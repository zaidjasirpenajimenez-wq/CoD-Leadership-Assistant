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
import { GuildConfig } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const sosCommandDefs = [
  new SlashCommandBuilder()
    .setName("sos")
    .setDescription("🚨 Alerta de emergencia — Castillo bajo ataque")
    .addStringOption((o) =>
      o
        .setName("mensaje")
        .setDescription("Descripción del ataque / ubicación")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("coordenadas").setDescription("Coordenadas X:Y del ataque").setRequired(false),
    ),
].map((b) => b.toJSON());

// Track SOS responses: messageId → userId[]
const sosResponders = new Map<string, string[]>();

export async function handleSosCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  const mensaje = interaction.options.getString("mensaje", true);
  const coords = interaction.options.getString("coordenadas");
  const guildId = interaction.guild.id;

  const config = await GuildConfig.findOne({ guildId });
  const targetChannelId = config?.channels?.warAlerts ?? interaction.channelId;
  const targetChan = (
    interaction.guild.channels.cache.get(targetChannelId) ?? interaction.channel
  ) as TextChannel;

  const embed = new EmbedBuilder()
    .setTitle("🚨 SOS — ¡CASTILLO BAJO ATAQUE!")
    .setColor(0xff0000)
    .setDescription(`@everyone\n\n**${mensaje}**`)
    .addFields(
      { name: "📍 Coordenadas", value: coords ?? "No especificadas", inline: true },
      { name: "🆘 Reportado por", value: `<@${interaction.user.id}>`, inline: true },
      { name: "✅ En camino", value: "0 soldados", inline: true },
    )
    .setTimestamp()
    .setFooter({ text: "Kingdom Guardian Pro — EMERGENCIA MILITAR" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("sos_go:PLACEHOLDER")
      .setLabel("🚀 ¡EN CAMINO!")
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.deferReply({ ephemeral: true });

  try {
    const msg = await targetChan.send({
      content: "@everyone",
      embeds: [embed],
      components: [row],
    });

    sosResponders.set(msg.id, []);

    const realRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`sos_go:${msg.id}`)
        .setLabel("🚀 ¡EN CAMINO!")
        .setStyle(ButtonStyle.Danger),
    );
    await msg.edit({ components: [realRow] });
    await interaction.editReply({ content: `🚨 SOS publicado en ${targetChan}.` });
  } catch (err) {
    logger.error({ err }, "SOS command failed");
    await interaction.editReply({ content: "❌ Error al publicar el SOS." });
  }
}

export async function handleSosButton(interaction: ButtonInteraction): Promise<void> {
  const [, messageId] = interaction.customId.split(":");
  const userId = interaction.user.id;

  const responders = sosResponders.get(messageId);
  if (!responders) {
    await interaction.reply({ content: "Esta alerta SOS ya no está activa.", ephemeral: true });
    return;
  }

  if (!responders.includes(userId)) {
    responders.push(userId);
  }

  const oldEmbed = interaction.message.embeds[0];
  const updated = EmbedBuilder.from(oldEmbed).spliceFields(
    oldEmbed.fields.findIndex((f) => f.name === "✅ En camino"),
    1,
    { name: "✅ En camino", value: `${responders.length} soldados`, inline: true },
  );

  await interaction.update({ embeds: [updated] });
  await interaction.followUp({
    content: "✅ Registrado. ¡La alianza cuenta contigo!",
    ephemeral: true,
  });
}
