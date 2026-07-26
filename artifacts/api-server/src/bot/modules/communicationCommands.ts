import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  Role,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { UserProfile, ScheduledTimer } from "../../db/schemas";
import { logger } from "../../lib/logger";

const COLOR_MAP: Record<string, number> = {
  "rojo":    0xed4245,
  "naranja": 0xff7b00,
  "amarillo":0xfee75c,
  "azul":    0x5865f2,
  "verde":   0x57f287,
  "morado":  0x9b59b6,
  "dorado":  0xf0a500,
  "oscuro":  0x2b2d31,
};

export const communicationCommandDefs = [
  new SlashCommandBuilder()
    .setName("announcement")
    .setDescription("Publicar comunicados oficiales")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("official")
        .setDescription("Publicar anuncio oficial del Alto Mando")
        .addStringOption((o) =>
          o.setName("titulo").setDescription("Título del anuncio").setRequired(true).setMaxLength(80),
        )
        .addStringOption((o) =>
          o.setName("mensaje").setDescription("Contenido del anuncio").setRequired(true).setMaxLength(1500),
        )
        .addRoleOption((o) =>
          o.setName("mencionar").setDescription("Rol a pingear (ej: @Miembros)").setRequired(false),
        )
        .addStringOption((o) =>
          o.setName("color")
            .setDescription("Color del embed")
            .setRequired(false)
            .addChoices(
              { name: "🔴 Rojo — Urgente",     value: "rojo" },
              { name: "🟠 Naranja — Importante", value: "naranja" },
              { name: "🟡 Amarillo — Aviso",    value: "amarillo" },
              { name: "🔵 Azul — Info",         value: "azul" },
              { name: "🟢 Verde — Positivo",    value: "verde" },
              { name: "🟣 Morado — Especial",   value: "morado" },
              { name: "🥇 Dorado — Oficial",    value: "dorado" },
              { name: "⚫ Oscuro — Clásico",    value: "oscuro" },
            ),
        ),
    ),
  new SlashCommandBuilder()
    .setName("event")
    .setDescription("Gestión de eventos de alianza")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("announcement")
        .setDescription("Publicar convocatoria de evento")
        .addStringOption((o) =>
          o.setName("nombre").setDescription("Nombre del evento").setRequired(true).setMaxLength(80),
        )
        .addStringOption((o) =>
          o.setName("fecha").setDescription("Fecha y hora (ej: Sábado 21:00 UTC)").setRequired(true).setMaxLength(60),
        )
        .addStringOption((o) =>
          o.setName("descripcion").setDescription("Detalles, objetivos, requisitos del evento").setRequired(true).setMaxLength(1000),
        )
        .addRoleOption((o) =>
          o.setName("mencionar").setDescription("Rol a pingear (ej: @Guerreros)").setRequired(false),
        )
        .addStringOption((o) =>
          o.setName("color")
            .setDescription("Color del embed")
            .setRequired(false)
            .addChoices(
              { name: "🔴 Rojo — Urgente",     value: "rojo" },
              { name: "🟠 Naranja — Importante", value: "naranja" },
              { name: "🟡 Amarillo — Aviso",    value: "amarillo" },
              { name: "🔵 Azul — Info",         value: "azul" },
              { name: "🟢 Verde — Positivo",    value: "verde" },
              { name: "🟣 Morado — Especial",   value: "morado" },
              { name: "🥇 Dorado — Oficial",    value: "dorado" },
              { name: "⚫ Oscuro — Clásico",    value: "oscuro" },
            ),
        ),
    ),
].map((b) => b.toJSON());

// Track active announcement message IDs → Set of users who confirmed
const announcementReaders = new Map<string, Set<string>>();

// Track active event attendees → { attend: string[], absent: string[] }
const eventAttendees = new Map<string, { attend: string[]; absent: string[] }>();

export async function handleAnnouncementCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  if (sub !== "official") return;

  const titulo      = interaction.options.getString("titulo", true);
  const mensaje     = interaction.options.getString("mensaje", true);
  const mentionRole = interaction.options.getRole("mencionar") as Role | null;
  const colorKey    = interaction.options.getString("color") ?? "dorado";
  const color       = COLOR_MAP[colorKey] ?? 0xf0a500;

  const member    = interaction.guild.members.cache.get(interaction.user.id);
  const authorName = member?.displayName ?? interaction.user.username;
  const authorAvatar = interaction.user.displayAvatarURL();

  await interaction.deferReply({ ephemeral: true });

  const pingContent = mentionRole ? `<@&${mentionRole.id}>` : "@here";

  const embed = new EmbedBuilder()
    .setAuthor({ name: authorName, iconURL: authorAvatar })
    .setTitle(`📢  ${titulo}`)
    .setColor(color)
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${mensaje}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    )
    .addFields(
      { name: "📬 Mención",    value: mentionRole ? `<@&${mentionRole.id}>` : "@here", inline: true },
      { name: "✅ Lecturas",   value: "0",                                              inline: true },
      { name: "\u200b",        value: "\u200b",                                         inline: true },
    )
    .setTimestamp()
    .setFooter({ text: "Kingdom Guardian Pro  •  Alto Mando" });

  const placeholderRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ann_read:PLACEHOLDER").setLabel("✅ Confirmar Lectura").setStyle(ButtonStyle.Secondary),
  );

  const msg = await (interaction.channel as TextChannel).send({
    content: pingContent,
    embeds: [embed],
    components: [placeholderRow],
    allowedMentions: mentionRole ? { roles: [mentionRole.id] } : { parse: ["everyone"] },
  });

  announcementReaders.set(msg.id, new Set());

  await msg.edit({
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`ann_read:${msg.id}`).setLabel("✅ Confirmar Lectura").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });

  await interaction.editReply({ content: "✅ Anuncio publicado correctamente." });
}

export async function handleEventCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  if (sub !== "announcement") return;

  const nombre      = interaction.options.getString("nombre", true);
  const fecha       = interaction.options.getString("fecha", true);
  const descripcion = interaction.options.getString("descripcion", true);
  const mentionRole = interaction.options.getRole("mencionar") as Role | null;
  const colorKey    = interaction.options.getString("color") ?? "azul";
  const color       = COLOR_MAP[colorKey] ?? 0x5865f2;

  const member     = interaction.guild.members.cache.get(interaction.user.id);
  const authorName  = member?.displayName ?? interaction.user.username;
  const authorAvatar = interaction.user.displayAvatarURL();

  await interaction.deferReply({ ephemeral: true });

  const pingContent = mentionRole ? `<@&${mentionRole.id}>` : "@here";

  const embed = new EmbedBuilder()
    .setAuthor({ name: authorName, iconURL: authorAvatar })
    .setTitle(`⚔️  ${nombre.toUpperCase()}`)
    .setColor(color)
    .setDescription(descripcion)
    .addFields(
      { name: "📅 Fecha y Hora", value: fecha,                                              inline: true },
      { name: "📬 Mención",      value: mentionRole ? `<@&${mentionRole.id}>` : "@here",    inline: true },
      { name: "\u200b",          value: "\u200b",                                            inline: true },
      { name: "🟢 Asistiré",    value: "0 soldados",                                       inline: true },
      { name: "🔴 Ausente",     value: "0 soldados",                                       inline: true },
      { name: "\u200b",          value: "\u200b",                                            inline: true },
    )
    .setTimestamp()
    .setFooter({ text: "Kingdom Guardian Pro  •  Gestión de Eventos  •  +10 pts por asistencia" });

  const placeholderRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("evt_attend:PLACEHOLDER").setLabel("🟢 Asistiré").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("evt_absent:PLACEHOLDER").setLabel("🔴 Ausente").setStyle(ButtonStyle.Danger),
  );

  const msg = await (interaction.channel as TextChannel).send({
    content: pingContent,
    embeds: [embed],
    components: [placeholderRow],
    allowedMentions: mentionRole ? { roles: [mentionRole.id] } : { parse: ["everyone"] },
  });

  eventAttendees.set(msg.id, { attend: [], absent: [] });

  await msg.edit({
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`evt_attend:${msg.id}`).setLabel("🟢 Asistiré").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`evt_absent:${msg.id}`).setLabel("🔴 Ausente").setStyle(ButtonStyle.Danger),
      ),
    ],
  });

  // Auto-schedule 30-min reminder if parseable
  try {
    const reminderTime = parseEventDate(fecha);
    if (reminderTime && reminderTime.getTime() - Date.now() > 35 * 60_000 && interaction.channelId) {
      const fireAt = new Date(reminderTime.getTime() - 30 * 60_000);
      await ScheduledTimer.create({
        guildId: interaction.guild!.id,
        channelId: interaction.channelId as string,
        message: `⏰ **Recordatorio:** El evento **${nombre}** comienza en **30 minutos**! (${fecha})`,
        fireAt,
        fired: false,
        createdBy: interaction.user.id,
      });
    }
  } catch (err) {
    logger.error({ err }, "Failed to schedule event reminder timer");
  }

  await interaction.editReply({
    content: "✅ Evento publicado. Si la hora es válida el bot enviará un recordatorio 30 min antes automáticamente.",
  });
}

function parseEventDate(input: string): Date | null {
  const abs = new Date(input.replace("UTC", "").trim() + " UTC");
  if (!isNaN(abs.getTime()) && abs > new Date()) return abs;
  return null;
}

export async function handleCommunicationButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const [action, messageId] = interaction.customId.split(":");
  const userId  = interaction.user.id;
  const guildId = interaction.guild.id;

  if (action === "ann_read") {
    const readers = announcementReaders.get(messageId);
    if (!readers) {
      await interaction.reply({ content: "Este anuncio ya no está activo en memoria.", ephemeral: true });
      return;
    }
    if (readers.has(userId)) {
      await interaction.reply({ content: "Ya confirmaste la lectura de este anuncio.", ephemeral: true });
      return;
    }
    readers.add(userId);

    const oldEmbed = interaction.message.embeds[0];
    const updated  = EmbedBuilder.from(oldEmbed).spliceFields(
      oldEmbed.fields.findIndex((f) => f.name === "✅ Lecturas"),
      1,
      { name: "✅ Lecturas", value: String(readers.size), inline: true },
    );
    await interaction.update({ embeds: [updated] });

  } else if (action === "evt_attend" || action === "evt_absent") {
    const data = eventAttendees.get(messageId);
    if (!data) {
      await interaction.reply({ content: "Este evento ya no está activo en memoria.", ephemeral: true });
      return;
    }

    data.attend = data.attend.filter((id) => id !== userId);
    data.absent = data.absent.filter((id) => id !== userId);

    const isAttend = action === "evt_attend";
    if (isAttend) {
      data.attend.push(userId);
      try {
        await UserProfile.findOneAndUpdate(
          { discordId: userId, guildId },
          { $inc: { weeklyPoints: 10, totalPoints: 10, eventsAttended: 1 } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
      } catch (err) {
        logger.error({ err }, "Failed to award event points");
      }
    } else {
      data.absent.push(userId);
    }

    const oldEmbed  = interaction.message.embeds[0];
    const attendIdx = oldEmbed.fields.findIndex((f) => f.name === "🟢 Asistiré");
    const absentIdx = oldEmbed.fields.findIndex((f) => f.name === "🔴 Ausente");

    const updated = EmbedBuilder.from(oldEmbed);
    updated.spliceFields(attendIdx, 1, { name: "🟢 Asistiré", value: `${data.attend.length} soldados`, inline: true });
    updated.spliceFields(absentIdx, 1, { name: "🔴 Ausente",  value: `${data.absent.length} soldados`, inline: true });

    await interaction.update({ embeds: [updated] });

    if (isAttend) {
      await interaction.followUp({
        content: "✅ Registrado como **Asistente** — +10 puntos semanales acreditados.",
        ephemeral: true,
      });
    }
  }
}

// No-op export kept for compatibility with client.ts modal handler router
export async function handleCommunicationModal(_interaction: import("discord.js").ModalSubmitInteraction): Promise<void> { return; }
