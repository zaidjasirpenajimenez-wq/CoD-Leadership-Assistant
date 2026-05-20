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
  TextInputBuilder,
  TextInputStyle,
  TextChannel,
  Role,
} from "discord.js";
import { UserProfile, GuildConfig, ScheduledTimer } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const communicationCommandDefs = [
  new SlashCommandBuilder()
    .setName("announcement")
    .setDescription("Publicar comunicados oficiales")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("official")
        .setDescription("Publicar anuncio oficial del Alto Mando")
        .addRoleOption((o) =>
          o
            .setName("mencionar")
            .setDescription("Rol a mencionar/pingear con el anuncio (ej: @Miembros)")
            .setRequired(false),
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
        .addRoleOption((o) =>
          o
            .setName("mencionar")
            .setDescription("Rol a mencionar/pingear con el evento (ej: @Miembros)")
            .setRequired(false),
        ),
    ),
].map((b) => b.toJSON());

// Temp store: userId → { roleId, roleMention } while modal is open
const pendingRoleMention = new Map<string, string | null>();

// Track active announcement message IDs → Set of users who confirmed
const announcementReaders = new Map<string, Set<string>>();

// Track active event attendees → { attend: string[], absent: string[] }
const eventAttendees = new Map<string, { attend: string[]; absent: string[] }>();

export async function handleAnnouncementCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub !== "official") return;

  const role = interaction.options.getRole("mencionar") as Role | null;
  pendingRoleMention.set(`ann:${interaction.user.id}`, role ? `<@&${role.id}>` : null);

  const modal = new ModalBuilder()
    .setCustomId("modal_announcement")
    .setTitle("📢 Anuncio Oficial — Alto Mando");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("ann_title")
        .setLabel("Título del Anuncio")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ej: Directriz Semanal de Guerra")
        .setRequired(true)
        .setMaxLength(80),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("ann_message")
        .setLabel("Mensaje")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Escribe el comunicado completo aquí...")
        .setRequired(true)
        .setMaxLength(1500),
    ),
  );

  await interaction.showModal(modal);
}

export async function handleEventCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub !== "announcement") return;

  const role = interaction.options.getRole("mencionar") as Role | null;
  pendingRoleMention.set(`evt:${interaction.user.id}`, role ? `<@&${role.id}>` : null);

  const modal = new ModalBuilder()
    .setCustomId("modal_event")
    .setTitle("⚔️ Convocatoria de Evento");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("evt_name")
        .setLabel("Nombre del Evento")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ej: Asalto al Castillo del Rey")
        .setRequired(true)
        .setMaxLength(80),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("evt_date")
        .setLabel("Fecha y Hora")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ej: Sábado 21:00 UTC  |  2025-06-15 21:00 UTC")
        .setRequired(true)
        .setMaxLength(60),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("evt_desc")
        .setLabel("Descripción")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Detalles del evento, objetivos, requisitos...")
        .setRequired(true)
        .setMaxLength(1000),
    ),
  );

  await interaction.showModal(modal);
}

export async function handleCommunicationModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  if (!interaction.guild) return;

  if (interaction.customId === "modal_announcement") {
    const title   = interaction.fields.getTextInputValue("ann_title");
    const message = interaction.fields.getTextInputValue("ann_message");
    const mention = pendingRoleMention.get(`ann:${interaction.user.id}`) ?? null;
    pendingRoleMention.delete(`ann:${interaction.user.id}`);

    const author = interaction.user;
    const member = interaction.guild.members.cache.get(author.id);
    const avatarUrl = author.displayAvatarURL();

    const embed = new EmbedBuilder()
      .setAuthor({
        name: member?.displayName ?? author.username,
        iconURL: avatarUrl,
      })
      .setTitle(`📢  ${title}`)
      .setDescription(`\`\`\`\n${message}\n\`\`\``)
      .setColor(0xf0a500)
      .addFields(
        { name: "📬 Mencionar", value: mention ?? "@here", inline: true },
        { name: "✅ Lecturas", value: "0", inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "Kingdom Guardian Pro • Alto Mando" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ann_read:PLACEHOLDER")
        .setLabel("✅ Confirmar Lectura")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.deferReply({ ephemeral: true });

    const pingContent = mention ?? "@here";
    const msg = await (interaction.channel as TextChannel).send({
      content: pingContent,
      embeds: [embed],
      components: [row],
      allowedMentions: { parse: mention ? ["roles"] : ["everyone"] },
    });

    announcementReaders.set(msg.id, new Set());

    await msg.edit({
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`ann_read:${msg.id}`)
            .setLabel("✅ Confirmar Lectura")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });

    await interaction.editReply({ content: "✅ Anuncio publicado correctamente." });

  } else if (interaction.customId === "modal_event") {
    const name    = interaction.fields.getTextInputValue("evt_name");
    const date    = interaction.fields.getTextInputValue("evt_date");
    const desc    = interaction.fields.getTextInputValue("evt_desc");
    const mention = pendingRoleMention.get(`evt:${interaction.user.id}`) ?? null;
    pendingRoleMention.delete(`evt:${interaction.user.id}`);

    const author  = interaction.user;
    const member  = interaction.guild.members.cache.get(author.id);
    const avatarUrl = author.displayAvatarURL();

    const embed = new EmbedBuilder()
      .setAuthor({
        name: member?.displayName ?? author.username,
        iconURL: avatarUrl,
      })
      .setTitle(`⚔️  ${name.toUpperCase()}`)
      .setDescription(desc)
      .setColor(0x5865f2)
      .addFields(
        { name: "📅 Fecha y Hora", value: date, inline: true },
        { name: "📬 Mencionar",    value: mention ?? "@here", inline: true },
        { name: "\u200b",          value: "\u200b", inline: true },
        { name: "🟢 Asistiré",    value: "0 soldados", inline: true },
        { name: "🔴 Ausente",     value: "0 soldados", inline: true },
        { name: "\u200b",          value: "\u200b", inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "Kingdom Guardian Pro • Gestión de Eventos  •  +10 pts por asistencia" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("evt_attend:PLACEHOLDER")
        .setLabel("🟢 Asistiré")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("evt_absent:PLACEHOLDER")
        .setLabel("🔴 Ausente")
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.deferReply({ ephemeral: true });

    const pingContent = mention ?? "@here";
    const msg = await (interaction.channel as TextChannel).send({
      content: pingContent,
      embeds: [embed],
      components: [row],
      allowedMentions: { parse: mention ? ["roles"] : ["everyone"] },
    });

    eventAttendees.set(msg.id, { attend: [], absent: [] });

    await msg.edit({
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`evt_attend:${msg.id}`)
            .setLabel("🟢 Asistiré")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`evt_absent:${msg.id}`)
            .setLabel("🔴 Ausente")
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    });

    // Auto-schedule 30-min reminder
    try {
      const reminderTime = parseEventDate(date);
      if (reminderTime && reminderTime.getTime() - Date.now() > 35 * 60_000 && interaction.channelId) {
        const fireAt = new Date(reminderTime.getTime() - 30 * 60_000);
        await ScheduledTimer.create({
          guildId: interaction.guild!.id,
          channelId: interaction.channelId as string,
          message: `⏰ **Recordatorio:** El evento **${name}** comienza en **30 minutos**! (${date})`,
          fireAt,
          fired: false,
          createdBy: interaction.user.id,
        });
      }
    } catch {}

    await interaction.editReply({
      content: "✅ Evento publicado. Si la hora es válida el bot enviará un recordatorio 30 min antes automáticamente.",
    });
  }
}

/** Try to parse a date string like "Sábado 21:00 UTC" or "2025-06-15 21:00 UTC" */
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

    const oldEmbed = interaction.message.embeds[0];
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
