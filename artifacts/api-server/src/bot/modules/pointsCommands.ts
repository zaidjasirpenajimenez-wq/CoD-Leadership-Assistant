import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { UserProfile } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const pointsCommandDefs = [
  new SlashCommandBuilder()
    .setName("perfil")
    .setDescription("Ver tu hoja de servicio militar"),

  new SlashCommandBuilder()
    .setName("points")
    .setDescription("Gestión de puntos semanales")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Sumar puntos a un jugador (solo R4/R5)")
        .addUserOption((o) => o.setName("usuario").setDescription("Jugador").setRequired(true))
        .addIntegerOption((o) =>
          o.setName("cantidad").setDescription("Puntos a sumar").setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Restar puntos a un jugador (solo R4/R5)")
        .addUserOption((o) => o.setName("usuario").setDescription("Jugador").setRequired(true))
        .addIntegerOption((o) =>
          o.setName("cantidad").setDescription("Puntos a restar").setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("reset")
        .setDescription("🚨 Reiniciar puntos semanales de toda la alianza (solo R5)")
        .addStringOption((o) =>
          o
            .setName("confirmar")
            .setDescription('Escribe "CONFIRMAR" para ejecutar el reset semanal')
            .setRequired(true),
        ),
    ),

  new SlashCommandBuilder()
    .setName("box")
    .setDescription("Gestión de recompensas")
    .addSubcommand((s) =>
      s
        .setName("giveaway")
        .setDescription("Sortear cofres premium entre soldados activos")
        .addIntegerOption((o) =>
          o
            .setName("puntos_minimos")
            .setDescription("Puntos semanales mínimos para participar")
            .setRequired(true)
            .setMinValue(1),
        )
        .addIntegerOption((o) =>
          o
            .setName("ganadores")
            .setDescription("Cantidad de ganadores (por defecto 1)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(10),
        ),
    ),
].map((b) => b.toJSON());

export async function handlePerfilCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;

  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  try {
    const profile = await UserProfile.findOne({ discordId: userId, guildId });

    const embed = new EmbedBuilder()
      .setTitle(`📋 Hoja de Servicio — ${interaction.user.displayName}`)
      .setColor(0x4488ff)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        {
          name: "⭐ Puntos Semanales",
          value: String(profile?.weeklyPoints ?? 0),
          inline: true,
        },
        {
          name: "🏆 Puntos Totales",
          value: String(profile?.totalPoints ?? 0),
          inline: true,
        },
        {
          name: "📅 Eventos Asistidos",
          value: String(profile?.eventsAttended ?? 0),
          inline: true,
        },
        {
          name: "🎮 IGN en Juego",
          value: profile?.ign ?? "No registrado",
          inline: true,
        },
        {
          name: "⚡ Poder",
          value: profile?.power ? profile.power.toLocaleString("es-ES") : "No registrado",
          inline: true,
        },
        {
          name: "⚠️ Advertencias",
          value: `${profile?.warns ?? 0}/3`,
          inline: true,
        },
      )
      .setTimestamp()
      .setFooter({ text: "Kingdom Guardian Pro — Sistema de Puntos Semanales" });

    if (!profile) {
      embed.setDescription(
        "⚠️ No tienes un perfil registrado. Verifica tu cuenta en el canal de verificación.",
      );
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (err) {
    logger.error({ err }, "Perfil command error");
    await interaction.reply({ content: "❌ Error al obtener tu perfil.", ephemeral: true });
  }
}

export async function handlePointsCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  try {
    if (sub === "add") {
      const target = interaction.options.getUser("usuario", true);
      const cantidad = interaction.options.getInteger("cantidad", true);

      const updated = await UserProfile.findOneAndUpdate(
        { discordId: target.id, guildId },
        { $inc: { weeklyPoints: cantidad, totalPoints: cantidad } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Puntos Acreditados")
            .setColor(0x00cc55)
            .addFields(
              { name: "Jugador", value: `<@${target.id}>`, inline: true },
              { name: "Puntos sumados", value: `+${cantidad}`, inline: true },
              { name: "Total semanal", value: String(updated?.weeklyPoints ?? cantidad), inline: true },
            )
            .setTimestamp(),
        ],
        ephemeral: true,
      });

    } else if (sub === "remove") {
      const target = interaction.options.getUser("usuario", true);
      const cantidad = interaction.options.getInteger("cantidad", true);

      const updated = await UserProfile.findOneAndUpdate(
        { discordId: target.id, guildId },
        { $inc: { weeklyPoints: -cantidad, totalPoints: -cantidad } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⚠️ Puntos Deducidos — Penalización")
            .setColor(0xff4400)
            .addFields(
              { name: "Jugador", value: `<@${target.id}>`, inline: true },
              { name: "Puntos descontados", value: `-${cantidad}`, inline: true },
              {
                name: "Total semanal",
                value: String(Math.max(0, updated?.weeklyPoints ?? 0)),
                inline: true,
              },
            )
            .setTimestamp(),
        ],
        ephemeral: true,
      });

    } else if (sub === "reset") {
      const confirm = interaction.options.getString("confirmar", true);
      if (confirm !== "CONFIRMAR") {
        await interaction.reply({
          content: '❌ Debes escribir exactamente **"CONFIRMAR"** para ejecutar el reset.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      const result = await UserProfile.updateMany(
        { guildId },
        { $set: { weeklyPoints: 0 } },
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🔄 NUEVA SEMANA MILITAR — PUNTOS REINICIADOS")
            .setColor(0x5865f2)
            .setDescription(
              "Los puntos semanales de **todos los miembros** han sido reiniciados a **0**.\n\n¡Que comience una nueva semana de gloria para la alianza!",
            )
            .addFields(
              { name: "Miembros afectados", value: String(result.modifiedCount), inline: true },
              { name: "Ejecutado por", value: `<@${interaction.user.id}>`, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Reset Semanal" }),
        ],
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Points command error");
    await interaction.reply({ content: "❌ Error al gestionar puntos.", ephemeral: true }).catch(() => {});
  }
}

export async function handleBoxCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  if (sub !== "giveaway") return;

  const puntosMin = interaction.options.getInteger("puntos_minimos", true);
  const numGanadores = interaction.options.getInteger("ganadores") ?? 1;
  const guildId = interaction.guild.id;

  await interaction.deferReply();

  try {
    // Filter eligible members
    const elegibles = await UserProfile.find({
      guildId,
      weeklyPoints: { $gte: puntosMin },
    }).lean();

    if (elegibles.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("📦 SORTEO DE COFRES — Sin Elegibles")
            .setColor(0xff8800)
            .setDescription(
              `No hay miembros con **${puntosMin}** puntos o más esta semana.\n\n¡Motiva a tus soldados a participar en los eventos!`,
            )
            .setTimestamp(),
        ],
      });
      return;
    }

    // Pick random winners (no repeats)
    const shuffled = [...elegibles].sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, Math.min(numGanadores, elegibles.length));

    const winnersText = winners
      .map((w, i) => `**${i + 1}.** <@${w.discordId}> — ${w.weeklyPoints} pts`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("🎉 SORTEO DE COFRES PREMIUM — RESULTADOS")
      .setColor(0xffd700)
      .setDescription(`@here\n\n¡El azar ha hablado! Estos soldados han ganado los cofres premium de la semana:`)
      .addFields(
        { name: "🏆 Ganadores", value: winnersText, inline: false },
        {
          name: "📊 Estadísticas del sorteo",
          value: [
            `Puntos mínimos: **${puntosMin}**`,
            `Elegibles: **${elegibles.length}** soldados`,
            `Ganadores: **${winners.length}**`,
          ].join("\n"),
          inline: false,
        },
        { name: "Sorteo ejecutado por", value: `<@${interaction.user.id}>`, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "Kingdom Guardian Pro — Sistema de Recompensas Transparente" });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Box giveaway error");
    await interaction.editReply({ content: "❌ Error al ejecutar el sorteo." });
  }
}
