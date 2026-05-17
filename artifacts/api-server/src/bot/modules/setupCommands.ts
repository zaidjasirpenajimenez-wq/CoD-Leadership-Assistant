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
        .setDescription("Configurar tag de la alianza")
        .addStringOption((o) =>
          o.setName("tag").setDescription("Tag de la alianza (ej: KGP)").setRequired(true),
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
        .addChannelOption((o) => o.setName("mod_logs").setDescription("Canal #mod-logs (sanciones, alertas)"))
        .addChannelOption((o) => o.setName("leaderboard").setDescription("Canal #leaderboard (ranking semanal automático)"))
        .addChannelOption((o) => o.setName("announcements").setDescription("Canal #announcements (anuncios oficiales)")),
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
      s.setName("status").setDescription("Ver la configuración actual del servidor"),
    ),
].map((b) => b.toJSON());

export async function handleSetupCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  try {
    if (sub === "alliance") {
      const tag = interaction.options.getString("tag", true);
      await GuildConfig.findOneAndUpdate(
        { guildId },
        { allianceTag: tag },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      await interaction.reply({ content: `✅ Tag de alianza configurado: **[${tag}]**`, ephemeral: true });

    } else if (sub === "channels") {
      const warAlerts = interaction.options.getChannel("war_alerts")?.id;
      const attackOrders = interaction.options.getChannel("attack_orders")?.id;
      const defenseOrders = interaction.options.getChannel("defense_orders")?.id;
      const resourceRequests = interaction.options.getChannel("resource_requests")?.id;
      const playerVerification = interaction.options.getChannel("player_verification")?.id;
      const modLogs = interaction.options.getChannel("mod_logs")?.id;
      const leaderboard = interaction.options.getChannel("leaderboard")?.id;
      const announcements = interaction.options.getChannel("announcements")?.id;

      const update: Record<string, string> = {};
      if (warAlerts) update["channels.warAlerts"] = warAlerts;
      if (attackOrders) update["channels.attackOrders"] = attackOrders;
      if (defenseOrders) update["channels.defenseOrders"] = defenseOrders;
      if (resourceRequests) update["channels.resourceRequests"] = resourceRequests;
      if (playerVerification) update["channels.playerVerification"] = playerVerification;
      if (modLogs) update["channels.modLogs"] = modLogs;
      if (leaderboard) update["channels.leaderboard"] = leaderboard;
      if (announcements) update["channels.announcements"] = announcements;

      await GuildConfig.findOneAndUpdate(
        { guildId },
        { $set: update },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Canales Configurados")
            .setColor(0x00cc55)
            .setDescription("Los canales fueron actualizados correctamente.")
            .setTimestamp(),
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
        content: `✅ Umbral de inactividad configurado a **${dias} días**. El scheduler alertará automáticamente a liderazgo cuando detecte miembros inactivos.`,
        ephemeral: true,
      });

    } else if (sub === "status") {
      const config = await GuildConfig.findOne({ guildId });
      if (!config) {
        await interaction.reply({
          content: "⚠️ Servidor no configurado. Usa `/setup alliance` primero.",
          ephemeral: true,
        });
        return;
      }

      const ch = (id?: string) => (id ? `<#${id}>` : "❌ No configurado");

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`⚙️ Configuración — [${config.allianceTag}]`)
            .setColor(0x4488ff)
            .addFields(
              { name: "🚨 War Alerts", value: ch(config.channels.warAlerts), inline: true },
              { name: "⚔️ Attack Orders", value: ch(config.channels.attackOrders), inline: true },
              { name: "🛡️ Defense Orders", value: ch(config.channels.defenseOrders), inline: true },
              { name: "📦 Resource Requests", value: ch(config.channels.resourceRequests), inline: true },
              { name: "🔍 Player Verification", value: ch(config.channels.playerVerification), inline: true },
              { name: "📋 Mod Logs", value: ch(config.channels.modLogs), inline: true },
              { name: "🏆 Leaderboard", value: ch(config.channels.leaderboard), inline: true },
              { name: "📢 Announcements", value: ch(config.channels.announcements), inline: true },
              { name: "👻 Inactividad", value: `${config.inactiveDays ?? 7} días`, inline: true },
            )
            .setTimestamp(),
        ],
        ephemeral: true,
      });
    }
  } catch (err) {
    logger.error({ err, sub }, "Setup command error");
    await interaction.reply({ content: "❌ Error al configurar.", ephemeral: true }).catch(() => {});
  }
}
