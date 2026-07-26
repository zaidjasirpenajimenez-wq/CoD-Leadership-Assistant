import { Router, Request, Response } from "express";
import {
  GuildConfig,
  UserProfile,
  IntelData,
  DiplomacyPact,
  SanctionRecord,
  KvkRecord,
  SpyReport,
  BlacklistEntry,
  AllianceEvent,
  AlliancePoll,
  MissionClaim,
} from "../db/schemas";
import { isMongoConnected } from "../db/mongoose";
import { logger } from "../lib/logger";
import { getDiscordClient } from "../bot/client";

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

// Returns all servers the bot is currently in, merged with MongoDB config data
router.get("/api/dashboard/bot-guilds", async (req: Request, res: Response) => {
  try {
    const discordClient = getDiscordClient();
    if (!discordClient) {
      res.json({ guilds: [] });
      return;
    }

    // Fetch MongoDB configs for guilds that have run /setup alliance
    let configs: Array<{ guildId: string; allianceTag: string }> = [];
    if (isMongoConnected()) {
      configs = await GuildConfig.find({}).select("guildId allianceTag").lean();
    }
    const configMap = new Map(configs.map((c) => [c.guildId, c.allianceTag]));

    const guilds = discordClient.guilds.cache.map((g) => ({
      guildId: g.id,
      name: g.name,
      icon: g.iconURL({ size: 64 }) ?? null,
      memberCount: g.memberCount,
      allianceTag: configMap.get(g.id) ?? null,
      configured: configMap.has(g.id),
    }));

    // Sort: configured first, then by member count
    guilds.sort((a, b) => {
      if (a.configured && !b.configured) return -1;
      if (!a.configured && b.configured) return 1;
      return b.memberCount - a.memberCount;
    });

    res.json({ guilds });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/bot-guilds error");
    res.status(500).json({ error: "Internal server error" });
  }
});

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

// ── Admin — Spy Reports ───────────────────────────────────────────────────────

router.get("/api/dashboard/spy-reports", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const { guildId, status } = req.query;
    const filter: Record<string, unknown> = {};
    if (guildId) filter.guildId = guildId;
    if (status) filter.status = status;
    const reports = await SpyReport.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    const guilds = await GuildConfig.find({}).select("guildId allianceTag").lean();
    const guildMap = Object.fromEntries(guilds.map((g) => [g.guildId, g.allianceTag]));
    res.json({ reports, guildMap });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/spy-reports error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/dashboard/spy-reports/:id", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const valid = ["open", "investigating", "cleared", "confirmed"];
    const { status } = req.body as { status: string };
    if (!valid.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
    const report = await SpyReport.findByIdAndUpdate(
      req.params.id,
      { status, reviewedBy: "admin-web" },
      { new: true },
    ).lean();
    if (!report) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true, report });
  } catch (err) {
    logger.error({ err }, "PATCH /api/dashboard/spy-reports/:id error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Admin — Blacklist ─────────────────────────────────────────────────────────

router.get("/api/dashboard/blacklist", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const { guildId } = req.query;
    const filter: Record<string, unknown> = {};
    if (guildId) filter.guildId = guildId;
    const entries = await BlacklistEntry.find(filter).sort({ addedAt: -1 }).limit(500).lean();
    const guilds = await GuildConfig.find({}).select("guildId allianceTag").lean();
    const guildMap = Object.fromEntries(guilds.map((g) => [g.guildId, g.allianceTag]));
    res.json({ entries, guildMap });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/blacklist error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/dashboard/blacklist", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const { guildId, ign, reason, notes } = req.body as Record<string, string>;
    if (!guildId || !ign || !reason) { res.status(400).json({ error: "guildId, ign and reason are required" }); return; }
    const entry = await BlacklistEntry.create({ guildId, ign: ign.trim(), reason, notes: notes ?? "", addedBy: "admin-web", addedAt: new Date() });
    res.status(201).json({ ok: true, entry });
  } catch (err) {
    logger.error({ err }, "POST /api/dashboard/blacklist error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/dashboard/blacklist/:id", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const entry = await BlacklistEntry.findByIdAndDelete(req.params.id).lean();
    if (!entry) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /api/dashboard/blacklist/:id error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Admin — Events ────────────────────────────────────────────────────────────

router.get("/api/dashboard/events", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const { guildId } = req.query;
    const filter: Record<string, unknown> = {};
    if (guildId) filter.guildId = guildId;
    const events = await AllianceEvent.find(filter).sort({ scheduledFor: -1 }).limit(100).lean();
    const guilds = await GuildConfig.find({}).select("guildId allianceTag").lean();
    const guildMap = Object.fromEntries(guilds.map((g) => [g.guildId, g.allianceTag]));
    res.json({ events, guildMap });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/events error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/dashboard/events/:id/cancel", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const event = await AllianceEvent.findByIdAndUpdate(req.params.id, { closed: true }, { new: true }).lean();
    if (!event) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true, event });
  } catch (err) {
    logger.error({ err }, "PATCH /api/dashboard/events/:id/cancel error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Admin — Polls ─────────────────────────────────────────────────────────────

router.get("/api/dashboard/polls", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const { guildId } = req.query;
    const filter: Record<string, unknown> = {};
    if (guildId) filter.guildId = guildId;
    const polls = await AlliancePoll.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    const guilds = await GuildConfig.find({}).select("guildId allianceTag").lean();
    const guildMap = Object.fromEntries(guilds.map((g) => [g.guildId, g.allianceTag]));
    res.json({ polls, guildMap });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/polls error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/dashboard/polls/:id/close", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const poll = await AlliancePoll.findByIdAndUpdate(req.params.id, { closed: true }, { new: true }).lean();
    if (!poll) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true, poll });
  } catch (err) {
    logger.error({ err }, "PATCH /api/dashboard/polls/:id/close error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Admin — Missions ──────────────────────────────────────────────────────────

router.get("/api/dashboard/missions", async (req: Request, res: Response) => {
  if (!requireMaster(req, res) || !requireMongo(res)) return;
  try {
    const { guildId } = req.query;
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const weekKey = `${startOfWeek.getFullYear()}-W${String(Math.ceil(startOfWeek.getDate() / 7)).padStart(2, "0")}`;

    const filter: Record<string, unknown> = { weekKey };
    if (guildId) filter.guildId = guildId;
    const claims = await MissionClaim.find(filter).sort({ claimedAt: -1 }).lean();
    const guilds = await GuildConfig.find({}).select("guildId allianceTag").lean();
    const guildMap = Object.fromEntries(guilds.map((g) => [g.guildId, g.allianceTag]));
    res.json({ claims, weekKey, guildMap });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/missions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Overview ──────────────────────────────────────────────────────────────────

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
