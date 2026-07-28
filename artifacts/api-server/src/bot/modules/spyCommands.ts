import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { GuildConfig, SpyReport } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const spyCommandDefs = [
  new SlashCommandBuilder()
    .setName("spy")
    .setDescription("Sistema de inteligencia — denuncia y gestión de espías")
    .addSubcommand((s) =>
      s
        .setName("report")
        .setDescription("Reportar actividad sospechosa de un miembro o jugador externo"),
    )
    .addSubcommand((s) =>
      s
        .setName("list")
        .setDescription("Ver reportes de espionaje pendientes (R4/R5)")
        .addStringOption((o) =>
          o
            .setName("estado")
            .setDescription("Filtrar por estado")
            .addChoices(
              { name: "🔴 Abiertos", value: "open" },
              { name: "🔵 Investigando", value: "investigating" },
              { name: "✅ Confirmados espías", value: "confirmed" },
              { name: "🟢 Limpiados", value: "cleared" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("update")
        .setDescription("Actualizar estado de un reporte (R4/R5)")
        .addStringOption((o) =>
          o.setName("id").setDescription("ID del reporte (6 caracteres)").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("estado")
            .setDescription("Nuevo estado")
            .setRequired(true)
            .addChoices(
              { name: "🔵 Investigando", value: "investigating" },
              { name: "✅ Confirmado espía", value: "confirmed" },
              { name: "🟢 Caso cerrado / limpio", value: "cleared" },
            ),
        ),
    ),
].map((b) => b.toJSON());

const STATUS_META: Record<string, { label: string; emoji: string; color: number }> = {
  open:          { label: "Abierto",         emoji: "🔴", color: 0xed4245 },
  investigating: { label: "Investigando",    emoji: "🔵", color: 0x5865f2 },
  confirmed:     { label: "Espía Confirmado", emoji: "⚠️", color: 0xff7b00 },
  cleared:       { label: "Caso Cerrado",    emoji: "🟢", color: 0x57f287 },
};

export async function handleSpyCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();

  try {
    if (sub === "report") {
      const modal = new ModalBuilder()
        .setCustomId("spy_report_modal")
        .setTitle("🕵️ Reportar Actividad Sospechosa");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("ign")
            .setLabel("IGN del sospechoso (nombre en el juego)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(50),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("alliance")
            .setLabel("Alianza del sospechoso (si la conoces)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(10)
            .setPlaceholder("ej: [ENC]"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("description")
            .setLabel("Describe la actividad sospechosa")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(800)
            .setPlaceholder("¿Qué viste? ¿Cuándo? ¿En qué contexto?"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("discord_id")
            .setLabel("ID de Discord (si es miembro del servidor)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(30)
            .setPlaceholder("Clic derecho → Copiar ID (activa modo desarrollador)"),
        ),
      );

      await interaction.showModal(modal);
      return;
    }

    if (sub === "list") {
      if (!interaction.member?.permissions || !(interaction.member.permissions as import("discord.js").PermissionsBitField).has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "❌ Solo R4/R5 pueden ver los reportes.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const estado = interaction.options.getString("estado") ?? "open";
      const guildId = interaction.guild.id;

      const reports = await SpyReport.find({ guildId, status: estado as "open" | "investigating" | "cleared" | "confirmed" })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      if (reports.length === 0) {
        await interaction.editReply({ content: `📭 No hay reportes con estado **${STATUS_META[estado]?.label ?? estado}**.` });
        return;
      }

      const meta = STATUS_META[estado] ?? STATUS_META["open"];
      const lines = reports.map((r, i) => {
        const date = `<t:${Math.floor(new Date(r.createdAt).getTime() / 1000)}:d>`;
        const ally = r.suspectAlliance ? ` [${r.suspectAlliance}]` : "";
        const reporter = `<@${r.reporterId}>`;
        const shortId = r._id.toString().slice(-6).toUpperCase();
        return `**#${i + 1}** \`${shortId}\` — **${r.suspectIGN}**${ally} · ${date}\n> 📝 ${r.description.slice(0, 80)}${r.description.length > 80 ? "…" : ""}\n> 👤 Reportado por ${reporter}`;
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${meta.emoji} Reportes de Inteligencia — ${meta.label}`)
            .setColor(meta.color)
            .setDescription(lines.join("\n\n"))
            .setFooter({ text: `${reports.length} reporte(s) · Usa /spy update <ID> para cambiar estado` })
            .setTimestamp(),
        ],
      });
      return;
    }

    if (sub === "update") {
      if (!interaction.member?.permissions || !(interaction.member.permissions as import("discord.js").PermissionsBitField).has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "❌ Solo R4/R5 pueden actualizar reportes.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const shortId = interaction.options.getString("id", true).toUpperCase();
      const estado  = interaction.options.getString("estado", true);
      const guildId = interaction.guild.id;

      const allReports = await SpyReport.find({ guildId }).lean();
      const report = await SpyReport.findById(
        allReports.find((r) => r._id.toString().toUpperCase().endsWith(shortId))?._id,
      );

      if (!report) {
        await interaction.editReply({ content: `❌ No se encontró reporte con ID \`${shortId}\`.` });
        return;
      }

      report.status = estado as "open" | "investigating" | "cleared" | "confirmed";
      report.reviewedBy = interaction.user.id;
      await report.save();

      const meta = STATUS_META[estado] ?? STATUS_META["open"];
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${meta.emoji} Reporte Actualizado`)
            .setColor(meta.color)
            .addFields(
              { name: "🕵️ Sospechoso", value: report.suspectIGN, inline: true },
              { name: "📋 Nuevo estado", value: `${meta.emoji} ${meta.label}`, inline: true },
              { name: "👮 Revisado por", value: `<@${interaction.user.id}>`, inline: true },
            )
            .setFooter({ text: "Kingdom Guardian Pro — Inteligencia" })
            .setTimestamp(),
        ],
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Spy command error");
    await interaction.reply({ content: "❌ Error al procesar el comando.", ephemeral: true }).catch(() => {});
  }
}

export async function handleSpyModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId !== "spy_report_modal" || !interaction.guild) return;

  const ign         = interaction.fields.getTextInputValue("ign").trim();
  const alliance    = interaction.fields.getTextInputValue("alliance").trim() || null;
  const description = interaction.fields.getTextInputValue("description").trim();
  const discordId   = interaction.fields.getTextInputValue("discord_id").trim() || null;
  const guildId     = interaction.guild.id;

  await interaction.deferReply({ ephemeral: true });

  try {
    const report = await SpyReport.create({
      guildId,
      reporterId: interaction.user.id,
      suspectDiscordId: discordId,
      suspectIGN: ign,
      suspectAlliance: alliance,
      description,
      status: "open",
    });

    const shortId = report._id.toString().slice(-6).toUpperCase();

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ Reporte de Inteligencia Enviado")
          .setColor(0x5865f2)
          .setDescription("Tu reporte fue recibido de forma anónima y será revisado por el liderazgo.")
          .addFields(
            { name: "🆔 ID del reporte", value: `\`${shortId}\``, inline: true },
            { name: "🕵️ Sospechoso",    value: ign,               inline: true },
          )
          .setFooter({ text: "Kingdom Guardian Pro — El Espejo · Inteligencia" })
          .setTimestamp(),
      ],
    });

    // Notify spy reports channel
    const config = await GuildConfig.findOne({ guildId }).lean();
    const channelId = config?.channels?.spyReports ?? config?.channels?.modLogs;
    if (!channelId) return;

    const chan = interaction.guild.channels.cache.get(channelId) as TextChannel | undefined;
    if (!chan) return;

    const reporterName = interaction.guild.members.cache.get(interaction.user.id)?.displayName ?? interaction.user.username;
    const suspectMention = discordId ? `<@${discordId}> (\`${discordId}\`)` : "*No especificado*";
    const ally = alliance ? `**[${alliance}]**` : "*Desconocida*";

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`spy_inv:${report._id.toString()}`)
        .setLabel("🔵 Marcar Investigando")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`spy_confirm:${report._id.toString()}`)
        .setLabel("⚠️ Confirmar Espía")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`spy_clear:${report._id.toString()}`)
        .setLabel("🟢 Caso Cerrado")
        .setStyle(ButtonStyle.Secondary),
    );

    await chan.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🕵️ NUEVO REPORTE DE INTELIGENCIA")
          .setColor(0xed4245)
          .setDescription(
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `**"${description}"**\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          )
          .addFields(
            { name: "🆔 ID",              value: `\`${shortId}\``,    inline: true },
            { name: "🕵️ IGN Sospechoso", value: ign,                  inline: true },
            { name: "🏴 Alianza",         value: ally,                 inline: true },
            { name: "👤 Discord",         value: suspectMention,       inline: true },
            { name: "📣 Reportado por",   value: reporterName,         inline: true },
            { name: "📋 Estado",          value: "🔴 Abierto",         inline: true },
          )
          .setTimestamp()
          .setFooter({ text: "Kingdom Guardian Pro — Inteligencia • El Espejo" }),
      ],
      components: [row],
    });
  } catch (err) {
    logger.error({ err }, "Spy modal submission error");
    await interaction.editReply({ content: "❌ Error al enviar el reporte." });
  }
}

export async function handleSpyButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  if (!interaction.member?.permissions || !(interaction.member.permissions as import("discord.js").PermissionsBitField).has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "❌ Solo R4/R5 pueden actualizar reportes.", ephemeral: true });
    return;
  }

  const [action, reportId] = interaction.customId.split(":");
  const statusMap: Record<string, "investigating" | "confirmed" | "cleared"> = {
    spy_inv:     "investigating",
    spy_confirm: "confirmed",
    spy_clear:   "cleared",
  };

  const newStatus = statusMap[action];
  if (!newStatus) return;

  try {
    const report = await SpyReport.findByIdAndUpdate(
      reportId,
      { status: newStatus, reviewedBy: interaction.user.id },
      { returnDocument: "after" },
    );
    if (!report) {
      await interaction.reply({ content: "❌ Reporte no encontrado.", ephemeral: true });
      return;
    }

    const meta = STATUS_META[newStatus];
    const oldEmbed = interaction.message.embeds[0];
    const updated = EmbedBuilder.from(oldEmbed)
      .setColor(meta.color)
      .spliceFields(
        oldEmbed.fields.findIndex((f) => f.name === "📋 Estado"),
        1,
        { name: "📋 Estado", value: `${meta.emoji} ${meta.label} — <@${interaction.user.id}>`, inline: true },
      );

    await interaction.update({ embeds: [updated] });
    await interaction.followUp({ content: `${meta.emoji} Estado actualizado a **${meta.label}**.`, ephemeral: true });
  } catch (err) {
    logger.error({ err }, "Spy button error");
    await interaction.reply({ content: "❌ Error al actualizar.", ephemeral: true }).catch(() => {});
  }
}
