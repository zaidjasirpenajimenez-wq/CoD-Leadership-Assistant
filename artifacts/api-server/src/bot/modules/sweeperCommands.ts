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
import { checkBlacklist } from "./blacklistCommands";
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
      logger.info({ guildId: message.guild.id, userId: message.author.id, ocrText: text }, "OCR raw text");
      const profile = parseProfileFromText(text);

      if (!profile.characterId) {
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  OCR — Character ID No Detectado")
              .setColor(0xed4245)
              .setDescription(
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `No se pudo leer un **Character ID** en tu imagen.\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
              )
              .addFields({ name: "💡 ¿Qué hacer?", value: "Sube una captura **clara y completa** de tu perfil del juego donde el ID sea visible.", inline: false })
              .setFooter({ text: "Kingdom Guardian Pro  •  Sistema de Verificación" })
              .setTimestamp(),
          ],
        });
        return;
      }

      // ── Server number validation ───────────────────────────────────────────
      if (config.gameServerId) {
        if (!profile.gameServer) {
          await message.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle("❌  Servidor No Detectado en la Imagen")
                .setColor(0xff7b00)
                .setDescription(
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  `No se pudo leer el **número de servidor** en tu captura.\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                )
                .addFields(
                  { name: "🎮 Servidor requerido", value: `**#${config.gameServerId}**`, inline: true },
                  { name: "💡 ¿Qué hacer?",        value: `Asegúrate de que el número **#${config.gameServerId}** sea visible en la imagen.`, inline: false },
                )
                .setFooter({ text: "Kingdom Guardian Pro  •  Sistema de Verificación" })
                .setTimestamp(),
            ],
          });
          return;
        }
        if (profile.gameServer !== config.gameServerId) {
          const modChan = message.guild.channels.cache.get(config.channels?.modLogs ?? "") as TextChannel | undefined;
          if (modChan) {
            await modChan.send({
              embeds: [
                new EmbedBuilder()
                  .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                  .setTitle("🚫  VERIFICACIÓN RECHAZADA — Servidor Incorrecto")
                  .setColor(0xff7b00)
                  .setDescription(
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `<@${message.author.id}> intentó verificarse con un perfil de otro servidor.\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                  )
                  .addFields(
                    { name: "👤 Usuario",             value: `<@${message.author.id}>`,  inline: true },
                    { name: "🎮 Servidor detectado",  value: `**#${profile.gameServer}**`, inline: true },
                    { name: "✅ Servidor requerido",  value: `**#${config.gameServerId}**`, inline: true },
                    { name: "🗡️ IGN detectado",       value: profile.ign ?? "Desconocido", inline: true },
                  )
                  .setTimestamp()
                  .setFooter({ text: "Kingdom Guardian Pro  •  Sistema de Verificación" }),
              ],
            });
          }
          await message.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle("🚫  Servidor de Juego Incorrecto")
                .setColor(0xff7b00)
                .setDescription(
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  `Tu perfil pertenece al servidor **#${profile.gameServer}**,\n` +
                  `pero este Discord corresponde al servidor **#${config.gameServerId}**.\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                )
                .addFields({ name: "ℹ️ Info", value: "No puedes verificarte en una alianza de otro servidor.", inline: false })
                .setFooter({ text: "Kingdom Guardian Pro  •  Sistema de Verificación" })
                .setTimestamp(),
            ],
          });
          return;
        }
      }

      const guildId = message.guild.id;
      const discordId = message.author.id;

      // ── Blacklist check — alert R5 silently if IGN is banned ─────────────
      if (profile.ign) {
        const banned = await checkBlacklist(guildId, profile.ign);
        if (banned) {
          const alertChanId = config.channels?.spyReports ?? config.channels?.modLogs;
          const alertChan = alertChanId
            ? (message.guild.channels.cache.get(alertChanId) as TextChannel | undefined)
            : undefined;
          if (alertChan) {
            await alertChan.send({
              embeds: [
                new EmbedBuilder()
                  .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                  .setTitle("🚫 ALERTA — IGN EN LISTA NEGRA INTENTÓ VERIFICARSE")
                  .setColor(0xed4245)
                  .setDescription(
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Un jugador en la lista negra intentó ingresar al servidor.\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                  )
                  .addFields(
                    { name: "🗡️ IGN detectado",  value: `**${profile.ign}**`,           inline: true },
                    { name: "👤 Discord",         value: `<@${discordId}>`,               inline: true },
                    { name: "📋 Motivo del ban",  value: banned.reason,                   inline: true },
                    ...(banned.notes ? [{ name: "📝 Notas", value: banned.notes, inline: false }] : []),
                    { name: "👮 Agregado por",    value: `<@${banned.addedBy}>`,          inline: true },
                  )
                  .setTimestamp()
                  .setFooter({ text: "Kingdom Guardian Pro — Lista Negra · Verificación bloqueada silenciosamente" }),
              ],
            }).catch(() => {});
          }
          // Silently reject — tell user their profile couldn't be verified without revealing why
          await message.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle("❌ Verificación No Completada")
                .setColor(0xed4245)
                .setDescription(
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  `No fue posible completar tu verificación en este momento.\n` +
                  `Contacta a un R4/R5 si crees que esto es un error.\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                )
                .setFooter({ text: "Kingdom Guardian Pro  •  Sistema de Verificación" })
                .setTimestamp(),
            ],
          }).catch(() => {});
          return;
        }
      }

      // Check if character ID already exists (could be a different user — spy alert)
      const existing = await UserProfile.findOne({ characterId: profile.characterId });

      if (existing && existing.discordId !== discordId) {
        const chan = message.guild.channels.cache.get(config.channels.modLogs ?? "") as TextChannel | undefined;
        if (chan) {
          await chan.send({
            embeds: [
              new EmbedBuilder()
                .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                .setTitle("🚨  ALERTA DE ESPÍA — Character ID Duplicado")
                .setColor(0xed4245)
                .setDescription(
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  `Un Character ID ya registrado fue reclamado por **otra** cuenta de Discord.\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                )
                .addFields(
                  { name: "🆔 Character ID",    value: `\`${profile.characterId}\``,   inline: true },
                  { name: "🗡️ IGN detectado",   value: profile.ign ?? "Desconocido",   inline: true },
                  { name: "\u200b",              value: "\u200b",                       inline: true },
                  { name: "✅ Cuenta original", value: `<@${existing.discordId}>`,     inline: true },
                  { name: "⚠️ Nuevo intento",   value: `<@${discordId}>`,              inline: true },
                  { name: "\u200b",              value: "\u200b",                       inline: true },
                )
                .setTimestamp()
                .setFooter({ text: "Kingdom Guardian Pro  •  Sistema Anti-Espía" }),
            ],
          });
        }
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⚠️  Character ID Ya Registrado")
              .setColor(0xed4245)
              .setDescription(
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `Este Character ID ya está vinculado a **otra cuenta de Discord**.\n` +
                `El caso fue reportado automáticamente a los moderadores.\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
              )
              .setFooter({ text: "Kingdom Guardian Pro  •  Sistema de Verificación" })
              .setTimestamp(),
          ],
        });
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

        // ── Nickname: "IGN | ID" ─────────────────────────────────────────────
        if (profile.ign) {
          const ign      = profile.ign.slice(0, 20); // cap to leave room for ID
          const idSuffix = profile.characterId ? ` | ${profile.characterId}` : "";
          const nick     = `${ign}${idSuffix}`.slice(0, 32); // Discord limit
          await member.setNickname(nick, "Verificación automática OCR").catch((nickErr) => {
            logger.warn({ nickErr, userId: discordId }, "Could not set nickname during verification");
          });
        }
      } catch (roleErr) {
        logger.warn({ roleErr }, "Could not update roles during verification");
        roleStatus = "⚠️ Registrado (no se pudo asignar rol — revisa permisos del bot)";
      }

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
            .setTitle("✅  VERIFICACIÓN EXITOSA")
            .setColor(0x57f287)
            .setDescription(
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `¡Bienvenido/a a la alianza, **${profile.ign ?? message.author.username}**! 🎉\n` +
              `Ya tienes acceso completo al servidor.\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            )
            .addFields(
              { name: "🆔 Character ID",  value: `\`${profile.characterId}\``,                      inline: true },
              { name: "🗡️ IGN",           value: profile.ign ?? "Extraído",                          inline: true },
              { name: "🎖️ Estado",        value: nameChanged ? "🔄 Nombre actualizado" : roleStatus, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro  •  Sistema de Verificación" }),
        ],
      });
    } catch (err) {
      logger.error({ err }, "Profile verification OCR failed");
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌  Error al Procesar la Imagen")
            .setColor(0xed4245)
            .setDescription(
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `No se pudo analizar la imagen correctamente.\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            )
            .addFields({ name: "💡 Sugerencia", value: "Asegúrate de subir una captura **nítida** de tu perfil del juego, con buena iluminación y sin recortes.", inline: false })
            .setFooter({ text: "Kingdom Guardian Pro  •  Sistema de Verificación" })
            .setTimestamp(),
        ],
      });
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

    const clean     = suspects.length === 0;
    const memberName = interaction.guild.members.cache.get(interaction.user.id)?.displayName ?? interaction.user.username;

    const embed = new EmbedBuilder()
      .setAuthor({ name: `Análisis por ${memberName}`, iconURL: interaction.user.displayAvatarURL() })
      .setTitle(`🔍  ROSTER SWEEP — ${clean ? "TODO LIMPIO" : `${suspects.length} SOSPECHOSO${suspects.length !== 1 ? "S" : ""}`}`)
      .setColor(clean ? 0x57f287 : 0xed4245)
      .setDescription(
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        (clean
          ? `✅ Todos los miembros del juego están registrados en Discord.`
          : `⚠️ Se detectaron **${suspects.length}** nombre${suspects.length !== 1 ? "s" : ""} sin registro Discord.`) +
        `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      )
      .addFields(
        { name: "📋 Líneas analizadas",    value: `**${lines.length}**`,                    inline: true },
        { name: "✅ Verificados",           value: `**${lines.length - suspects.length}**`,  inline: true },
        { name: "⚠️ Sospechosos",          value: `**${suspects.length}**`,                 inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "Kingdom Guardian Pro  •  Sistema Sweeper Anti-Espía" });

    if (suspects.length > 0) {
      embed.addFields({
        name: "🚨 Sin registro Discord (posibles espías)",
        value: suspects.map((s) => `> ⚠️ \`${s}\``).join("\n").slice(0, 1024),
        inline: false,
      });
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
