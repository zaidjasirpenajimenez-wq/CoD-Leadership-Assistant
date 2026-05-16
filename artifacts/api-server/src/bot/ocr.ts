import { createWorker, Worker } from "tesseract.js";
import { logger } from "../lib/logger";

let workerInstance: Worker | null = null;

export async function getOcrWorker(): Promise<Worker> {
  if (!workerInstance) {
    workerInstance = await createWorker("eng", 1, {
      logger: () => {},
    });
  }
  return workerInstance;
}

export async function processImageOcr(imageUrl: string): Promise<string> {
  const worker = await getOcrWorker();
  try {
    const { data } = await worker.recognize(imageUrl);
    return data.text;
  } catch (err) {
    logger.error({ err }, "OCR processing failed");
    throw err;
  } finally {
    // Free cached image data from memory after each run (anti-OOM)
    await worker.setParameters({
      preserve_interword_spaces: "0",
    });
  }
}

export async function terminateOcrWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
  }
}

export interface ResourceScan {
  wood: number | null;
  gold: number | null;
  ore: number | null;
  mana: number | null;
  hasMana: boolean;
}

export function parseResourcesFromText(text: string): ResourceScan {
  const lines = text.toLowerCase().split(/\n/);
  const result: ResourceScan = { wood: null, gold: null, ore: null, mana: null, hasMana: false };

  const numReg = /[\d,]+/g;

  function extractNum(keywords: string[]): number | null {
    for (const line of lines) {
      if (keywords.some((k) => line.includes(k))) {
        const nums = line.match(numReg);
        if (nums && nums.length > 0) {
          const n = parseInt(nums[nums.length - 1].replace(/,/g, ""), 10);
          if (!isNaN(n)) return n;
        }
      }
    }
    return null;
  }

  result.wood = extractNum(["wood", "madera", "lumber"]);
  result.gold = extractNum(["gold", "oro", "coins"]);
  result.ore = extractNum(["ore", "mineral", "stone", "iron"]);
  result.mana = extractNum(["mana"]);
  result.hasMana = result.mana !== null && result.mana > 0;

  return result;
}

export interface ProfileScan {
  characterId: string | null;
  ign: string | null;
}

export function parseProfileFromText(text: string): ProfileScan {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const result: ProfileScan = { characterId: null, ign: null };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Character ID: usually a large numeric string (8+ digits)
    const idMatch = line.match(/\b(\d{8,})\b/);
    if (idMatch && !result.characterId) {
      result.characterId = idMatch[1];
    }
    // IGN: look for "ID:" or "Name:" labels, or just pick the first clean string
    if (/^(name|ign|player|character|lord)[\s:]/i.test(line)) {
      const ign = line.replace(/^(name|ign|player|character|lord)[\s:]*/i, "").trim();
      if (ign.length > 1) result.ign = ign;
    }
  }

  // Fallback: ign = first non-numeric line
  if (!result.ign && lines.length > 0) {
    const candidate = lines.find((l) => !/^\d+$/.test(l) && l.length > 1);
    if (candidate) result.ign = candidate;
  }

  return result;
}
