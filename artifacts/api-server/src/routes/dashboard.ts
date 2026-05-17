import { Router, Request, Response } from "express";
import {
  GuildConfig,
  UserProfile,
  IntelData,
  DiplomacyPact,
  SanctionRecord,
  KvkRecord,
} from "../db/schemas";
import { isMongoConnected } from "../db/mongoose";
import { logger } from "../lib/logger";

const router = Router();

function requireMaster(req: Request, res: Response): boolean {
  if (req.headers["x-master-key"] !== "COD_MASTER_INTEL") {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function requireMongo(res: Response): boolean {
  if (!isMongoConnected()) {
    res.status(503).json({ error: "Database not connected" });
    return false;
  }
  return true;
}

// ── Public ────────────────────────────────────────────────────────────────────

router.get("/api/dashboard/guilds", async (req: Request, res: Response) => {
  if (!requireMongo(res)) return;
  try {
    const configs = await GuildConfig.find({}).select("guildId allianceTag updatedAt").lean();
    res.json({ guilds: configs });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/guilds error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/dashboard/guilds/:guildId", async (req: Request, res: Response) => {
  if (!requireMongo(res)) return;
  try {
    const { guildId } = req.params;
    const [config, memberCount, warnedCount, activeCount, pacts] = await Promise.all([
      GuildConfig.findOne({ guildId }).lean(),
      UserProfile.countDocuments({ guildId }),
      UserProfile.countDocuments({ guildId, warns: { $gt: 0 } }),
      UserProfile.countDocuments({ guildId, weeklyPoints: { $gt: 0 } }),
      DiplomacyPact.find({ guildId }).lean(),
    ]);
    if (!config) { res.status(404).json({ error: "Guild not found" }); return; }
    res.json({ config, memberCount, warnedCount, activeCount, pacts });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/guilds/:guildId error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/dashboard/guilds/:guildId/leaderboard", async (req: Request, res: Response) => {
  if (!requireMongo(res)) return;
  try {
    const { guildId } = req.params;
    const [weekly, allTime] = await Promise.all([
      UserProfile.find({ guildId, weeklyPoints: { $gt: 0 } })
        .sort({ weeklyPoints: -1 })
        .limit(20)
        .select("discordId ign weeklyPoints totalPoints eventsAttended")
        .lean(),
      UserProfile.find({ guildId, totalPoints: { $gt: 0 } })
        .sort({ totalPoints: -1 })
        .limit(20)
        .select("discordId ign weeklyPoints totalPoints eventsAttended")
        .lean(),
    ]);
    res.json({ weekly, allTime });
  } catch (err) {
    logger.error({ err }, "GET leaderboard error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Master — protected ────────────────────────────────────────────────────────

router.get("/api/dashboard/intel", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const intel = await IntelData.find({}).sort({ timestamp: -1 }).limit(200).lean();
    res.json({ intel });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/intel error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/dashboard/diplomacy", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
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

router.get("/api/dashboard/members", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const members = await UserProfile.find({}).sort({ power: -1 }).limit(500).lean();
    res.json({ members });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/members error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/dashboard/sanctions", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const sanctions = await SanctionRecord.find({}).sort({ createdAt: -1 }).limit(200).lean();
    const guilds = await GuildConfig.find({}).select("guildId allianceTag").lean();
    const guildMap = Object.fromEntries(guilds.map((g) => [g.guildId, g.allianceTag]));
    res.json({ sanctions, guildMap });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/sanctions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/dashboard/kvk", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const records = await KvkRecord.find({}).sort({ score: -1 }).limit(200).lean();
    const guilds = await GuildConfig.find({}).select("guildId allianceTag").lean();
    const guildMap = Object.fromEntries(guilds.map((g) => [g.guildId, g.allianceTag]));
    res.json({ records, guildMap });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/kvk error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/dashboard/inactivity", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const guilds = await GuildConfig.find({}).select("guildId allianceTag inactiveDays").lean();
    const guildMap = Object.fromEntries(guilds.map((g) => [g.guildId, g.allianceTag]));

    // Use 7 days as global threshold for the dashboard view
    const cutoff = new Date(Date.now() - 7 * 86_400_000);
    const inactive = await UserProfile.find({ lastActivity: { $lt: cutoff } })
      .sort({ lastActivity: 1 })
      .limit(200)
      .select("discordId ign guildId weeklyPoints totalPoints lastActivity")
      .lean();

    res.json({ inactive, guildMap });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/inactivity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/dashboard/overview", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const cutoff = new Date(Date.now() - 7 * 86_400_000);
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const [
      totalMembers, activeMembers, inactiveMembers,
      totalSanctions, sanctionsMonth,
      totalPacts, totalIntel,
    ] = await Promise.all([
      UserProfile.countDocuments({}),
      UserProfile.countDocuments({ weeklyPoints: { $gt: 0 } }),
      UserProfile.countDocuments({ lastActivity: { $lt: cutoff } }),
      SanctionRecord.countDocuments({}),
      SanctionRecord.countDocuments({ createdAt: { $gte: monthStart } }),
      DiplomacyPact.countDocuments({}),
      IntelData.countDocuments({}),
    ]);

    res.json({
      totalMembers, activeMembers, inactiveMembers,
      totalSanctions, sanctionsMonth,
      totalPacts, totalIntel,
    });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/overview error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
