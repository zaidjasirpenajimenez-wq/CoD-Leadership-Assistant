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
import { recordIntel } from "../intel";
import { logger } from "../../lib/logger";

export const warCommandDefs = [
  new SlashCommandBuilder()
    .setName("war")
    .setDescription("Comandos de guerra táctica")
    .addSubcommand((s) =>
      s.setName("alert")
        .setDescription("Publicar alerta de guerra")
        .addStringOption((o) =>
          o.setName("prioridad").setDescription("Nivel de prioridad de la alerta").setRequired(true)
            .addChoices(
              { name: "🔴 Critical", value: "Critical" },
              { name: "🟠 High",     value: "High" },
              { name: "🟡 Medium",   value: "Medium" },
              { name: "🟢 Low",      value: "Low" },
            ),
        )
        .addStringOption((o) => o.setName("detalles").setDescription("Detalles de la alerta").setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName("attack")
        .setDescription("Publicar orden de ataque")
        .addStringOption((o) => o.setName("objetivo").setDescription("Objetivo del ataque").setRequired(true))
        .addStringOption((o) => o.setName("coordenadas").setDescription("Coordenadas X:Y").setRequired(true))
        .addStringOption((o) => o.setName("tropa").setDescription("Tipo de tropa requerida").setRequired(true))
        .addStringOption((o) => o.setName("hora_utc").setDescription("Hora en UTC (ej: 20:00 UTC)").setRequired(true))
        .addStringOption((o) =>
          o.setName("prioridad").setDescription("Nivel de prioridad").setRequired(true)
            .addChoices(
              { name: "🔴 Critical", value: "Critical" },
              { name: "🟠 High",     value: "High" },
              { name: "🟡 Medium",   value: "Medium" },
              { name: "🟢 Low",      value: "Low" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s.setName("defense")
        .setDescription("Publicar orden de defensa")
        .addStringOption((o) => o.setName("estructura").setDescription("Estructura a defender").setRequired(true))
        .addStringOption((o) => o.setName("coordenadas").setDescription("Coordenadas X:Y").setRequired(true))
        .addStringOption((o) => o.setName("capitan").setDescription("Capitán de guarnición").setRequired(true))
        .addStringOption((o) =>
          o.setName("prioridad").setDescription("Nivel de prioridad").setRequired(true)
            .addChoices(
              { name: "🔴 Critical", value: "Critical" },
              { name: "🟠 High",     value: "High" },
              { name: "🟡 Medium",   value: "Medium" },
              { name: "🟢 Low",      value: "Low" },
            ),
        ),
    ),
].map((b) => b.toJSON());

// Track alert responses: messageId → { ready, late, no }
const alertResponses = new Map<string, { ready: string[]; late: string[]; no: string[] }>();

function buildAlertButtons(messageId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`alert_ready:${messageId}`)
      .setLabel("✅ En camino")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`alert_no:${messageId}`)
      .setLabel("❌ No disponible")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`alert_late:${messageId}`)
      .setLabel("⏳ Llego tarde")
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildAlertEmbed(
  priority: string,
  details: string,
  reporter: string,
  counts: { ready: number; late: number; no: number },
): EmbedBuilder {
  const priorityColors: Record<string, number> = {
    Critical: 0xff0000,
    High:     0xff8800,
    Medium:   0xffcc00,
    Low:      0x00cc44,
  };
  const priorityEmoji: Record<string, string> = {
    Critical: "🔴",
    High:     "🟠",
    Medium:   "🟡",
    Low:      "🟢",
  };
  const color = priorityColors[priority] ?? 0xff4400;
  const pEmoji = priorityEmoji[priority] ?? "⚡";

  return new EmbedBuilder()
    .setTitle(`🚨 ALERTA DE GUERRA — ${pEmoji} ${priority.toUpperCase()}`)
    .setColor(color)
    .setDescription(`@here\n\n**${details}**`)
    .addFields(
      { name: "✅ En camino", value: String(counts.ready), inline: true },
      { name: "⏳ Llego tarde", value: String(counts.late), inline: true },
      { name: "❌ No disponible", value: String(counts.no), inline: true },
    )
    .addFields({ name: "Reportado por", value: `<@${reporter}>`, inline: false })
    .setTimestamp()
    .setFooter({ text: "Kingdom Guardian Pro — Sistema Táctico" });
}

export async function handleWarCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const config = await GuildConfig.findOne({ guildId });

  try {
    if (sub === "alert") {
      const priority = interaction.options.getString("prioridad", true);
      const details = interaction.options.getString("detalles", true);

      const channelId = config?.channels?.warAlerts ?? interaction.channelId;
      const chan = interaction.guild.channels.cache.get(channelId) as TextChannel | undefined;
      const targetChan = chan ?? (interaction.channel as TextChannel);

      const counts = { ready: 0, late: 0, no: 0 };
      const embed = buildAlertEmbed(priority, details, interaction.user.id, counts);
      const placeholder = "PLACEHOLDER";
      const row = buildAlertButtons(placeholder);

      const msg = await targetChan.send({ embeds: [embed], components: [row] });

      // Store response tracking keyed by actual message ID
      alertResponses.set(msg.id, { ready: [], late: [], no: [] });

      // Update button custom IDs to use real message ID
      const realRow = buildAlertButtons(msg.id);
      await msg.edit({ components: [realRow] });

      await interaction.reply({ content: `✅ Alerta publicada en ${targetChan}`, ephemeral: true });

      // Record covert intel
      await recordIntel({
        sourceGuildId: guildId,
        allianceTag: config?.allianceTag ?? "UNKNOWN",
        actionType: "ALERT",
        coords: "N/A",
        details: `[ALERT] Priority: ${priority} — ${details}`,
        reportedBy: interaction.user.id,
      });

    } else if (sub === "attack") {
      const objetivo = interaction.options.getString("objetivo", true);
      const coords = interaction.options.getString("coordenadas", true);
      const tropa = interaction.options.getString("tropa", true);
      const hora = interaction.options.getString("hora_utc", true);
      const priority = interaction.options.getString("prioridad", true);

      const channelId = config?.channels?.attackOrders ?? interaction.channelId;
      const chan = (interaction.guild.channels.cache.get(channelId) ?? interaction.channel) as TextChannel;

      const atkColors: Record<string, number> = { Critical: 0xff0000, High: 0xff8800, Medium: 0xffcc00, Low: 0x00cc44 };
      const atkEmoji:  Record<string, string>  = { Critical: "🔴", High: "🟠", Medium: "🟡", Low: "🟢" };

      const embed = new EmbedBuilder()
        .setTitle(`⚔️ ORDEN DE ATAQUE — ${atkEmoji[priority] ?? "⚡"} ${priority.toUpperCase()}`)
        .setColor(atkColors[priority] ?? 0xcc0000)
        .addFields(
          { name: "🎯 Objetivo", value: objetivo, inline: true },
          { name: "📍 Coordenadas", value: coords, inline: true },
          { name: "⚔️ Tropa Requerida", value: tropa, inline: true },
          { name: "🕐 Hora de Ataque (UTC)", value: hora, inline: true },
          { name: "Comandante", value: `<@${interaction.user.id}>`, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro — Comando Táctico" });

      await chan.send({ embeds: [embed] });
      await interaction.reply({ content: `⚔️ Orden de ataque publicada en ${chan}`, ephemeral: true });

      await recordIntel({
        sourceGuildId: guildId,
        allianceTag: config?.allianceTag ?? "UNKNOWN",
        actionType: "ATTACK",
        coords,
        details: `Objetivo: ${objetivo} | Tropa: ${tropa} | Hora: ${hora}`,
        reportedBy: interaction.user.id,
      });

    } else if (sub === "defense") {
      const estructura = interaction.options.getString("estructura", true);
      const coords = interaction.options.getString("coordenadas", true);
      const capitan = interaction.options.getString("capitan", true);
      const priority = interaction.options.getString("prioridad", true);

      const channelId = config?.channels?.defenseOrders ?? interaction.channelId;
      const chan = (interaction.guild.channels.cache.get(channelId) ?? interaction.channel) as TextChannel;

      const defColors: Record<string, number> = { Critical: 0xff0000, High: 0xff8800, Medium: 0xffcc00, Low: 0x00cc44 };
      const defEmoji:  Record<string, string>  = { Critical: "🔴", High: "🟠", Medium: "🟡", Low: "🟢" };

      const embed = new EmbedBuilder()
        .setTitle(`🛡️ ORDEN DE DEFENSA — ${defEmoji[priority] ?? "⚡"} ${priority.toUpperCase()}`)
        .setColor(defColors[priority] ?? 0x0055cc)
        .addFields(
          { name: "🏰 Estructura", value: estructura, inline: true },
          { name: "📍 Coordenadas", value: coords, inline: true },
          { name: "👑 Capitán", value: capitan, inline: true },
          { name: `${defEmoji[priority] ?? "⚡"} Prioridad`, value: priority, inline: true },
          { name: "Comandante", value: `<@${interaction.user.id}>`, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro — Comando Táctico" });

      await chan.send({ embeds: [embed] });
      await interaction.reply({ content: `🛡️ Orden de defensa publicada en ${chan}`, ephemeral: true });

      await recordIntel({
        sourceGuildId: guildId,
        allianceTag: config?.allianceTag ?? "UNKNOWN",
        actionType: "DEFENSE",
        coords,
        details: `Estructura: ${estructura} | Capitán: ${capitan} | Prioridad: ${priority}`,
        reportedBy: interaction.user.id,
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "War command error");
    await interaction.reply({ content: "❌ Error al ejecutar el comando.", ephemeral: true }).catch(() => {});
  }
}

export async function handleAlertButton(interaction: ButtonInteraction): Promise<void> {
  const [action, messageId] = interaction.customId.split(":");
  const data = alertResponses.get(messageId);
  if (!data) {
    await interaction.reply({ content: "Esta alerta ya no está activa.", ephemeral: true });
    return;
  }

  const userId = interaction.user.id;

  // Remove user from all categories first
  data.ready = data.ready.filter((id) => id !== userId);
  data.late = data.late.filter((id) => id !== userId);
  data.no = data.no.filter((id) => id !== userId);

  if (action === "alert_ready") data.ready.push(userId);
  else if (action === "alert_late") data.late.push(userId);
  else if (action === "alert_no") data.no.push(userId);

  // Update the embed in place
  const oldEmbed = interaction.message.embeds[0];
  if (!oldEmbed) return;

  const updated = EmbedBuilder.from(oldEmbed).setFields(
    { name: "✅ En camino", value: String(data.ready.length), inline: true },
    { name: "⏳ Llego tarde", value: String(data.late.length), inline: true },
    { name: "❌ No disponible", value: String(data.no.length), inline: true },
    { name: "Reportado por", value: oldEmbed.fields.find((f) => f.name === "Reportado por")?.value ?? "—", inline: false },
  );

  await interaction.update({ embeds: [updated] });
}
