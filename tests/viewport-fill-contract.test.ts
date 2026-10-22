// tests/viewport-fill-contract.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Invariant 24, made file-agnostic: a page fills the box it is in; it never subtracts a
 * chrome estimate from `100dvh`. See `docs/search-chrome-behaviour.md` invariant 24 for
 * the three things such an estimate provably cannot know (the header's own top pad, the
 * `header-collapse-addon` nav row, and `#main-content`'s `sm:pb-8`), each measured as real
 * dead scroll before that contract landed.
 *
 * WHY THIS EXISTS AS A SEPARATE SCAN. The two guards that came before it --
 * `tests/ui-overlay-css-contract.test.ts` and `tests/mobile-interaction-regressions.test.ts`
 * -- are hard-coded allowlists of named files, each asserting that one literal string is
 * absent from one file. That shape cannot see a site it was never told about, which is
 * exactly how `src/components/mode-home-page-skeleton.tsx` kept two floors through PR #2419
 * and needed a follow-up sweep (`3b6e73c`, #2449) a day later. Worse, its second site was
 * written `h-[calc(100dvh-...)]` rather than `sm:min-h-[calc(...)]`, so even a repo-wide
 * search for that one literal would have missed half of it. This scan is therefore keyed on
 * the SHAPE of the offence, over the whole of `src/**`, not on a list of files.
 *
 * DESIGN DECISIONS, made deliberately:
 *
 * 1. `max-h` / `max-height` are OUT OF SCOPE and are never flagged. A bounded overlay
 *    (sheet, dialog, tooltip, sticky rail, expanded table) sizing itself to
 *    `max-h-[calc(100dvh-2rem)]` is declaring a ceiling it must not exceed, which is the
 *    opposite failure mode from a page claiming a floor it cannot fill exactly. Invariant 24
 *    is about page-fill floors only. The matchers use a negative lookbehind so `max-h-` and
 *    `max-height:` cannot match through their `h-`/`height` tail.
 * 2. Mockups are design scratch and 404 in production, so `src/app/mockups/**`
 *    and `*-mockups.tsx` are skipped outright.
 * 3. Comments are stripped before matching (block comments and whole-line `//`), because
 *    invariant 24 is discussed in prose in at least seven places -- `global-search-shell.tsx`,
 *    `mode-home-canvas.ts`, `mode-home-template.tsx`, `globals.css` -- and a guard that goes
 *    red on its own documentation teaches people to delete the documentation.
 * 4. The allowlist is EXACT-COUNT and fails closed in both directions. An entry that matches
 *    nothing is a stale entry and fails the test, so the list cannot quietly rot as files are
 *    refactored; an entry that matches more occurrences than it claims fails too, so a new
 *    offence cannot hide inside an already-exempt file.
 */

const SOURCE_ROOT = path.join(process.cwd(), "src");
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".css"];

/** Design scratch: not production surface, and exempt from the wiring/reachability gates too. */
function isDesignScratch(relativePath: string): boolean {
  return relativePath.startsWith("src/app/mockups/") || path.basename(relativePath).endsWith("-mockups.tsx");
}

// Blank out comments while preserving line numbers, so offence reports stay locatable.
//
// LINE COMMENTS FIRST -- ORDER IS LOAD-BEARING, and this file had it backwards. Blanking BLOCK
// comments first lets a line comment that merely CONTAINS the two characters that open a block
// comment, with no closer on the same line, start a block that runs forward to the next block
// closer anywhere in the file, blanking real code in between -- including a genuine offending
// class. tests/production-dynamic-route-reachability.test.ts records the identical defect
// measured at 1,897 characters of live JSX in one file; the mechanism is the same
// regex-ordering mistake, applied to a different scan. Proved live here by mutation: a scratch
// file with an opener-only line comment on one line, a genuine min-h-[calc(100dvh-4rem)]
// offence on the next, and a real block comment closing two lines later -- under the old
// block-first order this whole file went green with the offence still live in the scanned
// source; blanking line comments first leaves the block regex nothing to misfire on.
function stripComments(source: string): string {
  const withoutLines = source.replace(/^[ \t]*\/\/.*$/gm, (line) => " ".repeat(line.length));
  return withoutLines.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

/**
 * `min-h-[calc(100dvh-...)]` / `h-[calc(100svh-...)]` and every Tailwind variant prefix of
 * them. The leading lookbehind is what keeps `max-h-[calc(...)]` out: at the `h-[calc(`
 * position it is preceded by `-`, and no start position earlier in `max-h-` can satisfy the
 * variant-chain group, which must end at a `:`.
 *
 * The separator before the `-` accepts underscores as well as whitespace. A Tailwind
 * arbitrary value cannot contain a literal space, so the spec-correct way to write the
 * subtraction is `min-h-[calc(100dvh_-_4rem)]`. Every occurrence in this repo today omits
 * the space entirely (`100dvh-12.5rem`), so the underscore form is currently unexercised —
 * but it is the form a contributor reaching for correct calc() syntax would write, and a
 * guard that misses it would be a guard the next offence walks straight past.
 */
const CLASS_FLOOR = /(?<![\w:-])(?:[\w.[\]%/-]+:)*(?:min-)?h-\[calc\(\s*100(?:d|s|l)?vh[\s_]*-[^\]]*\]/g;

/** The CSS equivalents. Same lookbehind trick keeps `max-height:` out. */
const CSS_FLOOR = /(?<![\w-])(?:min-)?height\s*:\s*calc\(\s*100(?:d|s|l)?vh\s*-[^;}]*/g;

/**
 * The same floor written as a React inline style — `style={{ minHeight: "calc(100dvh - 4rem)" }}`.
 * `CSS_FLOOR` cannot see this: the JS property is camelCase, so there is no `min-height:`
 * token to match. Not hypothetical shorthand — `dashboard-nav.tsx` already sizes itself with
 * an inline `maxHeight: "min(25rem, calc(100dvh - 7rem))"`, so the object-literal shape is
 * live in this codebase and only the `minHeight` variant of it is currently unused.
 *
 * The lookbehind keeps `maxHeight` out: at the `Height` position it is preceded by `x`, and
 * a start at `max` cannot satisfy the optional `min` group. Quoted keys ("min-height") are
 * left to `CSS_FLOOR`, which already matches them.
 */
const JS_STYLE_FLOOR = /(?<![\w$])(?:min)?[Hh]eight\s*:\s*["'`][^"'`]*calc\(\s*100(?:d|s|l)?vh\s*-[^"'`]*/g;

type Finding = { file: string; line: number; match: string };

type Exemption = { file: string; match: string; count: number; reason: string };

/**
 * Every legitimate page-fill floor in `src/**`, each with the reason it is allowed to
 * subtract from a viewport unit. Adding to this list is a deliberate act; read invariant 24
 * before you do it, and never add an `sm`-and-up page floor here.
 */
const EXEMPTIONS: Exemption[] = [
  {
    // Phone floor. Invariant 24 exempts these explicitly: below `sm` the document owns
    // scrolling and there is no bounded box to fill, so there is nothing to grow into.
    // Pairs with `sm:grow sm:shrink-0`, which is the growth contract from `sm` up.
    file: "src/components/clinical-dashboard/mode-home-canvas.ts",
    match: "min-h-[calc(100dvh-12.5rem)]",
    count: 1,
    reason: "unprefixed phone floor, cancelled from sm up by sm:grow sm:shrink-0",
  },
  {
    // `max-sm:` only, so it cannot reach the bounded box at all. Carries its own 19-line
    // justification at lines 145-163 of that file explaining why the phone chrome estimate
    // is a different quantity from the sm+ one.
    file: "src/components/mode-home-template.tsx",
    match: "max-sm:min-h-[calc(100dvh-var(--phone-overlay-chrome-h)-var(--mobile-composer-reserve))]",
    count: 1,
    reason: "max-sm: only; phone overlay chrome, never applied at sm and up",
  },
  {
    // Phone floor paired with `sm:min-h-0 sm:grow`. Converted by PR #2419 itself, which is
    // the shape invariant 24 asks for: keep the phone floor, grow from sm up.
    file: "src/components/differentials/differential-compare-queue-page.tsx",
    match: "min-h-[calc(100dvh-var(--shell-header-h))]",
    count: 2,
    reason: "phone floor, explicitly cancelled at sm by sm:min-h-0 sm:grow",
  },
  {
    // Sheet primitive, not a page. A fullscreen-on-phone sheet sizes itself against the
    // inset-0 backdrop and is cancelled at sm (`sm:min-h-0`); it is an overlay box, so it
    // is not growing into `#main-content` and invariant 24's fill box does not apply.
    file: "src/components/ui/sheet.tsx",
    match: "min-h-[calc(100dvh-2rem)]",
    count: 2,
    reason: "overlay primitive sizing on phone, cancelled at sm by sm:min-h-0",
  },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return SCANNED_EXTENSIONS.some((extension) => full.endsWith(extension)) ? [full] : [];
  });
}

function collectFindings(): Finding[] {
  const findings: Finding[] = [];
  for (const absolute of walk(SOURCE_ROOT)) {
    const file = path.relative(process.cwd(), absolute).split(path.sep).join("/");
    if (isDesignScratch(file)) continue;
    const source = stripComments(readFileSync(absolute, "utf8"));
    for (const pattern of [CLASS_FLOOR, CSS_FLOOR, JS_STYLE_FLOOR]) {
      for (const match of source.matchAll(pattern)) {
        const text = match[0].replace(/\s+/g, " ").trim();
        const line = source.slice(0, match.index ?? 0).split("\n").length;
        findings.push({ file, line, match: text });
      }
    }
  }
  return findings;
}

describe("viewport fill contract (invariant 24)", () => {
  it("has no page-fill floor that subtracts a chrome estimate from a viewport unit", () => {
    const offences = collectFindings().filter(
      (finding) =>
        !EXEMPTIONS.some((exemption) => exemption.file === finding.file && exemption.match === finding.match),
    );

    expect(
      offences.map((offence) => `${offence.file}:${offence.line} ${offence.match}`),
      "A page fills the box it is in (docs/search-chrome-behaviour.md invariant 24). Grow into the " +
        "shell's reserve pad with `sm:grow` / `min-h-0 flex-1` instead of claiming a viewport floor.",
    ).toEqual([]);
  });

  it("keeps the exemption list honest -- every entry still matches exactly what it claims", () => {
    const findings = collectFindings();
    const drift = EXEMPTIONS.flatMap((exemption) => {
      const actual = findings.filter(
        (finding) => finding.file === exemption.file && finding.match === exemption.match,
      ).length;
      return actual === exemption.count
        ? []
        : [`${exemption.file} "${exemption.match}": expected ${exemption.count}, found ${actual}`];
    });

    expect(drift, "Stale or drifted exemption. Delete the entry if the site is gone; never widen it.").toEqual([]);
  });
});
