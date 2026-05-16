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
  };
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
    },
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
  verifiedAt: Date;
  updatedAt: Date;
}

const UserProfileSchema = new Schema<IUserProfile>(
  {
    discordId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    characterId: { type: String, required: true, unique: true },
    ign: { type: String, required: true },
    power: { type: Number, default: 0 },
    alliance: { type: String, default: "" },
    warns: { type: Number, default: 0 },
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
}

const DiplomacyPactSchema = new Schema<IDiplomacyPact>(
  {
    guildId: { type: String, required: true, index: true },
    targetAlliance: { type: String, required: true },
    pactType: { type: String, enum: ["NAP", "ALLY", "ENEMY", "BORDER"], required: true },
    details: { type: String, default: "" },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { strict: true },
);

export const DiplomacyPact: Model<IDiplomacyPact> =
  mongoose.models["DiplomacyPact"] ||
  mongoose.model<IDiplomacyPact>("DiplomacyPact", DiplomacyPactSchema);
