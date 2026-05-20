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
      s.setName("radar").setDescription("Ver pactos diplomáticos del servidor"),
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
              { name: "ALLY — Aliado",     value: "ALLY" },
              { name: "ENEMY — Enemigo",   value: "ENEMY" },
              { name: "BORDER — Frontera", value: "BORDER" },
            ),
        )
        .addStringOption((o) =>
          o.setName("detalles").setDescription("Detalles del pacto").setRequired(false),
        )
        .addIntegerOption((o) =>
          o.setName("dias_expiracion")
            .setDescription("Días hasta que expire el pacto (ej: 30)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(365),
        ),
    ),
].map((b) => b.toJSON());

const PACT_META: Record<string, { emoji: string; label: string; color: number; row: string }> = {
  NAP:    { emoji: "🤝", label: "NO AGRESIÓN", color: 0xfee75c, row: "━━━━━━━━━━━━  🤝 NAP  ━━━━━━━━━━━━" },
  ALLY:   { emoji: "💚", label: "ALIADO",       color: 0x57f287, row: "━━━━━━━━━━━━  💚 ALIADOS  ━━━━━━━━━━━━" },
  ENEMY:  { emoji: "🔴", label: "ENEMIGO",      color: 0xed4245, row: "━━━━━━━━━━━━  🔴 ENEMIGOS  ━━━━━━━━━━━━" },
  BORDER: { emoji: "🔵", label: "FRONTERA",     color: 0x5865f2, row: "━━━━━━━━━━━━  🔵 FRONTERA  ━━━━━━━━━━━━" },
};

export async function handleDiplomacyCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  const modName   = interaction.guild.members.cache.get(interaction.user.id)?.displayName ?? interaction.user.username;
  const modAvatar = interaction.user.displayAvatarURL();

  try {
    if (sub === "radar") {
      const pacts  = await DiplomacyPact.find({ guildId }).sort({ pactType: 1 });
      const config = await GuildConfig.findOne({ guildId });
      const tag    = config?.allianceTag ?? "GUILD";

      const embed = new EmbedBuilder()
        .setAuthor({ name: `[${tag}]  Inteligencia Diplomática`, iconURL: interaction.guild.iconURL() ?? undefined })
        .setTitle("🛰️  RADAR DIPLOMÁTICO")
        .setColor(0x5865f2)
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro  •  Panel Diplomático" });

      if (pacts.length === 0) {
        embed.setDescription(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `*No hay pactos diplomáticos registrados.*\n` +
          `Usa \`/diplomacy add\` para registrar uno.\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        );
      } else {
        const grouped: Record<string, typeof pacts> = { ALLY: [], NAP: [], BORDER: [], ENEMY: [] };
        for (const p of pacts) {
          if (grouped[p.pactType]) grouped[p.pactType].push(p);
        }

        const lines: string[] = [];
        for (const [type, entries] of Object.entries(grouped)) {
          if (entries.length === 0) continue;
          const meta = PACT_META[type];
          lines.push(`\n${meta.row}`);
          for (const p of entries) {
            const expStr = p.expiresAt
              ? ` · vence <t:${Math.floor(new Date(p.expiresAt).getTime() / 1000)}:R>`
              : "";
            const detail = p.details ? `  *${p.details}*` : "";
            lines.push(`${meta.emoji} **[${p.targetAlliance}]**${detail}${expStr}`);
          }
        }

        embed.setDescription(lines.join("\n").slice(0, 4096));

        const total = pacts.length;
        embed.addFields(
          { name: "💚 Aliados",      value: String(grouped.ALLY.length),   inline: true },
          { name: "🤝 NAP",          value: String(grouped.NAP.length),    inline: true },
          { name: "🔵 Frontera",     value: String(grouped.BORDER.length), inline: true },
          { name: "🔴 Enemigos",     value: String(grouped.ENEMY.length),  inline: true },
          { name: "📊 Total pactos", value: String(total),                 inline: true },
          { name: "\u200b",          value: "\u200b",                      inline: true },
        );
      }

      await interaction.reply({ embeds: [embed] });

    } else if (sub === "add") {
      const alianza      = interaction.options.getString("alianza", true);
      const tipo         = interaction.options.getString("tipo", true) as "NAP" | "ALLY" | "ENEMY" | "BORDER";
      const detalles     = interaction.options.getString("detalles") ?? "";
      const diasExpiracion = interaction.options.getInteger("dias_expiracion");
      const expiresAt    = diasExpiracion ? new Date(Date.now() + diasExpiracion * 86_400_000) : null;

      await DiplomacyPact.findOneAndUpdate(
        { guildId, targetAlliance: alianza },
        { pactType: tipo, details: detalles, createdBy: interaction.user.id, createdAt: new Date(), expiresAt },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      const meta = PACT_META[tipo];

      const embed = new EmbedBuilder()
        .setAuthor({ name: `Registrado por ${modName}`, iconURL: modAvatar })
        .setTitle(`${meta.emoji}  PACTO DIPLOMÁTICO — ${meta.label}`)
        .setColor(meta.color)
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `**[${alianza}]** ahora figura como **${meta.label}** en el radar.\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        )
        .addFields(
          { name: "🏴 Alianza",         value: `**[${alianza}]**`,              inline: true },
          { name: "📋 Tipo de Pacto",   value: `${meta.emoji} ${meta.label}`,   inline: true },
          { name: "🖊️ Registrado por", value: `<@${interaction.user.id}>`,      inline: true },
          {
            name: "⏳ Expiración",
            value: expiresAt
              ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:F>\n*(en ${diasExpiracion} días)*`
              : "Sin fecha de vencimiento",
            inline: true,
          },
          { name: "📝 Detalles",        value: detalles || "—",                 inline: false },
        )
        .setTimestamp()
        .setFooter({
          text: expiresAt
            ? "⚠️ El bot avisará 48h antes del vencimiento  •  Kingdom Guardian Pro"
            : "Kingdom Guardian Pro  •  Panel Diplomático",
        });

      await interaction.reply({ embeds: [embed] });
    }
  } catch (err) {
    logger.error({ err, sub }, "Diplomacy command error");
    await interaction.reply({ content: "❌ Error al procesar el comando.", ephemeral: true }).catch(() => {});
  }
}
