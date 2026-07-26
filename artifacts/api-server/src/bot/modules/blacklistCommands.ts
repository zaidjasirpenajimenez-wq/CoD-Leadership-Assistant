import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { BlacklistEntry, GuildConfig } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const blacklistCommandDefs = [
  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Lista negra de jugadores baneados/espías conocidos (R4/R5)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Agregar un jugador a la lista negra")
        .addStringOption((o) =>
          o.setName("ign").setDescription("IGN del jugador (nombre en el juego)").setRequired(true).setMaxLength(50),
        )
        .addStringOption((o) =>
          o
            .setName("razon")
            .setDescription("Motivo del ban")
            .setRequired(true)
            .addChoices(
              { name: "🕵️ Espía confirmado",      value: "Espía confirmado" },
              { name: "⚔️ Enemigo declarado",      value: "Enemigo declarado" },
              { name: "🚫 Tóxico / comportamiento", value: "Comportamiento tóxico" },
              { name: "🔄 Miembro expulsado",       value: "Miembro expulsado" },
              { name: "📋 Otro",                    value: "Otro" },
            ),
        )
        .addStringOption((o) =>
          o.setName("notas").setDescription("Notas adicionales (opcional)").setRequired(false).setMaxLength(200),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Eliminar un jugador de la lista negra")
        .addStringOption((o) =>
          o.setName("ign").setDescription("IGN del jugador a remover").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("view")
        .setDescription("Ver la lista negra completa"),
    )
    .addSubcommand((s) =>
      s
        .setName("check")
        .setDescription("Verificar si un IGN está en la lista negra")
        .addStringOption((o) =>
          o.setName("ign").setDescription("IGN a verificar").setRequired(true),
        ),
    ),
].map((b) => b.toJSON());

const REASON_EMOJI: Record<string, string> = {
  "Espía confirmado":      "🕵️",
  "Enemigo declarado":     "⚔️",
  "Comportamiento tóxico": "🚫",
  "Miembro expulsado":     "🔄",
  "Otro":                  "📋",
};

export async function handleBlacklistCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  try {
    if (sub === "add") {
      const ign   = interaction.options.getString("ign", true).trim();
      const razon = interaction.options.getString("razon", true);
      const notas = interaction.options.getString("notas")?.trim() ?? "";

      const existing = await BlacklistEntry.findOne({ guildId, ign: new RegExp(`^${ign}$`, "i") });
      if (existing) {
        await interaction.reply({
          content: `⚠️ **${ign}** ya está en la lista negra (motivo: ${existing.reason}).`,
          ephemeral: true,
        });
        return;
      }

      await BlacklistEntry.create({ guildId, ign, reason: razon, notes: notas, addedBy: interaction.user.id });

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🚫 Jugador Agregado a Lista Negra")
            .setColor(0xed4245)
            .addFields(
              { name: "🗡️ IGN",         value: `**${ign}**`,                         inline: true },
              { name: "📋 Motivo",      value: `${REASON_EMOJI[razon] ?? "📋"} ${razon}`, inline: true },
              { name: "👮 Agregado por", value: `<@${interaction.user.id}>`,            inline: true },
              ...(notas ? [{ name: "📝 Notas", value: notas, inline: false }] : []),
            )
            .setDescription("⚠️ Si este jugador intenta verificarse, el sistema alertará automáticamente al liderazgo.")
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Lista Negra" }),
        ],
        ephemeral: true,
      });

      // Notify spy channel
      const config = await GuildConfig.findOne({ guildId }).lean();
      const channelId = config?.channels?.spyReports ?? config?.channels?.modLogs;
      if (channelId) {
        const chan = interaction.guild.channels.cache.get(channelId) as TextChannel | undefined;
        chan?.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🚫 LISTA NEGRA — Nuevo Ingreso")
              .setColor(0xed4245)
              .addFields(
                { name: "🗡️ IGN",         value: `**${ign}**`,                              inline: true },
                { name: "📋 Motivo",      value: `${REASON_EMOJI[razon] ?? "📋"} ${razon}`,  inline: true },
                { name: "👮 Por",          value: `<@${interaction.user.id}>`,                inline: true },
                ...(notas ? [{ name: "📝 Notas", value: notas, inline: false }] : []),
              )
              .setTimestamp()
              .setFooter({ text: "Alerta automática si intenta verificarse" }),
          ],
        }).catch((err) => { logger.error({ err }, "Failed to notify spy channel on blacklist add"); });
      }
      return;
    }

    if (sub === "remove") {
      const ign = interaction.options.getString("ign", true).trim();
      const result = await BlacklistEntry.deleteOne({ guildId, ign: new RegExp(`^${ign}$`, "i") });

      if (result.deletedCount === 0) {
        await interaction.reply({ content: `❌ **${ign}** no está en la lista negra.`, ephemeral: true });
        return;
      }

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Jugador Removido de Lista Negra")
            .setColor(0x57f287)
            .addFields(
              { name: "🗡️ IGN",           value: `**${ign}**`,              inline: true },
              { name: "👮 Removido por",   value: `<@${interaction.user.id}>`, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Lista Negra" }),
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === "view") {
      await interaction.deferReply({ ephemeral: true });
      const entries = await BlacklistEntry.find({ guildId }).sort({ addedAt: -1 }).lean();

      if (entries.length === 0) {
        await interaction.editReply({ content: "✅ La lista negra está vacía." });
        return;
      }

      const lines = entries.map((e, i) => {
        const emoji = REASON_EMOJI[e.reason] ?? "📋";
        const date  = `<t:${Math.floor(new Date(e.addedAt).getTime() / 1000)}:d>`;
        return `**${i + 1}.** ${emoji} **${e.ign}** — ${e.reason} · ${date}`;
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🚫 Lista Negra de la Alianza")
            .setColor(0xed4245)
            .setDescription(lines.join("\n").slice(0, 4000))
            .addFields({ name: "Total", value: `**${entries.length}** entrada(s)`, inline: true })
            .setFooter({ text: "Kingdom Guardian Pro — Lista Negra · Alerta automática en #player-verification" })
            .setTimestamp(),
        ],
      });
      return;
    }

    if (sub === "check") {
      const ign   = interaction.options.getString("ign", true).trim();
      const entry = await BlacklistEntry.findOne({ guildId, ign: new RegExp(`^${ign}$`, "i") }).lean();

      if (!entry) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅ IGN No Encontrado en Lista Negra")
              .setColor(0x57f287)
              .setDescription(`**${ign}** no está registrado en la lista negra de esta alianza.`)
              .setTimestamp(),
          ],
          ephemeral: true,
        });
        return;
      }

      const emoji = REASON_EMOJI[entry.reason] ?? "📋";
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🚫 IGN ENCONTRADO EN LISTA NEGRA")
            .setColor(0xed4245)
            .addFields(
              { name: "🗡️ IGN",         value: `**${entry.ign}**`,            inline: true },
              { name: "📋 Motivo",      value: `${emoji} ${entry.reason}`,     inline: true },
              { name: "👮 Agregado por", value: `<@${entry.addedBy}>`,          inline: true },
              ...(entry.notes ? [{ name: "📝 Notas", value: entry.notes, inline: false }] : []),
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro — Lista Negra" }),
        ],
        ephemeral: true,
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Blacklist command error");
    await interaction.reply({ content: "❌ Error al procesar el comando.", ephemeral: true }).catch(() => {});
  }
}

/** Called from sweeperCommands during OCR verification — returns blacklist entry if found */
export async function checkBlacklist(
  guildId: string,
  ign: string,
): Promise<{ ign: string; reason: string; notes?: string; addedBy: string } | null> {
  try {
    return await BlacklistEntry.findOne({ guildId, ign: new RegExp(`^${ign}$`, "i") }).lean();
  } catch {
    return null;
  }
}
