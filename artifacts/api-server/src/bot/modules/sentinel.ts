import {
  Client,
  Events,
  GuildMember,
  Message,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { GuildConfig, UserProfile } from "../../db/schemas";
import { logger } from "../../lib/logger";

const ALLOWED_LINK_DOMAINS = [
  "callofdragons.com",
  "discord.com",
  "discord.gg",
  "support.callofdragons.com",
  "store.callofdragons.com",
];

const LINK_PATTERN = /https?:\/\/([^\s/]+)/gi;

// Anti-raid: track new joins per guild in a 10s window
const joinWindows = new Map<string, number[]>();

// Anti-spam: track message timestamps per user
const msgWindows = new Map<string, number[]>();

function isAllowedDomain(url: string): boolean {
  const match = url.match(/https?:\/\/([^\s/]+)/i);
  if (!match) return true;
  const host = match[1].toLowerCase().replace(/^www\./, "");
  return ALLOWED_LINK_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

export function registerSentinel(client: Client): void {
  // ── Anti-Raid ─────────────────────────────────────────────────────────────
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    const guildId = member.guild.id;
    const now = Date.now();

    const times = joinWindows.get(guildId) ?? [];
    const recent = times.filter((t) => now - t < 10_000);
    recent.push(now);
    joinWindows.set(guildId, recent);

    if (recent.length >= 5) {
      logger.warn({ guildId, count: recent.length }, "Anti-raid triggered");

      try {
        const config = await GuildConfig.findOne({ guildId });
        if (config?.channels?.modLogs) {
          const chan = member.guild.channels.cache.get(config.channels.modLogs) as TextChannel | undefined;
          if (chan) {
            const embed = new EmbedBuilder()
              .setTitle("🚨 ALERTA ANTI-RAID ACTIVADA")
              .setColor(0xff0000)
              .setDescription(
                `Se detectaron **${recent.length}** ingresos en menos de 10 segundos.\nNuevos miembros puestos en cuarentena automáticamente.`,
              )
              .addFields(
                { name: "Último miembro", value: member.user.tag, inline: true },
                { name: "ID", value: member.id, inline: true },
              )
              .setTimestamp();
            await chan.send({ embeds: [embed] });
          }
        }

        // Quarantine: remove all auto-assignable roles
        if (member.manageable) {
          await member.roles.set([], "Anti-raid quarantine");
        }
      } catch (err) {
        logger.error({ err }, "Anti-raid handler error");
      }
    }
  });

  // ── Anti-Spam & Anti-Links ────────────────────────────────────────────────
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.guild) return;
    if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    const userId = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();

    // Anti-links
    const urls = message.content.match(LINK_PATTERN) ?? [];
    const hasBlockedLink = urls.some((u) => !isAllowedDomain(u));
    if (hasBlockedLink) {
      try {
        await message.delete();
        await message.author.send(
          "⚠️ Tu mensaje fue eliminado porque contiene un enlace no autorizado en este servidor.",
        ).catch(() => {});
      } catch {}
      return;
    }

    // Anti-spam: >4 messages in <3 seconds
    const times = msgWindows.get(userId) ?? [];
    const recent = times.filter((t) => now - t < 3_000);
    recent.push(now);
    msgWindows.set(userId, recent);

    if (recent.length > 4) {
      try {
        await message.member?.timeout(10 * 60 * 1000, "Anti-spam: mensajes excesivos");
        if (message.channel.isSendable()) {
          await message.channel.send(
            `⏱️ <@${message.author.id}> ha sido silenciado por 10 minutos por spam.`,
          );
        }
        msgWindows.delete(userId);

        const config = await GuildConfig.findOne({ guildId: message.guild.id });
        if (config?.channels?.modLogs) {
          const chan = message.guild.channels.cache.get(config.channels.modLogs) as TextChannel | undefined;
          if (chan) {
            const embed = new EmbedBuilder()
              .setTitle("⏱️ Anti-Spam Timeout")
              .setColor(0xffaa00)
              .addFields(
                { name: "Usuario", value: message.author.tag, inline: true },
                { name: "ID", value: message.author.id, inline: true },
                { name: "Razón", value: "Más de 4 mensajes en menos de 3 segundos", inline: false },
              )
              .setTimestamp();
            await chan.send({ embeds: [embed] });
          }
        }
      } catch (err) {
        logger.error({ err }, "Anti-spam timeout failed");
      }
    }
  });

  // ── Auto-warn timeout (3 warns → 24h timeout) ────────────────────────────
  // Checked when a warn is added via /mod warn command handler
}

export async function checkAndApplyAutoTimeout(member: GuildMember, guildId: string): Promise<void> {
  const profile = await UserProfile.findOne({ discordId: member.id, guildId });
  if (profile && profile.warns >= 3) {
    await member.timeout(24 * 60 * 60 * 1000, "Auto-timeout: 3 advertencias acumuladas");
    await UserProfile.updateOne({ discordId: member.id, guildId }, { warns: 0 });
  }
}
