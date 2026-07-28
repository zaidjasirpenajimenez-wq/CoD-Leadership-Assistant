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
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  Interaction,
} from "discord.js";
import { logger } from "../lib/logger";
import { connectMongo } from "../db/mongoose";

import { registerSentinel } from "./modules/sentinel";
import { registerVerificationListener } from "./modules/sweeperCommands";

import { modCommandDefs, handleModCommand } from "./modules/modCommands";
import { warCommandDefs, handleWarCommand, handleAlertButton, handleAlertClose, handleAlertConfirmSelect, handleAlertExtraSelect } from "./modules/warCommands";
import { resourceCommandDefs, handleResourceCommand, handleResourceButton, handleResourceHistory, donateCommandDefs, handleDonateCommand } from "./modules/resourceCommands";
import { sweeperCommandDefs, handleSweeperCommand, registerGuestRoleAssigner } from "./modules/sweeperCommands";
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
import { sanctionCommandDefs, handleSanctionCommand } from "./modules/sanctionCommands";
import { sosCommandDefs, handleSosCommand, handleSosButton } from "./modules/sosCommands";
import { timerCommandDefs, handleTimerCommand, startScheduler, startWeeklyLeaderboard, startInactivityChecker } from "./modules/timerCommands";
import { leaderboardCommandDefs, handleLeaderboardCommand } from "./modules/leaderboardCommands";
import { statsCommandDefs, handleStatsCommand } from "./modules/statsCommands";
import { memberCommandDefs, handleMemberCommand } from "./modules/memberCommands";
import { startWeeklyReport } from "./modules/weeklyReport";
// ── New Tier 1 & 2 modules ────────────────────────────────────────────────────
import { blacklistCommandDefs, handleBlacklistCommand } from "./modules/blacklistCommands";
import { eventoCommandDefs, handleEventoCommand, handleEventoButton, startEventoScheduler } from "./modules/eventoCommands";
import { misionCommandDefs, handleMisionCommand } from "./modules/misionCommands";
import { pollCommandDefs, handlePollCommand, handlePollButton, startPollScheduler } from "./modules/pollCommands";
import { kvkCommandDefs, handleKvkCommand } from "./modules/kvkCommands";
import { rallyCommandDefs, handleRallyCommand, handleRallyButton } from "./modules/rallyCommands";

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
  ...sanctionCommandDefs,
  ...sosCommandDefs,
  ...timerCommandDefs,
  ...leaderboardCommandDefs,
  ...statsCommandDefs,
  ...memberCommandDefs,
  ...donateCommandDefs,
  // New
  ...blacklistCommandDefs,
  ...eventoCommandDefs,
  ...misionCommandDefs,
  ...pollCommandDefs,
  ...kvkCommandDefs,
  ...rallyCommandDefs,
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
  registerGuestRoleAssigner(client);

  client.once(Events.ClientReady, async (ready) => {
    logger.info({ tag: ready.user.tag }, "Discord bot online");

    const rest = new REST({ version: "10" }).setToken(token);
    try {
      await rest.put(Routes.applicationCommands(ready.user.id), { body: ALL_COMMANDS });
      logger.info({ count: ALL_COMMANDS.length }, "Slash commands registered globally");
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }

    // Start background schedulers
    startScheduler(client);
    startWeeklyLeaderboard(client);
    startInactivityChecker(client);
    startWeeklyReport(client);
    startEventoScheduler(client);
    startPollScheduler(client);
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleChatCommand(interaction as ChatInputCommandInteraction);
      } else if (interaction.isButton()) {
        await handleButton(interaction as ButtonInteraction);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction as StringSelectMenuInteraction);
      } else if (interaction.isUserSelectMenu()) {
        await handleUserSelectMenu(interaction as UserSelectMenuInteraction);
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
    // ── Moderación ────────────────────────────────────────────────────────
    case "mod":
      await handleModCommand(interaction);
      break;
    // ── Guerra ────────────────────────────────────────────────────────────
    case "war":
      await handleWarCommand(interaction);
      break;
    // ── Recursos ─────────────────────────────────────────────────────────
    case "request":
      if (interaction.options.getSubcommand() === "history") {
        await handleResourceHistory(interaction);
      } else {
        await handleResourceCommand(interaction);
      }
      break;
    case "donate":
      await handleDonateCommand(interaction);
      break;
    // ── Roster ────────────────────────────────────────────────────────────
    case "roster":
      await handleSweeperCommand(interaction);
      break;
    // ── Diplomacia ────────────────────────────────────────────────────────
    case "diplomacy":
      await handleDiplomacyCommand(interaction);
      break;
    // ── Configuración ─────────────────────────────────────────────────────
    case "setup":
      await handleSetupCommand(interaction);
      break;
    // ── Comunicación ──────────────────────────────────────────────────────
    case "announcement":
      await handleAnnouncementCommand(interaction);
      break;
    case "event":
      await handleEventCommand(interaction);
      break;
    // ── Operaciones ───────────────────────────────────────────────────────
    case "raid":
    case "building":
      await handleOperationsCommand(interaction);
      break;
    // ── Puntos y perfil ───────────────────────────────────────────────────
    case "perfil":
      await handlePerfilCommand(interaction);
      break;
    case "points":
      await handlePointsCommand(interaction);
      break;
    case "box":
      await handleBoxCommand(interaction);
      break;
    // ── Sanciones ─────────────────────────────────────────────────────────
    case "sanction":
      await handleSanctionCommand(interaction);
      break;
    // ── SOS ───────────────────────────────────────────────────────────────
    case "sos":
      await handleSosCommand(interaction);
      break;
    // ── Timers ────────────────────────────────────────────────────────────
    case "timer":
      await handleTimerCommand(interaction);
      break;
    // ── Leaderboard ───────────────────────────────────────────────────────
    case "leaderboard":
      await handleLeaderboardCommand(interaction);
      break;
    // ── Estadísticas ──────────────────────────────────────────────────────
    case "stats":
      await handleStatsCommand(interaction);
      break;
    // ── Miembros ──────────────────────────────────────────────────────────
    case "member":
      await handleMemberCommand(interaction);
      break;
    // ── KVK ───────────────────────────────────────────────────────────────
    case "kvk":
      await handleKvkCommand(interaction);
      break;
    // ── Rally ─────────────────────────────────────────────────────────────
    case "rally":
      await handleRallyCommand(interaction);
      break;
    // ── Lista Negra ───────────────────────────────────────────────────────
    case "blacklist":
      await handleBlacklistCommand(interaction);
      break;
    // ── Tier 2: Eventos, Misiones, Polls ──────────────────────────────────
    case "evento":
      await handleEventoCommand(interaction);
      break;
    case "mision":
      await handleMisionCommand(interaction);
      break;
    case "poll":
      await handlePollCommand(interaction);
      break;
    default:
      await interaction.reply({ content: "Comando no reconocido.", ephemeral: true });
  }
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  if (customId.startsWith("alert_close:")) {
    await handleAlertClose(interaction);
  } else if (customId.startsWith("alert_")) {
    await handleAlertButton(interaction);
  } else if (customId.startsWith("res_") || customId.startsWith("sres_")) {
    await handleResourceButton(interaction);
  } else if (customId.startsWith("ann_") || customId.startsWith("evt_")) {
    // evt_ prefix used by both communicationCommands and eventoCommands — disambiguate
    if (customId.startsWith("evt_yes:") || customId.startsWith("evt_maybe:") || customId.startsWith("evt_no:")) {
      await handleEventoButton(interaction);
    } else {
      await handleCommunicationButton(interaction);
    }
  } else if (customId.startsWith("raid_") || customId.startsWith("build_")) {
    await handleOperationsButton(interaction);
  } else if (customId.startsWith("sos_go:")) {
    await handleSosButton(interaction);
  } else if (customId.startsWith("rally_")) {
    await handleRallyButton(interaction);
  } else if (customId.startsWith("poll_vote:")) {
    await handlePollButton(interaction);
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const customId = interaction.customId;

  if (customId.startsWith("alert_confirm_select:")) {
    await handleAlertConfirmSelect(interaction);
  }
}

async function handleUserSelectMenu(interaction: UserSelectMenuInteraction): Promise<void> {
  const customId = interaction.customId;

  if (customId.startsWith("alert_extra_select:")) {
    await handleAlertExtraSelect(interaction);
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
