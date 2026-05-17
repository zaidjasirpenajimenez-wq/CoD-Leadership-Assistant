import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { UserProfile, SanctionRecord, KvkRecord, DiplomacyPact, GuildConfig } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const statsCommandDefs = [
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Estadísticas globales de la alianza")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName("server").setDescription("Briefing ejecutivo completo del servidor"),
    )
    .addSubcommand((s) =>
      s.setName("inactivity").setDescription("Ver miembros inactivos esta semana"),
    ),
].map((b) => b.toJSON());

export async function handleStatsCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  await interaction.deferReply({ ephemeral: true });

  try {
    if (sub === "server") {
      const config = await GuildConfig.findOne({ guildId }).lean();
      const inactiveDays = config?.inactiveDays ?? 7;
      const cutoff = new Date(Date.now() - inactiveDays * 86_400_000);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [
        totalMembers,
        activeThisWeek,
        inactiveCount,
        sanctionsThisMonth,
        totalSanctions,
        diplomacyPacts,
        topWeekly,
      ] = await Promise.all([
        UserProfile.countDocuments({ guildId }),
        UserProfile.countDocuments({ guildId, weeklyPoints: { $gt: 0 } }),
        UserProfile.countDocuments({ guildId, lastActivity: { $lt: cutoff } }),
        SanctionRecord.countDocuments({ guildId, createdAt: { $gte: monthStart } }),
        SanctionRecord.countDocuments({ guildId }),
        DiplomacyPact.find({ guildId }).lean(),
        UserProfile.find({ guildId, weeklyPoints: { $gt: 0 } })
          .sort({ weeklyPoints: -1 })
          .limit(3)
          .lean(),
      ]);

      const pactSummary = ["NAP", "ALLY", "ENEMY", "BORDER"]
        .map((t) => {
          const count = diplomacyPacts.filter((p) => p.pactType === t).length;
          return count > 0 ? `**${t}**: ${count}` : null;
        })
        .filter(Boolean)
        .join(" · ") || "Sin pactos registrados";

      const top3 = topWeekly.length > 0
        ? topWeekly.map((p, i) => `${["🥇","🥈","🥉"][i]} <@${p.discordId}> ${p.weeklyPoints}pts`).join("\n")
        : "Sin actividad registrada";

      const activityRate = totalMembers > 0
        ? Math.round((activeThisWeek / totalMembers) * 100)
        : 0;

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`📊 BRIEFING EJECUTIVO — [${config?.allianceTag ?? "GUILD"}]`)
            .setColor(0x4488ff)
            .addFields(
              {
                name: "👥 Fuerza Militar",
                value: [
                  `Total de soldados: **${totalMembers}**`,
                  `Activos esta semana: **${activeThisWeek}** (${activityRate}%)`,
                  `Inactivos (+${inactiveDays}d): **${inactiveCount}**`,
                ].join("\n"),
                inline: false,
              },
              {
                name: "⚠️ Disciplina",
                value: [
                  `Sanciones este mes: **${sanctionsThisMonth}**`,
                  `Sanciones totales: **${totalSanctions}**`,
                ].join("\n"),
                inline: true,
              },
              {
                name: "🌐 Diplomacia",
                value: pactSummary,
                inline: true,
              },
              {
                name: "⭐ Top 3 Semanal",
                value: top3,
                inline: false,
              },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Briefing Ejecutivo" }),
        ],
      });

    } else if (sub === "inactivity") {
      const config = await GuildConfig.findOne({ guildId }).lean();
      const inactiveDays = config?.inactiveDays ?? 7;
      const cutoff = new Date(Date.now() - inactiveDays * 86_400_000);

      const inactive = await UserProfile.find({
        guildId,
        lastActivity: { $lt: cutoff },
      })
        .sort({ lastActivity: 1 })
        .limit(25)
        .lean();

      if (inactive.length === 0) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅ Sin Inactivos Detectados")
              .setColor(0x00cc55)
              .setDescription(`Todos los miembros tuvieron actividad en los últimos **${inactiveDays} días**. ¡Excelente participación!`)
              .setTimestamp(),
          ],
        });
        return;
      }

      const lines = inactive.map((p) => {
        const ts = Math.floor(new Date(p.lastActivity).getTime() / 1000);
        const ign = p.ign ? ` — *${p.ign}*` : "";
        return `<@${p.discordId}>${ign} — última actividad <t:${ts}:R>`;
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`👻 SOLDADOS INACTIVOS — +${inactiveDays} días`)
            .setColor(0xff8800)
            .setDescription(lines.join("\n").slice(0, 4000))
            .addFields({ name: "Total inactivos", value: String(inactive.length), inline: true })
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Control de Inactividad" }),
        ],
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Stats command error");
    await interaction.editReply({ content: "❌ Error al obtener estadísticas." });
  }
}
