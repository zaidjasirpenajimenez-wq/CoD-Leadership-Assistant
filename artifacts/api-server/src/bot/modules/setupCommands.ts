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
      s.setName("alliance")
        .setDescription("Configurar tag de la alianza")
        .addStringOption((o) =>
          o.setName("tag").setDescription("Tag de la alianza (ej: KGP)").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName("channels")
        .setDescription("Configurar canales del bot")
        .addChannelOption((o) => o.setName("war_alerts").setDescription("Canal #war-alerts"))
        .addChannelOption((o) => o.setName("attack_orders").setDescription("Canal #attack-orders"))
        .addChannelOption((o) => o.setName("defense_orders").setDescription("Canal #defense-orders"))
        .addChannelOption((o) => o.setName("resource_requests").setDescription("Canal #resource-requests"))
        .addChannelOption((o) => o.setName("player_verification").setDescription("Canal #player-verification"))
        .addChannelOption((o) => o.setName("mod_logs").setDescription("Canal #mod-logs")),
    )
    .addSubcommand((s) =>
      s.setName("status")
        .setDescription("Ver la configuración actual del servidor"),
    ),
].map((b) => b.toJSON());

export async function handleSetupCommand(interaction: ChatInputCommandInteraction): Promise<void> {
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

      const update: Record<string, string> = {};
      if (warAlerts) update["channels.warAlerts"] = warAlerts;
      if (attackOrders) update["channels.attackOrders"] = attackOrders;
      if (defenseOrders) update["channels.defenseOrders"] = defenseOrders;
      if (resourceRequests) update["channels.resourceRequests"] = resourceRequests;
      if (playerVerification) update["channels.playerVerification"] = playerVerification;
      if (modLogs) update["channels.modLogs"] = modLogs;

      await GuildConfig.findOneAndUpdate({ guildId }, { $set: update }, { upsert: true, new: true, setDefaultsOnInsert: true });

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

    } else if (sub === "status") {
      const config = await GuildConfig.findOne({ guildId });
      if (!config) {
        await interaction.reply({ content: "⚠️ Servidor no configurado. Usa `/setup alliance` primero.", ephemeral: true });
        return;
      }

      const chanField = (id?: string) => (id ? `<#${id}>` : "No configurado");

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`⚙️ Configuración — [${config.allianceTag}]`)
            .setColor(0x4488ff)
            .addFields(
              { name: "🚨 War Alerts", value: chanField(config.channels.warAlerts), inline: true },
              { name: "⚔️ Attack Orders", value: chanField(config.channels.attackOrders), inline: true },
              { name: "🛡️ Defense Orders", value: chanField(config.channels.defenseOrders), inline: true },
              { name: "📦 Resource Requests", value: chanField(config.channels.resourceRequests), inline: true },
              { name: "🔍 Player Verification", value: chanField(config.channels.playerVerification), inline: true },
              { name: "📋 Mod Logs", value: chanField(config.channels.modLogs), inline: true },
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
