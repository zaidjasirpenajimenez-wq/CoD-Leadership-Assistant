import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  Events,
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
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
import {
  communicationCommandDefs,
  handleAnnouncementCommand,
  handleEventCommand,
  handleCommunicationModal,
  handleCommunicationButton,
} from "./modules/communicationCommands";
import {
  operationsCommandDefs,
  handleOperationsCommand,
  handleOperationsButton,
} from "./modules/operationsCommands";
import {
  pointsCommandDefs,
  handlePerfilCommand,
  handlePointsCommand,
  handleBoxCommand,
} from "./modules/pointsCommands";
import { kvkCommandDefs, handleKvkCommand } from "./modules/kvkCommands";
import { sanctionCommandDefs, handleSanctionCommand } from "./modules/sanctionCommands";
import { rallyCommandDefs, handleRallyCommand, handleRallyButton } from "./modules/rallyCommands";
import { sosCommandDefs, handleSosCommand, handleSosButton } from "./modules/sosCommands";
import { timerCommandDefs, handleTimerCommand, startScheduler, startWeeklyLeaderboard, startInactivityChecker } from "./modules/timerCommands";
import { leaderboardCommandDefs, handleLeaderboardCommand } from "./modules/leaderboardCommands";
import { statsCommandDefs, handleStatsCommand } from "./modules/statsCommands";
import { memberCommandDefs, handleMemberCommand } from "./modules/memberCommands";

const ALL_COMMANDS = [
  ...modCommandDefs,
  ...warCommandDefs,
  ...resourceCommandDefs,
  ...sweeperCommandDefs,
  ...diplomacyCommandDefs,
  ...setupCommandDefs,
  ...communicationCommandDefs,
  ...operationsCommandDefs,
  ...pointsCommandDefs,
  ...kvkCommandDefs,
  ...sanctionCommandDefs,
  ...rallyCommandDefs,
  ...sosCommandDefs,
  ...timerCommandDefs,
  ...leaderboardCommandDefs,
  ...statsCommandDefs,
  ...memberCommandDefs,
];

let discordClient: Client | null = null;

export function getDiscordClient(): Client | null {
  return discordClient;
}

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

  registerSentinel(client);
  registerVerificationListener(client);

  client.once(Events.ClientReady, async (ready) => {
    logger.info({ tag: ready.user.tag }, "Discord bot online");

    const rest = new REST({ version: "10" }).setToken(token);
    try {
      await rest.put(Routes.applicationCommands(ready.user.id), { body: ALL_COMMANDS });
      logger.info({ count: ALL_COMMANDS.length }, "Slash commands registered globally");
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }

    // Start lightweight background schedulers
    startScheduler(client);
    startWeeklyLeaderboard(client);
    startInactivityChecker(client);
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleChatCommand(interaction as ChatInputCommandInteraction);
      } else if (interaction.isButton()) {
        await handleButton(interaction as ButtonInteraction);
      } else if (interaction.isModalSubmit()) {
        await handleModal(interaction as ModalSubmitInteraction);
      }
    } catch (err) {
      logger.error({ err }, "Unhandled interaction error");
    }
  });

  client.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error");
  });

  client.on(Events.ShardDisconnect, (event, shardId) => {
    logger.warn({ shardId, code: event.code }, "Discord shard disconnected");
  });

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
    // ── Original modules ──────────────────────────────────────────────────
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
    // ── Communication ─────────────────────────────────────────────────────
    case "announcement":
      await handleAnnouncementCommand(interaction);
      break;
    case "event":
      await handleEventCommand(interaction);
      break;
    // ── Operations ────────────────────────────────────────────────────────
    case "raid":
    case "building":
      await handleOperationsCommand(interaction);
      break;
    // ── Points ────────────────────────────────────────────────────────────
    case "perfil":
      await handlePerfilCommand(interaction);
      break;
    case "points":
      await handlePointsCommand(interaction);
      break;
    case "box":
      await handleBoxCommand(interaction);
      break;
    // ── KVK Tracker ───────────────────────────────────────────────────────
    case "kvk":
      await handleKvkCommand(interaction);
      break;
    // ── Libro de Sanciones ────────────────────────────────────────────────
    case "sanction":
      await handleSanctionCommand(interaction);
      break;
    // ── Rally Coordinator ─────────────────────────────────────────────────
    case "rally":
      await handleRallyCommand(interaction);
      break;
    // ── SOS Emergencia ────────────────────────────────────────────────────
    case "sos":
      await handleSosCommand(interaction);
      break;
    // ── Timers / Recordatorios ────────────────────────────────────────────
    case "timer":
      await handleTimerCommand(interaction);
      break;
    // ── Leaderboard ───────────────────────────────────────────────────────
    case "leaderboard":
      await handleLeaderboardCommand(interaction);
      break;
    // ── Estadísticas globales ─────────────────────────────────────────────
    case "stats":
      await handleStatsCommand(interaction);
      break;
    // ── Gestión de miembros ───────────────────────────────────────────────
    case "member":
      await handleMemberCommand(interaction);
      break;
    default:
      await interaction.reply({ content: "Comando no reconocido.", ephemeral: true });
  }
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  if (customId.startsWith("alert_")) {
    await handleAlertButton(interaction);
  } else if (customId.startsWith("res_") || customId.startsWith("sres_")) {
    await handleResourceButton(interaction);
  } else if (customId.startsWith("ann_") || customId.startsWith("evt_")) {
    await handleCommunicationButton(interaction);
  } else if (customId.startsWith("raid_") || customId.startsWith("build_")) {
    await handleOperationsButton(interaction);
  } else if (customId.startsWith("rally_join:") || customId.startsWith("rally_leave:")) {
    await handleRallyButton(interaction);
  } else if (customId.startsWith("sos_go:")) {
    await handleSosButton(interaction);
  }
}

async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (
    interaction.customId === "modal_announcement" ||
    interaction.customId === "modal_event"
  ) {
    await handleCommunicationModal(interaction);
  }
}
