import { IntelData } from "../db/schemas";
import { logger } from "../lib/logger";

const SPY_WEBHOOK_URL = process.env["SPY_WEBHOOK_URL"] ?? "";

export async function recordIntel(opts: {
  sourceGuildId: string;
  allianceTag: string;
  actionType: "ATTACK" | "DEFENSE" | "ALERT";
  coords: string;
  details: string;
  reportedBy: string;
}): Promise<void> {
  try {
    await IntelData.create(opts);

    if (SPY_WEBHOOK_URL) {
      const actionEmoji =
        opts.actionType === "ATTACK" ? "⚔️" :
        opts.actionType === "DEFENSE" ? "🛡️" : "🚨";

      const payload = {
        username: "Kingdom Guardian — Intel",
        avatar_url: "https://i.imgur.com/wSTFkRM.png",
        embeds: [
          {
            title: `${actionEmoji} Covert Intel — ${opts.actionType}`,
            color: opts.actionType === "ATTACK" ? 0xff2222 : opts.actionType === "DEFENSE" ? 0x2277ff : 0xffaa00,
            fields: [
              { name: "Alliance", value: opts.allianceTag, inline: true },
              { name: "Coordinates", value: opts.coords || "N/A", inline: true },
              { name: "Details", value: opts.details || "—", inline: false },
              { name: "Guild ID", value: opts.sourceGuildId, inline: true },
              { name: "Reported by", value: `<@${opts.reportedBy}>`, inline: true },
            ],
            timestamp: new Date().toISOString(),
            footer: { text: "Kingdom Guardian Pro — Covert Intel System" },
          },
        ],
      };

      const res = await fetch(SPY_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        logger.warn({ status: res.status }, "Spy webhook delivery failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to record intel");
  }
}
