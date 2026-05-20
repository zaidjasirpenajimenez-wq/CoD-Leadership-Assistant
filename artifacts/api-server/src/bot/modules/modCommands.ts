import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { UserProfile, GuildConfig } from "../../db/schemas";
import { checkAndApplyAutoTimeout } from "./sentinel";
import { logger } from "../../lib/logger";

export const modCommandDefs = [
  new SlashCommandBuilder()
    .setName("mod")
    .setDescription("Comandos de moderación")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s.setName("ban").setDescription("Expulsar permanentemente a un miembro")
        .addUserOption((o) => o.setName("miembro").setDescription("Miembro a banear").setRequired(true))
        .addStringOption((o) => o.setName("razon").setDescription("Razón").setRequired(false)),
    )
    .addSubcommand((s) =>
      s.setName("kick").setDescription("Expulsar temporalmente a un miembro")
        .addUserOption((o) => o.setName("miembro").setDescription("Miembro").setRequired(true))
        .addStringOption((o) => o.setName("razon").setDescription("Razón").setRequired(false)),
    )
    .addSubcommand((s) =>
      s.setName("mute").setDescription("Silenciar a un miembro")
        .addUserOption((o) => o.setName("miembro").setDescription("Miembro").setRequired(true))
        .addIntegerOption((o) => o.setName("minutos").setDescription("Minutos de silencio").setRequired(true))
        .addStringOption((o) => o.setName("razon").setDescription("Razón").setRequired(false)),
    )
    .addSubcommand((s) =>
      s.setName("warn").setDescription("Registrar advertencia")
        .addUserOption((o) => o.setName("miembro").setDescription("Miembro").setRequired(true))
        .addStringOption((o) => o.setName("razon").setDescription("Razón").setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName("clear").setDescription("Limpiar mensajes del canal")
        .addIntegerOption((o) => o.setName("cantidad").setDescription("Cantidad (1-100)").setRequired(true))
        .addUserOption((o) => o.setName("usuario").setDescription("Filtrar por usuario").setRequired(false)),
    ),
].map((b) => b.toJSON());

const ACTION_META: Record<string, { emoji: string; label: string; color: number; verb: string }> = {
  ban:  { emoji: "🔨", label: "BANEO PERMANENTE",  color: 0xed4245, verb: "baneado" },
  kick: { emoji: "👢", label: "EXPULSIÓN",          color: 0xff7b00, verb: "expulsado" },
  mute: { emoji: "🔇", label: "SILENCIO TEMPORAL",  color: 0xfee75c, verb: "silenciado" },
  warn: { emoji: "⚠️", label: "ADVERTENCIA",        color: 0xf0a500, verb: "advertido" },
};

function warnBar(count: number): string {
  const filled = "🟥".repeat(Math.min(count, 3));
  const empty  = "⬜".repeat(Math.max(0, 3 - count));
  return `${filled}${empty}  \`${count}/3\``;
}

export async function handleModCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const config  = await GuildConfig.findOne({ guildId });

  const modName   = interaction.guild.members.cache.get(interaction.user.id)?.displayName ?? interaction.user.username;
  const modAvatar = interaction.user.displayAvatarURL();

  async function logMod(embed: EmbedBuilder): Promise<void> {
    if (!config?.channels?.modLogs) return;
    const chan = interaction.guild!.channels.cache.get(config.channels.modLogs!) as TextChannel | undefined;
    if (chan) await chan.send({ embeds: [embed] });
  }

  try {
    if (sub === "ban") {
      const target = interaction.options.getMember("miembro") as GuildMember;
      const reason = interaction.options.getString("razon") ?? "Sin razón especificada";
      await target.ban({ reason });

      const meta  = ACTION_META.ban;
      const embed = new EmbedBuilder()
        .setAuthor({ name: `Acción de ${modName}`, iconURL: modAvatar })
        .setTitle(`${meta.emoji}  ${meta.label}`)
        .setColor(meta.color)
        .setThumbnail(target.user.displayAvatarURL())
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `**${target.user.username}** ha sido **${meta.verb}** del servidor.\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        )
        .addFields(
          { name: "👤 Usuario",     value: `<@${target.id}> \`${target.user.tag}\``, inline: true },
          { name: "🛡️ Moderador",  value: `<@${interaction.user.id}>`,              inline: true },
          { name: "⏰ Fecha",       value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
          { name: "📋 Razón",       value: reason,                                   inline: false },
        )
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro  •  Registro de Moderación" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      await logMod(embed);

    } else if (sub === "kick") {
      const target = interaction.options.getMember("miembro") as GuildMember;
      const reason = interaction.options.getString("razon") ?? "Sin razón especificada";
      await target.kick(reason);

      const meta  = ACTION_META.kick;
      const embed = new EmbedBuilder()
        .setAuthor({ name: `Acción de ${modName}`, iconURL: modAvatar })
        .setTitle(`${meta.emoji}  ${meta.label}`)
        .setColor(meta.color)
        .setThumbnail(target.user.displayAvatarURL())
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `**${target.user.username}** ha sido **${meta.verb}** del servidor.\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        )
        .addFields(
          { name: "👤 Usuario",    value: `<@${target.id}> \`${target.user.tag}\``, inline: true },
          { name: "🛡️ Moderador", value: `<@${interaction.user.id}>`,              inline: true },
          { name: "⏰ Fecha",      value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
          { name: "📋 Razón",      value: reason,                                   inline: false },
        )
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro  •  Registro de Moderación" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      await logMod(embed);

    } else if (sub === "mute") {
      const target  = interaction.options.getMember("miembro") as GuildMember;
      const minutes = interaction.options.getInteger("minutos", true);
      const reason  = interaction.options.getString("razon") ?? "Sin razón especificada";
      await target.timeout(minutes * 60 * 1000, reason);
      const until = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);

      const meta  = ACTION_META.mute;
      const embed = new EmbedBuilder()
        .setAuthor({ name: `Acción de ${modName}`, iconURL: modAvatar })
        .setTitle(`${meta.emoji}  ${meta.label}`)
        .setColor(meta.color)
        .setThumbnail(target.user.displayAvatarURL())
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `**${target.user.username}** ha sido **${meta.verb}** temporalmente.\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        )
        .addFields(
          { name: "👤 Usuario",      value: `<@${target.id}> \`${target.user.tag}\``, inline: true },
          { name: "🛡️ Moderador",   value: `<@${interaction.user.id}>`,              inline: true },
          { name: "⏱️ Duración",    value: `**${minutes} min**`,                      inline: true },
          { name: "🔓 Fin del mute", value: `<t:${until}:R>`,                         inline: true },
          { name: "📋 Razón",        value: reason,                                   inline: false },
        )
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro  •  Registro de Moderación" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      await logMod(embed);

    } else if (sub === "warn") {
      const target  = interaction.options.getMember("miembro") as GuildMember;
      const reason  = interaction.options.getString("razon", true);
      const profile = await UserProfile.findOneAndUpdate(
        { discordId: target.id, guildId },
        { $inc: { warns: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      const warns = profile?.warns ?? 1;

      const meta  = ACTION_META.warn;
      const embed = new EmbedBuilder()
        .setAuthor({ name: `Acción de ${modName}`, iconURL: modAvatar })
        .setTitle(`${meta.emoji}  ${meta.label} #${warns}`)
        .setColor(warns >= 3 ? 0xed4245 : meta.color)
        .setThumbnail(target.user.displayAvatarURL())
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `**${target.user.username}** ha recibido una advertencia.\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        )
        .addFields(
          { name: "👤 Usuario",       value: `<@${target.id}> \`${target.user.tag}\``, inline: true },
          { name: "🛡️ Moderador",    value: `<@${interaction.user.id}>`,              inline: true },
          { name: "⏰ Fecha",         value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
          { name: "🟥 Advertencias", value: warnBar(warns),                            inline: true },
          { name: "\u200b",           value: "\u200b",                                 inline: true },
          { name: "\u200b",           value: "\u200b",                                 inline: true },
          { name: "📋 Razón",         value: reason,                                   inline: false },
          ...(warns >= 3 ? [{ name: "🚨 AUTO-ACCIÓN", value: "Se ha aplicado **timeout automático** por acumular 3 advertencias.", inline: false }] : []),
        )
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro  •  Registro de Moderación" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      await logMod(embed);
      await checkAndApplyAutoTimeout(target, guildId);

    } else if (sub === "clear") {
      const amount     = Math.min(100, Math.max(1, interaction.options.getInteger("cantidad", true)));
      const filterUser = interaction.options.getUser("usuario");
      const chan       = interaction.channel as TextChannel;
      let messages     = await chan.messages.fetch({ limit: amount + 1 });
      if (filterUser) messages = messages.filter((m) => m.author.id === filterUser.id);
      await chan.bulkDelete(messages, true);

      const embed = new EmbedBuilder()
        .setAuthor({ name: `Limpieza por ${modName}`, iconURL: modAvatar })
        .setTitle("🗑️  MENSAJES ELIMINADOS")
        .setColor(0x99aab5)
        .addFields(
          { name: "📝 Eliminados",   value: `**${messages.size}** mensajes`, inline: true },
          { name: "📌 Canal",        value: `<#${chan.id}>`,                  inline: true },
          { name: "🔍 Filtro",       value: filterUser ? `<@${filterUser.id}>` : "Todos", inline: true },
        )
        .setTimestamp()
        .setFooter({ text: "Kingdom Guardian Pro  •  Registro de Moderación" });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (err) {
    logger.error({ err, sub }, "Mod command error");
    await interaction.reply({ content: "❌ Error al ejecutar el comando.", ephemeral: true }).catch(() => {});
  }
}
