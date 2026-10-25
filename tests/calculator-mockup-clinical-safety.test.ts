import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Ledger #0JGJTK. PR #2491 removed directive prescribing, ECT and admission copy
 * from the production calculators on clinical-safety grounds, but the mockup tree
 * (`src/components/calculator-mockups`) is a separate set of files and kept serving
 * the same class of instruction. The mockup routes are developer-gated rather than
 * unreachable, so a reader who lands on one was getting guidance this repository
 * had already decided not to give.
 *
 * These are text gates, not behaviour gates. They exist because the two trees drift
 * silently: nothing links them, and the removal reached one and not the other for
 * eleven days without any check going red.
 */

const REPO_ROOT = join(import.meta.dirname, "..");

const COPY_FILES = [
  "src/lib/calculators/calculator-fixtures.ts",
  "src/components/calculators/calculator-pathways.ts",
  "src/components/calculator-mockups/calculator-fixtures.ts",
  "src/components/calculator-mockups/calculator-pathways.ts",
];

/**
 * Directive clinical copy of the three classes PR #2491 removed. Each pattern must
 * match an instruction to act, not a mention of the topic — a band label may still
 * say "Severe", and `related` links may still point at a medication document.
 */
const DIRECTIVE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "prescribing directive",
    pattern:
      /\b(?:start|initiate|commence|prescrib\w*|consider)\b[^"]{0,60}\b(?:an? SSRI|SSRI|antidepressant|pharmacotherapy|benzodiazepine\w*|thiamine)\b/i,
  },
  {
    // A link to an ECT document is a reference and stays allowed. What must not
    // appear is an instruction to weigh ECT for the patient in front of you, which
    // is what "Assess psychotic features and ECT indications" was.
    name: "ECT directive",
    pattern:
      /\b(?:assess|consider|arrange|refer\w*|indicated)\b[^"]{0,60}\bECT\b|\bECT\b[^"]{0,40}\b(?:indications?|indicated)\b/i,
  },
  {
    name: "admission or disposition directive",
    pattern:
      /\b(?:consider|arrange|ensure|usually indicated)\b[^"]{0,60}\badmission\b|\badmission\b[^"]{0,40}\bindicated\b/i,
  },
  {
    name: "bipolarity screening directive",
    pattern: /\bscreen for bipolarity\b/i,
  },
];

/** Only the human-facing copy fields can carry clinical instructions to a reader. */
const COPY_FIELD = /(?:guidance|label|detail|title|note|interpretation):\s*"([^"]*)"/g;

function copyStrings(relativePath: string): string[] {
  const source = readFileSync(join(REPO_ROOT, relativePath), "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(COPY_FIELD)) {
    found.push(match[1]);
  }
  return found;
}

describe("calculator copy carries no directive clinical instructions", () => {
  it.each(COPY_FILES)("%s", (relativePath) => {
    const strings = copyStrings(relativePath);
    // A file with no extractable copy would pass vacuously and hide a rename.
    expect(strings.length).toBeGreaterThan(0);

    const offenders = strings.flatMap((text) =>
      DIRECTIVE_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
        ({ name }) => `${name}: ${JSON.stringify(text)}`,
      ),
    );

    expect(offenders).toEqual([]);
  });
});

describe("the mockup tree carries no score-band action lists", () => {
  it("has no bandActions data, so no band can drive an instruction to act", () => {
    const source = readFileSync(join(REPO_ROOT, "src/components/calculator-mockups/calculator-pathways.ts"), "utf8");
    expect(source).not.toMatch(/bandActions/);
  });
});
