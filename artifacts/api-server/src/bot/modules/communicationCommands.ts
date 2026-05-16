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
} from "discord.js";
import { UserProfile, GuildConfig } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const communicationCommandDefs = [
  new SlashCommandBuilder()
    .setName("announcement")
    .setDescription("Publicar comunicados oficiales")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName("official").setDescription("Publicar anuncio oficial del Alto Mando"),
    ),
  new SlashCommandBuilder()
    .setName("event")
    .setDescription("Gestión de eventos de alianza")
    .addSubcommand((s) =>
      s.setName("announcement").setDescription("Publicar convocatoria de evento"),
    ),
].map((b) => b.toJSON());

// Track active announcement message IDs → Set of users who confirmed
const announcementReaders = new Map<string, Set<string>>();

// Track active event attendees → { attend: string[], absent: string[] }
const eventAttendees = new Map<string, { attend: string[]; absent: string[] }>();

export async function handleAnnouncementCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub !== "official") return;

  const modal = new ModalBuilder()
    .setCustomId("modal_announcement")
    .setTitle("📢 Anuncio Oficial — Alto Mando");

  const titleInput = new TextInputBuilder()
    .setCustomId("ann_title")
    .setLabel("Título del Anuncio")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ej: Directriz Semanal de Guerra")
    .setRequired(true)
    .setMaxLength(80);

  const msgInput = new TextInputBuilder()
    .setCustomId("ann_message")
    .setLabel("Mensaje")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Escribe el comunicado completo aquí...")
    .setRequired(true)
    .setMaxLength(1500);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(msgInput),
  );

  await interaction.showModal(modal);
}

export async function handleEventCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub !== "announcement") return;

  const modal = new ModalBuilder()
    .setCustomId("modal_event")
    .setTitle("⚔️ Convocatoria de Evento");

  const nameInput = new TextInputBuilder()
    .setCustomId("evt_name")
    .setLabel("Nombre del Evento")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ej: Asalto al Castillo del Rey")
    .setRequired(true)
    .setMaxLength(80);

  const dateInput = new TextInputBuilder()
    .setCustomId("evt_date")
    .setLabel("Fecha y Hora (UTC)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ej: Sábado 21:00 UTC")
    .setRequired(true)
    .setMaxLength(50);

  const descInput = new TextInputBuilder()
    .setCustomId("evt_desc")
    .setLabel("Descripción")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Detalles del evento, objetivos, requisitos...")
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
  );

  await interaction.showModal(modal);
}

export async function handleCommunicationModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  if (!interaction.guild) return;

  if (interaction.customId === "modal_announcement") {
    const title = interaction.fields.getTextInputValue("ann_title");
    const message = interaction.fields.getTextInputValue("ann_message");

    const embed = new EmbedBuilder()
      .setTitle(`📢 ${title}`)
      .setDescription(message)
      .setColor(0x2b2d31)
      .addFields(
        { name: "Emitido por", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Lecturas confirmadas", value: "0", inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "Kingdom Guardian Pro — Alto Mando" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ann_read:PLACEHOLDER")
        .setLabel("✅ Confirmar Lectura")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.deferReply({ ephemeral: true });
    const msg = await (interaction.channel as TextChannel).send({
      content: "@here",
      embeds: [embed],
      components: [row],
    });

    announcementReaders.set(msg.id, new Set());

    const realRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ann_read:${msg.id}`)
        .setLabel("✅ Confirmar Lectura")
        .setStyle(ButtonStyle.Secondary),
    );
    await msg.edit({ components: [realRow] });
    await interaction.editReply({ content: "✅ Anuncio publicado." });

  } else if (interaction.customId === "modal_event") {
    const name = interaction.fields.getTextInputValue("evt_name");
    const date = interaction.fields.getTextInputValue("evt_date");
    const desc = interaction.fields.getTextInputValue("evt_desc");

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ CONVOCATORIA DE EVENTO: ${name}`)
      .setColor(0x5865f2)
      .addFields(
        { name: "📅 Fecha y Hora", value: date, inline: true },
        { name: "Organizado por", value: `<@${interaction.user.id}>`, inline: true },
        { name: "📋 Descripción", value: desc, inline: false },
        { name: "🟢 Asistiré", value: "0 soldados", inline: true },
        { name: "🔴 Ausente", value: "0 soldados", inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "Kingdom Guardian Pro — Gestión de Eventos • +10 pts por asistencia" });

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
    const msg = await (interaction.channel as TextChannel).send({
      content: "@here",
      embeds: [embed],
      components: [row],
    });

    eventAttendees.set(msg.id, { attend: [], absent: [] });

    const realRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`evt_attend:${msg.id}`)
        .setLabel("🟢 Asistiré")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`evt_absent:${msg.id}`)
        .setLabel("🔴 Ausente")
        .setStyle(ButtonStyle.Danger),
    );
    await msg.edit({ components: [realRow] });
    await interaction.editReply({ content: "✅ Evento publicado." });
  }
}

export async function handleCommunicationButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const [action, messageId] = interaction.customId.split(":");
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  if (action === "ann_read") {
    const readers = announcementReaders.get(messageId);
    if (!readers) {
      await interaction.reply({ content: "Este anuncio ya no está activo.", ephemeral: true });
      return;
    }
    if (readers.has(userId)) {
      await interaction.reply({ content: "Ya confirmaste la lectura de este anuncio.", ephemeral: true });
      return;
    }
    readers.add(userId);

    const oldEmbed = interaction.message.embeds[0];
    const updated = EmbedBuilder.from(oldEmbed).spliceFields(
      oldEmbed.fields.findIndex((f) => f.name === "Lecturas confirmadas"),
      1,
      { name: "Lecturas confirmadas", value: String(readers.size), inline: true },
    );
    await interaction.update({ embeds: [updated] });

  } else if (action === "evt_attend" || action === "evt_absent") {
    const data = eventAttendees.get(messageId);
    if (!data) {
      await interaction.reply({ content: "Este evento ya no está activo.", ephemeral: true });
      return;
    }

    // Remove from both lists first
    data.attend = data.attend.filter((id) => id !== userId);
    data.absent = data.absent.filter((id) => id !== userId);

    const isAttend = action === "evt_attend";
    if (isAttend) {
      data.attend.push(userId);
      // Award +10 weekly points
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
    const updated = EmbedBuilder.from(oldEmbed)
      .spliceFields(
        oldEmbed.fields.findIndex((f) => f.name === "🟢 Asistiré"),
        1,
        { name: "🟢 Asistiré", value: `${data.attend.length} soldados`, inline: true },
      )
      .spliceFields(
        EmbedBuilder.from(oldEmbed).spliceFields(
          oldEmbed.fields.findIndex((f) => f.name === "🟢 Asistiré"),
          1,
          { name: "🟢 Asistiré", value: `${data.attend.length} soldados`, inline: true },
        ).data.fields!.findIndex((f) => f.name === "🔴 Ausente"),
        1,
        { name: "🔴 Ausente", value: `${data.absent.length} soldados`, inline: true },
      );

    await interaction.update({ embeds: [updated] });

    if (isAttend) {
      await interaction.followUp({
        content: "✅ Registrado como **Asistente** — +10 puntos semanales acreditados.",
        ephemeral: true,
      });
    }
  }
}
