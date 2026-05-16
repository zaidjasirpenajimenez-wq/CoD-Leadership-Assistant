import { Router, Request, Response } from "express";
import { GuildConfig, UserProfile, IntelData, DiplomacyPact } from "../db/schemas";
import { isMongoConnected } from "../db/mongoose";
import { logger } from "../lib/logger";

const router = Router();

// Public: list all guilds/alliances (basic stats)
router.get("/api/dashboard/guilds", async (req: Request, res: Response) => {
  if (!isMongoConnected()) {
    res.json({ guilds: [], error: "Database not connected" });
    return;
  }
  try {
    const configs = await GuildConfig.find({}).select("guildId allianceTag updatedAt").lean();
    res.json({ guilds: configs });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/guilds error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Public: guild stats by guildId
router.get("/api/dashboard/guilds/:guildId", async (req: Request, res: Response) => {
  if (!isMongoConnected()) {
    res.status(503).json({ error: "Database not connected" });
    return;
  }
  try {
    const { guildId } = req.params;
    const [config, memberCount, warnedCount, pacts] = await Promise.all([
      GuildConfig.findOne({ guildId }).lean(),
      UserProfile.countDocuments({ guildId }),
      UserProfile.countDocuments({ guildId, warns: { $gt: 0 } }),
      DiplomacyPact.find({ guildId }).lean(),
    ]);

    if (!config) {
      res.status(404).json({ error: "Guild not found" });
      return;
    }

    res.json({ config, memberCount, warnedCount, pacts });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/guilds/:guildId error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Master intel: recent attack intel across all guilds (protected by master key check on frontend)
router.get("/api/dashboard/intel", async (req: Request, res: Response) => {
  const masterKey = req.headers["x-master-key"];
  if (masterKey !== "COD_MASTER_INTEL") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isMongoConnected()) {
    res.status(503).json({ error: "Database not connected" });
    return;
  }
  try {
    const intel = await IntelData.find({})
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();
    res.json({ intel });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/intel error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Master intel: diplomacy across all guilds
router.get("/api/dashboard/diplomacy", async (req: Request, res: Response) => {
  const masterKey = req.headers["x-master-key"];
  if (masterKey !== "COD_MASTER_INTEL") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isMongoConnected()) {
    res.status(503).json({ error: "Database not connected" });
    return;
  }
  try {
    const pacts = await DiplomacyPact.find({}).sort({ createdAt: -1 }).lean();
    const guilds = await GuildConfig.find({}).select("guildId allianceTag").lean();
    const guildMap = Object.fromEntries(guilds.map((g) => [g.guildId, g.allianceTag]));
    res.json({ pacts, guildMap });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/diplomacy error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Master intel: member roster across all guilds
router.get("/api/dashboard/members", async (req: Request, res: Response) => {
  const masterKey = req.headers["x-master-key"];
  if (masterKey !== "COD_MASTER_INTEL") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isMongoConnected()) {
    res.status(503).json({ error: "Database not connected" });
    return;
  }
  try {
    const members = await UserProfile.find({}).sort({ power: -1 }).limit(500).lean();
    res.json({ members });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/members error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
