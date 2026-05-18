import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { GuildConfig, UserProfile } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const resourceCommandDefs = [
  new SlashCommandBuilder()
    .setName("request")
    .setDescription("Solicitar recursos del banco de suministros")
    .addSubcommand((s) =>
      s
        .setName("resources")
        .setDescription("Solicitar uno o varios recursos en una sola petición")
        .addStringOption((o) =>
          o
            .setName("proposito")
            .setDescription("¿Para qué utilizarás los recursos?")
            .setRequired(true)
            .addChoices(
              { name: "⚔️ Entrenar tropas", value: "Entrenar tropas" },
              { name: "🔬 Investigar", value: "Investigar" },
              { name: "🏗️ Construir", value: "Construir" },
              { name: "🏥 Curar tropas", value: "Curar tropas" },
            ),
        )
        .addIntegerOption((o) =>
          o
            .setName("madera")
            .setDescription("Cantidad de Madera 🪵")
            .setRequired(false)
            .setMinValue(1),
        )
        .addIntegerOption((o) =>
          o
            .setName("piedra")
            .setDescription("Cantidad de Piedra 🪨")
            .setRequired(false)
            .setMinValue(1),
        )
        .addIntegerOption((o) =>
          o
            .setName("oro")
            .setDescription("Cantidad de Oro 💰")
            .setRequired(false)
            .setMinValue(1),
        ),
    ),
].map((b) => b.toJSON());

// messageId → { requesterId, donorId? }
const activeRequests = new Map<string, { requesterId: string; donorId?: string }>();

// userId → messageId  (limit: 1 active request per user)
const userActiveRequest = new Map<string, string>();

const PROPOSITO_EMOJI: Record<string, string> = {
  "Entrenar tropas": "⚔️",
  "Investigar": "🔬",
  "Construir": "🏗️",
  "Curar tropas": "🏥",
};

export async function handleResourceCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  if (sub !== "resources") return;

  await interaction.deferReply({ ephemeral: true });

  // Check if user already has an active request
  const existingMsgId = userActiveRequest.get(`${guildId}:${userId}`);
  if (existingMsgId && activeRequests.has(existingMsgId)) {
    await interaction.editReply({
      content: "⚠️ Ya tienes una solicitud activa pendiente. Espera a que sea atendida antes de hacer una nueva.",
    });
    return;
  }

  const proposito = interaction.options.getString("proposito", true);
  const madera = interaction.options.getInteger("madera");
  const piedra = interaction.options.getInteger("piedra");
  const oro = interaction.options.getInteger("oro");

  // At least one resource must be specified
  if (!madera && !piedra && !oro) {
    await interaction.editReply({
      content: "❌ Debes especificar al menos un recurso (Madera, Piedra u Oro).",
    });
    return;
  }

  const config = await GuildConfig.findOne({ guildId });
  const targetChannelId = config?.channels?.resourceRequests ?? interaction.channelId;
  const targetChan = (
    interaction.guild.channels.cache.get(targetChannelId) ?? interaction.channel
  ) as TextChannel;

  const propEmoji = PROPOSITO_EMOJI[proposito] ?? "📌";

  const resourceFields = [
    madera ? { name: "🪵 Madera", value: madera.toLocaleString("es-ES"), inline: true } : null,
    piedra ? { name: "🪨 Piedra", value: piedra.toLocaleString("es-ES"), inline: true } : null,
    oro    ? { name: "💰 Oro",    value: oro.toLocaleString("es-ES"),    inline: true } : null,
  ].filter(Boolean) as { name: string; value: string; inline: boolean }[];

  const embed = new EmbedBuilder()
    .setTitle("📦 SOLICITUD DE RECURSOS — BANCO DE SUMINISTROS")
    .setColor(0x22bb77)
    .addFields(
      ...resourceFields,
      { name: `${propEmoji} Propósito`, value: proposito, inline: false },
      { name: "👤 Solicitante", value: `<@${userId}>`, inline: true },
      { name: "Estado", value: "🟡 Pendiente de ayuda", inline: false },
    )
    .setTimestamp()
    .setFooter({ text: "Kingdom Guardian Pro — Banco de Suministros • +5 pts por ayudar" });

  const placeholderRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("sres_help:PLACEHOLDER")
      .setLabel("🤝 Enviar Ayuda")
      .setStyle(ButtonStyle.Primary),
  );

  const msg = await targetChan.send({ embeds: [embed], components: [placeholderRow] });

  activeRequests.set(msg.id, { requesterId: userId });
  userActiveRequest.set(`${guildId}:${userId}`, msg.id);

  const realRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`sres_help:${msg.id}`)
      .setLabel("🤝 Enviar Ayuda")
      .setStyle(ButtonStyle.Primary),
  );
  await msg.edit({ components: [realRow] });

  const resumenRecursos = [
    madera ? `🪵 Madera: **${madera.toLocaleString("es-ES")}**` : null,
    piedra ? `🪨 Piedra: **${piedra.toLocaleString("es-ES")}**` : null,
    oro    ? `💰 Oro: **${oro.toLocaleString("es-ES")}**`       : null,
  ].filter(Boolean).join("\n");

  await interaction.editReply({
    content: `✅ Solicitud publicada en ${targetChan}:\n${resumenRecursos}\n${propEmoji} Para: **${proposito}**`,
  });
}

export async function handleResourceButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const [action, messageId] = interaction.customId.split(":");
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  if (action !== "sres_help") return;

  const data = activeRequests.get(messageId);
  if (!data) {
    await interaction.reply({
      content: "Esta solicitud ya fue completada o no existe.",
      ephemeral: true,
    });
    return;
  }
  if (data.donorId) {
    await interaction.reply({
      content: "⚠️ Esta solicitud ya fue aceptada por otro jugador.",
      ephemeral: true,
    });
    return;
  }
  if (data.requesterId === userId) {
    await interaction.reply({
      content: "❌ No puedes ayudarte a ti mismo.",
      ephemeral: true,
    });
    return;
  }

  data.donorId = userId;

  try {
    await UserProfile.findOneAndUpdate(
      { discordId: userId, guildId },
      { $inc: { weeklyPoints: 5, totalPoints: 5 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    logger.error({ err }, "Failed to award resource donation points");
  }

  const oldEmbed = interaction.message.embeds[0];
  const updated = EmbedBuilder.from(oldEmbed)
    .spliceFields(
      oldEmbed.fields.findIndex((f) => f.name === "Estado"),
      1,
      {
        name: "Estado",
        value: `✅ COMPLETADO — Ayudado por <@${userId}>`,
        inline: false,
      },
    )
    .setColor(0x00cc55);

  const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`sres_help:${messageId}`)
      .setLabel("✅ Completado")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
  );

  await interaction.update({ embeds: [updated], components: [disabledRow] });
  await interaction.followUp({
    content: "✅ ¡Registrado! +5 puntos semanales acreditados por tu ayuda.",
    ephemeral: true,
  });

  // Free up the requester's slot
  userActiveRequest.delete(`${guildId}:${data.requesterId}`);
  activeRequests.delete(messageId);
}
