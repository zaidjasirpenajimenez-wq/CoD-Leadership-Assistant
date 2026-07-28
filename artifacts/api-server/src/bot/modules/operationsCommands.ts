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
import { UserProfile } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const operationsCommandDefs = [
  new SlashCommandBuilder()
    .setName("raid")
    .setDescription("Coordinar raids de campo de batalla")
    .addSubcommand((s) =>
      s
        .setName("begimo")
        .setDescription("Convocar raid de Bégimo")
        .addStringOption((o) =>
          o
            .setName("tipo")
            .setDescription("Tipo de Bégimo")
            .setRequired(true)
            .addChoices(
              { name: "🐻 Oso", value: "Oso" },
              { name: "👹 Gigante", value: "Gigante" },
              { name: "🐉 Dragón", value: "Dragón" },
              { name: "🦁 León", value: "León" },
              { name: "🕷️ Araña Gigante", value: "Araña Gigante" },
              { name: "🦅 Grifo", value: "Grifo" },
            ),
        )
        .addStringOption((o) =>
          o.setName("canal_voz").setDescription("Canal de voz para coordinación (nombre)").setRequired(false),
        ),
    ),
  new SlashCommandBuilder()
    .setName("building")
    .setDescription("Coordinar construcción táctica en el reino")
    .addStringOption((o) =>
      o.setName("coordenadas").setDescription("Coordenadas X:Y del objetivo").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("objetivo")
        .setDescription("Tipo de construcción")
        .setRequired(true)
        .addChoices(
          { name: "🚩 Bandera de Alianza", value: "Bandera de Alianza" },
          { name: "🏰 Fortaleza", value: "Fortaleza" },
          { name: "⛺ Campamento Avanzado", value: "Campamento Avanzado" },
          { name: "🗼 Torre de Vigilancia", value: "Torre de Vigilancia" },
          { name: "🏗️ Otro", value: "Otro" },
        ),
    ),
].map((b) => b.toJSON());

// Track raid participants: messageId → { tanks: string[], dps: string[] }
const raidParticipants = new Map<string, { tanks: string[]; dps: string[] }>();
// Track building helpers: messageId → Set<userId>
const buildingHelpers = new Map<string, Set<string>>();

function buildRaidEmbed(
  tipo: string,
  canalVoz: string | null,
  commander: string,
  counts: { tanks: number; dps: number },
): EmbedBuilder {
  const bossEmojis: Record<string, string> = {
    Oso: "🐻", Gigante: "👹", Dragón: "🐉", León: "🦁", "Araña Gigante": "🕷️", Grifo: "🦅",
  };
  const emoji = bossEmojis[tipo] ?? "⚔️";

  return new EmbedBuilder()
    .setTitle(`${emoji} RAID DE BÉGIMO — ${tipo.toUpperCase()}`)
    .setColor(0xaa2200)
    .addFields(
      { name: "🎯 Objetivo", value: tipo, inline: true },
      { name: "🎙️ Canal de Voz", value: canalVoz ?? "Sin canal asignado", inline: true },
      { name: "Comandante", value: `<@${commander}>`, inline: true },
      { name: "🛡️ Tanques", value: String(counts.tanks), inline: true },
      { name: "⚔️ DPS", value: String(counts.dps), inline: true },
      { name: "Total", value: String(counts.tanks + counts.dps), inline: true },
    )
    .setTimestamp()
    .setFooter({ text: "Kingdom Guardian Pro — Operaciones • +10 pts por participar" });
}

export async function handleOperationsCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;

  const commandName = interaction.commandName;

  if (commandName === "raid") {
    const tipo = interaction.options.getString("tipo", true);
    const canalVoz = interaction.options.getString("canal_voz");

    const embed = buildRaidEmbed(tipo, canalVoz, interaction.user.id, { tanks: 0, dps: 0 });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("raid_tank:PLACEHOLDER")
        .setLabel("🛡️ Tanque")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("raid_dps:PLACEHOLDER")
        .setLabel("⚔️ DPS")
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.deferReply({ ephemeral: true });
    if (!interaction.channel?.isSendable()) {
      await interaction.editReply({ content: "❌ No se puede enviar mensajes en este canal." });
      return;
    }
    const msg = await interaction.channel.send({
      content: "@here",
      embeds: [embed],
      components: [row],
    });

    raidParticipants.set(msg.id, { tanks: [], dps: [] });

    const realRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`raid_tank:${msg.id}`)
        .setLabel("🛡️ Tanque")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`raid_dps:${msg.id}`)
        .setLabel("⚔️ DPS")
        .setStyle(ButtonStyle.Danger),
    );
    await msg.edit({ components: [realRow] });
    await interaction.editReply({ content: `✅ Raid de **${tipo}** convocado.` });

  } else if (commandName === "building") {
    const coords = interaction.options.getString("coordenadas", true);
    const objetivo = interaction.options.getString("objetivo", true);

    const embed = new EmbedBuilder()
      .setTitle("🏗️ ORDEN DE CONSTRUCCIÓN TÁCTICA")
      .setColor(0x44aa44)
      .addFields(
        { name: "🏗️ Objetivo", value: objetivo, inline: true },
        { name: "📍 Coordenadas", value: coords, inline: true },
        { name: "Comandante", value: `<@${interaction.user.id}>`, inline: true },
        { name: "🧱 Constructores enviados", value: "0", inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "Kingdom Guardian Pro — Logística • +5 pts por enviar constructores" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("build_send:PLACEHOLDER")
        .setLabel("🧱 Enviar Constructores")
        .setStyle(ButtonStyle.Success),
    );

    await interaction.deferReply({ ephemeral: true });
    if (!interaction.channel?.isSendable()) {
      await interaction.editReply({ content: "❌ No se puede enviar mensajes en este canal." });
      return;
    }
    const msg = await interaction.channel.send({
      embeds: [embed],
      components: [row],
    });

    buildingHelpers.set(msg.id, new Set());

    const realRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`build_send:${msg.id}`)
        .setLabel("🧱 Enviar Constructores")
        .setStyle(ButtonStyle.Success),
    );
    await msg.edit({ components: [realRow] });
    await interaction.editReply({ content: `✅ Orden de construcción publicada en **${coords}**.` });
  }
}

export async function handleOperationsButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const [action, messageId] = interaction.customId.split(":");
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  if (action === "raid_tank" || action === "raid_dps") {
    const data = raidParticipants.get(messageId);
    if (!data) {
      await interaction.reply({ content: "Esta convocatoria ya no está activa.", ephemeral: true });
      return;
    }

    // Remove from both to allow role switching
    data.tanks = data.tanks.filter((id) => id !== userId);
    data.dps = data.dps.filter((id) => id !== userId);

    const isTank = action === "raid_tank";
    if (isTank) data.tanks.push(userId);
    else data.dps.push(userId);

    // Award +10 pts (only first time — if was already in data, no duplicate)
    try {
      await UserProfile.findOneAndUpdate(
        { discordId: userId, guildId },
        { $inc: { weeklyPoints: 10, totalPoints: 10 } },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      );
    } catch (err) {
      logger.error({ err }, "Failed to award raid points");
    }

    const oldEmbed = interaction.message.embeds[0];
    const updated = EmbedBuilder.from(oldEmbed)
      .spliceFields(
        oldEmbed.fields.findIndex((f) => f.name === "🛡️ Tanques"),
        1,
        { name: "🛡️ Tanques", value: String(data.tanks.length), inline: true },
      )
      .spliceFields(
        EmbedBuilder.from(oldEmbed)
          .spliceFields(
            oldEmbed.fields.findIndex((f) => f.name === "🛡️ Tanques"),
            1,
            { name: "🛡️ Tanques", value: String(data.tanks.length), inline: true },
          )
          .data.fields!.findIndex((f) => f.name === "⚔️ DPS"),
        1,
        { name: "⚔️ DPS", value: String(data.dps.length), inline: true },
      )
      .spliceFields(
        EmbedBuilder.from(oldEmbed)
          .data.fields!.findIndex((f) => f.name === "Total"),
        1,
        { name: "Total", value: String(data.tanks.length + data.dps.length), inline: true },
      );

    await interaction.update({ embeds: [updated] });
    await interaction.followUp({
      content: `✅ Registrado como **${isTank ? "🛡️ Tanque" : "⚔️ DPS"}** — +10 puntos semanales acreditados.`,
      ephemeral: true,
    });

  } else if (action === "build_send") {
    const helpers = buildingHelpers.get(messageId);
    if (!helpers) {
      await interaction.reply({ content: "Esta orden ya no está activa.", ephemeral: true });
      return;
    }

    if (helpers.has(userId)) {
      await interaction.reply({ content: "Ya registraste el envío de tus constructores.", ephemeral: true });
      return;
    }

    helpers.add(userId);

    // Award +5 pts
    try {
      await UserProfile.findOneAndUpdate(
        { discordId: userId, guildId },
        { $inc: { weeklyPoints: 5, totalPoints: 5 } },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      );
    } catch (err) {
      logger.error({ err }, "Failed to award building points");
    }

    const oldEmbed = interaction.message.embeds[0];
    const idx = oldEmbed.fields.findIndex((f) => f.name === "🧱 Constructores enviados");
    const updated = EmbedBuilder.from(oldEmbed).spliceFields(idx, 1, {
      name: "🧱 Constructores enviados",
      value: String(helpers.size),
      inline: true,
    });

    await interaction.update({ embeds: [updated] });
    await interaction.followUp({
      content: "✅ ¡Constructores enviados! +5 puntos semanales acreditados.",
      ephemeral: true,
    });
  }
}
