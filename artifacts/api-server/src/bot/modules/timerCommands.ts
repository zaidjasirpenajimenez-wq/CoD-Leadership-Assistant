import {
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { ScheduledTimer, GuildConfig, UserProfile, DiplomacyPact } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const timerCommandDefs = [
  new SlashCommandBuilder()
    .setName("timer")
    .setDescription("Recordatorios y timers automáticos")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Programar un recordatorio")
        .addStringOption((o) =>
          o.setName("mensaje").setDescription("Mensaje del recordatorio").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("fecha_hora")
            .setDescription("Fecha y hora UTC (ej: 2025-06-15 20:00 o en: 30m / 2h / 1d)")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("repetir")
            .setDescription("Repetición")
            .setRequired(false)
            .addChoices({ name: "🔁 Cada semana", value: "weekly" }),
        ),
    )
    .addSubcommand((s) =>
      s.setName("list").setDescription("Ver recordatorios activos del servidor"),
    )
    .addSubcommand((s) =>
      s
        .setName("cancel")
        .setDescription("Cancelar un recordatorio")
        .addStringOption((o) =>
          o.setName("id").setDescription("ID del timer (de /timer list)").setRequired(true),
        ),
    ),
].map((b) => b.toJSON());

/** Parse relative times like 30m, 2h, 1d or absolute "2025-06-15 20:00" */
function parseFireAt(input: string): Date {
  const relativeMatch = input.match(/^(\d+)(m|h|d)$/i);
  if (relativeMatch) {
    const val = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const ms = unit === "m" ? val * 60_000 : unit === "h" ? val * 3_600_000 : val * 86_400_000;
    return new Date(Date.now() + ms);
  }
  // Try absolute parse
  const d = new Date(input + " UTC");
  if (!isNaN(d.getTime())) return d;
  throw new Error(`No se pudo interpretar la fecha: "${input}". Usa formato "2025-06-15 20:00" o relativo "30m", "2h", "1d".`);
}

export async function handleTimerCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  try {
    if (sub === "set") {
      const mensaje = interaction.options.getString("mensaje", true);
      const fechaHoraStr = interaction.options.getString("fecha_hora", true);
      const repeat = interaction.options.getString("repetir") as "weekly" | null;

      let fireAt: Date;
      try {
        fireAt = parseFireAt(fechaHoraStr.trim());
      } catch (err) {
        await interaction.reply({ content: `❌ ${(err as Error).message}`, ephemeral: true });
        return;
      }

      if (fireAt <= new Date()) {
        await interaction.reply({ content: "❌ La fecha debe ser en el futuro.", ephemeral: true });
        return;
      }

      const timer = await ScheduledTimer.create({
        guildId,
        channelId: interaction.channelId,
        message: mensaje,
        fireAt,
        fired: false,
        createdBy: interaction.user.id,
        repeat: repeat ?? undefined,
      });

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⏰ Recordatorio Programado")
            .setColor(0x5865f2)
            .addFields(
              { name: "📢 Mensaje", value: mensaje, inline: false },
              { name: "🕐 Se enviará", value: `<t:${Math.floor(fireAt.getTime() / 1000)}:F>`, inline: true },
              {
                name: "🔁 Repetición",
                value: repeat === "weekly" ? "Cada semana" : "Una sola vez",
                inline: true,
              },
              { name: "🆔 ID", value: timer._id.toString(), inline: false },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Timer System" }),
        ],
        ephemeral: true,
      });

    } else if (sub === "list") {
      const timers = await ScheduledTimer.find({ guildId, fired: false }).sort({ fireAt: 1 }).lean();

      if (timers.length === 0) {
        await interaction.reply({ content: "No hay recordatorios activos en este servidor.", ephemeral: true });
        return;
      }

      const lines = timers.map((t) => {
        const ts = Math.floor(new Date(t.fireAt).getTime() / 1000);
        const rep = t.repeat === "weekly" ? " 🔁" : "";
        return `\`${t._id.toString().slice(-6)}\` — <t:${ts}:R>${rep} — ${t.message.slice(0, 60)}`;
      });

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⏰ Recordatorios Activos")
            .setColor(0x5865f2)
            .setDescription(lines.join("\n").slice(0, 4000))
            .setFooter({ text: `${timers.length} timer(s) activos` }),
        ],
        ephemeral: true,
      });

    } else if (sub === "cancel") {
      const id = interaction.options.getString("id", true);
      const result = await ScheduledTimer.findOneAndDelete({ guildId, _id: id }).catch(() => null);
      if (!result) {
        await interaction.reply({ content: "❌ No se encontró ese timer o ya fue disparado.", ephemeral: true });
        return;
      }
      await interaction.reply({ content: `✅ Recordatorio \`${id}\` cancelado.`, ephemeral: true });
    }
  } catch (err) {
    logger.error({ err, sub }, "Timer command error");
    await interaction.reply({ content: "❌ Error en el comando.", ephemeral: true }).catch(() => {});
  }
}

/** Lightweight scheduler — checks every 60s for due timers and expiring NAP pacts */
export function startScheduler(client: Client): void {
  const INTERVAL_MS = 60_000;

  setInterval(async () => {
    try {
      await fireDueTimers(client);
      await checkExpiringPacts(client);
    } catch (err) {
      logger.error({ err }, "Scheduler tick error");
    }
  }, INTERVAL_MS);

  logger.info("Timer scheduler started (60s interval)");
}

async function fireDueTimers(client: Client): Promise<void> {
  const now = new Date();
  const due = await ScheduledTimer.find({ fired: false, fireAt: { $lte: now } }).lean();

  for (const timer of due) {
    try {
      const guild = client.guilds.cache.get(timer.guildId);
      if (!guild) continue;
      // Fetch from API if not in cache (e.g. after bot restart)
      let chan = guild.channels.cache.get(timer.channelId) as TextChannel | undefined;
      if (!chan) {
        chan = await guild.channels.fetch(timer.channelId).catch(() => null) as TextChannel | undefined;
      }
      if (!chan) continue;

      await chan.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("⏰ RECORDATORIO PROGRAMADO")
            .setColor(0x5865f2)
            .setDescription(timer.message)
            .setTimestamp()
            .setFooter({ text: `Kingdom Guardian Pro — Timer | Programado por <@${timer.createdBy}>` }),
        ],
      });

      if (timer.repeat === "weekly") {
        const nextFireAt = new Date(timer.fireAt);
        nextFireAt.setDate(nextFireAt.getDate() + 7);
        await ScheduledTimer.findByIdAndUpdate(timer._id, { fireAt: nextFireAt });
      } else {
        await ScheduledTimer.findByIdAndUpdate(timer._id, { fired: true });
      }
    } catch (err) {
      logger.error({ err, timerId: timer._id }, "Failed to fire timer");
    }
  }
}

async function checkExpiringPacts(client: Client): Promise<void> {
  const in48h = new Date(Date.now() + 48 * 3_600_000);
  const expiring = await DiplomacyPact.find({
    expiresAt: { $gt: new Date(), $lte: in48h },
  }).lean();

  for (const pact of expiring) {
    try {
      const config = await GuildConfig.findOne({ guildId: pact.guildId }).lean();
      if (!config?.channels?.modLogs) continue;

      const guild = client.guilds.cache.get(pact.guildId);
      if (!guild) continue;
      const chan = guild.channels.cache.get(config.channels.modLogs) as TextChannel | undefined;
      if (!chan) continue;

      const expiresTs = Math.floor(new Date(pact.expiresAt!).getTime() / 1000);
      await chan.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("⚠️ PACTO DIPLOMÁTICO POR VENCER")
            .setColor(0xff8800)
            .addFields(
              { name: "Alianza", value: pact.targetAlliance, inline: true },
              { name: "Tipo", value: pact.pactType, inline: true },
              { name: "Vence", value: `<t:${expiresTs}:R>`, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Alerta Diplomática" }),
        ],
      });

      // Mark pact as expired after notifying (only notify once)
      await DiplomacyPact.findByIdAndUpdate(pact._id, { expiresAt: null });
    } catch (err) {
      logger.error({ err }, "Failed to notify expiring pact");
    }
  }
}

/** Check inactivity daily and notify modLogs channel — runs every hour */
export function startInactivityChecker(client: Client): void {
  const INTERVAL_MS = 60 * 60_000; // every hour
  let lastCheck = "";

  setInterval(async () => {
    try {
      const now = new Date();
      // Only run once per day at 08:00 UTC
      if (now.getUTCHours() !== 8) return;
      const dayKey = now.toISOString().slice(0, 10);
      if (lastCheck === dayKey) return;
      lastCheck = dayKey;

      const guilds = await GuildConfig.find({}).lean();
      for (const config of guilds) {
        const inactiveDays = config.inactiveDays ?? 7;
        const cutoff = new Date(Date.now() - inactiveDays * 86_400_000);
        const inactiveCount = await UserProfile.countDocuments({
          guildId: config.guildId,
          lastActivity: { $lt: cutoff },
        });

        if (inactiveCount === 0) continue;

        const channelId = config.channels?.modLogs;
        if (!channelId) continue;
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) continue;
        const chan = guild.channels.cache.get(channelId) as TextChannel | undefined;
        if (!chan) continue;

        await chan.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("👻 ALERTA DE INACTIVIDAD — CONTROL DIARIO")
              .setColor(0xff8800)
              .setDescription(
                `Se detectaron **${inactiveCount}** soldados sin actividad en los últimos **${inactiveDays} días**.\n\nUsa \`/stats inactivity\` para ver la lista completa.`,
              )
              .setTimestamp()
              .setFooter({ text: "Kingdom Guardian Pro — Control de Inactividad" }),
          ],
        });
      }
    } catch (err) {
      logger.error({ err }, "Inactivity checker error");
    }
  }, INTERVAL_MS);

  logger.info("Inactivity checker started (hourly)");
}

/** Auto-post weekly leaderboard every Monday 00:05 UTC and reset weekly points */
export function startWeeklyLeaderboard(client: Client): void {
  const CHECK_INTERVAL = 5 * 60_000; // Check every 5 minutes

  let lastReset = "";

  setInterval(async () => {
    try {
      const now = new Date();
      // Monday = 1, 00:00–00:10 UTC window
      if (now.getUTCDay() !== 1 || now.getUTCHours() !== 0 || now.getUTCMinutes() > 9) return;

      const resetKey = `${now.getUTCFullYear()}-W${getWeekNumber(now)}`;
      if (lastReset === resetKey) return;
      lastReset = resetKey;

      const guilds = await GuildConfig.find({}).lean();
      for (const config of guilds) {
        await postWeeklyLeaderboard(client, config.guildId);
      }
    } catch (err) {
      logger.error({ err }, "Weekly leaderboard scheduler error");
    }
  }, CHECK_INTERVAL);

  logger.info("Weekly leaderboard scheduler started");
}

export async function postWeeklyLeaderboard(client: Client, guildId: string): Promise<void> {
  const config = await GuildConfig.findOne({ guildId }).lean();
  // Prefer dedicated leaderboard channel, fall back to modLogs
  const channelId = config?.channels?.leaderboard ?? config?.channels?.modLogs;
  if (!channelId) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const chan = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (!chan) return;

  const top = await UserProfile.find({ guildId, weeklyPoints: { $gt: 0 } })
    .sort({ weeklyPoints: -1 })
    .limit(15)
    .lean();

  if (top.length === 0) return;

  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((p, i) => {
    const m = medals[i] ?? `**${i + 1}.**`;
    return `${m} <@${p.discordId}> — **${p.weeklyPoints}** pts semanales`;
  });

  await chan.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🏆 RANKING SEMANAL — CIERRE DE SEMANA MILITAR")
        .setColor(0xffd700)
        .setDescription(lines.join("\n"))
        .addFields({ name: "Soldados activos esta semana", value: String(top.length), inline: true })
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro — Los puntos semanales serán reiniciados" }),
    ],
  });

  // Reset weekly points for all members in this guild
  await UserProfile.updateMany({ guildId }, { $set: { weeklyPoints: 0 } });
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
