import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { UserProfile, WarAlertLog, ResourceRequestLog, MissionClaim } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const misionCommandDefs = [
  new SlashCommandBuilder()
    .setName("mision")
    .setDescription("Misiones semanales — completa objetivos y gana puntos extra")
    .addSubcommand((s) =>
      s.setName("ver").setDescription("Ver tus misiones semanales y progreso actual"),
    )
    .addSubcommand((s) =>
      s.setName("reclamar").setDescription("Reclamar recompensa si completaste todas las misiones"),
    )
    .addSubcommand((s) =>
      s.setName("ranking").setDescription("Ver quién ha completado misiones esta semana (R4/R5)"),
    ),
].map((b) => b.toJSON());

// ── Week key ─────────────────────────────────────────────────────────────────
function getWeekKey(): string {
  const now = new Date();
  const d   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week      = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function getWeekStart(): Date {
  const now = new Date();
  const d   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7; // Monday = 1
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

// ── Mission definitions (targets scale by week to keep fresh) ────────────────
interface MissionDef {
  id: string;
  emoji: string;
  title: string;
  description: string;
  target: number;
  rewardPts: number;
}

function getWeeklyMissions(): MissionDef[] {
  return [
    {
      id:          "war_participation",
      emoji:       "⚔️",
      title:       "Guerrero Semanal",
      description: "Responde a **2 alertas de guerra** esta semana",
      target:      2,
      rewardPts:   0, // progress only, full reward on completion of all 3
    },
    {
      id:          "resource_donation",
      emoji:       "🤝",
      title:       "Donante Generoso",
      description: "Completa **2 donaciones de recursos** esta semana",
      target:      2,
      rewardPts:   0,
    },
    {
      id:          "weekly_points",
      emoji:       "⭐",
      title:       "Soldado Activo",
      description: "Acumula **40 puntos semanales** participando en eventos",
      target:      40,
      rewardPts:   0,
    },
  ];
}

const TOTAL_REWARD_PTS = 50; // bonus for completing all 3 missions

// ── Progress computation ──────────────────────────────────────────────────────
async function computeProgress(
  discordId: string,
  guildId:   string,
): Promise<{ war: number; donations: number; weeklyPts: number }> {
  const weekStart = getWeekStart();

  const [warLogs, donations, profile] = await Promise.all([
    WarAlertLog.find({ guildId, createdAt: { $gte: weekStart }, "attendees.userId": discordId }).countDocuments(),
    ResourceRequestLog.countDocuments({ guildId, donorId: discordId, status: "done", closedAt: { $gte: weekStart } }),
    UserProfile.findOne({ discordId, guildId }).lean(),
  ]);

  return {
    war:       warLogs,
    donations,
    weeklyPts: profile?.weeklyPoints ?? 0,
  };
}

function progressBar(current: number, target: number): string {
  const pct   = Math.min(current / target, 1);
  const filled = Math.round(pct * 10);
  return `${"▰".repeat(filled)}${"▱".repeat(10 - filled)} **${Math.min(current, target)}/${target}**`;
}

export async function handleMisionCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub      = interaction.options.getSubcommand();
  const guildId  = interaction.guild.id;
  const userId   = interaction.user.id;
  const weekKey  = getWeekKey();
  const missions = getWeeklyMissions();

  try {
    if (sub === "ver") {
      await interaction.deferReply({ ephemeral: true });
      const progress = await computeProgress(userId, guildId);
      const claimed  = await MissionClaim.findOne({ guildId, discordId: userId, weekKey }).lean();

      const progMap: Record<string, number> = {
        war_participation: progress.war,
        resource_donation: progress.donations,
        weekly_points:     progress.weeklyPts,
      };

      const fields = missions.map((m) => {
        const current   = progMap[m.id] ?? 0;
        const completed = current >= m.target;
        return {
          name:   `${m.emoji} ${m.title} ${completed ? "✅" : ""}`,
          value:  `${m.description}\n${progressBar(current, m.target)}`,
          inline: false,
        };
      });

      const allDone    = missions.every((m) => (progMap[m.id] ?? 0) >= m.target);
      const claimedStr = claimed
        ? "✅ **¡Ya reclamaste tu recompensa esta semana!** (+50 pts)"
        : allDone
        ? "🎁 **¡Misiones completadas!** Usa `/mision reclamar` para obtener tus **+50 pts bonus**."
        : `⏳ Completa las 3 misiones para ganar **+${TOTAL_REWARD_PTS} pts bonus**.`;

      const memberName = interaction.guild.members.cache.get(userId)?.displayName ?? interaction.user.username;

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🗺️ Misiones Semanales — ${memberName}`)
            .setColor(allDone ? 0xffd700 : 0x5865f2)
            .setDescription(
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `📅 **Semana:** \`${weekKey}\`\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
              claimedStr,
            )
            .addFields(fields)
            .setFooter({ text: "Kingdom Guardian Pro — Misiones Semanales · Se reinician cada lunes" })
            .setTimestamp(),
        ],
      });
      return;
    }

    if (sub === "reclamar") {
      await interaction.deferReply({ ephemeral: true });

      const claimed = await MissionClaim.findOne({ guildId, discordId: userId, weekKey }).lean();
      if (claimed) {
        await interaction.editReply({ content: "✅ Ya reclamaste tu recompensa esta semana. ¡Vuelve el lunes!" });
        return;
      }

      const progress = await computeProgress(userId, guildId);
      const missions = getWeeklyMissions();
      const progMap: Record<string, number> = {
        war_participation: progress.war,
        resource_donation: progress.donations,
        weekly_points:     progress.weeklyPts,
      };

      const incomplete = missions.filter((m) => (progMap[m.id] ?? 0) < m.target);
      if (incomplete.length > 0) {
        const names = incomplete.map((m) => `${m.emoji} ${m.title}`).join(", ");
        await interaction.editReply({
          content: `❌ Aún no completaste todas las misiones. Pendientes: **${names}**.`,
        });
        return;
      }

      // Grant reward
      await MissionClaim.create({ guildId, discordId: userId, weekKey });
      await UserProfile.findOneAndUpdate(
        { discordId: userId, guildId },
        { $inc: { weeklyPoints: TOTAL_REWARD_PTS, totalPoints: TOTAL_REWARD_PTS }, $set: { lastActivity: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      const memberName = interaction.guild.members.cache.get(userId)?.displayName ?? interaction.user.username;

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🏆 ¡Misiones Semanales Completadas!")
            .setColor(0xffd700)
            .setDescription(
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `¡Excelente trabajo, **${memberName}**!\n` +
              `Completaste las 3 misiones de la semana.\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            )
            .addFields(
              { name: "🎁 Recompensa",     value: `**+${TOTAL_REWARD_PTS} puntos** acreditados`,  inline: true },
              { name: "📅 Semana",          value: `\`${weekKey}\``,                               inline: true },
            )
            .setFooter({ text: "Kingdom Guardian Pro — Misiones Semanales · ¡Hasta la próxima!" })
            .setTimestamp(),
        ],
      });
      return;
    }

    if (sub === "ranking") {
      await interaction.deferReply({ ephemeral: true });

      const claims = await MissionClaim.find({ guildId, weekKey }).sort({ claimedAt: 1 }).lean();
      if (claims.length === 0) {
        await interaction.editReply({ content: "📭 Nadie ha completado las misiones esta semana todavía." });
        return;
      }

      const medals = ["🥇", "🥈", "🥉"];
      const lines = claims.map((c, i) => {
        const medal = medals[i] ?? `**${i + 1}.**`;
        const ts    = `<t:${Math.floor(new Date(c.claimedAt).getTime() / 1000)}:d>`;
        return `${medal} <@${c.discordId}> — ${ts}`;
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🗺️ Ranking de Misiones — \`${weekKey}\``)
            .setColor(0xffd700)
            .setDescription(lines.join("\n"))
            .addFields({ name: "✅ Completados", value: `**${claims.length}** soldados`, inline: true })
            .setFooter({ text: "Kingdom Guardian Pro — Misiones Semanales" })
            .setTimestamp(),
        ],
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Mision command error");
    await interaction.reply({ content: "❌ Error al procesar el comando.", ephemeral: true }).catch(() => {});
  }
}
