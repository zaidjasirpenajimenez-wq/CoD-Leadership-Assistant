import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { GuildConfig, UserProfile } from "../../db/schemas";
import { processImageOcr, parseResourcesFromText } from "../ocr";
import { logger } from "../../lib/logger";

export const resourceCommandDefs = [
  new SlashCommandBuilder()
    .setName("request")
    .setDescription("Solicitar recursos del banco de suministros")
    .addSubcommand((s) =>
      s
        .setName("resources")
        .setDescription("Publicar solicitud de recursos en logística")
        .addStringOption((o) =>
          o
            .setName("recurso")
            .setDescription("Tipo de recurso necesario")
            .setRequired(true)
            .addChoices(
              { name: "🪵 Madera", value: "Madera" },
              { name: "🪨 Piedra", value: "Piedra" },
              { name: "💰 Oro", value: "Oro" },
              { name: "✨ Maná", value: "Maná" },
            ),
        )
        .addIntegerOption((o) =>
          o
            .setName("cantidad")
            .setDescription("Cantidad requerida")
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("hospital")
        .setDescription("Escanear hospital con OCR para solicitar recursos exactos")
        .addAttachmentOption((o) =>
          o
            .setName("captura")
            .setDescription("Captura de pantalla del hospital")
            .setRequired(true),
        ),
    ),
].map((b) => b.toJSON());

// Track simple resource requests: messageId → { requesterId, donorId? }
const simpleRequests = new Map<string, { requesterId: string; donorId?: string }>();

// Track OCR requests: messageId → { requesterId, farmerId? }
const ocrRequests = new Map<string, { requesterId: string; farmerId?: string }>();

const RESOURCE_EMOJI: Record<string, string> = {
  Madera: "🪵",
  Piedra: "🪨",
  Oro: "💰",
  Maná: "✨",
};

function fmtNum(n: number | null): string {
  if (n === null) return "No detectado";
  return n.toLocaleString("es-ES");
}

export async function handleResourceCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const config = await GuildConfig.findOne({ guildId });
  const targetChannelId = config?.channels?.resourceRequests ?? interaction.channelId;
  const targetChan = (
    interaction.guild.channels.cache.get(targetChannelId) ?? interaction.channel
  ) as TextChannel;

  if (sub === "resources") {
    const recurso = interaction.options.getString("recurso", true);
    const cantidad = interaction.options.getInteger("cantidad", true);
    const emoji = RESOURCE_EMOJI[recurso] ?? "📦";

    const embed = new EmbedBuilder()
      .setTitle("📦 SOLICITUD DE RECURSOS — BANCO DE SUMINISTROS")
      .setColor(0x22bb77)
      .addFields(
        { name: `${emoji} Recurso`, value: recurso, inline: true },
        { name: "📊 Cantidad", value: cantidad.toLocaleString("es-ES"), inline: true },
        { name: "Solicitante", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Estado", value: "🟡 Pendiente de ayuda", inline: false },
      )
      .setTimestamp()
      .setFooter({ text: "Kingdom Guardian Pro — Banco de Suministros • +5 pts por ayudar" });

    if (recurso === "Maná") {
      embed.addFields({
        name: "⚠️ Nota sobre el Maná",
        value: "El **Maná** no se puede transferir por suministros directamente, debes conseguirlo en tu ciudad.",
        inline: false,
      });
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("sres_help:PLACEHOLDER")
        .setLabel("🤝 Enviar Ayuda")
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.deferReply({ ephemeral: true });
    const msg = await targetChan.send({ embeds: [embed], components: [row] });

    simpleRequests.set(msg.id, { requesterId: interaction.user.id });

    const realRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`sres_help:${msg.id}`)
        .setLabel("🤝 Enviar Ayuda")
        .setStyle(ButtonStyle.Primary),
    );
    await msg.edit({ components: [realRow] });
    await interaction.editReply({ content: `✅ Solicitud de **${recurso}** publicada en ${targetChan}.` });

  } else if (sub === "hospital") {
    await interaction.deferReply({ ephemeral: true });
    const attachment = interaction.options.getAttachment("captura", true);

    try {
      const text = await processImageOcr(attachment.url);
      const resources = parseResourcesFromText(text);

      const embed = new EmbedBuilder()
        .setTitle("🏥 SOLICITUD DE RECURSOS — ESCANEO DE HOSPITAL")
        .setColor(0x22bb77)
        .setThumbnail(attachment.url)
        .addFields(
          { name: "🪵 Madera (Wood)", value: fmtNum(resources.wood), inline: true },
          { name: "💰 Oro (Gold)", value: fmtNum(resources.gold), inline: true },
          { name: "⛏️ Mineral (Ore)", value: fmtNum(resources.ore), inline: true },
          { name: "Solicitante", value: `<@${interaction.user.id}>`, inline: false },
          { name: "Estado", value: "🟡 Pendiente de asignación", inline: false },
        )
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro — Banco de Suministros" });

      if (resources.hasMana) {
        embed.addFields({
          name: "⚠️ Advertencia — Maná",
          value:
            "El **Maná** no se puede transferir por suministros, debes conseguirlo en tu ciudad.",
          inline: false,
        });
      }

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("res_accept:PLACEHOLDER")
          .setLabel("📦 Aceptar Envío")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("res_confirm:PLACEHOLDER")
          .setLabel("✅ Confirmar Recepción")
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
      );

      const msg = await targetChan.send({ embeds: [embed], components: [row] });
      ocrRequests.set(msg.id, { requesterId: interaction.user.id });

      const realRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`res_accept:${msg.id}`)
          .setLabel("📦 Aceptar Envío")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`res_confirm:${msg.id}`)
          .setLabel("✅ Confirmar Recepción")
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
      );
      await msg.edit({ components: [realRow] });
      await interaction.editReply({ content: `✅ Solicitud publicada en ${targetChan}` });
    } catch (err) {
      logger.error({ err }, "Hospital OCR failed");
      await interaction.editReply({
        content: "❌ Error al procesar la imagen. Intenta con una captura más clara.",
      });
    }
  }
}

export async function handleResourceButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const [action, messageId] = interaction.customId.split(":");
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  // ── Simple resource request buttons ─────────────────────────────────────
  if (action === "sres_help") {
    const data = simpleRequests.get(messageId);
    if (!data) {
      await interaction.reply({
        content: "Esta solicitud ya fue completada o no existe.",
        ephemeral: true,
      });
      return;
    }
    if (data.donorId) {
      await interaction.reply({
        content: "⚠️ Esta solicitud ya fue aceptada por otro jugador.",
        ephemeral: true,
      });
      return;
    }
    if (data.requesterId === userId) {
      await interaction.reply({
        content: "❌ No puedes ayudarte a ti mismo.",
        ephemeral: true,
      });
      return;
    }

    data.donorId = userId;

    // Award +5 pts to the donor
    try {
      await UserProfile.findOneAndUpdate(
        { discordId: userId, guildId },
        { $inc: { weeklyPoints: 5, totalPoints: 5 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    } catch (err) {
      logger.error({ err }, "Failed to award resource donation points");
    }

    const oldEmbed = interaction.message.embeds[0];
    const updated = EmbedBuilder.from(oldEmbed)
      .spliceFields(
        oldEmbed.fields.findIndex((f) => f.name === "Estado"),
        1,
        {
          name: "Estado",
          value: `✅ COMPLETADO — Ayudado por <@${userId}>`,
          inline: false,
        },
      )
      .setColor(0x00cc55);

    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`sres_help:${messageId}`)
        .setLabel("✅ Completado")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    await interaction.update({ embeds: [updated], components: [disabledRow] });
    await interaction.followUp({
      content: "✅ ¡Registrado! +5 puntos semanales acreditados por tu ayuda.",
      ephemeral: true,
    });
    simpleRequests.delete(messageId);
    return;
  }

  // ── OCR hospital request buttons ─────────────────────────────────────────
  const data = ocrRequests.get(messageId);

  if (action === "res_accept") {
    if (!data) {
      await interaction.reply({ content: "Esta solicitud ya no existe.", ephemeral: true });
      return;
    }
    if (data.farmerId) {
      await interaction.reply({
        content: "⚠️ Esta solicitud ya fue aceptada por otro granjero.",
        ephemeral: true,
      });
      return;
    }
    data.farmerId = userId;

    const oldEmbed = interaction.message.embeds[0];
    const updated = EmbedBuilder.from(oldEmbed).spliceFields(
      oldEmbed.fields.findIndex((f) => f.name === "Estado"),
      1,
      { name: "Estado", value: `🟢 Asignado a <@${userId}>`, inline: false },
    );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`res_accept:${messageId}`)
        .setLabel("📦 Aceptar Envío")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`res_confirm:${messageId}`)
        .setLabel("✅ Confirmar Recepción")
        .setStyle(ButtonStyle.Success)
        .setDisabled(false),
    );
    await interaction.update({ embeds: [updated], components: [row] });

  } else if (action === "res_confirm") {
    if (!data) {
      await interaction.reply({ content: "Esta solicitud ya fue cerrada.", ephemeral: true });
      return;
    }
    if (userId !== data.requesterId) {
      await interaction.reply({
        content: "❌ Solo el solicitante original puede confirmar la recepción.",
        ephemeral: true,
      });
      return;
    }

    const oldEmbed = interaction.message.embeds[0];
    const updated = EmbedBuilder.from(oldEmbed)
      .spliceFields(
        oldEmbed.fields.findIndex((f) => f.name === "Estado"),
        1,
        { name: "Estado", value: "✅ Completado — Recursos recibidos", inline: false },
      )
      .setColor(0x00cc55);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`res_accept:${messageId}`)
        .setLabel("📦 Aceptar Envío")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`res_confirm:${messageId}`)
        .setLabel("✅ Confirmado")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );
    await interaction.update({ embeds: [updated], components: [row] });
    ocrRequests.delete(messageId);
  }
}
