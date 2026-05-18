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
          o.setName("madera").setDescription("Cantidad de Madera 🪵").setRequired(false).setMinValue(1),
        )
        .addIntegerOption((o) =>
          o.setName("piedra").setDescription("Cantidad de Piedra 🪨").setRequired(false).setMinValue(1),
        )
        .addIntegerOption((o) =>
          o.setName("oro").setDescription("Cantidad de Oro 💰").setRequired(false).setMinValue(1),
        ),
    ),
].map((b) => b.toJSON());

interface RequestData {
  requesterId: string;
  donorId?: string;
}

// messageId → RequestData
const activeRequests = new Map<string, RequestData>();
// `${guildId}:${userId}` → messageId
const userActiveRequest = new Map<string, string>();

const PROPOSITO_EMOJI: Record<string, string> = {
  "Entrenar tropas": "⚔️",
  "Investigar": "🔬",
  "Construir": "🏗️",
  "Curar tropas": "🏥",
};

function buildInitialButtons(msgId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`sres_help:${msgId}`)
      .setLabel("🤝 Enviar Ayuda")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`sres_cancel:${msgId}`)
      .setLabel("❌ Cancelar solicitud")
      .setStyle(ButtonStyle.Danger),
  );
}

function buildWaitingConfirmButtons(msgId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`sres_help:${msgId}`)
      .setLabel("🤝 Ayuda enviada")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`sres_confirm:${msgId}`)
      .setLabel("✅ Confirmar recepción")
      .setStyle(ButtonStyle.Success),
  );
}

function buildCompletedButtons(msgId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`sres_done:${msgId}`)
      .setLabel("✅ Completado")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
  );
}

function buildCancelledButtons(msgId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`sres_cancelled:${msgId}`)
      .setLabel("❌ Cancelada")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
  );
}

export async function handleResourceCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  if (sub !== "resources") return;

  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  await interaction.deferReply({ ephemeral: true });

  // Limit: 1 active request per user
  const existingMsgId = userActiveRequest.get(`${guildId}:${userId}`);
  if (existingMsgId && activeRequests.has(existingMsgId)) {
    await interaction.editReply({
      content: "⚠️ Ya tienes una solicitud activa pendiente. Espera a que sea atendida o cancélala antes de hacer una nueva.",
    });
    return;
  }

  const proposito = interaction.options.getString("proposito", true);
  const madera = interaction.options.getInteger("madera");
  const piedra = interaction.options.getInteger("piedra");
  const oro    = interaction.options.getInteger("oro");

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
    .setFooter({ text: "Kingdom Guardian Pro — Banco de Suministros • +5 pts al confirmar ayuda" });

  // Send with placeholder first, then update with real IDs
  const placeholderRow = buildInitialButtons("PLACEHOLDER");
  const msg = await targetChan.send({ embeds: [embed], components: [placeholderRow] });

  activeRequests.set(msg.id, { requesterId: userId });
  userActiveRequest.set(`${guildId}:${userId}`, msg.id);

  await msg.edit({ components: [buildInitialButtons(msg.id)] });

  const resumen = [
    madera ? `🪵 Madera: **${madera.toLocaleString("es-ES")}**` : null,
    piedra ? `🪨 Piedra: **${piedra.toLocaleString("es-ES")}**` : null,
    oro    ? `💰 Oro: **${oro.toLocaleString("es-ES")}**`       : null,
  ].filter(Boolean).join("\n");

  await interaction.editReply({
    content: `✅ Solicitud publicada en ${targetChan}:\n${resumen}\n${propEmoji} Para: **${proposito}**`,
  });
}

export async function handleResourceButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const [action, messageId] = interaction.customId.split(":");
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;
  const data = activeRequests.get(messageId);

  // ── Cancelar solicitud ─────────────────────────────────────────────────────
  if (action === "sres_cancel") {
    if (!data) {
      await interaction.reply({ content: "Esta solicitud ya no existe.", ephemeral: true });
      return;
    }
    if (data.requesterId !== userId) {
      await interaction.reply({
        content: "❌ Solo el solicitante puede cancelar esta solicitud.",
        ephemeral: true,
      });
      return;
    }
    if (data.donorId) {
      await interaction.reply({
        content: "⚠️ Ya hay alguien enviándote ayuda. Confirma la recepción o contacta al donante.",
        ephemeral: true,
      });
      return;
    }

    const oldEmbed = interaction.message.embeds[0];
    const updated = EmbedBuilder.from(oldEmbed)
      .spliceFields(
        oldEmbed.fields.findIndex((f) => f.name === "Estado"),
        1,
        { name: "Estado", value: "❌ Cancelada por el solicitante", inline: false },
      )
      .setColor(0xcc2222);

    await interaction.update({ embeds: [updated], components: [buildCancelledButtons(messageId)] });

    userActiveRequest.delete(`${guildId}:${data.requesterId}`);
    activeRequests.delete(messageId);
    return;
  }

  // ── Enviar ayuda ───────────────────────────────────────────────────────────
  if (action === "sres_help") {
    if (!data) {
      await interaction.reply({ content: "Esta solicitud ya no existe.", ephemeral: true });
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

    const oldEmbed = interaction.message.embeds[0];
    const updated = EmbedBuilder.from(oldEmbed)
      .spliceFields(
        oldEmbed.fields.findIndex((f) => f.name === "Estado"),
        1,
        {
          name: "Estado",
          value: `🟢 Ayuda en camino — <@${userId}> está enviando los recursos\n📌 <@${data.requesterId}> confirma cuando los recibas`,
          inline: false,
        },
      )
      .setColor(0x3399ff);

    await interaction.update({
      embeds: [updated],
      components: [buildWaitingConfirmButtons(messageId)],
    });
    return;
  }

  // ── Confirmar recepción ────────────────────────────────────────────────────
  if (action === "sres_confirm") {
    if (!data) {
      await interaction.reply({ content: "Esta solicitud ya fue cerrada.", ephemeral: true });
      return;
    }
    if (data.requesterId !== userId) {
      await interaction.reply({
        content: "❌ Solo el solicitante puede confirmar la recepción.",
        ephemeral: true,
      });
      return;
    }
    if (!data.donorId) {
      await interaction.reply({
        content: "⚠️ Nadie ha aceptado tu solicitud todavía.",
        ephemeral: true,
      });
      return;
    }

    // Award +5 pts to the donor now that delivery is confirmed
    try {
      await UserProfile.findOneAndUpdate(
        { discordId: data.donorId, guildId },
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
          value: `✅ COMPLETADO — <@${data.requesterId}> confirmó la recepción\n🏅 +5 pts acreditados a <@${data.donorId}>`,
          inline: false,
        },
      )
      .setColor(0x00cc55);

    await interaction.update({
      embeds: [updated],
      components: [buildCompletedButtons(messageId)],
    });

    await interaction.followUp({
      content: `✅ ¡Recepción confirmada! <@${data.donorId}> recibe **+5 puntos semanales** por su ayuda.`,
      ephemeral: false,
    });

    userActiveRequest.delete(`${guildId}:${data.requesterId}`);
    activeRequests.delete(messageId);
    return;
  }
}
