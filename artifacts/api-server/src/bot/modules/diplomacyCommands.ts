import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { DiplomacyPact, GuildConfig } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const diplomacyCommandDefs = [
  new SlashCommandBuilder()
    .setName("diplomacy")
    .setDescription("Panel Diplomático")
    .addSubcommand((s) =>
      s.setName("radar")
        .setDescription("Ver pactos diplomáticos del servidor"),
    )
    .addSubcommand((s) =>
      s.setName("add")
        .setDescription("Agregar pacto diplomático")
        .addStringOption((o) =>
          o.setName("alianza").setDescription("Nombre/Tag de la alianza").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("tipo")
            .setDescription("Tipo de pacto")
            .setRequired(true)
            .addChoices(
              { name: "NAP — No Agresión", value: "NAP" },
              { name: "ALLY — Aliado", value: "ALLY" },
              { name: "ENEMY — Enemigo", value: "ENEMY" },
              { name: "BORDER — Frontera", value: "BORDER" },
            ),
        )
        .addStringOption((o) =>
          o.setName("detalles").setDescription("Detalles del pacto").setRequired(false),
        )
        .addIntegerOption((o) =>
          o
            .setName("dias_expiracion")
            .setDescription("Días hasta que expire el pacto (ej: 30 para NAP de 30 días)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(365),
        ),
    ),
].map((b) => b.toJSON());

const PACT_COLORS: Record<string, number> = {
  NAP: 0xffdd00,
  ALLY: 0x00cc55,
  ENEMY: 0xff2222,
  BORDER: 0x5588ff,
};

const PACT_LABELS: Record<string, string> = {
  NAP: "🤝 NAP",
  ALLY: "💚 ALIADO",
  ENEMY: "🔴 ENEMIGO",
  BORDER: "🔵 FRONTERA",
};

export async function handleDiplomacyCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  try {
    if (sub === "radar") {
      const pacts = await DiplomacyPact.find({ guildId }).sort({ pactType: 1 });
      const config = await GuildConfig.findOne({ guildId });

      const embed = new EmbedBuilder()
        .setTitle(`🛰️ RADAR DIPLOMÁTICO — [${config?.allianceTag ?? "GUILD"}]`)
        .setColor(0x4444ff)
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro — Panel Diplomático" });

      if (pacts.length === 0) {
        embed.setDescription("No hay pactos diplomáticos registrados.");
      } else {
        const grouped: Record<string, string[]> = { NAP: [], ALLY: [], ENEMY: [], BORDER: [] };
        for (const p of pacts) {
          grouped[p.pactType].push(`**${p.targetAlliance}** — ${p.details || "Sin detalles"}`);
        }

        for (const [type, entries] of Object.entries(grouped)) {
          if (entries.length > 0) {
            embed.addFields({
              name: PACT_LABELS[type] ?? type,
              value: entries.join("\n").slice(0, 1024),
              inline: false,
            });
          }
        }
      }

      await interaction.reply({ embeds: [embed] });

    } else if (sub === "add") {
      const alianza = interaction.options.getString("alianza", true);
      const tipo = interaction.options.getString("tipo", true) as "NAP" | "ALLY" | "ENEMY" | "BORDER";
      const detalles = interaction.options.getString("detalles") ?? "";
      const diasExpiracion = interaction.options.getInteger("dias_expiracion");

      const expiresAt = diasExpiracion
        ? new Date(Date.now() + diasExpiracion * 86_400_000)
        : null;

      await DiplomacyPact.findOneAndUpdate(
        { guildId, targetAlliance: alianza },
        {
          pactType: tipo,
          details: detalles,
          createdBy: interaction.user.id,
          createdAt: new Date(),
          expiresAt,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      const embed = new EmbedBuilder()
        .setTitle("✅ Pacto Diplomático Registrado")
        .setColor(PACT_COLORS[tipo] ?? 0x888888)
        .addFields(
          { name: "Alianza", value: alianza, inline: true },
          { name: "Tipo", value: PACT_LABELS[tipo] ?? tipo, inline: true },
          { name: "Detalles", value: detalles || "—", inline: false },
          {
            name: "⏳ Expiración",
            value: expiresAt
              ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:F> (${diasExpiracion} días)`
              : "Sin fecha de vencimiento",
            inline: false,
          },
          { name: "Registrado por", value: `<@${interaction.user.id}>`, inline: true },
        )
        .setTimestamp()
        .setFooter({
          text: expiresAt
            ? "⚠️ El bot avisará 48h antes de que venza el pacto"
            : "Kingdom Guardian Pro — Panel Diplomático",
        });

      await interaction.reply({ embeds: [embed] });
    }
  } catch (err) {
    logger.error({ err, sub }, "Diplomacy command error");
    await interaction.reply({ content: "❌ Error al procesar el comando.", ephemeral: true }).catch(() => {});
  }
}
