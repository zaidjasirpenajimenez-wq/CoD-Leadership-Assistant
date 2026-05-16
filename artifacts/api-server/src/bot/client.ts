import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  Events,
  ChatInputCommandInteraction,
  ButtonInteraction,
  Interaction,
} from "discord.js";
import { logger } from "../lib/logger";
import { connectMongo } from "../db/mongoose";

import { registerSentinel } from "./modules/sentinel";
import { registerVerificationListener } from "./modules/sweeperCommands";

import { modCommandDefs, handleModCommand } from "./modules/modCommands";
import { warCommandDefs, handleWarCommand, handleAlertButton } from "./modules/warCommands";
import { resourceCommandDefs, handleResourceCommand, handleResourceButton } from "./modules/resourceCommands";
import { sweeperCommandDefs, handleSweeperCommand } from "./modules/sweeperCommands";
import { diplomacyCommandDefs, handleDiplomacyCommand } from "./modules/diplomacyCommands";
import { setupCommandDefs, handleSetupCommand } from "./modules/setupCommands";

const ALL_COMMANDS = [
  ...modCommandDefs,
  ...warCommandDefs,
  ...resourceCommandDefs,
  ...sweeperCommandDefs,
  ...diplomacyCommandDefs,
  ...setupCommandDefs,
];

let discordClient: Client | null = null;

export async function startBot(): Promise<void> {
  const token = process.env["DISCORD_TOKEN"];
  if (!token) {
    logger.warn("DISCORD_TOKEN not set — Discord bot disabled");
    return;
  }

  await connectMongo();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
  });

  discordClient = client;

  // Register event listeners
  registerSentinel(client);
  registerVerificationListener(client);

  client.once(Events.ClientReady, async (ready) => {
    logger.info({ tag: ready.user.tag }, "Discord bot online");

    // Register slash commands globally
    const rest = new REST({ version: "10" }).setToken(token);
    try {
      await rest.put(Routes.applicationCommands(ready.user.id), { body: ALL_COMMANDS });
      logger.info("Slash commands registered globally");
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleChatCommand(interaction as ChatInputCommandInteraction);
      } else if (interaction.isButton()) {
        await handleButton(interaction as ButtonInteraction);
      }
    } catch (err) {
      logger.error({ err }, "Unhandled interaction error");
    }
  });

  client.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error");
  });

  client.on(Events.ShardDisconnect, (event, shardId) => {
    logger.warn({ shardId, code: event.code }, "Discord shard disconnected — attempting resume");
  });

  // Auto-reconnect on disconnect
  client.on(Events.Invalidated, () => {
    logger.warn("Discord session invalidated — reconnecting in 10s");
    setTimeout(() => {
      client.login(token).catch((err) => logger.error({ err }, "Reconnect failed"));
    }, 10_000);
  });

  await client.login(token);
}

async function handleChatCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;

  switch (commandName) {
    case "mod":
      await handleModCommand(interaction);
      break;
    case "war":
      await handleWarCommand(interaction);
      break;
    case "request":
      await handleResourceCommand(interaction);
      break;
    case "roster":
      await handleSweeperCommand(interaction);
      break;
    case "diplomacy":
      await handleDiplomacyCommand(interaction);
      break;
    case "setup":
      await handleSetupCommand(interaction);
      break;
    default:
      await interaction.reply({ content: "Comando no reconocido.", ephemeral: true });
  }
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  if (customId.startsWith("alert_")) {
    await handleAlertButton(interaction);
  } else if (customId.startsWith("res_")) {
    await handleResourceButton(interaction);
  }
}

export function getDiscordClient(): Client | null {
  return discordClient;
}
