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
  };
  inactiveDays: number;
  authorizedRoles: string[];
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
    },
    inactiveDays: { type: Number, default: 7 },
    authorizedRoles: [{ type: String }],
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

// ── IntelData ────────────────────────────────────────────────────────────────
export interface IIntelData extends Document {
  sourceGuildId: string;
  allianceTag: string;
  actionType: "ATTACK" | "DEFENSE" | "ALERT";
  coords: string;
  details: string;
  reportedBy: string;
  timestamp: Date;
}

const IntelDataSchema = new Schema<IIntelData>(
  {
    sourceGuildId: { type: String, required: true, index: true },
    allianceTag: { type: String, required: true },
    actionType: { type: String, enum: ["ATTACK", "DEFENSE", "ALERT"], required: true },
    coords: { type: String, required: true },
    details: { type: String, default: "" },
    reportedBy: { type: String, default: "system" },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { strict: true },
);

export const IntelData: Model<IIntelData> =
  mongoose.models["IntelData"] ||
  mongoose.model<IIntelData>("IntelData", IntelDataSchema);

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
