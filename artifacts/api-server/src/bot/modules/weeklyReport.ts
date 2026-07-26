import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { GuildConfig, UserProfile } from "../../db/schemas";
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
    if (now.getUTCDay() !== 0) return;   // solo domingos
    if (now.getUTCHours() !== 0) return; // 00:00 UTC = 19:00 COT

    const week = getISOWeek(now);

    let configs;
    try {
      configs = await GuildConfig.find({ "channels.weeklyReport": { $exists: true, $ne: null } }).lean();
    } catch (err) {
      logger.error({ err }, "Weekly report: failed to query guild configs");
      return;
    }

    for (const config of configs) {
      if ((config as { lastWeeklyReportSent?: number | null }).lastWeeklyReportSent === week) continue;
      try {
        await GuildConfig.updateOne({ guildId: config.guildId }, { $set: { lastWeeklyReportSent: week } });
        await postWeeklyTopPlayers(client, config.guildId, config.channels.weeklyReport!, config.allianceTag);
      } catch (err) {
        logger.error({ err, guildId: config.guildId }, "Weekly report: failed to post");
      }
    }
  }, 60 * 60 * 1000);
}

async function postWeeklyTopPlayers(
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

  const top = await UserProfile.find({ guildId, weeklyPoints: { $gt: 0 } })
    .sort({ weeklyPoints: -1 })
    .limit(10)
    .lean();

  const now = new Date();
  const dateLabel = now.toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });

  if (top.length === 0) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`📋 TOP SEMANAL — [${allianceTag}]`)
          .setColor(0x5865f2)
          .setDescription(`*Sin actividad registrada este domingo.*`)
          .setFooter({ text: "Kingdom Guardian Pro  •  Ranking dominical" })
          .setTimestamp(),
      ],
    });
    logger.info({ guildId, week: getISOWeek(now) }, "Weekly report posted (empty)");
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((u, i) => {
    const medal = medals[i] ?? `**${i + 1}.**`;
    const name  = guild.members.cache.get(u.discordId)?.displayName ?? u.ign ?? `<@${u.discordId}>`;
    return `${medal} **${name}** — ${u.weeklyPoints} pts`;
  });

  const winner = guild.members.cache.get(top[0].discordId)?.displayName ?? top[0].ign ?? "—";

  await channel.send({
    content: `@here 📋 **¡Ranking semanal publicado!**`,
    embeds: [
      new EmbedBuilder()
        .setTitle(`📋 TOP SEMANAL — [${allianceTag}]`)
        .setColor(0x5865f2)
        .setDescription(`📅 **${dateLabel}**\n\n${lines.join("\n")}`)
        .setFooter({ text: "Kingdom Guardian Pro  •  Ranking semanal" })
        .setTimestamp(),
    ],
    allowedMentions: { parse: ["everyone"] },
  });

  logger.info({ guildId, week: getISOWeek(now) }, "Weekly report posted");
}
