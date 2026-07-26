import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { GuildConfig, UserProfile, ResourceRequestLog, WarAlertLog } from "../../db/schemas";
import { logger } from "../../lib/logger";

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day  = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function startWeeklyReport(client: Client): void {
  setInterval(async () => {
    const now = new Date();
    if (now.getUTCDay() !== 0) return;
    const hour = now.getUTCHours();
    if (hour !== 20) return;

    const week = getISOWeek(now);

    let configs;
    try {
      configs = await GuildConfig.find({ "channels.weeklyReport": { $exists: true, $ne: null } }).lean();
    } catch (err) {
      logger.error({ err }, "Weekly report: failed to query guild configs");
      return;
    }

    for (const config of configs) {
      // Use DB-persisted week number so restarts don't trigger duplicate reports
      if ((config as { lastWeeklyReportSent?: number | null }).lastWeeklyReportSent === week) continue;
      try {
        await GuildConfig.updateOne({ guildId: config.guildId }, { $set: { lastWeeklyReportSent: week } });
        await generateAndPostReport(client, config.guildId, config.channels.weeklyReport!, config.allianceTag);
      } catch (err) {
        logger.error({ err, guildId: config.guildId }, "Weekly report: failed to post report");
      }
    }
  }, 60 * 60 * 1000);
}

async function generateAndPostReport(
  client: Client,
  guildId: string,
  channelId: string,
  allianceTag: string,
): Promise<void> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  await guild.members.fetch().catch(() => {});

  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (!channel?.isTextBased()) return;

  const weekStart = new Date();
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  weekStart.setUTCHours(0, 0, 0, 0);

  const [topPoints, topDonors, warLogs, inactiveCount, totalMembers] = await Promise.all([
    UserProfile.find({ guildId, weeklyPoints: { $gt: 0 } })
      .sort({ weeklyPoints: -1 })
      .limit(5)
      .lean(),
    ResourceRequestLog.aggregate<{ _id: string; count: number }>([
      { $match: { guildId, status: "done", closedAt: { $gte: weekStart } } },
      { $group: { _id: "$donorId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    WarAlertLog.find({ guildId, closedAt: { $gte: weekStart } }).lean(),
    UserProfile.countDocuments({ guildId, weeklyPoints: 0 }),
    UserProfile.countDocuments({ guildId }),
  ]);

  const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

  const topPtsLines =
    topPoints.length > 0
      ? topPoints
          .map((u, i) => {
            const name = guild.members.cache.get(u.discordId)?.displayName ?? u.ign ?? "—";
            return `${medals[i]} **${name}** — ${u.weeklyPoints} pts`;
          })
          .join("\n")
      : "*Sin actividad esta semana*";

  const topDonorLines =
    topDonors.length > 0
      ? topDonors
          .map((d, i) => {
            const name = guild.members.cache.get(d._id)?.displayName ?? `<@${d._id}>`;
            return `${medals[i]} **${name}** — ${d.count} donación${d.count !== 1 ? "es" : ""}`;
          })
          .join("\n")
      : "*Sin donaciones esta semana*";

  const warTotal      = warLogs.length;
  const warAttendees  = warLogs.reduce((sum, w) => sum + (w.attendees?.length ?? 0), 0);
  const warPts        = warLogs.reduce((sum, w) => sum + (w.totalPts ?? 0), 0);

  const activeCount = totalMembers - inactiveCount;

  const now = new Date();
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", timeZone: "UTC" });
  const weekLabel = `${fmtDate(weekStart)} – ${fmtDate(now)}`;

  const embed = new EmbedBuilder()
    .setTitle(`📊  REPORTE SEMANAL — [${allianceTag}]`)
    .setColor(0x5865f2)
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 **Semana:** ${weekLabel}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    )
    .addFields(
      { name: "🏆 Top 5 — Puntos semanales",    value: topPtsLines,    inline: false },
      { name: "🤝 Top 5 — Donantes de recursos", value: topDonorLines, inline: false },
      {
        name:   "⚔️ Guerras esta semana",
        value:  warTotal > 0
          ? `**${warTotal}** alerta${warTotal !== 1 ? "s" : ""} cerrada${warTotal !== 1 ? "s" : ""} · **${warAttendees}** asistencias · **${warPts}** pts repartidos`
          : "*Sin actividad de guerra*",
        inline: false,
      },
      {
        name:   "👥 Participación global",
        value:  `✅ **${activeCount}** activos   ·   ⚠️ **${inactiveCount}** inactivos   ·   👤 **${totalMembers}** total`,
        inline: false,
      },
    )
    .setFooter({ text: "Kingdom Guardian Pro  •  Reporte automático semanal — los puntos semanales han sido reiniciados" })
    .setTimestamp();

  await channel.send({
    content: "@here 📣 **¡Reporte semanal de la alianza publicado!**",
    embeds: [embed],
    allowedMentions: { parse: ["everyone"] },
  });

  await UserProfile.updateMany({ guildId }, { $set: { weeklyPoints: 0 } });
  logger.info({ guildId, week: getISOWeek(now) }, "Weekly report posted and weekly points reset");
}
