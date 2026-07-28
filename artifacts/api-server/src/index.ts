import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot/client";
import { terminateOcrWorker } from "./bot/ocr";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

// Start the Discord bot (non-blocking)
startBot().catch((err) => {
  logger.error({ err }, "Bot startup failed");
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal: string) {
  logger.info({ signal }, "Shutdown signal received — cleaning up");
  await terminateOcrWorker().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
