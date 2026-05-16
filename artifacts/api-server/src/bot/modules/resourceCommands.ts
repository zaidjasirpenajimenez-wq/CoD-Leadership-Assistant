import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { GuildConfig } from "../../db/schemas";
import { processImageOcr, parseResourcesFromText } from "../ocr";
import { logger } from "../../lib/logger";

export const resourceCommandDefs = [
  new SlashCommandBuilder()
    .setName("request")
    .setDescription("Solicitar recursos del banco de suministros")
    .addSubcommand((s) =>
      s.setName("resources")
        .setDescription("Subir captura del hospital para solicitar recursos")
        .addAttachmentOption((o) =>
          o.setName("captura").setDescription("Captura de pantalla del hospital").setRequired(true),
        ),
    ),
].map((b) => b.toJSON());

// Track active resource requests: messageId → requesterId
const activeRequests = new Map<string, { requesterId: string; farmerId?: string }>();

function fmtNum(n: number | null): string {
  if (n === null) return "No detectado";
  return n.toLocaleString("es-ES");
}

export async function handleResourceCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  if (sub !== "resources") return;

  await interaction.deferReply({ ephemeral: true });

  const attachment = interaction.options.getAttachment("captura", true);
  const guildId = interaction.guild.id;
  const config = await GuildConfig.findOne({ guildId });
  const targetChannelId = config?.channels?.resourceRequests ?? interaction.channelId;
  const targetChan = (interaction.guild.channels.cache.get(targetChannelId) ?? interaction.channel) as TextChannel;

  try {
    // Run OCR on the uploaded image
    const text = await processImageOcr(attachment.url);
    const resources = parseResourcesFromText(text);

    const embed = new EmbedBuilder()
      .setTitle("📦 SOLICITUD DE RECURSOS — BANCO DE SUMINISTROS")
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
        value: "El **Maná** no se puede transferir por suministros, debes conseguirlo en tu ciudad.",
        inline: false,
      });
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`res_accept:PLACEHOLDER`)
        .setLabel("📦 Aceptar Envío")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`res_confirm:PLACEHOLDER`)
        .setLabel("✅ Confirmar Recepción")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    const msg = await targetChan.send({ embeds: [embed], components: [row] });

    // Register request with real message ID
    activeRequests.set(msg.id, { requesterId: interaction.user.id });

    // Update buttons with real IDs
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
    logger.error({ err }, "Resource command OCR failed");
    await interaction.editReply({ content: "❌ Error al procesar la imagen. Intenta con una captura más clara." });
  }
}

export async function handleResourceButton(interaction: ButtonInteraction): Promise<void> {
  const [action, messageId] = interaction.customId.split(":");
  const data = activeRequests.get(messageId);

  if (!data) {
    await interaction.reply({ content: "Esta solicitud ya fue cerrada o no existe.", ephemeral: true });
    return;
  }

  if (action === "res_accept") {
    if (data.farmerId) {
      await interaction.reply({ content: "⚠️ Esta solicitud ya fue aceptada por otro granjero.", ephemeral: true });
      return;
    }
    data.farmerId = interaction.user.id;

    // Update embed
    const oldEmbed = interaction.message.embeds[0];
    const updated = EmbedBuilder.from(oldEmbed).spliceFields(
      oldEmbed.fields.findIndex((f) => f.name === "Estado"),
      1,
      { name: "Estado", value: `🟢 Asignado a <@${interaction.user.id}>`, inline: false },
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
    if (interaction.user.id !== data.requesterId) {
      await interaction.reply({ content: "❌ Solo el solicitante original puede confirmar la recepción.", ephemeral: true });
      return;
    }

    const oldEmbed = interaction.message.embeds[0];
    const updated = EmbedBuilder.from(oldEmbed).spliceFields(
      oldEmbed.fields.findIndex((f) => f.name === "Estado"),
      1,
      { name: "Estado", value: "✅ Completado — Recursos recibidos", inline: false },
    ).setColor(0x00cc55);

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
    activeRequests.delete(messageId);
  }
}
