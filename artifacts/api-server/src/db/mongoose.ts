import mongoose from "mongoose";
import { logger } from "../lib/logger";

let isConnected = false;

export async function connectMongo(): Promise<void> {
  if (isConnected) return;

  const uri = process.env["MONGODB_URI"];
  if (!uri) {
    logger.warn("MONGODB_URI not set — MongoDB features disabled");
    return;
  }

  mongoose.connection.on("connected", () => {
    isConnected = true;
    logger.info("MongoDB connected");
  });

  mongoose.connection.on("disconnected", () => {
    isConnected = false;
    logger.warn("MongoDB disconnected — attempting reconnect...");
    scheduleReconnect(uri);
  });

  mongoose.connection.on("error", (err) => {
    logger.error({ err }, "MongoDB error");
  });

  await attemptConnect(uri);
}

async function attemptConnect(uri: string): Promise<void> {
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
  } catch (err) {
    logger.error({ err }, "MongoDB initial connection failed — retrying in 5s");
    scheduleReconnect(uri);
  }
}

function scheduleReconnect(uri: string): void {
  setTimeout(() => attemptConnect(uri), 5000);
}

export function isMongoConnected(): boolean {
  return isConnected;
}
