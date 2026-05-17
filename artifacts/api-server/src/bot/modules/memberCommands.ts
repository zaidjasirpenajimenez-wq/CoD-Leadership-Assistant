import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { UserProfile, SanctionRecord, KvkRecord, GuildConfig } from "../../db/schemas";
import { logger } from "../../lib/logger";
import { computeMerits } from "./meritSystem";

export const memberCommandDefs = [
  new SlashCommandBuilder()
    .setName("member")
    .setDescription("Gestión de miembros de la alianza")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("search")
        .setDescription("Buscar miembro por nombre en el juego (IGN)")
        .addStringOption((o) =>
          o.setName("ign").setDescription("Nombre del personaje en el juego").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName("export").setDescription("Exportar roster completo de miembros verificados"),
    ),
].map((b) => b.toJSON());

export async function handleMemberCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  await interaction.deferReply({ ephemeral: true });

  try {
    if (sub === "search") {
      const ign = interaction.options.getString("ign", true);

      const profile = await UserProfile.findOne({
        guildId,
        ign: { $regex: new RegExp(ign, "i") },
      }).lean();

      if (!profile) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🔍 Miembro No Encontrado")
              .setColor(0xff4400)
              .setDescription(`No se encontró ningún miembro verificado con IGN similar a **"${ign}"**.`)
              .setTimestamp(),
          ],
        });
        return;
      }

      const config = await GuildConfig.findOne({ guildId }).lean();
      const inactiveDays = config?.inactiveDays ?? 7;
      const cutoff = new Date(Date.now() - inactiveDays * 86_400_000);

      const [sanctionCount, kvkRecord] = await Promise.all([
        SanctionRecord.countDocuments({ guildId, discordId: profile.discordId }),
        KvkRecord.findOne({ guildId, discordId: profile.discordId }).sort({ updatedAt: -1 }).lean(),
      ]);

      const merits = computeMerits({
        totalPoints: profile.totalPoints,
        eventsAttended: profile.eventsAttended,
        weeklyPoints: profile.weeklyPoints,
        sanctions: sanctionCount,
        kvkKills: kvkRecord?.kills ?? 0,
      });

      const lastActivityTs = Math.floor(new Date(profile.lastActivity).getTime() / 1000);
      const isInactive = new Date(profile.lastActivity) < cutoff;

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Perfil Militar — ${profile.ign}`)
        .setColor(isInactive ? 0xff8800 : 0x4488ff)
        .addFields(
          { name: "👤 Discord", value: `<@${profile.discordId}>`, inline: true },
          { name: "🎮 IGN", value: profile.ign, inline: true },
          { name: "⚡ Poder", value: profile.power ? profile.power.toLocaleString("es-ES") : "N/A", inline: true },
          { name: "⭐ Puntos Semana", value: String(profile.weeklyPoints), inline: true },
          { name: "🏆 Puntos Totales", value: String(profile.totalPoints), inline: true },
          { name: "📅 Eventos", value: String(profile.eventsAttended), inline: true },
          { name: "⚠️ Warns", value: `${profile.warns}/3`, inline: true },
          { name: "📋 Sanciones", value: String(sanctionCount), inline: true },
          {
            name: "🕐 Última Actividad",
            value: `<t:${lastActivityTs}:R>${isInactive ? " ⚠️ INACTIVO" : ""}`,
            inline: true,
          },
        )
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro — Búsqueda de Miembro" });

      if (kvkRecord) {
        embed.addFields({
          name: "⚔️ KVK (última temporada)",
          value: `Kills: **${kvkRecord.kills.toLocaleString()}** · Poder destruido: **${kvkRecord.powerDestroyed.toLocaleString()}**`,
          inline: false,
        });
      }

      if (merits.length > 0) {
        embed.addFields({ name: "🎖️ Méritos", value: merits.join("  "), inline: false });
      }

      await interaction.editReply({ embeds: [embed] });

    } else if (sub === "export") {
      const members = await UserProfile.find({ guildId, ign: { $ne: "" } })
        .sort({ totalPoints: -1 })
        .lean();

      if (members.length === 0) {
        await interaction.editReply({ content: "No hay miembros verificados para exportar." });
        return;
      }

      const header = "IGN | Discord | Poder | Pts Semanal | Pts Total | Eventos | Warns\n" +
        "─".repeat(75);

      const rows = members.map((m) =>
        `${(m.ign || "—").padEnd(20)} | <@${m.discordId}> | ${String(m.power || 0).padStart(8)} | ${String(m.weeklyPoints).padStart(11)} | ${String(m.totalPoints).padStart(9)} | ${String(m.eventsAttended).padStart(7)} | ${m.warns}/3`,
      );

      const content = `\`\`\`\n${header}\n${rows.join("\n")}\n\`\`\``;

      // Discord has 4000 char limit on embed description, split if needed
      const chunks: string[] = [];
      const allRows = rows.join("\n");
      const chunkSize = 1900;
      for (let i = 0; i < allRows.length; i += chunkSize) {
        chunks.push(allRows.slice(i, i + chunkSize));
      }

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`📤 Roster Export — ${members.length} miembros verificados`)
            .setColor(0x4488ff)
            .setDescription(`\`\`\`\n${header}\n${chunks[0]}\n\`\`\``)
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Exportación de Roster" }),
        ],
      });

      // Send additional chunks as follow-ups if needed
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({
          embeds: [
            new EmbedBuilder()
              .setColor(0x4488ff)
              .setDescription(`\`\`\`\n${chunks[i]}\n\`\`\``),
          ],
          ephemeral: true,
        });
      }
    }
  } catch (err) {
    logger.error({ err, sub }, "Member command error");
    await interaction.editReply({ content: "❌ Error en el comando." });
  }
}
