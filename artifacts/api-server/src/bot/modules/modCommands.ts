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

export async function handleModCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const config = await GuildConfig.findOne({ guildId });

  async function logMod(description: string, color: number): Promise<void> {
    if (config?.channels?.modLogs) {
      const chan = interaction.guild!.channels.cache.get(config.channels.modLogs!) as TextChannel | undefined;
      if (chan) {
        await chan.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("📋 Registro de Moderación")
              .setDescription(description)
              .setColor(color)
              .addFields({ name: "Moderador", value: interaction.user.tag, inline: true })
              .setTimestamp(),
          ],
        });
      }
    }
  }

  try {
    if (sub === "ban") {
      const target = interaction.options.getMember("miembro") as GuildMember;
      const reason = interaction.options.getString("razon") ?? "Sin razón especificada";
      await target.ban({ reason });
      await interaction.reply({ content: `✅ **${target.user.tag}** fue baneado. Razón: ${reason}`, ephemeral: true });
      await logMod(`🔨 **Ban** a ${target.user.tag} — ${reason}`, 0xff0000);

    } else if (sub === "kick") {
      const target = interaction.options.getMember("miembro") as GuildMember;
      const reason = interaction.options.getString("razon") ?? "Sin razón especificada";
      await target.kick(reason);
      await interaction.reply({ content: `✅ **${target.user.tag}** fue expulsado.`, ephemeral: true });
      await logMod(`👢 **Kick** a ${target.user.tag} — ${reason}`, 0xff8800);

    } else if (sub === "mute") {
      const target = interaction.options.getMember("miembro") as GuildMember;
      const minutes = interaction.options.getInteger("minutos", true);
      const reason = interaction.options.getString("razon") ?? "Sin razón especificada";
      await target.timeout(minutes * 60 * 1000, reason);
      await interaction.reply({ content: `✅ **${target.user.tag}** silenciado por ${minutes} min.`, ephemeral: true });
      await logMod(`⏱️ **Mute** (${minutes}min) a ${target.user.tag} — ${reason}`, 0xffaa00);

    } else if (sub === "warn") {
      const target = interaction.options.getMember("miembro") as GuildMember;
      const reason = interaction.options.getString("razon", true);
      const profile = await UserProfile.findOneAndUpdate(
        { discordId: target.id, guildId },
        { $inc: { warns: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      const warns = profile?.warns ?? 1;
      await interaction.reply({
        content: `⚠️ Advertencia registrada a **${target.user.tag}**. Total: **${warns}/3** — ${reason}`,
        ephemeral: true,
      });
      await logMod(`⚠️ **Warn #${warns}** a ${target.user.tag} — ${reason}`, 0xffdd00);
      await checkAndApplyAutoTimeout(target, guildId);

    } else if (sub === "clear") {
      const amount = Math.min(100, Math.max(1, interaction.options.getInteger("cantidad", true)));
      const filterUser = interaction.options.getUser("usuario");
      const chan = interaction.channel as TextChannel;
      let messages = await chan.messages.fetch({ limit: amount + 1 });
      if (filterUser) {
        messages = messages.filter((m) => m.author.id === filterUser.id);
      }
      await chan.bulkDelete(messages, true);
      await interaction.reply({ content: `🗑️ ${messages.size} mensajes eliminados.`, ephemeral: true });
    }
  } catch (err) {
    logger.error({ err, sub }, "Mod command error");
    await interaction.reply({ content: "❌ Error al ejecutar el comando.", ephemeral: true }).catch(() => {});
  }
}
