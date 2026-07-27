import { createWorker, Worker } from "tesseract.js";
import { logger } from "../lib/logger";

let workerInstance: Worker | null = null;

// Mutex: queue OCR requests to prevent concurrent worker access (Tesseract is single-threaded)
let ocrQueue: Promise<unknown> = Promise.resolve();

export async function getOcrWorker(): Promise<Worker> {
  if (!workerInstance) {
    workerInstance = await createWorker("eng", 1, {
      logger: () => {},
    });
  }
  return workerInstance;
}

export async function processImageOcr(imageUrl: string): Promise<string> {
  const result = ocrQueue.then(async () => {
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
  });
  // Chain the queue so the next call waits for this one, but don't let
  // a rejection in this call block the queue permanently.
  ocrQueue = result.catch(() => {});
  return result as Promise<string>;
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
  gameServer: string | null;
}

export function parseProfileFromText(text: string): ProfileScan {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const result: ProfileScan = { characterId: null, ign: null, gameServer: null };

  // Helper: normalize OCR artifacts in a line before reading numbers
  const norm = (s: string) => s.replace(/[Ol]/g, "0").replace(/[Ii]/g, "1");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── #NNN format → always server number (highest priority) ───────────────
    if (!result.gameServer) {
      const hashMatch = line.match(/^#(\d{3,5})$/);
      if (hashMatch) {
        result.gameServer = hashMatch[1];
        continue;
      }
    }

    // ── Servidor / Server label → number on the SAME or NEXT line ──────────
    if (!result.gameServer) {
      // "Servidor: 1234" or "Server 1234" or "Servidor #1234" on same line
      const inLine = line.match(/(?:servidor|server)[:\s#]*(\d{3,5})/i);
      if (inLine) {
        result.gameServer = inLine[1];
      } else if (/^(servidor|server)$/i.test(line)) {
        // Label alone → value on next line, may have # prefix
        const nextRaw  = lines[i + 1] ?? "";
        const nextNum  = nextRaw.match(/^#?(\d{3,12})$/);
        if (nextNum) {
          const n = nextNum[1];
          if (n.length <= 5) {
            result.gameServer = n;
          } else if (!result.characterId) {
            result.characterId = norm(n);
          }
          i++;
        }
      }
    }

    // ── Character ID label → number on the SAME or NEXT line ───────────────
    if (!result.characterId) {
      if (/(?:character\s*id|id\s*personaje|id\s*jugador|player\s*id|uid)[:\s]*/i.test(line)) {
        // Value may be on same line after the label
        const inLine = norm(line).match(/(\d{6,})/);
        if (inLine) {
          result.characterId = inLine[1];
        } else {
          // Or on the next line
          const nextNorm = norm(lines[i + 1] ?? "");
          const nextNum  = nextNorm.match(/^(\d{6,})$/);
          if (nextNum) {
            result.characterId = nextNum[1];
            i++;
          }
        }
      }
    }

    // ── IGN label ───────────────────────────────────────────────────────────
    if (/^(name|ign|player|character|lord|nombre)[\s:]/i.test(line)) {
      const ign = line.replace(/^(name|ign|player|character|lord|nombre)[\s:]*/i, "").trim();
      if (ign.length > 1) result.ign = ign;
    }
  }

  // ── Fallback: any 8+ digit number not already assigned ──────────────────
  // Only used if the label-based approach found nothing
  if (!result.characterId) {
    for (const line of lines) {
      const n = norm(line);
      const m = n.match(/\b(\d{8,})\b/);
      if (m) { result.characterId = m[1]; break; }
    }
  }

  // ── Fallback server: standalone 3-5 digit line near top of text ─────────
  if (!result.gameServer) {
    for (const line of lines.slice(0, 10)) {
      const m = line.match(/^#?(\d{3,5})$/);
      if (m) { result.gameServer = m[1]; break; }
    }
  }

  // ── Fallback IGN: first non-numeric, non-keyword line ───────────────────
  if (!result.ign) {
    const candidate = lines.find(
      (l) => !/^\d+$/.test(l) && l.length > 1 && !/^(server|servidor|srv)/i.test(l),
    );
    if (candidate) result.ign = candidate;
  }

  return result;
}
