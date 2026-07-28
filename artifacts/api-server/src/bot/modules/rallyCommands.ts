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

export const rallyCommandDefs = [
  new SlashCommandBuilder()
    .setName("rally")
    .setDescription("Coordinación de rallies de alianza")
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Crear convocatoria de rally")
        .addStringOption((o) =>
          o.setName("objetivo").setDescription("Objetivo del rally (ej: Castillo enemigo [X:Y])").setRequired(true),
        )
        .addUserOption((o) =>
          o.setName("lider").setDescription("Líder del rally (quién abre la marcha)").setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("marchas")
            .setDescription("Número de marchas necesarias")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10),
        )
        .addStringOption((o) =>
          o.setName("hora_utc").setDescription("Hora de lanzamiento en UTC (ej: 21:00 UTC)").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("tipo_tropa")
            .setDescription("Tipo de tropa preferida")
            .setRequired(false)
            .addChoices(
              { name: "⚔️ Infantería", value: "Infantería" },
              { name: "🏹 Arqueros", value: "Arqueros" },
              { name: "🐴 Caballería", value: "Caballería" },
              { name: "🧙 Magia", value: "Magia" },
              { name: "🔀 Mixto", value: "Mixto" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("close")
        .setDescription("Cerrar rally y desplegar (R4/R5)")
        .addStringOption((o) =>
          o.setName("mensaje_id").setDescription("ID del mensaje del rally").setRequired(true),
        ),
    ),
].map((b) => b.toJSON());

// Track rally sign-ups: messageId → { leaderId, slots, participants }
const activeRallies = new Map<
  string,
  { leaderId: string; slotsNeeded: number; participants: string[] }
>();

function buildRallyEmbed(opts: {
  objetivo: string;
  leaderId: string;
  slotsNeeded: number;
  hora: string;
  tipoTropa: string | null;
  participants: string[];
  commanderId: string;
  closed?: boolean;
}): EmbedBuilder {
  const filled = opts.participants.length;
  const fillBar =
    "█".repeat(Math.min(filled, opts.slotsNeeded)) +
    "░".repeat(Math.max(0, opts.slotsNeeded - filled));

  const embed = new EmbedBuilder()
    .setTitle(`🚩 RALLY DE ALIANZA — ${opts.objetivo}`)
    .setColor(opts.closed ? 0x888888 : filled >= opts.slotsNeeded ? 0x00cc55 : 0xff8800)
    .addFields(
      { name: "🎯 Objetivo", value: opts.objetivo, inline: true },
      { name: "👑 Líder del Rally", value: `<@${opts.leaderId}>`, inline: true },
      { name: "🕐 Hora de Lanzamiento", value: opts.hora, inline: true },
      { name: "⚔️ Tipo de Tropa", value: opts.tipoTropa ?? "Sin preferencia", inline: true },
      {
        name: `📊 Marchas [${filled}/${opts.slotsNeeded}]`,
        value: `\`${fillBar}\``,
        inline: false,
      },
    )
    .setTimestamp()
    .setFooter({
      text: opts.closed
        ? "Rally cerrado — ¡A la batalla!"
        : "Kingdom Guardian Pro — Rally Coordinator • +10 pts por unirse",
    });

  if (opts.participants.length > 0) {
    embed.addFields({
      name: "🛡️ Marchando",
      value: opts.participants.map((id) => `<@${id}>`).join(", ").slice(0, 1024),
      inline: false,
    });
  }

  return embed;
}

export async function handleRallyCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  try {
    if (sub === "create") {
      const objetivo = interaction.options.getString("objetivo", true);
      const lider = interaction.options.getUser("lider", true);
      const marchas = interaction.options.getInteger("marchas", true);
      const hora = interaction.options.getString("hora_utc", true);
      const tipoTropa = interaction.options.getString("tipo_tropa");

      const embed = buildRallyEmbed({
        objetivo,
        leaderId: lider.id,
        slotsNeeded: marchas,
        hora,
        tipoTropa,
        participants: [],
        commanderId: interaction.user.id,
      });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("rally_join:PLACEHOLDER")
          .setLabel("🚩 Unirse al Rally")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("rally_leave:PLACEHOLDER")
          .setLabel("❌ Retirarme")
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.deferReply({ ephemeral: true });
      const msg = await (interaction.channel as TextChannel).send({
        content: "@here",
        embeds: [embed],
        components: [row],
      });

      activeRallies.set(msg.id, {
        leaderId: lider.id,
        slotsNeeded: marchas,
        participants: [],
      });

      const realRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`rally_join:${msg.id}`)
          .setLabel("🚩 Unirse al Rally")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`rally_leave:${msg.id}`)
          .setLabel("❌ Retirarme")
          .setStyle(ButtonStyle.Secondary),
      );
      await msg.edit({ components: [realRow] });
      await interaction.editReply({
        content: `✅ Rally publicado. ID del mensaje: \`${msg.id}\` (úsalo con \`/rally close\` para cerrar).`,
      });

    } else if (sub === "close") {
      const msgId = interaction.options.getString("mensaje_id", true);
      const data = activeRallies.get(msgId);
      if (!data) {
        await interaction.reply({ content: "❌ No se encontró un rally activo con ese ID.", ephemeral: true });
        return;
      }

      // Disable buttons
      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`rally_join:${msgId}`)
          .setLabel("🚩 Rally Cerrado")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`rally_leave:${msgId}`)
          .setLabel("❌ Retirarme")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );

      try {
        const msg = await (interaction.channel as TextChannel).messages.fetch(msgId);
        const oldEmbed = msg.embeds[0];
        if (oldEmbed) {
          const updatedEmbed = EmbedBuilder.from(oldEmbed)
            .setColor(0x888888)
            .setFooter({ text: "Rally DESPLEGADO — ¡A la batalla!" });
          await msg.edit({ embeds: [updatedEmbed], components: [disabledRow] });
        }
      } catch {}

      activeRallies.delete(msgId);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🚀 Rally Desplegado")
            .setColor(0x00cc55)
            .setDescription(`El rally \`${msgId}\` fue cerrado y las marchas desplegadas.`)
            .addFields({
              name: "Participantes",
              value: String(data.participants.length),
              inline: true,
            })
            .setTimestamp(),
        ],
        ephemeral: true,
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Rally command error");
    await interaction.reply({ content: "❌ Error en el comando.", ephemeral: true }).catch(() => {});
  }
}

export async function handleRallyButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [action, messageId] = interaction.customId.split(":");
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  const data = activeRallies.get(messageId);
  if (!data) {
    await interaction.reply({ content: "Este rally ya no está activo.", ephemeral: true });
    return;
  }

  if (action === "rally_join") {
    if (data.participants.includes(userId)) {
      await interaction.reply({ content: "Ya estás registrado en este rally.", ephemeral: true });
      return;
    }
    data.participants.push(userId);

    // Award +10 pts
    await UserProfile.findOneAndUpdate(
      { discordId: userId, guildId },
      { $inc: { weeklyPoints: 10, totalPoints: 10 } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).catch(() => {});

    const oldEmbed = interaction.message.embeds[0];
    const fillBar =
      "█".repeat(Math.min(data.participants.length, data.slotsNeeded)) +
      "░".repeat(Math.max(0, data.slotsNeeded - data.participants.length));

    const updated = EmbedBuilder.from(oldEmbed)
      .setColor(data.participants.length >= data.slotsNeeded ? 0x00cc55 : 0xff8800)
      .spliceFields(
        oldEmbed.fields.findIndex((f) => f.name.startsWith("📊 Marchas")),
        1,
        {
          name: `📊 Marchas [${data.participants.length}/${data.slotsNeeded}]`,
          value: `\`${fillBar}\``,
          inline: false,
        },
      )
      .spliceFields(
        Math.max(0, oldEmbed.fields.findIndex((f) => f.name === "🛡️ Marchando")),
        oldEmbed.fields.findIndex((f) => f.name === "🛡️ Marchando") >= 0 ? 1 : 0,
        {
          name: "🛡️ Marchando",
          value: data.participants.map((id) => `<@${id}>`).join(", ").slice(0, 1024),
          inline: false,
        },
      );

    await interaction.update({ embeds: [updated] });
    await interaction.followUp({
      content: `✅ Registrado en el rally. +10 puntos semanales acreditados. ¡${
        data.participants.length >= data.slotsNeeded ? "¡El rally está COMPLETO! 🚀" : `${data.slotsNeeded - data.participants.length} marchas restantes.`
      }`,
      ephemeral: true,
    });

  } else if (action === "rally_leave") {
    if (!data.participants.includes(userId)) {
      await interaction.reply({ content: "No estás registrado en este rally.", ephemeral: true });
      return;
    }
    data.participants = data.participants.filter((id) => id !== userId);

    const oldEmbed = interaction.message.embeds[0];
    const fillBar =
      "█".repeat(Math.min(data.participants.length, data.slotsNeeded)) +
      "░".repeat(Math.max(0, data.slotsNeeded - data.participants.length));

    const participantValue =
      data.participants.length > 0
        ? data.participants.map((id) => `<@${id}>`).join(", ").slice(0, 1024)
        : "Ninguno aún";

    const updated = EmbedBuilder.from(oldEmbed)
      .setColor(0xff8800)
      .spliceFields(
        oldEmbed.fields.findIndex((f) => f.name.startsWith("📊 Marchas")),
        1,
        {
          name: `📊 Marchas [${data.participants.length}/${data.slotsNeeded}]`,
          value: `\`${fillBar}\``,
          inline: false,
        },
      )
      .spliceFields(
        Math.max(0, oldEmbed.fields.findIndex((f) => f.name === "🛡️ Marchando")),
        oldEmbed.fields.findIndex((f) => f.name === "🛡️ Marchando") >= 0 ? 1 : 0,
        { name: "🛡️ Marchando", value: participantValue, inline: false },
      );

    await interaction.update({ embeds: [updated] });
    await interaction.followUp({ content: "Has sido removido del rally.", ephemeral: true });
  }
}
