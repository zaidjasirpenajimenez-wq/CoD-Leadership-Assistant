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
              { name: "🔬 Investigar",       value: "Investigar" },
              { name: "🏗️ Construir",       value: "Construir" },
              { name: "🏥 Curar tropas",     value: "Curar tropas" },
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
  requesterName: string;
}

const activeRequests  = new Map<string, RequestData>();
const userActiveRequest = new Map<string, string>();

const PROPOSITO_EMOJI: Record<string, string> = {
  "Entrenar tropas": "⚔️",
  "Investigar":      "🔬",
  "Construir":       "🏗️",
  "Curar tropas":    "🏥",
};

function fmt(n: number): string { return n.toLocaleString("es-ES"); }

function buildInitialButtons(msgId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`sres_help:${msgId}`).setLabel("🤝 Enviar Ayuda").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`sres_cancel:${msgId}`).setLabel("Cancelar solicitud").setStyle(ButtonStyle.Danger),
  );
}
function buildWaitingConfirmButtons(msgId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`sres_help:${msgId}`).setLabel("Ayuda en camino…").setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`sres_confirm:${msgId}`).setLabel("✅ Confirmar recepción").setStyle(ButtonStyle.Success),
  );
}
function buildCompletedButtons(msgId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`sres_done:${msgId}`).setLabel("✅ Completado").setStyle(ButtonStyle.Success).setDisabled(true),
  );
}
function buildCancelledButtons(msgId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`sres_cancelled:${msgId}`).setLabel("❌ Cancelada").setStyle(ButtonStyle.Danger).setDisabled(true),
  );
}

function buildRequestEmbed(opts: {
  userId: string;
  userName: string;
  userAvatar: string;
  proposito: string;
  madera: number | null;
  piedra: number | null;
  oro: number | null;
  status: "pending" | "inprogress" | "done" | "cancelled";
  donorId?: string;
}): EmbedBuilder {
  const { userId, userName, userAvatar, proposito, madera, piedra, oro, status, donorId } = opts;
  const propEmoji = PROPOSITO_EMOJI[proposito] ?? "📌";

  const resourceLine = [
    madera ? `🪵 **Madera:** \`${fmt(madera)}\`` : null,
    piedra ? `🪨 **Piedra:** \`${fmt(piedra)}\`` : null,
    oro    ? `💰 **Oro:** \`${fmt(oro)}\``       : null,
  ].filter(Boolean).join("  ·  ");

  const statusMap: Record<string, { label: string; color: number; bar: string }> = {
    pending:    { label: "🟡 Esperando donante",                        color: 0xfee75c, bar: "▱▱▱▱▱ `0 / 3`" },
    inprogress: { label: `🔵 <@${donorId}> está enviando los recursos`, color: 0x5865f2, bar: "▰▰▱▱▱ `En tránsito`" },
    done:       { label: "🟢 Completada — recursos recibidos",          color: 0x57f287, bar: "▰▰▰▰▰ `✓ Completado`" },
    cancelled:  { label: "🔴 Cancelada por el solicitante",             color: 0xed4245, bar: "— `Cancelada`" },
  };

  const st = statusMap[status];

  return new EmbedBuilder()
    .setAuthor({ name: userName, iconURL: userAvatar })
    .setTitle("📦  SOLICITUD DE SUMINISTROS")
    .setColor(st.color)
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${resourceLine}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    )
    .addFields(
      { name: `${propEmoji} Propósito`,   value: proposito,              inline: true },
      { name: "👤 Solicitante",           value: `<@${userId}>`,         inline: true },
      { name: "⏰ Solicitada",            value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      { name: "📊 Estado",                value: st.label,               inline: false },
    )
    .setTimestamp()
    .setFooter({ text: "Kingdom Guardian Pro  •  Banco de Suministros  •  +5 pts al donante confirmado" });
}

export async function handleResourceCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  if (sub !== "resources") return;

  const guildId = interaction.guild.id;
  const userId  = interaction.user.id;
  await interaction.deferReply({ ephemeral: true });

  const existingMsgId = userActiveRequest.get(`${guildId}:${userId}`);
  if (existingMsgId && activeRequests.has(existingMsgId)) {
    await interaction.editReply({ content: "⚠️ Ya tienes una solicitud activa. Cancélala antes de abrir una nueva." });
    return;
  }

  const proposito = interaction.options.getString("proposito", true);
  const madera    = interaction.options.getInteger("madera");
  const piedra    = interaction.options.getInteger("piedra");
  const oro       = interaction.options.getInteger("oro");

  if (!madera && !piedra && !oro) {
    await interaction.editReply({ content: "❌ Debes especificar al menos un recurso (Madera, Piedra u Oro)." });
    return;
  }

  const config        = await GuildConfig.findOne({ guildId });
  const targetChanId  = config?.channels?.resourceRequests ?? interaction.channelId;
  const targetChan    = (interaction.guild.channels.cache.get(targetChanId) ?? interaction.channel) as TextChannel;
  const member        = interaction.guild.members.cache.get(userId);
  const userName      = member?.displayName ?? interaction.user.username;
  const userAvatar    = interaction.user.displayAvatarURL();

  const embed = buildRequestEmbed({ userId, userName, userAvatar, proposito, madera, piedra, oro, status: "pending" });

  const msg = await targetChan.send({ embeds: [embed], components: [buildInitialButtons("PLACEHOLDER")] });
  activeRequests.set(msg.id, { requesterId: userId, requesterName: userName });
  userActiveRequest.set(`${guildId}:${userId}`, msg.id);
  await msg.edit({ components: [buildInitialButtons(msg.id)] });

  const resumen = [
    madera ? `🪵 **${fmt(madera)}** Madera` : null,
    piedra ? `🪨 **${fmt(piedra)}** Piedra` : null,
    oro    ? `💰 **${fmt(oro)}** Oro`       : null,
  ].filter(Boolean).join(" · ");

  await interaction.editReply({ content: `✅ Solicitud publicada en ${targetChan}:\n${resumen}` });
}

export async function handleResourceButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [action, messageId] = interaction.customId.split(":");
  const userId  = interaction.user.id;
  const guildId = interaction.guild.id;
  const data    = activeRequests.get(messageId);

  if (action === "sres_cancel") {
    if (!data) { await interaction.reply({ content: "Esta solicitud ya no existe.", ephemeral: true }); return; }
    if (data.requesterId !== userId) {
      await interaction.reply({ content: "❌ Solo el solicitante puede cancelar.", ephemeral: true }); return;
    }
    if (data.donorId) {
      await interaction.reply({ content: "⚠️ Ya hay alguien enviando ayuda. Confirma la recepción o contacta al donante.", ephemeral: true }); return;
    }

    const oldEmbed = interaction.message.embeds[0];
    const updated  = EmbedBuilder.from(oldEmbed)
      .setColor(0xed4245)
      .spliceFields(oldEmbed.fields.findIndex((f) => f.name === "📊 Estado"), 1,
        { name: "📊 Estado", value: "🔴 Cancelada por el solicitante", inline: false });

    await interaction.update({ embeds: [updated], components: [buildCancelledButtons(messageId)] });
    userActiveRequest.delete(`${guildId}:${data.requesterId}`);
    activeRequests.delete(messageId);
    return;
  }

  if (action === "sres_help") {
    if (!data) { await interaction.reply({ content: "Esta solicitud ya no existe.", ephemeral: true }); return; }
    if (data.donorId) { await interaction.reply({ content: "⚠️ Esta solicitud ya fue aceptada por otro jugador.", ephemeral: true }); return; }
    if (data.requesterId === userId) { await interaction.reply({ content: "❌ No puedes ayudarte a ti mismo.", ephemeral: true }); return; }

    data.donorId = userId;

    const oldEmbed = interaction.message.embeds[0];
    const updated  = EmbedBuilder.from(oldEmbed)
      .setColor(0x5865f2)
      .spliceFields(oldEmbed.fields.findIndex((f) => f.name === "📊 Estado"), 1,
        { name: "📊 Estado", value: `🔵 <@${userId}> está enviando los recursos\n*<@${data.requesterId}> confirma cuando los recibas*`, inline: false });

    await interaction.update({ embeds: [updated], components: [buildWaitingConfirmButtons(messageId)] });
    return;
  }

  if (action === "sres_confirm") {
    if (!data) { await interaction.reply({ content: "Esta solicitud ya fue cerrada.", ephemeral: true }); return; }
    if (data.requesterId !== userId) { await interaction.reply({ content: "❌ Solo el solicitante puede confirmar la recepción.", ephemeral: true }); return; }
    if (!data.donorId) { await interaction.reply({ content: "⚠️ Nadie ha aceptado tu solicitud todavía.", ephemeral: true }); return; }

    try {
      await UserProfile.findOneAndUpdate(
        { discordId: data.donorId, guildId },
        { $inc: { weeklyPoints: 5, totalPoints: 5 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    } catch (err) { logger.error({ err }, "Failed to award resource donation points"); }

    const oldEmbed = interaction.message.embeds[0];
    const updated  = EmbedBuilder.from(oldEmbed)
      .setColor(0x57f287)
      .spliceFields(oldEmbed.fields.findIndex((f) => f.name === "📊 Estado"), 1,
        { name: "📊 Estado", value: `🟢 **Completada** — <@${userId}> confirmó la recepción\n🏅 +5 pts acreditados a <@${data.donorId}>`, inline: false });

    await interaction.update({ embeds: [updated], components: [buildCompletedButtons(messageId)] });
    await interaction.followUp({
      content: `✅ ¡Recursos recibidos! <@${data.donorId}> gana **+5 puntos semanales** por su apoyo. 🏅`,
      ephemeral: false,
    });

    userActiveRequest.delete(`${guildId}:${data.requesterId}`);
    activeRequests.delete(messageId);
    return;
  }
}
