import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  Events,
  Client,
  GuildMember,
  SlashCommandBuilder,
  TextChannel,
  Message,
} from "discord.js";
import { UserProfile, GuildConfig } from "../../db/schemas";
import { processImageOcr, parseProfileFromText } from "../ocr";
import { logger } from "../../lib/logger";

export const sweeperCommandDefs = [
  new SlashCommandBuilder()
    .setName("roster")
    .setDescription("Sweeper — Detector de espías")
    .addSubcommand((s) =>
      s.setName("sweep")
        .setDescription("Analizar lista de miembros del juego")
        .addAttachmentOption((o) =>
          o.setName("lista").setDescription("Captura de la lista de miembros del juego").setRequired(true),
        ),
    ),
].map((b) => b.toJSON());

export function registerGuestRoleAssigner(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const config = await GuildConfig.findOne({ guildId: member.guild.id }).catch(() => null);
      if (!config?.guestRoleId) return;

      const role = member.guild.roles.cache.get(config.guestRoleId);
      if (!role) return;

      await member.roles.add(role);
      logger.info({ userId: member.id, guildId: member.guild.id, role: role.name }, "Guest role assigned on join");
    } catch (err) {
      logger.warn({ err, userId: member.id }, "Failed to assign Guest role on join");
    }
  });
}

export function registerVerificationListener(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.guild) return;

    const config = await GuildConfig.findOne({ guildId: message.guild.id }).catch(() => null);
    if (!config?.channels?.playerVerification) return;
    if (message.channelId !== config.channels.playerVerification) return;

    // Only process messages with image attachments
    const imageAttachment = message.attachments.find((a) =>
      a.contentType?.startsWith("image/"),
    );
    if (!imageAttachment) return;

    try {
      const text = await processImageOcr(imageAttachment.url);
      const profile = parseProfileFromText(text);

      if (!profile.characterId) {
        await message.reply("❌ No se pudo detectar un Character ID en la imagen. Sube una captura clara de tu perfil del juego.");
        return;
      }

      // ── Server number validation ───────────────────────────────────────────
      if (config.gameServerId) {
        if (!profile.gameServer) {
          await message.reply(
            `❌ No se pudo detectar el número de servidor en tu captura.\n` +
            `Asegurate de que el número de servidor **#${config.gameServerId}** sea visible en la imagen.`,
          );
          return;
        }
        if (profile.gameServer !== config.gameServerId) {
          const modChan = message.guild.channels.cache.get(config.channels?.modLogs ?? "") as TextChannel | undefined;
          if (modChan) {
            await modChan.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle("⚠️ Intento de Verificación — Servidor Incorrecto")
                  .setColor(0xff8800)
                  .addFields(
                    { name: "Usuario", value: `<@${message.author.id}>`, inline: true },
                    { name: "Servidor detectado", value: `#${profile.gameServer}`, inline: true },
                    { name: "Servidor requerido", value: `#${config.gameServerId}`, inline: true },
                    { name: "IGN detectado", value: profile.ign ?? "Desconocido", inline: true },
                  )
                  .setTimestamp(),
              ],
            });
          }
          await message.reply(
            `❌ Tu perfil pertenece al servidor **#${profile.gameServer}**, pero este Discord es del servidor **#${config.gameServerId}**.\n` +
            `No puedes verificarte en una alianza de otro servidor.`,
          );
          return;
        }
      }

      const guildId = message.guild.id;
      const discordId = message.author.id;

      // Check if character ID already exists (could be a different user — spy alert)
      const existing = await UserProfile.findOne({ characterId: profile.characterId });

      if (existing && existing.discordId !== discordId) {
        const chan = message.guild.channels.cache.get(config.channels.modLogs ?? "") as TextChannel | undefined;
        if (chan) {
          await chan.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("🚨 ALERTA DE ESPÍA — Character ID Duplicado")
                .setColor(0xff0000)
                .addFields(
                  { name: "Character ID", value: profile.characterId, inline: true },
                  { name: "IGN Detectado", value: profile.ign ?? "Desconocido", inline: true },
                  { name: "Reclamado por", value: `<@${existing.discordId}>`, inline: true },
                  { name: "Nuevo intento por", value: `<@${discordId}>`, inline: true },
                )
                .setTimestamp(),
            ],
          });
        }
        await message.reply("⚠️ Este Character ID ya está registrado con otra cuenta de Discord. El caso fue reportado a los moderadores.");
        return;
      }

      // Upsert profile
      await UserProfile.findOneAndUpdate(
        { characterId: profile.characterId },
        {
          discordId,
          guildId,
          ign: profile.ign ?? existing?.ign ?? "Desconocido",
          characterId: profile.characterId,
          verifiedAt: existing ? existing.verifiedAt : new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      // Name change detection
      const nameChanged = existing && existing.ign !== profile.ign;

      // ── Role assignment: Guest → Member ───────────────────────────────────
      let roleStatus = "✅ Registrado";
      try {
        const member = await message.guild.members.fetch(discordId);
        const { guestRoleId, memberRoleId } = config;

        if (memberRoleId && !member.roles.cache.has(memberRoleId)) {
          await member.roles.add(memberRoleId);
          roleStatus = "✅ Rol de Miembro asignado";
        }
        if (guestRoleId && member.roles.cache.has(guestRoleId)) {
          await member.roles.remove(guestRoleId);
        }
      } catch (roleErr) {
        logger.warn({ roleErr }, "Could not update roles during verification");
        roleStatus = "⚠️ Registrado (no se pudo asignar rol — revisa permisos del bot)";
      }

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Verificación Exitosa")
            .setColor(0x00cc55)
            .addFields(
              { name: "Character ID", value: profile.characterId, inline: true },
              { name: "IGN", value: profile.ign ?? "Extraído", inline: true },
              { name: "Estado", value: nameChanged ? "🔄 Nombre actualizado en BD" : roleStatus, inline: true },
            )
            .setFooter({ text: "Ya tienes acceso completo al servidor. ¡Bienvenido!" })
            .setTimestamp(),
        ],
      });
    } catch (err) {
      logger.error({ err }, "Profile verification OCR failed");
      await message.reply("❌ Error al procesar la imagen. Asegúrate de subir una captura clara de tu perfil del juego.");
    }
  });
}

export async function handleSweeperCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const attachment = interaction.options.getAttachment("lista", true);
  const guildId = interaction.guild.id;

  try {
    const text = await processImageOcr(attachment.url);
    const lines = text.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 1);

    // Get all registered IGNs for this guild
    const profiles = await UserProfile.find({ guildId });
    const registeredIgns = new Map<string, string>(profiles.map((p) => [p.ign.toLowerCase(), p.discordId]));
    const registeredIds = new Map<string, { ign: string; discordId: string }>(
      profiles.map((p) => [p.characterId, { ign: p.ign, discordId: p.discordId }]),
    );

    const suspects: string[] = [];
    const nameChanges: string[] = [];

    for (const line of lines) {
      const cleanLine = line.replace(/[^a-zA-Z0-9\s_\-]/g, "").trim();
      if (cleanLine.length < 2) continue;

      const isKnownIgn = registeredIgns.has(cleanLine.toLowerCase());
      if (!isKnownIgn) {
        suspects.push(cleanLine);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("🔍 ROSTER SWEEP — Reporte de Espías")
      .setColor(suspects.length > 0 ? 0xff4400 : 0x00cc55)
      .addFields(
        { name: "📋 Líneas analizadas", value: String(lines.length), inline: true },
        { name: "✅ Miembros verificados", value: String(lines.length - suspects.length), inline: true },
        { name: "⚠️ Sospechosos", value: String(suspects.length), inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "Kingdom Guardian Pro — El Sweeper" });

    if (suspects.length > 0) {
      embed.addFields({
        name: "🚨 Usuarios en juego sin registro Discord (Posibles Espías)",
        value: suspects.map((s) => `⚠️ \`${s}\``).join("\n").slice(0, 1024),
        inline: false,
      });
    } else {
      embed.addFields({ name: "✅ Sin Sospechosos", value: "Todos los miembros del juego están registrados en Discord.", inline: false });
    }

    await interaction.editReply({ embeds: [embed] });

    // Also post to mod-logs if configured
    const config = await GuildConfig.findOne({ guildId });
    if (config?.channels?.modLogs && suspects.length > 0) {
      const chan = interaction.guild.channels.cache.get(config.channels.modLogs) as TextChannel | undefined;
      if (chan) await chan.send({ embeds: [embed] });
    }
  } catch (err) {
    logger.error({ err }, "Sweeper command failed");
    await interaction.editReply({ content: "❌ Error al procesar la lista. Intenta con una imagen más clara." });
  }
}
