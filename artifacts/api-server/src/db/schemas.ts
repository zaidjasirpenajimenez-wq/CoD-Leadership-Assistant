import mongoose, { Schema, Document, Model } from "mongoose";

// ── GuildConfig ──────────────────────────────────────────────────────────────
export interface IGuildConfig extends Document {
  guildId: string;
  allianceTag: string;
  channels: {
    warAlerts?: string;
    attackOrders?: string;
    defenseOrders?: string;
    resourceRequests?: string;
    playerVerification?: string;
    modLogs?: string;
    leaderboard?: string;
    announcements?: string;
    weeklyReport?: string;

    eventos?: string;
  };
  gameServerId?: string;
  guestRoleId?: string;
  memberRoleId?: string;
  inactiveDays: number;
  authorizedRoles: string[];
  lastWeeklyReportSent?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const GuildConfigSchema = new Schema<IGuildConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    allianceTag: { type: String, required: true, default: "GUILD" },
    channels: {
      warAlerts: String,
      attackOrders: String,
      defenseOrders: String,
      resourceRequests: String,
      playerVerification: String,
      modLogs: String,
      leaderboard: String,
      announcements: String,
      weeklyReport: String,
      eventos: String,
    },
    gameServerId: { type: String, default: null },
    guestRoleId: { type: String, default: null },
    memberRoleId: { type: String, default: null },
    inactiveDays: { type: Number, default: 7 },
    authorizedRoles: [{ type: String }],
    lastWeeklyReportSent: { type: Number, default: null },
  },
  { timestamps: true, strict: true },
);

export const GuildConfig: Model<IGuildConfig> =
  mongoose.models["GuildConfig"] ||
  mongoose.model<IGuildConfig>("GuildConfig", GuildConfigSchema);

// ── UserProfile ──────────────────────────────────────────────────────────────
export interface IUserProfile extends Document {
  discordId: string;
  guildId: string;
  characterId: string;
  ign: string;
  power: number;
  alliance: string;
  warns: number;
  weeklyPoints: number;
  totalPoints: number;
  eventsAttended: number;
  lastActivity: Date;
  verifiedAt: Date;
  updatedAt: Date;
}

const UserProfileSchema = new Schema<IUserProfile>(
  {
    discordId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    characterId: { type: String, default: "" },
    ign: { type: String, default: "" },
    power: { type: Number, default: 0 },
    alliance: { type: String, default: "" },
    warns: { type: Number, default: 0 },
    weeklyPoints: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    eventsAttended: { type: Number, default: 0 },
    lastActivity: { type: Date, default: Date.now, index: true },
    verifiedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, strict: true },
);

export const UserProfile: Model<IUserProfile> =
  mongoose.models["UserProfile"] ||
  mongoose.model<IUserProfile>("UserProfile", UserProfileSchema);

// ── DiplomacyPact ────────────────────────────────────────────────────────────
export interface IDiplomacyPact extends Document {
  guildId: string;
  targetAlliance: string;
  pactType: "NAP" | "ALLY" | "ENEMY" | "BORDER";
  details: string;
  createdBy: string;
  createdAt: Date;
  expiresAt?: Date;
}

const DiplomacyPactSchema = new Schema<IDiplomacyPact>(
  {
    guildId: { type: String, required: true, index: true },
    targetAlliance: { type: String, required: true },
    pactType: { type: String, enum: ["NAP", "ALLY", "ENEMY", "BORDER"], required: true },
    details: { type: String, default: "" },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
  },
  { strict: true },
);

export const DiplomacyPact: Model<IDiplomacyPact> =
  mongoose.models["DiplomacyPact"] ||
  mongoose.model<IDiplomacyPact>("DiplomacyPact", DiplomacyPactSchema);

// ── KvkRecord ────────────────────────────────────────────────────────────────
export interface IKvkRecord extends Document {
  guildId: string;
  seasonName: string;
  discordId: string;
  kills: number;
  deaths: number;
  powerDestroyed: number;
  score: number;
  updatedAt: Date;
}

const KvkRecordSchema = new Schema<IKvkRecord>(
  {
    guildId: { type: String, required: true, index: true },
    seasonName: { type: String, required: true },
    discordId: { type: String, required: true, index: true },
    kills: { type: Number, default: 0 },
    deaths: { type: Number, default: 0 },
    powerDestroyed: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
  },
  { timestamps: true, strict: true },
);

export const KvkRecord: Model<IKvkRecord> =
  mongoose.models["KvkRecord"] ||
  mongoose.model<IKvkRecord>("KvkRecord", KvkRecordSchema);

// ── SanctionRecord ───────────────────────────────────────────────────────────
export interface ISanctionRecord extends Document {
  guildId: string;
  discordId: string;
  type: "FALTA_GUERRA" | "AUSENCIA_EVENTO" | "PENALIZACION" | "OTRO";
  reason: string;
  addedBy: string;
  createdAt: Date;
}

const SanctionRecordSchema = new Schema<ISanctionRecord>(
  {
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ["FALTA_GUERRA", "AUSENCIA_EVENTO", "PENALIZACION", "OTRO"],
      required: true,
    },
    reason: { type: String, required: true },
    addedBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { strict: true },
);

export const SanctionRecord: Model<ISanctionRecord> =
  mongoose.models["SanctionRecord"] ||
  mongoose.model<ISanctionRecord>("SanctionRecord", SanctionRecordSchema);

// ── ResourceRequestLog ───────────────────────────────────────────────────────
export interface IResourceRequestLog extends Document {
  guildId: string;
  requesterId: string;
  requesterName: string;
  donorId?: string;
  proposito: string;
  madera: number;
  piedra: number;
  oro: number;
  status: "done" | "cancelled";
  createdAt: Date;
  closedAt: Date;
}

const ResourceRequestLogSchema = new Schema<IResourceRequestLog>(
  {
    guildId:       { type: String, required: true, index: true },
    requesterId:   { type: String, required: true, index: true },
    requesterName: { type: String, default: "" },
    donorId:       { type: String, default: null },
    proposito:     { type: String, default: "" },
    madera:        { type: Number, default: 0 },
    piedra:        { type: Number, default: 0 },
    oro:           { type: Number, default: 0 },
    status:        { type: String, enum: ["done", "cancelled"], required: true },
    createdAt:     { type: Date, default: Date.now },
    closedAt:      { type: Date, default: Date.now },
  },
  { strict: true },
);

export const ResourceRequestLog: Model<IResourceRequestLog> =
  mongoose.models["ResourceRequestLog"] ||
  mongoose.model<IResourceRequestLog>("ResourceRequestLog", ResourceRequestLogSchema);

// ── WarAlertLog ──────────────────────────────────────────────────────────────
export interface IWarAlertLog extends Document {
  guildId: string;
  priority: string;
  details: string;
  createdBy: string;
  attendees: Array<{ userId: string; pts: number }>;
  readyCount: number;
  lateCount: number;
  totalPts: number;
  createdAt: Date;
  closedAt: Date;
}

const WarAlertLogSchema = new Schema<IWarAlertLog>(
  {
    guildId:    { type: String, required: true, index: true },
    priority:   { type: String, default: "Medium" },
    details:    { type: String, default: "" },
    createdBy:  { type: String, default: "" },
    attendees:  [{ userId: { type: String }, pts: { type: Number } }],
    readyCount: { type: Number, default: 0 },
    lateCount:  { type: Number, default: 0 },
    totalPts:   { type: Number, default: 0 },
    createdAt:  { type: Date, default: Date.now },
    closedAt:   { type: Date, default: Date.now },
  },
  { strict: true },
);

export const WarAlertLog: Model<IWarAlertLog> =
  mongoose.models["WarAlertLog"] ||
  mongoose.model<IWarAlertLog>("WarAlertLog", WarAlertLogSchema);

// ── ScheduledTimer ───────────────────────────────────────────────────────────
export interface IScheduledTimer extends Document {
  guildId: string;
  channelId: string;
  message: string;
  fireAt: Date;
  fired: boolean;
  createdBy: string;
  repeat?: "weekly";
}

const ScheduledTimerSchema = new Schema<IScheduledTimer>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    message: { type: String, required: true },
    fireAt: { type: Date, required: true, index: true },
    fired: { type: Boolean, default: false },
    createdBy: { type: String, required: true },
    repeat: { type: String, enum: ["weekly"], default: null },
  },
  { strict: true },
);

export const ScheduledTimer: Model<IScheduledTimer> =
  mongoose.models["ScheduledTimer"] ||
  mongoose.model<IScheduledTimer>("ScheduledTimer", ScheduledTimerSchema);

// ── BlacklistEntry ────────────────────────────────────────────────────────────
export interface IBlacklistEntry extends Document {
  guildId: string;
  ign: string;
  reason: string;
  notes: string;
  addedBy: string;
  addedAt: Date;
}

const BlacklistEntrySchema = new Schema<IBlacklistEntry>(
  {
    guildId: { type: String, required: true, index: true },
    ign:     { type: String, required: true },
    reason:  { type: String, required: true },
    notes:   { type: String, default: "" },
    addedBy: { type: String, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { strict: true },
);
BlacklistEntrySchema.index({ guildId: 1, ign: 1 });

export const BlacklistEntry: Model<IBlacklistEntry> =
  mongoose.models["BlacklistEntry"] ||
  mongoose.model<IBlacklistEntry>("BlacklistEntry", BlacklistEntrySchema);

// ── AllianceEvent ─────────────────────────────────────────────────────────────
export interface IAllianceEvent extends Document {
  guildId: string;
  title: string;
  description: string;
  tipo: string;
  scheduledFor: Date;
  channelId: string;
  messageId: string;
  createdBy: string;
  confirmed: string[];
  declined: string[];
  maybe: string[];
  reminderSent: boolean;
  closed: boolean;
  createdAt: Date;
}

const AllianceEventSchema = new Schema<IAllianceEvent>(
  {
    guildId:      { type: String, required: true, index: true },
    title:        { type: String, required: true },
    description:  { type: String, required: true },
    tipo:         { type: String, default: "general" },
    scheduledFor: { type: Date, required: true, index: true },
    channelId:    { type: String, required: true },
    messageId:    { type: String, required: true },
    createdBy:    { type: String, required: true },
    confirmed:    [{ type: String }],
    declined:     [{ type: String }],
    maybe:        [{ type: String }],
    reminderSent: { type: Boolean, default: false },
    closed:       { type: Boolean, default: false },
  },
  { timestamps: true, strict: true },
);

export const AllianceEvent: Model<IAllianceEvent> =
  mongoose.models["AllianceEvent"] ||
  mongoose.model<IAllianceEvent>("AllianceEvent", AllianceEventSchema);

// ── AlliancePoll ──────────────────────────────────────────────────────────────
export interface IAlliancePoll extends Document {
  guildId: string;
  question: string;
  options: string[];
  votes: Map<string, number>;
  messageId: string;
  channelId: string;
  endsAt: Date;
  createdBy: string;
  closed: boolean;
  createdAt: Date;
}

const AlliancePollSchema = new Schema<IAlliancePoll>(
  {
    guildId:   { type: String, required: true, index: true },
    question:  { type: String, required: true },
    options:   [{ type: String }],
    votes:     { type: Map, of: Number, default: {} },
    messageId: { type: String, required: true },
    channelId: { type: String, required: true },
    endsAt:    { type: Date, required: true, index: true },
    createdBy: { type: String, required: true },
    closed:    { type: Boolean, default: false },
  },
  { timestamps: true, strict: true },
);

export const AlliancePoll: Model<IAlliancePoll> =
  mongoose.models["AlliancePoll"] ||
  mongoose.model<IAlliancePoll>("AlliancePoll", AlliancePollSchema);

// ── MissionClaim ──────────────────────────────────────────────────────────────
export interface IMissionClaim extends Document {
  guildId: string;
  discordId: string;
  weekKey: string;
  claimedAt: Date;
}

const MissionClaimSchema = new Schema<IMissionClaim>(
  {
    guildId:   { type: String, required: true, index: true },
    discordId: { type: String, required: true },
    weekKey:   { type: String, required: true },
    claimedAt: { type: Date, default: Date.now },
  },
  { strict: true },
);
MissionClaimSchema.index({ guildId: 1, discordId: 1, weekKey: 1 }, { unique: true });

export const MissionClaim: Model<IMissionClaim> =
  mongoose.models["MissionClaim"] ||
  mongoose.model<IMissionClaim>("MissionClaim", MissionClaimSchema);
