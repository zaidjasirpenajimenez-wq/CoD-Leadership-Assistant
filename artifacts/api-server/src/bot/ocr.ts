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
    // PSM 11 = Sparse text: finds as much text as possible in any order.
    // Essential for game UI screenshots where text is scattered across the screen
    // (IGN, ID, server number, alliance — each in a different position/size).
    await workerInstance.setParameters({
      tessedit_pageseg_mode: "11" as unknown as string,
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
  alliance: string | null;
}

export function parseProfileFromText(text: string): ProfileScan {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const result: ProfileScan = { characterId: null, ign: null, gameServer: null, alliance: null };

  // Normalize OCR digit-substitution artifacts in a string
  const norm = (s: string) => s.replace(/[Ol]/g, "0").replace(/[Ii]/g, "1");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── "Lord" label (Call of Dragons) ─────────────────────────────────────
    // The word "Lord" appears as a label; the IGN is on the NEXT line.
    // The Character ID ("ID: 21503712") often appears on this same line.
    if (/\blord\b/i.test(line)) {
      if (!result.characterId) {
        // Search the RAW line — norm() would turn "I"→"1" making "ID" invisible to the regex.
        // Also accept "1D:" in case OCR itself misread the capital I as 1.
        const idMatch = line.match(/\b[I1]D[:\s]+(\d{6,})\b/i);
        if (idMatch) result.characterId = norm(idMatch[1]);
      }
      if (!result.ign) {
        // IGN may be inline ("Lord NfL Zxid") or on one of the next lines.
        // With PSM 11 there can be garbage tokens between "Lord" and the real IGN
        // (e.g. "(2", "y", "'") — skip any candidate that is too short or has
        // fewer than 2 actual letters.
        const letterCount = (s: string) => (s.match(/[a-záéíóúüñA-ZÁÉÍÓÚÜÑ]/g) ?? []).length;
        const isValidIgn = (s: string) =>
          s.length >= 3 &&
          !/^\d+$/.test(s) &&
          !/^(servidor|divis|alianza|poder|m[eé]rito|distinciones|perfil)/i.test(s) &&
          letterCount(s) >= 2;

        const inLine = line
          .replace(/\blord[\s:]*/i, "")
          .replace(/\b[I1]D[:\s]+\d+\b/gi, "")
          .trim();
        if (isValidIgn(inLine)) {
          result.ign = inLine;
        } else {
          // Scan up to 3 lines ahead for the first valid IGN candidate
          for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
            const candidate = lines[j].trim();
            if (isValidIgn(candidate)) {
              result.ign = candidate;
              i = j;
              break;
            }
          }
        }
      }
      continue;
    }

    // ── "Servidor" label (alone or combined with "División") → server on next line ──
    if (!result.gameServer && /^servidor\b/i.test(line)) {
      const nextRaw = lines[i + 1] ?? "";
      const nextHash = nextRaw.match(/#(\d{3,5})\b/);
      if (nextHash) { result.gameServer = nextHash[1]; i++; continue; }
      const nextNum = norm(nextRaw).match(/^(\d{3,5})$/);
      if (nextNum) { result.gameServer = nextNum[1]; i++; continue; }
    }

    // ── "Alianza" label → alliance name in the next few lines ───────────────
    // With PSM 11 each text element is on its own line, so "Facción" (the
    // right-column header) often appears between "Alianza" and "[-NFL]".
    // We scan up to 4 lines ahead, skipping any faction-related line.
    if (!result.alliance && /\balianza\b/i.test(line)) {
      for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
        const candidate = lines[j].trim();
        if (candidate.length === 0) continue;
        // Skip the "Facción" column header (OCR variants: Facción, Faccion, Faccón…)
        if (/^facc/i.test(candidate)) continue;
        // Stop if we've reached a known stats section
        if (/^(poder|m[eé]rito|servidor|distinciones)/i.test(candidate)) break;
        // Take bracket groups like [-NFL] or the first non-space token
        const clean = candidate.match(/^(\[[^\]]*\]|\S+)/);
        result.alliance = clean ? clean[1] : candidate.split(/\s{2,}/)[0];
        i = j;
        break;
      }
      continue;
    }

    // ── Numeric # tokens: server (#NNN) or character ID (#NNNNNNN) ──────────
    // Match on the RAW line (not normalized) so that Division codes like
    // "#50S7-9040" or "#SoS7-9040" — which contain letters — never match
    // /#([\d\-]{3,})/ and are therefore naturally excluded.
    // norm() is applied only to the extracted digit string (e.g. O→0, I→1).
    if (!result.gameServer || !result.characterId) {
      const tokens = [...line.matchAll(/#([\d\-]{3,})/g)];
      for (const tok of tokens) {
        const digits = norm(tok[1]).replace(/-/g, "");
        if (digits.length <= 5 && !result.gameServer) {
          result.gameServer = digits;
        } else if (digits.length >= 6 && !result.characterId) {
          result.characterId = digits;
        }
      }
    }

    // ── Bare "ID: XXXXXXXX" anywhere in the line ────────────────────────────
    // Use the RAW line (not norm'd) — norm() turns "I"→"1" which breaks /ID/.
    // Also accept "1D:" for OCR misreads of the capital I.
    if (!result.characterId) {
      const bareId = line.match(/\b[I1]D[:\s]+(\d{6,})\b/i);
      if (bareId) result.characterId = norm(bareId[1]);
    }

    // ── "Server: 1234" inline ────────────────────────────────────────────────
    if (!result.gameServer) {
      const inLine = line.match(/(?:servidor|server)[:\s#]+(\d{3,5})/i);
      if (inLine) result.gameServer = inLine[1];
    }

    // ── Character ID label → number on same or next line ────────────────────
    if (!result.characterId) {
      if (/(?:character\s*id|id\s*personaje|id\s*jugador|player\s*id|uid)[:\s]*/i.test(line)) {
        const inLine = norm(line).match(/(\d{6,})/);
        if (inLine) {
          result.characterId = inLine[1];
        } else {
          const nextNorm = norm(lines[i + 1] ?? "");
          const nextNum  = nextNorm.match(/^(\d{6,})$/);
          if (nextNum) { result.characterId = nextNum[1]; i++; }
        }
      }
    }

    // ── IGN label (inline format: "Name: NfL Zxid") ─────────────────────────
    if (!result.ign && /^(name|ign|player|nombre)[\s:]/i.test(line)) {
      const ign = line.replace(/^(name|ign|player|nombre)[\s:]*/i, "").trim();
      if (ign.length > 1) result.ign = ign;
    }
  }

  // ── Fallback: bare 8+ digit number, avoiding stat lines ─────────────────
  // Expanded to cover all Call of Dragons stats in Spanish and English so we
  // don't confuse Poder / Méritos / etc. with the Character ID.
  const STAT_KEYWORDS =
    /poder|power|m[eé]rit|m[eé]rito|kill|trophy|trofeo|battle|batalla|gold|oro|wood|madera|fuerza|strength|troop|tropa|soldier|soldado|constru|investig|research|heal|cura|recruit|reclu|gather|recolect|donac|donation|puntos|points|ranking|rango|logro|achievement|muerte|dead|recurso|resource|cristal|crystal|gema|gem|food|comida|chest|cofre|fortuna|fortune|hierro|iron|stone|piedra|lumber|militar|combate|combat|alianza|alliance/i;

  if (!result.characterId) {
    // Pre-compute which line indices to skip:
    // any line matching a stat keyword AND up to 2 lines after it
    // (handles "Poder\n123456789" as well as "Poder\n\n123456789" layouts).
    const skipIndices = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (STAT_KEYWORDS.test(lines[i])) {
        skipIndices.add(i);
        skipIndices.add(i + 1);
        skipIndices.add(i + 2);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      if (skipIndices.has(i)) continue;
      const n = norm(lines[i]);
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
