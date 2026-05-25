import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Role,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { GuildConfig, UserProfile } from "../../db/schemas";
import { recordIntel } from "../intel";
import { logger } from "../../lib/logger";

export const warCommandDefs = [
  new SlashCommandBuilder()
    .setName("war")
    .setDescription("Comandos de guerra táctica")
    .addSubcommand((s) =>
      s.setName("alert")
        .setDescription("Publicar alerta de guerra")
        .addStringOption((o) =>
          o.setName("prioridad").setDescription("Nivel de prioridad de la alerta").setRequired(true)
            .addChoices(
              { name: "🔴 Critical", value: "Critical" },
              { name: "🟠 High",     value: "High" },
              { name: "🟡 Medium",   value: "Medium" },
              { name: "🟢 Low",      value: "Low" },
            ),
        )
        .addStringOption((o) => o.setName("detalles").setDescription("Detalles de la alerta").setRequired(true))
        .addRoleOption((o) => o.setName("mencionar").setDescription("Rol a pingear con la alerta").setRequired(false)),
    )
    .addSubcommand((s) =>
      s.setName("attack")
        .setDescription("Publicar orden de ataque")
        .addStringOption((o) => o.setName("objetivo").setDescription("Objetivo del ataque").setRequired(true))
        .addStringOption((o) => o.setName("coordenadas").setDescription("Coordenadas X:Y").setRequired(true))
        .addStringOption((o) => o.setName("tropa").setDescription("Tipo de tropa requerida").setRequired(true))
        .addStringOption((o) => o.setName("hora_utc").setDescription("Hora en UTC (ej: 20:00 UTC)").setRequired(true))
        .addStringOption((o) =>
          o.setName("prioridad").setDescription("Nivel de prioridad").setRequired(true)
            .addChoices(
              { name: "🔴 Critical", value: "Critical" },
              { name: "🟠 High",     value: "High" },
              { name: "🟡 Medium",   value: "Medium" },
              { name: "🟢 Low",      value: "Low" },
            ),
        )
        .addRoleOption((o) => o.setName("mencionar").setDescription("Rol a pingear con la orden").setRequired(false)),
    )
    .addSubcommand((s) =>
      s.setName("defense")
        .setDescription("Publicar orden de defensa")
        .addStringOption((o) => o.setName("estructura").setDescription("Estructura a defender").setRequired(true))
        .addStringOption((o) => o.setName("coordenadas").setDescription("Coordenadas X:Y").setRequired(true))
        .addStringOption((o) => o.setName("capitan").setDescription("Capitán de guarnición").setRequired(true))
        .addStringOption((o) =>
          o.setName("prioridad").setDescription("Nivel de prioridad").setRequired(true)
            .addChoices(
              { name: "🔴 Critical", value: "Critical" },
              { name: "🟠 High",     value: "High" },
              { name: "🟡 Medium",   value: "Medium" },
              { name: "🟢 Low",      value: "Low" },
            ),
        )
        .addRoleOption((o) => o.setName("mencionar").setDescription("Rol a pingear con la orden").setRequired(false)),
    ),
].map((b) => b.toJSON());

interface AlertData {
  ready: string[];
  late: string[];
  no: string[];
  pointedUsers: Set<string>;
}

const alertResponses = new Map<string, AlertData>();

const PRIORITY_COLOR: Record<string, number>  = { Critical: 0xed4245, High: 0xff7b00, Medium: 0xfee75c, Low: 0x57f287 };
const PRIORITY_EMOJI: Record<string, string>  = { Critical: "🔴", High: "🟠", Medium: "🟡", Low: "🟢" };
const PRIORITY_LABEL: Record<string, string>  = { Critical: "CRÍTICO", High: "ALTO", Medium: "MEDIO", Low: "BAJO" };

function buildAlertButtons(messageId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`alert_ready:${messageId}`).setLabel("✅ En camino").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`alert_no:${messageId}`).setLabel("❌ No disponible").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`alert_late:${messageId}`).setLabel("⏳ Llego tarde").setStyle(ButtonStyle.Secondary),
  );
}

function responderBar(count: number): string {
  if (count === 0) return "—";
  return `**${count}** miembro${count !== 1 ? "s" : ""}`;
}

function buildAlertEmbed(
  priority: string,
  details: string,
  reporterId: string,
  reporterName: string,
  reporterAvatar: string,
  counts: { ready: number; late: number; no: number },
): EmbedBuilder {
  const color  = PRIORITY_COLOR[priority] ?? 0xff4400;
  const pEmoji = PRIORITY_EMOJI[priority] ?? "⚡";
  const pLabel = PRIORITY_LABEL[priority] ?? priority.toUpperCase();
  const now    = Math.floor(Date.now() / 1000);

  return new EmbedBuilder()
    .setAuthor({ name: reporterName, iconURL: reporterAvatar })
    .setTitle(`${pEmoji}  ALERTA DE GUERRA — NIVEL ${pLabel}`)
    .setColor(color)
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `> ${details}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    )
    .addFields(
      { name: "👤 Reportado por", value: `<@${reporterId}>`,      inline: true },
      { name: "🕐 Hora",          value: `<t:${now}:t>`,           inline: true },
      { name: "🎖️ Prioridad",    value: `${pEmoji} **${pLabel}**`, inline: true },
      { name: "✅ En camino",     value: responderBar(counts.ready), inline: true },
      { name: "⏳ Llego tarde",   value: responderBar(counts.late),  inline: true },
      { name: "❌ No disponible", value: responderBar(counts.no),    inline: true },
    )
    .setTimestamp()
    .setFooter({ text: "Kingdom Guardian Pro  •  Sistema Táctico  •  Responde abajo 👇" });
}

export async function handleWarCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub      = interaction.options.getSubcommand();
  const guildId  = interaction.guild.id;
  const config   = await GuildConfig.findOne({ guildId });
  const member   = interaction.guild.members.cache.get(interaction.user.id);
  const userName  = member?.displayName ?? interaction.user.username;
  const userAvatar = interaction.user.displayAvatarURL();

  try {
    if (sub === "alert") {
      const priority  = interaction.options.getString("prioridad", true);
      const details   = interaction.options.getString("detalles", true);
      const mentionRole = interaction.options.getRole("mencionar") as Role | null;
      const channelId = config?.channels?.warAlerts ?? interaction.channelId;
      const chan = (interaction.guild.channels.cache.get(channelId) ?? interaction.channel) as TextChannel;

      const counts = { ready: 0, late: 0, no: 0 };
      const embed  = buildAlertEmbed(priority, details, interaction.user.id, userName, userAvatar, counts);
      const row    = buildAlertButtons("PLACEHOLDER");
      const pingContent = mentionRole ? `<@&${mentionRole.id}>` : "@here";

      const msg = await chan.send({
        content: pingContent,
        embeds: [embed],
        components: [row],
        allowedMentions: mentionRole ? { roles: [mentionRole.id] } : { parse: ["everyone"] },
      });
      alertResponses.set(msg.id, { ready: [], late: [], no: [], pointedUsers: new Set() });
      await msg.edit({ components: [buildAlertButtons(msg.id)] });
      await interaction.reply({ content: `✅ Alerta publicada en ${chan}`, ephemeral: true });

      await recordIntel({
        sourceGuildId: guildId,
        allianceTag: config?.allianceTag ?? "UNKNOWN",
        actionType: "ALERT",
        coords: "N/A",
        details: `[ALERT] Priority: ${priority} — ${details}`,
        reportedBy: interaction.user.id,
      });

    } else if (sub === "attack") {
      const objetivo    = interaction.options.getString("objetivo", true);
      const coords      = interaction.options.getString("coordenadas", true);
      const tropa       = interaction.options.getString("tropa", true);
      const hora        = interaction.options.getString("hora_utc", true);
      const priority    = interaction.options.getString("prioridad", true);
      const mentionRole = interaction.options.getRole("mencionar") as Role | null;
      const channelId   = config?.channels?.attackOrders ?? interaction.channelId;
      const chan = (interaction.guild.channels.cache.get(channelId) ?? interaction.channel) as TextChannel;

      const color  = PRIORITY_COLOR[priority] ?? 0xcc0000;
      const pEmoji = PRIORITY_EMOJI[priority] ?? "⚡";
      const pLabel = PRIORITY_LABEL[priority] ?? priority.toUpperCase();

      const embed = new EmbedBuilder()
        .setAuthor({ name: userName, iconURL: userAvatar })
        .setTitle(`⚔️  ORDEN DE ATAQUE`)
        .setColor(color)
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `**OBJETIVO  ›  ${objetivo}**\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        )
        .addFields(
          { name: "📍 Coordenadas",      value: `\`\`${coords}\`\``,         inline: true },
          { name: "⚔️ Tropa Requerida",  value: tropa,                        inline: true },
          { name: "🕐 Hora de Ataque",   value: `\`\`${hora}\`\``,            inline: true },
          { name: "🎖️ Prioridad",        value: `${pEmoji} **${pLabel}**`,    inline: true },
          { name: "👑 Comandante",        value: `<@${interaction.user.id}>`,  inline: true },
          { name: "\u200b",              value: "\u200b",                      inline: true },
        )
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro  •  Comando Táctico  •  Ejecuten la orden" });

      const pingContent = mentionRole ? `<@&${mentionRole.id}>` : null;
      await chan.send({
        content: pingContent ?? undefined,
        embeds: [embed],
        allowedMentions: mentionRole ? { roles: [mentionRole.id] } : { parse: [] },
      });
      await interaction.reply({ content: `⚔️ Orden publicada en ${chan}`, ephemeral: true });

      await recordIntel({
        sourceGuildId: guildId,
        allianceTag: config?.allianceTag ?? "UNKNOWN",
        actionType: "ATTACK",
        coords,
        details: `Objetivo: ${objetivo} | Tropa: ${tropa} | Hora: ${hora}`,
        reportedBy: interaction.user.id,
      });

    } else if (sub === "defense") {
      const estructura  = interaction.options.getString("estructura", true);
      const coords      = interaction.options.getString("coordenadas", true);
      const capitan     = interaction.options.getString("capitan", true);
      const priority    = interaction.options.getString("prioridad", true);
      const mentionRole = interaction.options.getRole("mencionar") as Role | null;
      const channelId   = config?.channels?.defenseOrders ?? interaction.channelId;
      const chan = (interaction.guild.channels.cache.get(channelId) ?? interaction.channel) as TextChannel;

      const color  = PRIORITY_COLOR[priority] ?? 0x0055cc;
      const pEmoji = PRIORITY_EMOJI[priority] ?? "⚡";
      const pLabel = PRIORITY_LABEL[priority] ?? priority.toUpperCase();

      const embed = new EmbedBuilder()
        .setAuthor({ name: userName, iconURL: userAvatar })
        .setTitle(`🛡️  ORDEN DE DEFENSA`)
        .setColor(color)
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `**DEFENDER  ›  ${estructura}**\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        )
        .addFields(
          { name: "📍 Coordenadas",   value: `\`\`${coords}\`\``,        inline: true },
          { name: "👑 Capitán",       value: capitan,                     inline: true },
          { name: "🎖️ Prioridad",    value: `${pEmoji} **${pLabel}**`,   inline: true },
          { name: "🗡️ Comandante",   value: `<@${interaction.user.id}>`, inline: true },
          { name: "⏰ Emitida",       value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
          { name: "\u200b",           value: "\u200b",                    inline: true },
        )
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro  •  Comando Táctico  •  ¡A las posiciones!" });

      const pingContent = mentionRole ? `<@&${mentionRole.id}>` : null;
      await chan.send({
        content: pingContent ?? undefined,
        embeds: [embed],
        allowedMentions: mentionRole ? { roles: [mentionRole.id] } : { parse: [] },
      });
      await interaction.reply({ content: `🛡️ Orden de defensa publicada en ${chan}`, ephemeral: true });

      await recordIntel({
        sourceGuildId: guildId,
        allianceTag: config?.allianceTag ?? "UNKNOWN",
        actionType: "DEFENSE",
        coords,
        details: `Estructura: ${estructura} | Capitán: ${capitan} | Prioridad: ${priority}`,
        reportedBy: interaction.user.id,
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "War command error");
    await interaction.reply({ content: "❌ Error al ejecutar el comando.", ephemeral: true }).catch(() => {});
  }
}

export async function handleAlertButton(interaction: ButtonInteraction): Promise<void> {
  const [action, messageId] = interaction.customId.split(":");
  const data = alertResponses.get(messageId);
  if (!data) {
    await interaction.reply({ content: "Esta alerta ya no está activa.", ephemeral: true });
    return;
  }

  const userId  = interaction.user.id;
  const guildId = interaction.guild?.id;

  const wasPointed = data.pointedUsers.has(userId);

  data.ready = data.ready.filter((id) => id !== userId);
  data.late  = data.late.filter((id) => id !== userId);
  data.no    = data.no.filter((id) => id !== userId);

  let responseLabel = "";

  if (action === "alert_ready") {
    data.ready.push(userId);
    responseLabel = "✅ **En camino** registrado.";

    if (!data.pointedUsers.has(userId) && guildId) {
      data.pointedUsers.add(userId);
      try {
        await UserProfile.findOneAndUpdate(
          { discordId: userId, guildId },
          { $inc: { weeklyPoints: 3, totalPoints: 3 } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        responseLabel += " +3 pts acreditados 🏅";
      } catch (err) {
        logger.error({ err }, "Failed to award war attendance points");
      }
    } else {
      responseLabel = "✅ **En camino** registrado.";
    }

  } else if (action === "alert_late") {
    data.late.push(userId);
    responseLabel = "⏳ **Llego tarde** registrado.";

    if (wasPointed && guildId) {
      data.pointedUsers.delete(userId);
      try {
        await UserProfile.findOneAndUpdate(
          { discordId: userId, guildId },
          { $inc: { weeklyPoints: -3, totalPoints: -3 } },
          { upsert: false },
        );
      } catch (err) {
        logger.error({ err }, "Failed to deduct war points on status change");
      }
    }

  } else if (action === "alert_no") {
    data.no.push(userId);
    responseLabel = "❌ **No disponible** registrado.";

    if (wasPointed && guildId) {
      data.pointedUsers.delete(userId);
      try {
        await UserProfile.findOneAndUpdate(
          { discordId: userId, guildId },
          { $inc: { weeklyPoints: -3, totalPoints: -3 } },
          { upsert: false },
        );
      } catch (err) {
        logger.error({ err }, "Failed to deduct war points on status change");
      }
    }
  }

  const oldEmbed = interaction.message.embeds[0];
  if (!oldEmbed) return;

  const updated = EmbedBuilder.from(oldEmbed).setFields(
    { name: "👤 Reportado por", value: oldEmbed.fields.find((f) => f.name === "👤 Reportado por")?.value ?? "—", inline: true },
    { name: "🕐 Hora",          value: oldEmbed.fields.find((f) => f.name === "🕐 Hora")?.value ?? "—",          inline: true },
    { name: "🎖️ Prioridad",    value: oldEmbed.fields.find((f) => f.name === "🎖️ Prioridad")?.value ?? "—",    inline: true },
    { name: "✅ En camino",     value: responderBar(data.ready.length), inline: true },
    { name: "⏳ Llego tarde",   value: responderBar(data.late.length),  inline: true },
    { name: "❌ No disponible", value: responderBar(data.no.length),    inline: true },
  );

  await interaction.update({ embeds: [updated] });
  if (responseLabel) {
    await interaction.followUp({ content: responseLabel, ephemeral: true });
  }
}
