import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { KvkRecord, GuildConfig, UserProfile } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const kvkCommandDefs = [
  new SlashCommandBuilder()
    .setName("kvk")
    .setDescription("Kingdom vs Kingdom — Gestión de temporada")
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Iniciar nueva temporada KVK (R4/R5)")
        .addStringOption((o: import("discord.js").SlashCommandStringOption) =>
          o.setName("nombre").setDescription("Nombre de la temporada (ej: KVK S5)").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("register")
        .setDescription("Registrar tus estadísticas personales de KVK")
        .addIntegerOption((o: import("discord.js").SlashCommandIntegerOption) =>
          o.setName("kills").setDescription("Total de kills").setRequired(true).setMinValue(0),
        )
        .addIntegerOption((o: import("discord.js").SlashCommandIntegerOption) =>
          o.setName("muertes").setDescription("Total de muertes").setRequired(true).setMinValue(0),
        )
        .addIntegerOption((o: import("discord.js").SlashCommandIntegerOption) =>
          o.setName("poder_destruido").setDescription("Poder destruido total").setRequired(true).setMinValue(0),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("update")
        .setDescription("Actualizar estadísticas de un miembro (R4/R5)")
        .addUserOption((o: import("discord.js").SlashCommandUserOption) =>
          o.setName("usuario").setDescription("Miembro").setRequired(true),
        )
        .addIntegerOption((o: import("discord.js").SlashCommandIntegerOption) =>
          o.setName("kills").setDescription("Total de kills").setRequired(true).setMinValue(0),
        )
        .addIntegerOption((o: import("discord.js").SlashCommandIntegerOption) =>
          o.setName("muertes").setDescription("Total de muertes").setRequired(true).setMinValue(0),
        )
        .addIntegerOption((o: import("discord.js").SlashCommandIntegerOption) =>
          o.setName("poder_destruido").setDescription("Poder destruido total").setRequired(true).setMinValue(0),
        ),
    )
    .addSubcommand((s) =>
      s.setName("top").setDescription("Ver ranking KVK de la temporada activa"),
    )
    .addSubcommand((s) =>
      s
        .setName("reset")
        .setDescription("Cerrar temporada KVK y limpiar datos (R5)")
        .addStringOption((o: import("discord.js").SlashCommandStringOption) =>
          o.setName("confirmar").setDescription('Escribe "CONFIRMAR" para cerrar la temporada').setRequired(true),
        ),
    ),
].map((b) => b.toJSON());

// Active season per guild (in-memory cache)
const activeSeasons = new Map<string, string>();

function calcScore(kills: number, deaths: number, powerDestroyed: number): number {
  return kills * 10 + powerDestroyed * 0.001 - deaths * 2;
}

export async function handleKvkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  try {
    if (sub === "start") {
      const nombre = interaction.options.getString("nombre", true);
      activeSeasons.set(guildId, nombre);

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⚔️ NUEVA TEMPORADA KVK INICIADA")
            .setColor(0xff4400)
            .setDescription(`La temporada **${nombre}** ha comenzado oficialmente.\n\nTodos los miembros pueden registrar sus estadísticas con \`/kvk register\`.`)
            .addFields({ name: "Iniciado por", value: `<@${interaction.user.id}>`, inline: true })
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — KVK Tracker" }),
        ],
      });

    } else if (sub === "register" || sub === "update") {
      const targetUser = sub === "update" ? interaction.options.getUser("usuario", true) : interaction.user;
      const kills = interaction.options.getInteger("kills", true);
      const deaths = interaction.options.getInteger("muertes", true);
      const powerDestroyed = interaction.options.getInteger("poder_destruido", true);

      const seasonName = activeSeasons.get(guildId) ?? "Temporada Activa";
      const score = calcScore(kills, deaths, powerDestroyed);

      await KvkRecord.findOneAndUpdate(
        { guildId, discordId: targetUser.id, seasonName },
        { kills, deaths, powerDestroyed, score },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      // Also award weekly points for participation
      await UserProfile.findOneAndUpdate(
        { discordId: targetUser.id, guildId },
        { $inc: { weeklyPoints: 15, totalPoints: 15 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`📊 Estadísticas KVK Registradas — ${seasonName}`)
            .setColor(0x4488ff)
            .addFields(
              { name: "Soldado", value: `<@${targetUser.id}>`, inline: true },
              { name: "⚔️ Kills", value: kills.toLocaleString("es-ES"), inline: true },
              { name: "💀 Muertes", value: deaths.toLocaleString("es-ES"), inline: true },
              { name: "💥 Poder Destruido", value: powerDestroyed.toLocaleString("es-ES"), inline: true },
              { name: "🏆 Puntuación KVK", value: Math.round(score).toLocaleString("es-ES"), inline: true },
              { name: "Bonificación", value: "+15 puntos semanales", inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — KVK Tracker" }),
        ],
        ephemeral: sub === "register",
      });

    } else if (sub === "top") {
      const seasonName = activeSeasons.get(guildId) ?? "Temporada Activa";
      const records = await KvkRecord.find({ guildId, seasonName }).sort({ score: -1 }).limit(15).lean();

      if (records.length === 0) {
        await interaction.reply({
          content: `No hay estadísticas registradas para la temporada **${seasonName}** aún.`,
          ephemeral: true,
        });
        return;
      }

      const medals = ["🥇", "🥈", "🥉"];
      const rankings = records
        .map((r, i) => {
          const medal = medals[i] ?? `**${i + 1}.**`;
          return `${medal} <@${r.discordId}> — ⚔️ ${r.kills.toLocaleString()} kills · 💥 ${r.powerDestroyed.toLocaleString()} poder · 🏆 ${Math.round(r.score).toLocaleString()} pts`;
        })
        .join("\n");

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🏆 RANKING KVK — ${seasonName}`)
            .setColor(0xffd700)
            .setDescription(rankings)
            .addFields({
              name: "📊 Fórmula de Puntuación",
              value: "Kills × 10 + Poder Destruido × 0.001 − Muertes × 2",
              inline: false,
            })
            .setTimestamp()
            .setFooter({ text: `${records.length} soldados registrados` }),
        ],
      });

    } else if (sub === "reset") {
      const confirm = interaction.options.getString("confirmar", true);
      if (confirm !== "CONFIRMAR") {
        await interaction.reply({ content: '❌ Escribe "CONFIRMAR" exactamente.', ephemeral: true });
        return;
      }

      const seasonName = activeSeasons.get(guildId) ?? "Temporada Activa";
      await interaction.deferReply();
      const result = await KvkRecord.deleteMany({ guildId, seasonName });
      activeSeasons.delete(guildId);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🔄 Temporada KVK Cerrada")
            .setColor(0x888888)
            .setDescription(`La temporada **${seasonName}** ha sido cerrada y los datos eliminados.`)
            .addFields(
              { name: "Registros eliminados", value: String(result.deletedCount), inline: true },
              { name: "Ejecutado por", value: `<@${interaction.user.id}>`, inline: true },
            )
            .setTimestamp(),
        ],
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "KVK command error");
    await interaction.reply({ content: "❌ Error en el comando KVK.", ephemeral: true }).catch(() => {});
  }
}
