import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { SanctionRecord, UserProfile } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const sanctionCommandDefs = [
  new SlashCommandBuilder()
    .setName("sanction")
    .setDescription("Libro de sanciones y faltas militares")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Registrar sanción o falta a un miembro")
        .addUserOption((o) => o.setName("usuario").setDescription("Miembro").setRequired(true))
        .addStringOption((o) =>
          o
            .setName("tipo")
            .setDescription("Tipo de sanción")
            .setRequired(true)
            .addChoices(
              { name: "⚔️ Falta a Guerra", value: "FALTA_GUERRA" },
              { name: "📅 Ausencia a Evento", value: "AUSENCIA_EVENTO" },
              { name: "⚠️ Penalización", value: "PENALIZACION" },
              { name: "📋 Otro", value: "OTRO" },
            ),
        )
        .addStringOption((o) =>
          o.setName("razon").setDescription("Descripción de la falta").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("history")
        .setDescription("Ver historial de sanciones de un miembro")
        .addUserOption((o) => o.setName("usuario").setDescription("Miembro").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("clear")
        .setDescription("Limpiar historial de sanciones de un miembro")
        .addUserOption((o) => o.setName("usuario").setDescription("Miembro").setRequired(true)),
    ),
].map((b) => b.toJSON());

const TYPE_EMOJI: Record<string, string> = {
  FALTA_GUERRA: "⚔️",
  AUSENCIA_EVENTO: "📅",
  PENALIZACION: "⚠️",
  OTRO: "📋",
};

const TYPE_LABEL: Record<string, string> = {
  FALTA_GUERRA: "Falta a Guerra",
  AUSENCIA_EVENTO: "Ausencia a Evento",
  PENALIZACION: "Penalización",
  OTRO: "Otro",
};

export async function handleSanctionCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  try {
    if (sub === "add") {
      const target = interaction.options.getUser("usuario", true);
      const tipo = interaction.options.getString("tipo", true) as ISanctionType;
      const razon = interaction.options.getString("razon", true);

      await SanctionRecord.create({
        guildId,
        discordId: target.id,
        type: tipo,
        reason: razon,
        addedBy: interaction.user.id,
      });

      // Auto-deduct points based on sanction severity
      const SANCTION_PENALTY: Record<string, number> = {
        FALTA_GUERRA: 20,
        AUSENCIA_EVENTO: 10,
        PENALIZACION: 5,
        OTRO: 0,
      };
      const penalty = SANCTION_PENALTY[tipo] ?? 0;
      if (penalty > 0) {
        await UserProfile.findOneAndUpdate(
          { discordId: target.id, guildId },
          { $inc: { weeklyPoints: -penalty, totalPoints: -penalty } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ).catch(() => {});
      }

      const totalSanctions = await SanctionRecord.countDocuments({ guildId, discordId: target.id });

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${TYPE_EMOJI[tipo]} Sanción Registrada — ${TYPE_LABEL[tipo]}`)
            .setColor(0xff4400)
            .addFields(
              { name: "Soldado", value: `<@${target.id}>`, inline: true },
              { name: "Tipo", value: `${TYPE_EMOJI[tipo]} ${TYPE_LABEL[tipo]}`, inline: true },
              { name: "Total de sanciones", value: String(totalSanctions), inline: true },
              { name: "Motivo", value: razon, inline: false },
              { name: "Penalización automática", value: penalty > 0 ? `-${penalty} puntos` : "Sin deducción", inline: true },
              { name: "Registrado por", value: `<@${interaction.user.id}>`, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Libro de Sanciones" }),
        ],
      });

    } else if (sub === "history") {
      const target = interaction.options.getUser("usuario", true);
      const sanctions = await SanctionRecord.find({ guildId, discordId: target.id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

      const embed = new EmbedBuilder()
        .setTitle(`📋 Historial de Sanciones — <@${target.id}>`)
        .setColor(sanctions.length > 0 ? 0xff4400 : 0x00cc55)
        .setThumbnail(target.displayAvatarURL())
        .addFields({ name: "Total", value: String(sanctions.length), inline: true })
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro — Libro de Sanciones" });

      if (sanctions.length === 0) {
        embed.setDescription("✅ Este miembro no tiene sanciones registradas.");
      } else {
        const lines = sanctions.map((s) => {
          const date = new Date(s.createdAt).toLocaleDateString("es-ES");
          return `${TYPE_EMOJI[s.type]} **${TYPE_LABEL[s.type]}** — ${s.reason} *(${date})*`;
        });
        embed.setDescription(lines.join("\n").slice(0, 4000));
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });

    } else if (sub === "clear") {
      const target = interaction.options.getUser("usuario", true);
      const result = await SanctionRecord.deleteMany({ guildId, discordId: target.id });

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Historial de Sanciones Limpiado")
            .setColor(0x00cc55)
            .addFields(
              { name: "Soldado", value: `<@${target.id}>`, inline: true },
              { name: "Sanciones eliminadas", value: String(result.deletedCount), inline: true },
              { name: "Ejecutado por", value: `<@${interaction.user.id}>`, inline: true },
            )
            .setTimestamp(),
        ],
        ephemeral: true,
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Sanction command error");
    await interaction.reply({ content: "❌ Error en el comando.", ephemeral: true }).catch(() => {});
  }
}

type ISanctionType = "FALTA_GUERRA" | "AUSENCIA_EVENTO" | "PENALIZACION" | "OTRO";
