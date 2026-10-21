import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BRAND_CATCHPHRASE,
  BRAND_CATCHPHRASE_BARE,
  BRAND_DESCRIPTION,
  BRAND_INSTALL_TAGLINE,
  BRAND_MENU_DESCRIPTION,
  BRAND_NAME,
  BRAND_OG_ALT,
} from "@/lib/brand";

/**
 * The product's written identity has one home (`src/lib/brand.ts`).
 *
 * Before it did, four surfaces described PsychSift four different ways — the
 * page metadata, the web manifest, the OG card and the install prompt each
 * carried a hand-typed sentence, and two of them disagreed about whether the
 * product is a "RAG knowledge base" or a "knowledge base". Nobody had made a
 * decision to say two different things; the second sentence was written months
 * after the first by someone who could not see it.
 *
 * So this file guards the property that made that possible: a brand line
 * re-typed as a literal at the point of use. The check is deliberately narrow —
 * it does not police every mention of the product, only the specific lines the
 * module owns, and only outside the module itself.
 */

const SOURCE_FILES = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.(ts|tsx)$/.test(file))
  // The module that defines the strings is the one place they may appear as
  // literals, and design-scratch mockups are excluded for the same reason they
  // are excluded from the wiring and reachability gates: they are not product.
  .filter((file) => file !== "src/lib/brand.ts" && !file.includes("mockups"))
  // `public/llms.txt` is the product's own description of itself to agents, and
  // it is product copy in every sense except that it lives outside src — which
  // is exactly how it sat on the retired name for two months after the rename
  // while every gate scanned past it (full-repository audit 2026-09-02, L86).
  .concat("public/llms.txt");

/** Lines a surface must import rather than retype. */
const OWNED_LINES: ReadonlyArray<readonly [name: string, value: string]> = [
  ["BRAND_CATCHPHRASE", BRAND_CATCHPHRASE],
  ["BRAND_DESCRIPTION", BRAND_DESCRIPTION],
  ["BRAND_INSTALL_TAGLINE", BRAND_INSTALL_TAGLINE],
  ["BRAND_MENU_DESCRIPTION", BRAND_MENU_DESCRIPTION],
];

describe("brand copy has a single source", () => {
  it.each(OWNED_LINES)("%s appears as a literal only in src/lib/brand.ts", (name, value) => {
    const offenders = SOURCE_FILES.filter((file) => readFileSync(file, "utf8").includes(value));
    expect(
      offenders,
      `${name} is retyped as a literal in ${offenders.join(", ")}. Import it from "@/lib/brand" instead — ` +
        "a second copy is how the product ended up describing itself two different ways.",
    ).toEqual([]);
  });

  it("the surfaces that carry brand copy read it from the module", () => {
    for (const file of [
      "src/app/layout.tsx",
      "src/app/manifest.ts",
      "src/app/opengraph-image.tsx",
      "src/components/pwa-lifecycle.tsx",
      "src/components/clinical-dashboard/ClinicalSidebar.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), `${file} no longer imports the brand module`).toMatch(/from "@\/lib\/brand"/);
    }
  });
});

describe("the catchphrase stays usable where it is shown", () => {
  /**
   * The phone drawer renders the bare catchphrase on a single truncating line
   * beside a 32px mark and a 48px close control. There is not much room, and the
   * failure is silent: a longer line does not break the layout, it just gets
   * cut off mid-word with an ellipsis and reads as a bug.
   *
   * 28 characters is the measured fit at the narrowest supported width (320px),
   * re-measured 2026-09-04 when the strapline moved onto the shared PsychSift
   * lockup at 12px (it was 32 characters at the previous 10px setting). The
   * measurement: a 304px panel less its 32px of padding leaves a 167px title
   * column once the mark and the close control take their share, and the line
   * renders at 5.91px per character. Not a style preference — raise it only
   * against a re-measure at 320px.
   */
  it("fits the phone drawer strapline", () => {
    expect(BRAND_CATCHPHRASE_BARE.length).toBeLessThanOrEqual(28);
  });

  it("is one line, not a sentence pair", () => {
    expect(BRAND_CATCHPHRASE).not.toMatch(/[\n\r]/);
    expect(BRAND_CATCHPHRASE.split(".").filter(Boolean)).toHaveLength(1);
  });

  it("keeps the bare variant in step with the punctuated one", () => {
    // Two exports so no caller has to slice the string and quietly disagree
    // about where it ends; that only helps while they still say the same thing.
    expect(`${BRAND_CATCHPHRASE_BARE}.`).toBe(BRAND_CATCHPHRASE);
  });

  it("does not promise clinical correctness", () => {
    // This is a clinical reference prototype, not validated decision support.
    // The catchphrase may describe what the product does; it may not make a
    // claim about the guidance it surfaces being right, safe or sufficient,
    // because the entire citation architecture exists so a clinician can check
    // that themselves. Guarding the words is cruder than guarding the meaning,
    // but a review that has to argue with a failing test is the point.
    expect(BRAND_CATCHPHRASE.toLowerCase()).not.toMatch(
      /\b(trust(ed|worthy)?|accurate|correct|safe|reliable|proven|verified|evidence-based)\b/,
    );
  });
});

/**
 * The product was called "Clinical Guide" before 2026-08-28. The rename to
 * PsychSift moved the name in `src/lib/brand.ts` and the surfaces that read it,
 * but every hand-typed occurrence stayed where it was — a sr-only page heading,
 * five sidebar and drawer aria-labels, the sign-up title, the calculator empty
 * state, and the agent-facing `llms.txt` — so for two months the product
 * introduced itself by one name and labelled its own navigation with another.
 * The 2026-09-02 audit found the llms.txt half of it (L86) only because a
 * Playwright assertion had been written to pin the stale string.
 *
 * A name is not a line this module can own the way it owns the taglines above:
 * "PsychSift" is written as a literal in over a hundred places and routing all
 * of them through an import would be a migration, not a guard. So the guard runs
 * the other way round — the retired name may not come back.
 */
describe("the retired product name stays retired", () => {
  // "Clinical Guideline"/"Clinical Guidelines" are document titles in the corpus
  // (the Lithium Clinical Guideline, for one) and have nothing to do with the
  // product's own name, so the lookahead lets them through.
  const RETIRED_NAME = /\bClinical Guide(?!lines?\b)/;

  // Unlike the retyped-line scan above, this one has no exclusions: mockups are
  // design scratch, but a prototype of the sidebar that still says the old name
  // is exactly what a designer copies the next version from, so they are held to
  // the product name too. `src/lib/brand.ts` is in scope for the same reason —
  // it is the module that decides what the product is called.
  const NAMED_SURFACES = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .concat("public/llms.txt");

  it.each(NAMED_SURFACES)("%s does not call the product Clinical Guide", (file) => {
    const offending = readFileSync(file, "utf8")
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => RETIRED_NAME.test(line));

    expect(
      offending.map(({ number, line }) => `${file}:${number}: ${line.trim()}`),
      `${file} still calls the product "Clinical Guide". It is PsychSift (BRAND_NAME) — ` +
        "a surface that keeps the old name labels the navigation differently from the header above it.",
    ).toEqual([]);
  });
});

describe("derived brand lines", () => {
  it("builds the description from the catchphrase", () => {
    expect(BRAND_DESCRIPTION).toContain(BRAND_CATCHPHRASE_BARE.toLowerCase());
  });

  it("names the product in the share-card alt text", () => {
    expect(BRAND_OG_ALT.startsWith(BRAND_NAME)).toBe(true);
    // The alt text joins with a colon, so it never stacks a second dash on the
    // description's punctuation. Two em dashes in one line read as a stutter.
    expect((BRAND_OG_ALT.match(/—/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});
