import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { UserProfile } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const leaderboardCommandDefs = [
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Rankings de la alianza")
    .addSubcommand((s) =>
      s.setName("weekly").setDescription("Ver ranking semanal de puntos activo"),
    )
    .addSubcommand((s) =>
      s.setName("total").setDescription("Ver ranking de puntos totales histórico"),
    ),
].map((b) => b.toJSON());

export async function handleLeaderboardCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  await interaction.deferReply();

  try {
    if (sub === "weekly") {
      const top = await UserProfile.find({ guildId, weeklyPoints: { $gt: 0 } })
        .sort({ weeklyPoints: -1 })
        .limit(20)
        .lean();

      if (top.length === 0) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("📊 Ranking Semanal")
              .setColor(0x888888)
              .setDescription("No hay puntos semanales registrados aún esta semana.")
              .setTimestamp(),
          ],
        });
        return;
      }

      const medals = ["🥇", "🥈", "🥉"];
      const lines = top.map((p, i) => {
        const m = medals[i] ?? `\`${String(i + 1).padStart(2, " ")}.\``;
        const bar = "█".repeat(Math.min(10, Math.floor((p.weeklyPoints / top[0].weeklyPoints) * 10)));
        return `${m} <@${p.discordId}>\n   \`${bar}\` **${p.weeklyPoints}** pts`;
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⭐ RANKING SEMANAL — SOLDADOS ACTIVOS")
            .setColor(0x5865f2)
            .setDescription(lines.join("\n").slice(0, 4000))
            .addFields(
              { name: "Soldados en ranking", value: String(top.length), inline: true },
              { name: "Líder semanal", value: `<@${top[0].discordId}>`, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Sistema de Puntos Semanales" }),
        ],
      });

    } else if (sub === "total") {
      const top = await UserProfile.find({ guildId, totalPoints: { $gt: 0 } })
        .sort({ totalPoints: -1 })
        .limit(20)
        .lean();

      if (top.length === 0) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🏆 Ranking Total")
              .setColor(0x888888)
              .setDescription("No hay puntos totales registrados aún.")
              .setTimestamp(),
          ],
        });
        return;
      }

      const medals = ["🥇", "🥈", "🥉"];
      const lines = top.map((p, i) => {
        const m = medals[i] ?? `\`${String(i + 1).padStart(2, " ")}.\``;
        return `${m} <@${p.discordId}> — **${p.totalPoints.toLocaleString("es-ES")}** pts totales · 📅 ${p.eventsAttended} eventos`;
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🏆 RANKING HISTÓRICO — HALL OF FAME")
            .setColor(0xffd700)
            .setDescription(lines.join("\n").slice(0, 4000))
            .addFields(
              { name: "Soldados en ranking", value: String(top.length), inline: true },
              { name: "Leyenda de la alianza", value: `<@${top[0].discordId}>`, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Hall of Fame" }),
        ],
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Leaderboard command error");
    await interaction.editReply({ content: "❌ Error al cargar el ranking." });
  }
}
