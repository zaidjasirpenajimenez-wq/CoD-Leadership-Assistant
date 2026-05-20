import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { GuildConfig } from "../../db/schemas";
import { logger } from "../../lib/logger";

export const setupCommandDefs = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurar Kingdom Guardian en este servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s
        .setName("alliance")
        .setDescription("Configurar tag de la alianza y número de servidor del juego")
        .addStringOption((o) =>
          o.setName("tag").setDescription("Tag de la alianza (ej: KGP)").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("servidor").setDescription("Número de servidor del juego (ej: 1423)").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("channels")
        .setDescription("Configurar canales del bot")
        .addChannelOption((o) => o.setName("war_alerts").setDescription("Canal #war-alerts"))
        .addChannelOption((o) => o.setName("attack_orders").setDescription("Canal #attack-orders"))
        .addChannelOption((o) => o.setName("defense_orders").setDescription("Canal #defense-orders"))
        .addChannelOption((o) => o.setName("resource_requests").setDescription("Canal #resource-requests"))
        .addChannelOption((o) => o.setName("player_verification").setDescription("Canal #player-verification"))
        .addChannelOption((o) => o.setName("mod_logs").setDescription("Canal #mod-logs"))
        .addChannelOption((o) => o.setName("leaderboard").setDescription("Canal #leaderboard"))
        .addChannelOption((o) => o.setName("announcements").setDescription("Canal #announcements")),
    )
    .addSubcommand((s) =>
      s
        .setName("inactivity")
        .setDescription("Configurar días de inactividad para alertas automáticas")
        .addIntegerOption((o) =>
          o
            .setName("dias")
            .setDescription("Días sin actividad para considerar inactivo (por defecto: 7)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(30),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("roles")
        .setDescription("Configurar roles de verificación (Guest → Miembro)")
        .addRoleOption((o) =>
          o.setName("guest").setDescription("Rol que tienen los nuevos integrantes (Guest)").setRequired(true),
        )
        .addRoleOption((o) =>
          o.setName("member").setDescription("Rol que se asigna al verificarse (Miembro)").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName("status").setDescription("Ver la configuración actual del servidor"),
    ),
].map((b) => b.toJSON());

export async function handleSetupCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const adminName   = interaction.guild.members.cache.get(interaction.user.id)?.displayName ?? interaction.user.username;
  const adminAvatar = interaction.user.displayAvatarURL();

  try {
    if (sub === "alliance") {
      const tag      = interaction.options.getString("tag", true);
      const servidor = interaction.options.getString("servidor", true);
      await GuildConfig.findOneAndUpdate(
        { guildId },
        { allianceTag: tag, gameServerId: servidor },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: adminName, iconURL: adminAvatar })
            .setTitle("🏰  ALIANZA CONFIGURADA")
            .setColor(0x5865f2)
            .setDescription(
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `**[${tag}]** queda registrada como la alianza de este servidor.\n` +
              `Solo se verificarán jugadores del servidor de juego **#${servidor}**.\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            )
            .addFields(
              { name: "🏴 Tag de Alianza",       value: `**[${tag}]**`,      inline: true },
              { name: "🎮 Servidor del Juego",   value: `**#${servidor}**`,  inline: true },
              { name: "🔒 Verificación filtrada", value: "Activa",           inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro  •  Configuración" }),
        ],
        ephemeral: true,
      });

    } else if (sub === "channels") {
      const warAlerts        = interaction.options.getChannel("war_alerts")?.id;
      const attackOrders     = interaction.options.getChannel("attack_orders")?.id;
      const defenseOrders    = interaction.options.getChannel("defense_orders")?.id;
      const resourceRequests = interaction.options.getChannel("resource_requests")?.id;
      const playerVerification = interaction.options.getChannel("player_verification")?.id;
      const modLogs          = interaction.options.getChannel("mod_logs")?.id;
      const leaderboard      = interaction.options.getChannel("leaderboard")?.id;
      const announcements    = interaction.options.getChannel("announcements")?.id;

      const update: Record<string, string> = {};
      if (warAlerts)         update["channels.warAlerts"]        = warAlerts;
      if (attackOrders)      update["channels.attackOrders"]     = attackOrders;
      if (defenseOrders)     update["channels.defenseOrders"]    = defenseOrders;
      if (resourceRequests)  update["channels.resourceRequests"] = resourceRequests;
      if (playerVerification) update["channels.playerVerification"] = playerVerification;
      if (modLogs)           update["channels.modLogs"]          = modLogs;
      if (leaderboard)       update["channels.leaderboard"]      = leaderboard;
      if (announcements)     update["channels.announcements"]    = announcements;

      await GuildConfig.findOneAndUpdate(
        { guildId },
        { $set: update },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      const updated = Object.keys(update).length;
      const chanList = [
        warAlerts        ? `🚨 War Alerts → <#${warAlerts}>`              : null,
        attackOrders     ? `⚔️ Attack Orders → <#${attackOrders}>`        : null,
        defenseOrders    ? `🛡️ Defense Orders → <#${defenseOrders}>`      : null,
        resourceRequests ? `📦 Resource Requests → <#${resourceRequests}>` : null,
        playerVerification ? `🔍 Verificación → <#${playerVerification}>` : null,
        modLogs          ? `📋 Mod Logs → <#${modLogs}>`                  : null,
        leaderboard      ? `🏆 Leaderboard → <#${leaderboard}>`           : null,
        announcements    ? `📢 Announcements → <#${announcements}>`        : null,
      ].filter(Boolean);

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: adminName, iconURL: adminAvatar })
            .setTitle("📡  CANALES ACTUALIZADOS")
            .setColor(0x57f287)
            .setDescription(
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `**${updated}** canal${updated !== 1 ? "es" : ""} configurado${updated !== 1 ? "s" : ""} correctamente.\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              chanList.join("\n"),
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro  •  Configuración" }),
        ],
        ephemeral: true,
      });

    } else if (sub === "inactivity") {
      const dias = interaction.options.getInteger("dias", true);
      await GuildConfig.findOneAndUpdate(
        { guildId },
        { inactiveDays: dias },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: adminName, iconURL: adminAvatar })
            .setTitle("👻  UMBRAL DE INACTIVIDAD CONFIGURADO")
            .setColor(0xfee75c)
            .setDescription(
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `El bot alertará automáticamente a liderazgo cuando detecte miembros **sin actividad por ${dias} días**.\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            )
            .addFields(
              { name: "⏱️ Umbral",       value: `**${dias} días**`,    inline: true },
              { name: "🔄 Revisión",     value: "Cada hora",           inline: true },
              { name: "📢 Notificación", value: "Canal Mod Logs",      inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro  •  Configuración" }),
        ],
        ephemeral: true,
      });

    } else if (sub === "roles") {
      const guestRole  = interaction.options.getRole("guest",  true);
      const memberRole = interaction.options.getRole("member", true);

      await GuildConfig.findOneAndUpdate(
        { guildId },
        { $set: { guestRoleId: guestRole.id, memberRoleId: memberRole.id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: adminName, iconURL: adminAvatar })
            .setTitle("🎭  ROLES DE VERIFICACIÓN CONFIGURADOS")
            .setColor(0x57f287)
            .setDescription(
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `Cuando un miembro suba su captura de perfil y pase el OCR, el bot cambiará sus roles automáticamente.\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            )
            .addFields(
              { name: "👤 Rol Guest (al entrar)",         value: `<@&${guestRole.id}>`,  inline: true },
              { name: "✅ Rol Miembro (tras verificarse)", value: `<@&${memberRole.id}>`, inline: true },
              { name: "🤖 Flujo automático",              value: "Guest → OCR → Miembro", inline: false },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro  •  Configuración" }),
        ],
        ephemeral: true,
      });

    } else if (sub === "status") {
      const config = await GuildConfig.findOne({ guildId });
      if (!config) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⚙️  Sin Configuración")
              .setColor(0xed4245)
              .setDescription("Este servidor aún no está configurado.\nUsa `/setup alliance` para empezar.")
              .setFooter({ text: "Kingdom Guardian Pro  •  Configuración" }),
          ],
          ephemeral: true,
        });
        return;
      }

      const ch  = (id?: string) => id ? `<#${id}>` : "`❌ No configurado`";
      const rl  = (id?: string | null) => id ? `<@&${id}>` : "`❌ No configurado`";
      const ok  = (v?: string | null) => v ? "✅" : "❌";

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: interaction.guild.name, iconURL: interaction.guild.iconURL() ?? undefined })
            .setTitle(`⚙️  CONFIGURACIÓN — [${config.allianceTag ?? "Sin tag"}]`)
            .setColor(0x5865f2)
            .setDescription(
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `**Servidor del juego:** ${config.gameServerId ? `\`#${config.gameServerId}\`` : "`❌ No configurado`"} · ` +
              `**Inactividad:** \`${config.inactiveDays ?? 7} días\`\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            )
            .addFields(
              { name: `${ok(config.channels?.warAlerts)} 🚨 War Alerts`,         value: ch(config.channels?.warAlerts),        inline: true },
              { name: `${ok(config.channels?.attackOrders)} ⚔️ Attack Orders`,   value: ch(config.channels?.attackOrders),     inline: true },
              { name: `${ok(config.channels?.defenseOrders)} 🛡️ Defense Orders`, value: ch(config.channels?.defenseOrders),    inline: true },
              { name: `${ok(config.channels?.resourceRequests)} 📦 Resources`,   value: ch(config.channels?.resourceRequests), inline: true },
              { name: `${ok(config.channels?.playerVerification)} 🔍 Verificación`, value: ch(config.channels?.playerVerification), inline: true },
              { name: `${ok(config.channels?.modLogs)} 📋 Mod Logs`,             value: ch(config.channels?.modLogs),          inline: true },
              { name: `${ok(config.channels?.leaderboard)} 🏆 Leaderboard`,      value: ch(config.channels?.leaderboard),      inline: true },
              { name: `${ok(config.channels?.announcements)} 📢 Announcements`,  value: ch(config.channels?.announcements),    inline: true },
              { name: "\u200b",                                                    value: "\u200b",                             inline: true },
              { name: `${ok(config.guestRoleId)} 👤 Rol Guest`,                  value: rl(config.guestRoleId),               inline: true },
              { name: `${ok(config.memberRoleId)} ✅ Rol Miembro`,               value: rl(config.memberRoleId),              inline: true },
              { name: "\u200b",                                                    value: "\u200b",                             inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Kingdom Guardian Pro  •  Configuración  •  Solo visible para ti" }),
        ],
        ephemeral: true,
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Setup command error");
    await interaction.reply({ content: "❌ Error al configurar.", ephemeral: true }).catch(() => {});
  }
}
