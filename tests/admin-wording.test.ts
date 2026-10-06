import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_VERDICTS,
  readerFacingStrings,
  verdictsIn,
  type VerdictPattern,
} from "./helpers/reader-facing-strings";

/** Spec, "Purpose": Admin is an organiser, not an authority. */
const ADMIN_VERDICTS: readonly VerdictPattern[] = [
  ...FORBIDDEN_VERDICTS,
  { pattern: /\bcovered\b/i, why: "a verdict on cover this app has never seen" },
  { pattern: /\beligible\b/i, why: "an entitlement ruling; Admin keeps no entitlement rules" },
  { pattern: /\bcleared\b/i, why: "a verdict on a check this app never ran ('Clearances', the category, is allowed)" },
  { pattern: /\bowed\b/i, why: "a pay ruling; Admin shows what was logged, never what is owed" },
  { pattern: /\bverified\b/i, why: "a verdict on a check this app never made with the issuing body" },
];
/** Status ticks. A plain checkbox the doctor ticks for their own to-do is a control, not a status. */
const STATUS_TICK_ICONS = /\b(BadgeCheck|CheckCircle2?|CircleCheck(?:Big)?|ShieldCheck|SquareCheck(?:Big)?)\b/;

const ADMIN_ROOTS = ["src/components/admin", "src/lib/admin", "src/app/(search-app)/admin"];
/** My Day shows Admin's dates, so its wording is held to the same rules. It also reads CPD, so only the wording checks cover it. */
const WORDING_ROOTS = [...ADMIN_ROOTS, "src/components/my-day"];

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}
const adminFiles = ADMIN_ROOTS.flatMap(filesUnder);
const wordingFiles = WORDING_ROOTS.flatMap(filesUnder);

describe("Admin never renders a verdict", () => {
  it("has Admin surfaces to read", () => {
    expect(adminFiles.length).toBeGreaterThanOrEqual(8);
  });

  it("puts none of the banned words in anything a reader sees", () => {
    expect(verdictsIn(wordingFiles.flatMap(readerFacingStrings), ADMIN_VERDICTS)).toEqual([]);
  });

  it("draws no status tick", () => {
    for (const file of wordingFiles) expect(readFileSync(file, "utf8"), file).not.toMatch(STATUS_TICK_ICONS);
  });
});

describe("nothing from Admin goes to search or the AI", () => {
  it("imports no search, answer or model client and calls no such route", () => {
    for (const file of adminFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/@\/lib\/(openai|rag\/|clinical-ask|clinical-search)/);
      expect(source, file).not.toMatch(/\/api\/(search|answer|clinical-ask|speech)/);
    }
  });

  it("reads no CPD data: only the pure Perth date helper, and a plain link to /cme/check (spec review 20)", () => {
    for (const file of adminFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\/api\/cme/);
      expect(source, file).not.toMatch(/@\/lib\/cme\/(?!cpd-year")/);
    }
  });
});
