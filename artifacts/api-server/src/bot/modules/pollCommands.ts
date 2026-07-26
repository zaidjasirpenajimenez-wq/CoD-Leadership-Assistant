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
import { AlliancePoll, GuildConfig } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const pollCommandDefs = [
  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Votaciones rápidas de alianza")
    .addSubcommand((s) =>
      s
        .setName("crear")
        .setDescription("Crear una votación (R4/R5)")
        .addStringOption((o: import("discord.js").SlashCommandStringOption) =>
          o.setName("pregunta").setDescription("Pregunta de la votación").setRequired(true).setMaxLength(200),
        )
        .addStringOption((o: import("discord.js").SlashCommandStringOption) => o.setName("opcion1").setDescription("Opción 1").setRequired(true).setMaxLength(80))
        .addStringOption((o: import("discord.js").SlashCommandStringOption) => o.setName("opcion2").setDescription("Opción 2").setRequired(true).setMaxLength(80))
        .addIntegerOption((o: import("discord.js").SlashCommandIntegerOption) =>
          o
            .setName("horas")
            .setDescription("Duración en horas (1-72, por defecto 24)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(72),
        )
        .addStringOption((o: import("discord.js").SlashCommandStringOption) => o.setName("opcion3").setDescription("Opción 3 (opcional)").setRequired(false).setMaxLength(80))
        .addStringOption((o: import("discord.js").SlashCommandStringOption) => o.setName("opcion4").setDescription("Opción 4 (opcional)").setRequired(false).setMaxLength(80))
        .addStringOption((o: import("discord.js").SlashCommandStringOption) => o.setName("opcion5").setDescription("Opción 5 (opcional)").setRequired(false).setMaxLength(80)),
    )
    .addSubcommand((s) =>
      s
        .setName("cerrar")
        .setDescription("Cerrar una votación anticipadamente (R4/R5)")
        .addStringOption((o: import("discord.js").SlashCommandStringOption) =>
          o.setName("id").setDescription("ID de la votación (6 caracteres)").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName("activas").setDescription("Ver votaciones activas"),
    ),
].map((b) => b.toJSON());

const OPTION_EMOJIS  = ["🅐", "🅑", "🅒", "🅓", "🅔"];
const OPTION_COLORS  = [0x5865f2, 0x57f287, 0xff7b00, 0xed4245, 0xffd700];

function buildPollEmbed(opts: {
  question: string;
  options:  string[];
  votes:    Map<string, number> | Record<string, number>;
  endsAt:   Date;
  closed:   boolean;
  createdBy: string;
  shortId:  string;
}): EmbedBuilder {
  const voteMap: Record<string, number> =
    opts.votes instanceof Map
      ? Object.fromEntries(opts.votes)
      : opts.votes;

  // Count votes per option
  const counts: number[] = opts.options.map((_, i) =>
    Object.values(voteMap).filter((v) => v === i).length,
  );
  const totalVotes = counts.reduce((a, b) => a + b, 0);
  const maxVotes   = Math.max(...counts, 1);

  const ts = Math.floor(opts.endsAt.getTime() / 1000);

  const fields = opts.options.map((opt, i) => {
    const pct  = totalVotes > 0 ? Math.round((counts[i] / totalVotes) * 100) : 0;
    const bar  = "█".repeat(Math.round((counts[i] / maxVotes) * 10)) + "░".repeat(10 - Math.round((counts[i] / maxVotes) * 10));
    const win  = opts.closed && counts[i] === maxVotes && counts[i] > 0 ? " 👑" : "";
    return {
      name:  `${OPTION_EMOJIS[i]} ${opt}${win}`,
      value: `\`${bar}\` **${counts[i]}** voto${counts[i] !== 1 ? "s" : ""} (${pct}%)`,
      inline: false,
    };
  });

  const winnerIdx = opts.closed ? counts.indexOf(Math.max(...counts)) : -1;
  const winner    = opts.closed && totalVotes > 0
    ? `\n\n🏆 **Ganador: ${opts.options[winnerIdx]}** con ${counts[winnerIdx]} voto${counts[winnerIdx] !== 1 ? "s" : ""}`
    : "";

  return new EmbedBuilder()
    .setTitle(`📊 ${opts.question}`)
    .setColor(opts.closed ? 0x808080 : OPTION_COLORS[0])
    .setDescription(
      (opts.closed ? "🔒 **Votación cerrada**" : `⏳ Cierra <t:${ts}:R>`) +
      `\n👥 **${totalVotes}** voto${totalVotes !== 1 ? "s" : ""} registrado${totalVotes !== 1 ? "s" : ""}` +
      winner,
    )
    .addFields(fields)
    .setFooter({ text: `ID: ${opts.shortId} · Organizado por <@${opts.createdBy}> · Kingdom Guardian Pro` })
    .setTimestamp();
}

function buildVoteButtons(pollMongoId: string, options: string[], disabled = false): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = options.map((opt, i) =>
    new ButtonBuilder()
      .setCustomId(`poll_vote:${pollMongoId}:${i}`)
      .setLabel(`${OPTION_EMOJIS[i]} ${opt.slice(0, 40)}`)
      .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(disabled),
  );

  // Discord allows max 5 buttons per row
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

export async function handlePollCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  try {
    if (sub === "crear") {
      const question = interaction.options.getString("pregunta", true);
      const horas    = interaction.options.getInteger("horas") ?? 24;
      const options  = [
        interaction.options.getString("opcion1", true),
        interaction.options.getString("opcion2", true),
        interaction.options.getString("opcion3"),
        interaction.options.getString("opcion4"),
        interaction.options.getString("opcion5"),
      ].filter((o): o is string => !!o);

      await interaction.deferReply({ ephemeral: true });

      const endsAt    = new Date(Date.now() + horas * 3_600_000);
      const config    = await GuildConfig.findOne({ guildId }).lean();
      const channelId = config?.channels?.announcements ?? interaction.channelId;
      const chan       = interaction.guild.channels.cache.get(channelId) as TextChannel | undefined;

      if (!chan) {
        await interaction.editReply({ content: "❌ No se encontró el canal de anuncios." });
        return;
      }

      const poll = await AlliancePoll.create({
        guildId,
        question,
        options,
        votes: {},
        messageId: "pending",
        channelId,
        endsAt,
        createdBy: interaction.user.id,
        closed: false,
      });

      const shortId = poll._id.toString().slice(-6).toUpperCase();
      const embed   = buildPollEmbed({
        question, options, votes: {}, endsAt,
        closed: false, createdBy: interaction.user.id, shortId,
      });

      const msg = await chan.send({
        content: "@here 📊 **¡Nueva votación de alianza!**",
        embeds: [embed],
        components: buildVoteButtons(poll._id.toString(), options),
        allowedMentions: { parse: ["everyone"] },
      });

      poll.messageId = msg.id;
      await poll.save();

      await interaction.editReply({
        content: `✅ Votación creada en <#${channelId}>. ID: \`${shortId}\` · Cierra en **${horas}h**.`,
      });
      return;
    }

    if (sub === "cerrar") {
      const shortId = interaction.options.getString("id", true).toUpperCase();
      const poll    = await AlliancePoll.findOne({ guildId, closed: false })
        .where("_id").regex(new RegExp(shortId + "$", "i"))
        .exec();

      if (!poll) {
        await interaction.reply({ content: `❌ No se encontró votación activa con ID \`${shortId}\`.`, ephemeral: true });
        return;
      }

      poll.closed = true;
      await poll.save();
      await closeAndUpdatePollMessage(interaction.guild, poll);

      await interaction.reply({ content: `✅ Votación \`${shortId}\` cerrada.`, ephemeral: true });
      return;
    }

    if (sub === "activas") {
      await interaction.deferReply({ ephemeral: true });
      const polls = await AlliancePoll.find({ guildId, closed: false }).sort({ createdAt: -1 }).lean();

      if (polls.length === 0) {
        await interaction.editReply({ content: "📭 No hay votaciones activas ahora mismo." });
        return;
      }

      const lines = polls.map((p, i) => {
        const shortId  = p._id.toString().slice(-6).toUpperCase();
        const ts       = `<t:${Math.floor(new Date(p.endsAt).getTime() / 1000)}:R>`;
        const totalVotes = Object.keys(p.votes instanceof Map ? Object.fromEntries(p.votes) : p.votes ?? {}).length;
        return `**${i + 1}.** \`${shortId}\` **${p.question.slice(0, 60)}** · ${totalVotes} votos · Cierra ${ts}`;
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("📊 Votaciones Activas")
            .setColor(0x5865f2)
            .setDescription(lines.join("\n"))
            .setFooter({ text: "Kingdom Guardian Pro — Polls" })
            .setTimestamp(),
        ],
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Poll command error");
    await interaction.reply({ content: "❌ Error al procesar el comando.", ephemeral: true }).catch(() => {});
  }
}

export async function handlePollButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const parts    = interaction.customId.split(":");
  const pollId   = parts[1];
  const optIdx   = parseInt(parts[2], 10);
  const userId   = interaction.user.id;
  const guildId  = interaction.guild.id;

  try {
    const poll = await AlliancePoll.findById(pollId);
    if (!poll || poll.closed || poll.guildId !== guildId) {
      await interaction.reply({ content: "Esta votación ya no está activa.", ephemeral: true });
      return;
    }

    const rawVotes = poll.votes instanceof Map ? poll.votes : new Map(Object.entries(poll.votes ?? {}));
    const votes = rawVotes as Map<string, number>;

    const prevVote = votes.get(userId);
    if (prevVote === optIdx) {
      await interaction.reply({ content: "Ya votaste por esta opción. Elige otra para cambiar tu voto.", ephemeral: true });
      return;
    }

    votes.set(userId, optIdx);
    poll.votes = votes;
    poll.markModified("votes");
    await poll.save();

    const shortId = poll._id.toString().slice(-6).toUpperCase();
    const embed   = buildPollEmbed({
      question:  poll.question,
      options:   poll.options,
      votes:     votes,
      endsAt:    poll.endsAt,
      closed:    false,
      createdBy: poll.createdBy,
      shortId,
    });

    const changedMsg = prevVote !== undefined
      ? `🔄 Voto cambiado a **${OPTION_EMOJIS[optIdx]} ${poll.options[optIdx]}**.`
      : `✅ Voto registrado: **${OPTION_EMOJIS[optIdx]} ${poll.options[optIdx]}**. Puedes cambiarlo hasta que cierre.`;

    await interaction.update({ embeds: [embed], components: buildVoteButtons(pollId, poll.options) });
    await interaction.followUp({ content: changedMsg, ephemeral: true });
  } catch (err) {
    logger.error({ err }, "Poll button error");
    await interaction.reply({ content: "❌ Error al registrar tu voto.", ephemeral: true }).catch(() => {});
  }
}

async function closeAndUpdatePollMessage(guild: import("discord.js").Guild, poll: import("mongoose").Document & { options: string[]; votes: Map<string, number>; messageId: string; channelId: string; endsAt: Date; createdBy: string; question: string }): Promise<void> {
  try {
    const chan = guild.channels.cache.get(poll.channelId) as TextChannel | undefined;
    const msg  = await chan?.messages.fetch(poll.messageId);
    if (!msg) return;

    const shortId = (poll._id as import("mongoose").Types.ObjectId).toString().slice(-6).toUpperCase();
    const embed   = buildPollEmbed({
      question:  poll.question,
      options:   poll.options,
      votes:     poll.votes,
      endsAt:    poll.endsAt,
      closed:    true,
      createdBy: poll.createdBy,
      shortId,
    });

    await msg.edit({ embeds: [embed], components: buildVoteButtons((poll._id as import("mongoose").Types.ObjectId).toString(), poll.options, true) });
  } catch (err) {
    logger.error({ err }, "Failed to update closed poll message");
  }
}

/** Run every minute — auto-closes expired polls */
export function startPollScheduler(client: Client): void {
  setInterval(async () => {
    try {
      const expired = await AlliancePoll.find({ closed: false, endsAt: { $lte: new Date() } }).lean();
      for (const p of expired) {
        await AlliancePoll.findByIdAndUpdate(p._id, { closed: true });
        const guild = client.guilds.cache.get(p.guildId);
        if (guild) {
          const pollDoc = await AlliancePoll.findById(p._id);
          if (pollDoc) await closeAndUpdatePollMessage(guild, pollDoc as Parameters<typeof closeAndUpdatePollMessage>[1]);
        }
      }
    } catch (err) {
      logger.error({ err }, "Poll scheduler error");
    }
  }, 60_000);

  logger.info("Poll scheduler started");
}
