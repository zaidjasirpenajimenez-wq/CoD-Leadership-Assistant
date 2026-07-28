import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  Role,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextChannel,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
} from "discord.js";
import { GuildConfig, UserProfile, WarAlertLog } from "../../db/schemas";
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
    )
    .addSubcommand((s) =>
      s.setName("history")
        .setDescription("Ver historial de alertas de guerra cerradas")
        .addIntegerOption((o) =>
          o.setName("limite").setDescription("Cantidad a mostrar (máx 15, por defecto 10)").setRequired(false).setMinValue(1).setMaxValue(15),
        ),
    ),
].map((b) => b.toJSON());

interface AlertData {
  ready: string[];
  late: string[];
  no: string[];
  pointedUsers: Set<string>;
  priority: string;
  details: string;
  guildId: string;
  createdBy: string;
  createdAt: Date;
}

const alertResponses = new Map<string, AlertData>();

// Purge alert entries older than 24 h to prevent unbounded memory growth.
// Called each time a new alert is created so no separate timer is needed.
const ALERT_TTL_MS = 24 * 60 * 60 * 1000;
function purgeStaleAlerts() {
  const cutoff = Date.now() - ALERT_TTL_MS;
  for (const [id, data] of alertResponses) {
    if (data.createdAt.getTime() < cutoff) alertResponses.delete(id);
  }
}

const PRIORITY_COLOR: Record<string, number>  = { Critical: 0xed4245, High: 0xff7b00, Medium: 0xfee75c, Low: 0x57f287 };
const PRIORITY_EMOJI: Record<string, string>  = { Critical: "🔴", High: "🟠", Medium: "🟡", Low: "🟢" };
const PRIORITY_LABEL: Record<string, string>  = { Critical: "CRÍTICO", High: "ALTO", Medium: "MEDIO", Low: "BAJO" };

function buildAlertButtons(messageId: string): ActionRowBuilder<ButtonBuilder>[] {
  const attendanceRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`alert_ready:${messageId}`).setLabel("✅ En camino").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`alert_no:${messageId}`).setLabel("❌ No disponible").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`alert_late:${messageId}`).setLabel("⏳ Llego tarde").setStyle(ButtonStyle.Secondary),
  );
  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`alert_close:${messageId}`)
      .setLabel("🗡️ Confirmar Asistencia")
      .setStyle(ButtonStyle.Primary),
  );
  return [attendanceRow, confirmRow];
}

function buildDisabledAlertButtons(messageId: string, confirmedCount: number): ActionRowBuilder<ButtonBuilder>[] {
  const attendanceRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`alert_ready:${messageId}`).setLabel("✅ En camino").setStyle(ButtonStyle.Success).setDisabled(true),
    new ButtonBuilder().setCustomId(`alert_no:${messageId}`).setLabel("❌ No disponible").setStyle(ButtonStyle.Danger).setDisabled(true),
    new ButtonBuilder().setCustomId(`alert_late:${messageId}`).setLabel("⏳ Llego tarde").setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
  const closedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`alert_close:${messageId}`)
      .setLabel(`✅ Cerrada — ${confirmedCount} confirmados`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
  );
  return [attendanceRow, closedRow];
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
      const pingContent = mentionRole ? `<@&${mentionRole.id}>` : "@here";

      const msg = await chan.send({
        content: pingContent,
        embeds: [embed],
        components: buildAlertButtons("PLACEHOLDER"),
        allowedMentions: mentionRole ? { roles: [mentionRole.id] } : { parse: ["everyone"] },
      });
      purgeStaleAlerts();
      alertResponses.set(msg.id, {
        ready: [], late: [], no: [], pointedUsers: new Set(),
        priority, details, guildId,
        createdBy: interaction.user.id,
        createdAt: new Date(),
      });
      await msg.edit({ components: buildAlertButtons(msg.id) });
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

    } else if (sub === "history") {
      await interaction.deferReply({ ephemeral: true });
      const limite = interaction.options.getInteger("limite") ?? 10;

      const logs = await WarAlertLog.find({ guildId })
        .sort({ closedAt: -1 })
        .limit(limite)
        .lean();

      if (logs.length === 0) {
        await interaction.editReply({ content: "📭 No hay alertas de guerra cerradas registradas todavía." });
        return;
      }

      const PRIO_EMOJI: Record<string, string> = { Critical: "🔴", High: "🟠", Medium: "🟡", Low: "🟢" };

      const lines = logs.map((log, i) => {
        const date  = `<t:${Math.floor(new Date(log.closedAt).getTime() / 1000)}:d>`;
        const pEmoji = PRIO_EMOJI[log.priority] ?? "⚔️";
        const by    = log.createdBy ? ` · <@${log.createdBy}>` : "";
        return (
          `${pEmoji} **#${i + 1}** ${date} — ${log.priority.toUpperCase()}${by}\n` +
          `> 📋 ${log.details.substring(0, 60)}${log.details.length > 60 ? "…" : ""}\n` +
          `> ✅ ${log.readyCount} en camino · ⏳ ${log.lateCount} tarde · 🏅 ${log.totalPts} pts`
        );
      });

      const totalAlerts = await WarAlertLog.countDocuments({ guildId });
      const totalPtsAll = await WarAlertLog.aggregate<{ total: number }>([
        { $match: { guildId } },
        { $group: { _id: null, total: { $sum: "$totalPts" } } },
      ]).then((r) => r[0]?.total ?? 0);

      const embed = new EmbedBuilder()
        .setTitle("⚔️ Historial de alertas de guerra")
        .setColor(0xed4245)
        .setDescription(lines.join("\n\n"))
        .addFields(
          { name: "📊 Alertas totales",      value: `**${totalAlerts}**`,  inline: true },
          { name: "🏅 Puntos repartidos",    value: `**${totalPtsAll}**`,  inline: true },
        )
        .setFooter({ text: `Mostrando las últimas ${logs.length} alertas · Kingdom Guardian Pro` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
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
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
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

export async function handleAlertClose(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [, messageId] = interaction.customId.split(":");
  const data = alertResponses.get(messageId);

  if (!data) {
    await interaction.reply({ content: "Esta alerta ya no está activa.", ephemeral: true });
    return;
  }

  const member = interaction.guild.members.cache.get(interaction.user.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "❌ Solo los oficiales (R4/R5) pueden confirmar asistencia.", ephemeral: true });
    return;
  }

  const attendees = [...data.ready, ...data.late];
  if (attendees.length === 0) {
    await interaction.reply({ content: "⚠️ No hay nadie para confirmar (nadie respondió ✅ ni ⏳ todavía).", ephemeral: true });
    return;
  }

  const guildMembers = interaction.guild.members.cache;
  const options = attendees.slice(0, 25).map((userId) => {
    const m = guildMembers.get(userId);
    const name = (m?.displayName ?? userId).substring(0, 100);
    const isLate = data.late.includes(userId);
    return new StringSelectMenuOptionBuilder()
      .setValue(userId)
      .setLabel(name)
      .setDescription(isLate ? "⏳ Llego tarde → +2 pts" : "✅ En camino → +5 pts");
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`alert_confirm_select:${messageId}`)
    .setPlaceholder("Selecciona quién confirmó asistencia…")
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options);

  const listRow  = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const extraMenu = new UserSelectMenuBuilder()
    .setCustomId(`alert_extra_select:${messageId}`)
    .setPlaceholder("Jugadores que ayudaron pero no respondieron en Discord…")
    .setMinValues(0)
    .setMaxValues(10);

  const extraRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(extraMenu);

  await interaction.reply({
    content:
      `**🗡️ Confirmar asistencia de guerra**\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `**① Respondieron en Discord** — selecciona quién participó:\n` +
      `> ✅ En camino → **+5 pts** · ⏳ Llego tarde → **+2 pts**\n\n` +
      `**② No respondieron pero sí ayudaron** — agrégalos antes de confirmar:\n` +
      `> 👥 Extras → **+5 pts** c/u\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    components: [listRow, extraRow],
    ephemeral: true,
  });
}

export async function handleAlertExtraSelect(interaction: UserSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [, messageId] = interaction.customId.split(":");
  const guildId  = interaction.guild.id;
  const members  = interaction.guild.members.cache;
  const lines: string[] = [];

  for (const userId of interaction.values) {
    try {
      await UserProfile.findOneAndUpdate(
        { discordId: userId, guildId },
        { $inc: { weeklyPoints: 5, totalPoints: 5 } },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      );
      const name = members.get(userId)?.displayName ?? `<@${userId}>`;
      lines.push(`👥 **${name}** — +5 pts`);
    } catch (err) {
      logger.error({ err }, "Failed to award extra war participation points");
    }
  }

  const summary = lines.length > 0
    ? `✅ **Extras acreditados:**\n${lines.join("\n")}\n\n*Ahora usa la lista ① para cerrar la alerta.*`
    : "⚠️ No se seleccionó ningún jugador extra.";

  await interaction.reply({ content: summary, ephemeral: true });
}

export async function handleAlertConfirmSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [, messageId] = interaction.customId.split(":");
  const data = alertResponses.get(messageId);
  const guildId = interaction.guild.id;

  if (!data) {
    await interaction.update({ content: "Esta alerta ya no está activa.", components: [] });
    return;
  }

  const confirmedIds = interaction.values;
  const guildMembers = interaction.guild.members.cache;
  const lines: string[] = [];

  for (const userId of confirmedIds) {
    const isLate  = data.late.includes(userId);
    const isReady = data.ready.includes(userId);
    const pts     = isLate ? 2 : isReady ? 5 : 0;
    if (pts === 0) continue;

    try {
      await UserProfile.findOneAndUpdate(
        { discordId: userId, guildId },
        { $inc: { weeklyPoints: pts, totalPoints: pts } },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      );
      const name = guildMembers.get(userId)?.displayName ?? `<@${userId}>`;
      const icon = isLate ? "⏳" : "✅";
      lines.push(`${icon} **${name}** — +${pts} pts`);
    } catch (err) {
      logger.error({ err }, "Failed to award war confirmation points");
    }
  }

  const originalMsg = await interaction.channel?.messages.fetch(messageId).catch(() => null);
  if (originalMsg) {
    const oldEmbed = originalMsg.embeds[0];
    if (oldEmbed) {
      const closedEmbed = EmbedBuilder.from(oldEmbed)
        .setColor(0x57f287)
        .setFooter({ text: `Kingdom Guardian Pro  •  Alerta cerrada — ${confirmedIds.length} asistencia(s) confirmada(s)` });
      await originalMsg.edit({ embeds: [closedEmbed], components: buildDisabledAlertButtons(messageId, confirmedIds.length) });
    }
  }

  const attendeeLog = confirmedIds
    .filter((id) => data.late.includes(id) || data.ready.includes(id))
    .map((id) => ({ userId: id, pts: data.late.includes(id) ? 2 : 5 }));
  const totalPts = attendeeLog.reduce((s, a) => s + a.pts, 0);

  WarAlertLog.create({
    guildId:    data.guildId,
    priority:   data.priority,
    details:    data.details,
    createdBy:  data.createdBy,
    attendees:  attendeeLog,
    readyCount: attendeeLog.filter((a) => a.pts === 5).length,
    lateCount:  attendeeLog.filter((a) => a.pts === 2).length,
    totalPts,
    createdAt:  data.createdAt,
    closedAt:   new Date(),
  }).catch((err) => logger.error({ err }, "Failed to save WarAlertLog"));

  alertResponses.delete(messageId);

  const summary =
    lines.length > 0
      ? `✅ **Asistencia confirmada:**\n${lines.join("\n")}`
      : "⚠️ No se seleccionó ningún asistente. La alerta fue cerrada sin acreditar puntos.";

  await interaction.update({ content: summary, components: [] });
}
