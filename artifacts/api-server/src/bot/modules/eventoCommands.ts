import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { AllianceEvent, GuildConfig } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const eventoCommandDefs = [
  new SlashCommandBuilder()
    .setName("evento")
    .setDescription("Gestión de eventos de alianza con RSVP")
    .addSubcommand((s) =>
      s
        .setName("crear")
        .setDescription("Crear un evento con botones de confirmación (R4/R5)")
        .addStringOption((o: import("discord.js").SlashCommandStringOption) =>
          o.setName("titulo").setDescription("Título del evento").setRequired(true).setMaxLength(80),
        )
        .addStringOption((o: import("discord.js").SlashCommandStringOption) =>
          o.setName("descripcion").setDescription("Descripción del evento").setRequired(true).setMaxLength(500),
        )
        .addStringOption((o: import("discord.js").SlashCommandStringOption) =>
          o
            .setName("tipo")
            .setDescription("Tipo de evento")
            .setRequired(true)
            .addChoices(
              { name: "⚔️ Guerra",          value: "guerra" },
              { name: "🏰 Construcción",    value: "construccion" },
              { name: "🔬 Investigación",   value: "investigacion" },
              { name: "🛡️ Defensa",         value: "defensa" },
              { name: "🤝 Diplomacia",      value: "diplomacia" },
              { name: "🎉 Social",          value: "social" },
              { name: "📋 General",         value: "general" },
            ),
        )
        .addStringOption((o: import("discord.js").SlashCommandStringOption) =>
          o
            .setName("fecha_hora_utc")
            .setDescription("Fecha y hora en UTC (formato: DD/MM/YYYY HH:MM — ej: 25/07/2026 20:00)")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("lista")
        .setDescription("Ver eventos próximos de la alianza"),
    )
    .addSubcommand((s) =>
      s
        .setName("cancelar")
        .setDescription("Cancelar un evento activo (R4/R5)")
        .addStringOption((o: import("discord.js").SlashCommandStringOption) =>
          o.setName("id").setDescription("ID del evento (6 caracteres)").setRequired(true),
        ),
    ),
].map((b) => b.toJSON());

const TYPE_META: Record<string, { emoji: string; color: number }> = {
  guerra:        { emoji: "⚔️", color: 0xed4245 },
  construccion:  { emoji: "🏰", color: 0xff7b00 },
  investigacion: { emoji: "🔬", color: 0x5865f2 },
  defensa:       { emoji: "🛡️", color: 0x57f287 },
  diplomacia:    { emoji: "🤝", color: 0x9b59b6 },
  social:        { emoji: "🎉", color: 0xffd700 },
  general:       { emoji: "📋", color: 0x4488ff },
};

function parseDateTime(input: string): Date | null {
  // Accepts DD/MM/YYYY HH:MM
  const match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, d, m, y, h, min] = match;
  const date = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(h), parseInt(min)));
  return isNaN(date.getTime()) ? null : date;
}

function buildEventEmbed(opts: {
  title: string;
  description: string;
  tipo: string;
  scheduledFor: Date;
  createdBy: string;
  confirmed: string[];
  declined: string[];
  maybe: string[];
  shortId: string;
}): EmbedBuilder {
  const meta = TYPE_META[opts.tipo] ?? TYPE_META["general"];
  const ts   = Math.floor(opts.scheduledFor.getTime() / 1000);

  const confirmedList = opts.confirmed.length > 0
    ? opts.confirmed.slice(0, 20).map((id) => `<@${id}>`).join(", ")
    : "*Nadie aún*";
  const maybeList = opts.maybe.length > 0
    ? opts.maybe.slice(0, 10).map((id) => `<@${id}>`).join(", ")
    : "*Nadie aún*";

  return new EmbedBuilder()
    .setTitle(`${meta.emoji} ${opts.title}`)
    .setColor(meta.color)
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${opts.description}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    )
    .addFields(
      { name: "🕐 Fecha y hora",      value: `<t:${ts}:F> (<t:${ts}:R>)`,                        inline: false },
      { name: `✅ Confirmados (${opts.confirmed.length})`, value: confirmedList.slice(0, 500), inline: false },
      { name: `🤔 Tal vez (${opts.maybe.length})`,        value: maybeList.slice(0, 300),     inline: false },
      { name: `❌ No pueden (${opts.declined.length})`,   value: String(opts.declined.length), inline: true },
      { name: "📣 Organiza",          value: `<@${opts.createdBy}>`,                              inline: true },
    )
    .setFooter({ text: `ID: ${opts.shortId} · Kingdom Guardian Pro — Eventos · +10 pts por confirmar asistencia` })
    .setTimestamp();
}

function buildRsvpButtons(eventMongoId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`evt_yes:${eventMongoId}`)
      .setLabel("✅ Confirmo asistencia")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`evt_maybe:${eventMongoId}`)
      .setLabel("🤔 Tal vez")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`evt_no:${eventMongoId}`)
      .setLabel("❌ No puedo")
      .setStyle(ButtonStyle.Danger),
  );
}

export async function handleEventoCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  try {
    if (sub === "crear") {
      const titulo      = interaction.options.getString("titulo", true);
      const descripcion = interaction.options.getString("descripcion", true);
      const tipo        = interaction.options.getString("tipo", true);
      const fechaInput  = interaction.options.getString("fecha_hora_utc", true);

      const scheduledFor = parseDateTime(fechaInput);
      if (!scheduledFor) {
        await interaction.reply({
          content: "❌ Formato de fecha inválido. Usa **DD/MM/YYYY HH:MM** en UTC (ej: `25/07/2026 20:00`).",
          ephemeral: true,
        });
        return;
      }

      if (scheduledFor <= new Date()) {
        await interaction.reply({ content: "❌ La fecha del evento debe ser en el futuro.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const config    = await GuildConfig.findOne({ guildId }).lean();
      const channelId = config?.channels?.eventos ?? config?.channels?.announcements ?? interaction.channelId;
      const chan       = interaction.guild.channels.cache.get(channelId) as TextChannel | undefined;

      if (!chan) {
        await interaction.editReply({ content: "❌ No se encontró el canal de eventos. Configúralo con `/setup channels`." });
        return;
      }

      // Create a placeholder event to get the ID
      const event = await AllianceEvent.create({
        guildId,
        title: titulo,
        description: descripcion,
        tipo,
        scheduledFor,
        channelId,
        messageId: "pending",
        createdBy: interaction.user.id,
        confirmed: [],
        declined:  [],
        maybe:     [],
        reminderSent: false,
        closed: false,
      });

      const shortId = event._id.toString().slice(-6).toUpperCase();
      const embed   = buildEventEmbed({
        title: titulo, description: descripcion, tipo, scheduledFor,
        createdBy: interaction.user.id, confirmed: [], declined: [], maybe: [], shortId,
      });

      const msg = await chan.send({
        content: "@here 📣 **¡Nuevo evento de alianza!**",
        embeds: [embed],
        components: [buildRsvpButtons(event._id.toString())],
        allowedMentions: { parse: ["everyone"] },
      });

      event.messageId = msg.id;
      await event.save();

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Evento Creado")
            .setColor(0x57f287)
            .addFields(
              { name: "📋 Título",  value: titulo,       inline: true },
              { name: "🆔 ID",      value: `\`${shortId}\``, inline: true },
              { name: "📢 Canal",   value: `<#${channelId}>`, inline: true },
            )
            .setDescription("Los participantes recibirán un recordatorio por DM 30 minutos antes del evento.")
            .setTimestamp(),
        ],
      });
      return;
    }

    if (sub === "lista") {
      await interaction.deferReply({ ephemeral: true });
      const now    = new Date();
      const events = await AllianceEvent.find({ guildId, closed: false, scheduledFor: { $gt: now } })
        .sort({ scheduledFor: 1 })
        .limit(8)
        .lean();

      if (events.length === 0) {
        await interaction.editReply({ content: "📭 No hay eventos próximos." });
        return;
      }

      const lines = events.map((e, i) => {
        const ts   = Math.floor(new Date(e.scheduledFor).getTime() / 1000);
        const meta = TYPE_META[e.tipo ?? "general"] ?? TYPE_META["general"];
        const shortId = e._id.toString().slice(-6).toUpperCase();
        return `**${i + 1}.** ${meta.emoji} **${e.title}** \`${shortId}\`\n> <t:${ts}:F> · ✅ ${e.confirmed.length} · ❌ ${e.declined.length}`;
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("📅 Próximos Eventos de la Alianza")
            .setColor(0x4488ff)
            .setDescription(lines.join("\n\n"))
            .setFooter({ text: "Kingdom Guardian Pro — Eventos" })
            .setTimestamp(),
        ],
      });
      return;
    }

    if (sub === "cancelar") {
      const shortId = interaction.options.getString("id", true).toUpperCase();
      const event   = await AllianceEvent.findOne({ guildId, closed: false })
        .where("_id").regex(new RegExp(shortId + "$", "i"))
        .exec();

      if (!event) {
        await interaction.reply({ content: `❌ No se encontró evento activo con ID \`${shortId}\`.`, ephemeral: true });
        return;
      }

      event.closed = true;
      await event.save();

      // Edit original message
      try {
        const chan = interaction.guild.channels.cache.get(event.channelId) as TextChannel | undefined;
        const msg  = await chan?.messages.fetch(event.messageId);
        if (msg) {
          const cancelled = EmbedBuilder.from(msg.embeds[0])
            .setColor(0x808080)
            .setTitle(`~~${msg.embeds[0].title}~~ — CANCELADO`);
          await msg.edit({ embeds: [cancelled], components: [] });
        }
      } catch { /* message may be deleted */ }

      await interaction.reply({
        content: `✅ Evento \`${shortId}\` cancelado y embed actualizado.`,
        ephemeral: true,
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Evento command error");
    await interaction.reply({ content: "❌ Error al procesar el comando.", ephemeral: true }).catch(() => {});
  }
}

export async function handleEventoButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [action, eventId] = interaction.customId.split(":");
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  try {
    const event = await AllianceEvent.findById(eventId);
    if (!event || event.closed || event.guildId !== guildId) {
      await interaction.reply({ content: "Este evento ya no está activo.", ephemeral: true });
      return;
    }

    // Remove from all lists first
    event.confirmed = event.confirmed.filter((id) => id !== userId);
    event.declined  = event.declined.filter((id) => id !== userId);
    event.maybe     = event.maybe.filter((id) => id !== userId);

    let responseMsg = "";
    let earnedPoints = false;

    if (action === "evt_yes") {
      if (!event.confirmed.includes(userId)) {
        event.confirmed.push(userId);
        earnedPoints = true;
      }
      responseMsg = "✅ **¡Asistencia confirmada!** Recibirás un recordatorio 30 min antes. +10 pts acreditados.";
    } else if (action === "evt_maybe") {
      event.maybe.push(userId);
      responseMsg = "🤔 **Registrado como «tal vez»**. Puedes cambiar tu respuesta antes del evento.";
    } else if (action === "evt_no") {
      event.declined.push(userId);
      responseMsg = "❌ **Registrado como «no puedo»**. Puedes cambiar tu respuesta si tus planes cambian.";
    }

    await event.save();

    // Award points for confirmed attendance
    if (earnedPoints) {
      const { UserProfile } = await import("../../db/schemas");
      await UserProfile.findOneAndUpdate(
        { discordId: userId, guildId },
        { $inc: { weeklyPoints: 10, totalPoints: 10, eventsAttended: 1 }, $set: { lastActivity: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).catch((err) => { logger.error({ err, userId }, "Failed to award evento RSVP points"); });
    }

    const shortId = event._id.toString().slice(-6).toUpperCase();
    const embed   = buildEventEmbed({
      title: event.title,
      description: event.description,
      tipo: event.tipo ?? "general",
      scheduledFor: event.scheduledFor,
      createdBy: event.createdBy,
      confirmed: event.confirmed,
      declined:  event.declined,
      maybe:     event.maybe,
      shortId,
    });

    await interaction.update({ embeds: [embed], components: [buildRsvpButtons(eventId)] });
    await interaction.followUp({ content: responseMsg, ephemeral: true });
  } catch (err) {
    logger.error({ err }, "Evento button error");
    await interaction.reply({ content: "❌ Error al registrar tu respuesta.", ephemeral: true }).catch(() => {});
  }
}

/** Run every minute from startScheduler — sends DM reminders 30 min before event */
export function startEventoScheduler(client: Client): void {
  setInterval(async () => {
    try {
      const now      = new Date();
      const in30     = new Date(now.getTime() + 31 * 60_000);
      const in29     = new Date(now.getTime() + 29 * 60_000);

      const upcoming = await AllianceEvent.find({
        closed: false,
        reminderSent: false,
        scheduledFor: { $gte: in29, $lte: in30 },
      }).lean();

      for (const event of upcoming) {
        const ts = Math.floor(new Date(event.scheduledFor).getTime() / 1000);
        const meta = TYPE_META[event.tipo ?? "general"] ?? TYPE_META["general"];

        for (const userId of event.confirmed) {
          client.users.fetch(userId)
            .then((user) =>
              user.send({
                embeds: [
                  new EmbedBuilder()
                    .setTitle(`⏰ Recordatorio — ${meta.emoji} ${event.title}`)
                    .setColor(meta.color)
                    .setDescription(
                      `¡El evento comienza en **30 minutos**!\n\n${event.description}`,
                    )
                    .addFields({ name: "🕐 Hora", value: `<t:${ts}:t> (<t:${ts}:R>)`, inline: true })
                    .setFooter({ text: "Kingdom Guardian Pro — Eventos · ¡Prepárate!" })
                    .setTimestamp(),
                ],
              }),
            )
            .catch(() => { /* DMs can fail if user has them disabled — expected */ });
        }

        await AllianceEvent.findByIdAndUpdate(event._id, { reminderSent: true });
        logger.info({ eventId: event._id, recipients: event.confirmed.length }, "Event reminders sent");
      }

      // Auto-close past events
      await AllianceEvent.updateMany(
        { closed: false, scheduledFor: { $lt: new Date(now.getTime() - 3 * 60 * 60_000) } },
        { $set: { closed: true } },
      );
    } catch (err) {
      logger.error({ err }, "Evento scheduler error");
    }
  }, 60_000);

  logger.info("Evento reminder scheduler started");
}
