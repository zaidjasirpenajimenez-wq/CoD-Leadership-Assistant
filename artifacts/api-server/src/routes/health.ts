import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isMongoConnected } from "../db/mongoose";
import { getDiscordClient } from "../bot/client";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const client = getDiscordClient();
  const data = HealthCheckResponse.parse({
    status: isMongoConnected() && client?.isReady() ? "ok" : "degraded",
  });
  res.json({
    ...data,
    mongo: isMongoConnected() ? "connected" : "disconnected",
    discord: client?.isReady() ? "online" : "offline",
  });
});

export default router;
