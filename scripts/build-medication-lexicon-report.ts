// Renders the curated interaction lexicon as something a clinician can actually
// review: `docs/medication-interaction-lexicon-review.md`.
//
// WHY THIS EXISTS
// `src/lib/medication-interaction-lexicon.ts` decides which drugs a phrase like
// "NSAIDs" or "CNS depressants" refers to, and that decision drives every red and
// amber interaction alert in the app. It was assembled by pattern-matching the
// catalogue corpus, not by a clinician, and it has never had clinical review.
//
// The blocker to that review was legibility, not willingness: nobody should be
// asked to check `{ subclassIncludes: ["Opioid"], denySlugs: ["naltrexone"] }` and
// work out in their head which of 328 medications that covers. This report
// expands every selector to the actual drug names it resolves to, reports how
// many catalogue rows depend on each term, and flags the shapes most likely to be
// wrong — so the review is reading a table, not reading code.
//
// Run with `npm run medications:lexicon-report`. `--check` verifies the committed
// report matches the current lexicon, so the two cannot drift.
//
// This script reports. It does not validate: nothing here asserts a mapping is
// clinically correct, and a generated report is not a review.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { format } from "prettier";

import { INTERACTION_LEXICON, selectCatalogueSlugs, type LexiconTerm } from "../src/lib/medication-interaction-lexicon";
import type { MedicationRecord } from "../src/lib/medications";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const SNAPSHOT_PATH = "data/medications-snapshot.json";
const INDEX_PATH = "data/medication-interaction-index.json";
const OUTPUT_PATH = "docs/medication-interaction-lexicon-review.md";

/** A resolved set this large is usually a selector that is too broad. */
const WIDE_EXPANSION = 25;

type IndexShape = {
  bySlug: Record<string, { rows: { termIds: string[]; severity: string; counterparties?: string[] }[] }>;
};

function escapePipes(value: string): string {
  return value.replaceAll("|", "\\|");
}

/** Every interaction row's text on one record, in source order. */
function interactionRowText(record: MedicationRecord | undefined): string[] {
  return (record?.sections ?? [])
    .filter((section) => section.type === "inter")
    .flatMap((section) => (section.rows ?? []).map((row) => row.val ?? ""))
    .filter(Boolean);
}

/**
 * Word-boundary surface match, mirroring `mentions()` in
 * `build-medication-interaction-index.ts`.
 *
 * Reporting-only: it counts the rows a source-side exclusion covers so the
 * reviewer can see its reach. It is deliberately not imported from the index
 * builder, which is a different script with its own corpus-parsing concerns —
 * a near-miss here would over- or under-count a row in a table, never change
 * which alert the app raises.
 */
function mentionsSurface(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i").test(haystack);
}

/** One row's wording, short enough to sit in a table cell. */
function excerpt(value: string, limit = 140): string {
  const flat = value.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (!flat) return "_no row text_";
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const records = JSON.parse(readFileSync(path.resolve(process.cwd(), SNAPSHOT_PATH), "utf8")) as MedicationRecord[];
  const index = JSON.parse(readFileSync(path.resolve(process.cwd(), INDEX_PATH), "utf8")) as IndexShape;
  const nameBySlug = new Map(records.map((record) => [record.slug, record.name]));

  // The catalogue is not guaranteed to give a drug one record. It currently
  // holds two called "Warfarin" (`warfarin-vka`, `warfarin-anticoagulant`),
  // which rendered as "Warfarin, Warfarin" and read like a bug in this report
  // rather than a duplicate in the source. Disambiguate by slug so the reviewer
  // can see which record is which, and flag the duplicates explicitly below.
  const slugsByName = new Map<string, string[]>();
  for (const record of records) {
    const bucket = slugsByName.get(record.name) ?? [];
    bucket.push(record.slug);
    slugsByName.set(record.name, bucket);
  }
  const drugLabel = (slug: string): string => {
    const name = nameBySlug.get(slug);
    if (!name) return slug;
    return (slugsByName.get(name)?.length ?? 0) > 1 ? `${name} (\`${slug}\`)` : name;
  };

  // How many catalogue rows each term fires on, and how many of those are the
  // two severities that paint a row red. A wrong mapping on a high-usage,
  // high-severity term is the most expensive kind.
  const usage = new Map<string, { rows: number; severe: number }>();
  for (const entry of Object.values(index.bySlug)) {
    for (const row of entry.rows) {
      const severe = row.severity === "critical" || row.severity === "high";
      for (const id of row.termIds) {
        const current = usage.get(id) ?? { rows: 0, severe: 0 };
        current.rows += 1;
        if (severe) current.severe += 1;
        usage.set(id, current);
      }
    }
  }

  // The status line has to be derived, not hardcoded. It previously always read
  // UNREVIEWED, so the day a clinician filled in the sign-off block the document
  // contradicted itself in its own first sentence — and the sign-off is the half
  // a reader is less likely to scroll to. Both the write path and `--check` build
  // it from the same read, or the check would report a stale artefact forever.
  const recordedSignOff = readSignOff(path.resolve(process.cwd(), OUTPUT_PATH));

  // Resolved before the header, because the status line now depends on what the
  // terms currently resolve to, not only on the date somebody recorded.
  const catalogueTerms = INTERACTION_LEXICON.filter((term) => term.kind === "catalogue");
  const expansions = new Map<string, string[]>();
  for (const term of catalogueTerms) {
    expansions.set(term.id, term.select ? selectCatalogueSlugs(term.select, records) : []);
  }
  const currentHash = catalogueMappingsHash(catalogueTerms, expansions);
  const signOffIsCurrent = Boolean(recordedSignOff.date) && recordedSignOff.hash === currentHash;

  const lines: string[] = [];
  lines.push("# Medication interaction lexicon — clinical review sheet");
  lines.push("");
  lines.push(signOffStatusLine(recordedSignOff, currentHash));
  lines.push("");
  lines.push(
    "Generated by `npm run medications:lexicon-report` from `src/lib/medication-interaction-lexicon.ts`.",
    "Do not hand-edit — fix the lexicon and regenerate. `npm run check:medication-lexicon-report` fails when",
    "this file and the lexicon disagree.",
  );
  lines.push("");
  lines.push("## What you are checking");
  lines.push("");
  lines.push(
    "The catalogue writes interactions as prose (`CRITICAL — NSAIDs and Aspirin. SSRIs deplete platelet",
    "serotonin…`). To warn a clinician that *this* patient's drug is the one being described, the app has to",
    "decide which catalogue medications a phrase like **NSAIDs** covers. This table is every one of those",
    "decisions, expanded to the drugs it actually resolves to.",
  );
  lines.push("");
  lines.push("Three questions per row:");
  lines.push("");
  lines.push("1. Does the term cover a drug it should **not**? (a false alert)");
  lines.push("2. Does it **miss** a drug it should cover? (a missed alert — the dangerous direction)");
  lines.push("3. Is the classification (`catalogue` / `external` / `nonDrug` / `mechanism`) right?");
  lines.push("");
  lines.push("`Rows` is how many catalogue interaction rows the term fires on; `Severe` is how many of those are");
  lines.push("CRITICAL or HIGH. Start at the top — the table is sorted by severe usage.");
  lines.push("");

  const sorted = [...catalogueTerms].sort((a, b) => {
    const usageA = usage.get(a.id) ?? { rows: 0, severe: 0 };
    const usageB = usage.get(b.id) ?? { rows: 0, severe: 0 };
    return usageB.severe - usageA.severe || usageB.rows - usageA.rows || a.id.localeCompare(b.id);
  });

  lines.push("## Drug-class terms");
  lines.push("");
  lines.push("| Term | Matches these phrases | Rows | Severe | Resolves to |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const term of sorted) {
    const stat = usage.get(term.id) ?? { rows: 0, severe: 0 };
    const slugs = expansions.get(term.id) ?? [];
    const names = slugs.map(drugLabel).sort();
    lines.push(
      `| \`${term.id}\` | ${escapePipes(term.surfaces.join(", "))} | ${stat.rows} | ${stat.severe} | ` +
        `**${names.length}** — ${escapePipes(names.join(", ")) || "_nothing_"} |`,
    );
  }
  lines.push("");

  // Deny-lists are the guards against known mis-classifications, so they are
  // called out rather than left implicit in a selector.
  lines.push("## Deliberate exclusions");
  lines.push("");
  lines.push("Drugs a selector would otherwise have swept in. Each is a clinical claim worth checking.");
  lines.push("");
  const denied = catalogueTerms.filter((term) => (term.select?.denySlugs ?? []).length > 0);
  if (denied.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Term | Excluded | Why it would otherwise match |");
    lines.push("| --- | --- | --- |");
    for (const term of denied) {
      for (const slug of term.select?.denySlugs ?? []) {
        const record = records.find((item) => item.slug === slug);
        const reason = record ? `class \`${record.class}\`, subclass \`${record.subclass}\`` : "not in catalogue";
        lines.push(`| \`${term.id}\` | ${drugLabel(slug)} | ${escapePipes(reason)} |`);
      }
    }
  }
  lines.push("");

  // The other half of a deny decision, and the one that was invisible until
  // 2026-09-03. `select.denySlugs` above says a drug is not IN the class;
  // `sourceDenySlugs` says the class term, wherever it appears on one named
  // record, does not name a counterparty there at all — so every row on that
  // record stops raising an alert through this term. That is a clinical claim
  // of exactly the same weight, and since the sign-off hash now covers it, the
  // reviewer has to be able to read it. Signing a digest over something the
  // sheet never rendered is the failure this document exists to prevent.
  lines.push("## Source-side exclusions");
  lines.push("");
  lines.push(
    "Records where a term is present in the text but is **not** read as naming a counterparty — usually",
    "because the record is using the class word for its own drug. Every interaction row on the record is",
    "affected, so each of these is a clinical claim worth checking. Each exclusion requires an authored",
    "clinical rationale.",
  );
  lines.push("");
  const sourceDenied = catalogueTerms.filter((term) => (term.sourceDenySlugs ?? []).length > 0);
  if (sourceDenied.length === 0) {
    lines.push("_None._");
  } else {
    lines.push(
      "| Term | Not read as a counterparty on | Rows affected | The wording it appears in | Clinical rationale |",
    );
    lines.push("| --- | --- | --- | --- | --- |");
    for (const term of sourceDenied) {
      for (const slug of term.sourceDenySlugs ?? []) {
        const record = records.find((item) => item.slug === slug);
        const rows = interactionRowText(record);
        const matched = rows.filter((row) => term.surfaces.some((surface) => mentionsSurface(row, surface)));
        const example = matched[0] ?? "";
        const rationale = term.sourceDenyRationales?.[slug] ?? "_None provided._";
        lines.push(
          `| \`${term.id}\` | ${drugLabel(slug)} | ${matched.length} of ${rows.length} | ` +
            `${escapePipes(excerpt(example))} | ${escapePipes(rationale)} |`,
        );
      }
    }
  }
  lines.push("");

  lines.push("## Terms that resolve to no catalogue drug");
  lines.push("");
  lines.push(
    "These never produce an alert. `nonDrug` and `external` are deliberate; `mechanism` is an admission that",
    "the class cannot be enumerated, and holds the medication at grey rather than green.",
  );
  lines.push("");
  lines.push("| Term | Kind | Matches these phrases | Rows | Note |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const term of INTERACTION_LEXICON.filter((item) => item.kind !== "catalogue")) {
    const stat = usage.get(term.id) ?? { rows: 0, severe: 0 };
    lines.push(
      `| \`${term.id}\` | ${term.kind} | ${escapePipes(term.surfaces.join(", "))} | ${stat.rows} | ` +
        `${escapePipes(term.note ?? "")} |`,
    );
  }
  lines.push("");

  lines.push(...coverageSection(records, index));

  lines.push("## Flagged for a closer look");
  lines.push("");
  const traps = substringTraps(catalogueTerms, records);
  const missed = missedClassMembers(catalogueTerms, expansions, records);
  const flags = [
    ...traps,
    ...missed,
    ...duplicateCatalogueNames(slugsByName, expansions, records),
    ...collectFlags(catalogueTerms, expansions, usage),
  ];
  if (flags.length === 0) {
    lines.push("_Nothing flagged._");
  } else {
    for (const flag of flags) lines.push(`- ${flag}`);
  }
  lines.push("");
  // State what ran clean as well as what fired. A reviewer who cannot tell the
  // difference between "checked, nothing found" and "never checked" has to redo
  // the check by hand, which is most of the work this sheet exists to save.
  if (traps.length === 0 || missed.length === 0) {
    lines.push("Checks that ran and found nothing:");
    lines.push("");
    if (traps.length === 0) {
      lines.push(
        "- **Accidental substring matches** — no class token matches a subclass only as a fragment of a longer" +
          " word. (This is the check that caught `ARB` inside _Carbapenem_.)",
      );
    }
    if (missed.length === 0) {
      lines.push(
        "- **Missed class members** — no catalogue drug whose own class, subclass or tag names a term's phrase" +
          " was left out of that term. Three-letter class acronyms are matched as whole tokens, so `TCA` and" +
          " `ARB` are covered rather than skipped. Where a class resolves to a single drug, that is the" +
          " catalogue holding one such drug, not a narrow selector.",
      );
    }
    lines.push("");
  }

  lines.push("## Sign-off");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  lines.push("| Reviewer (name + role) | _not yet reviewed_ |");
  lines.push("| Date | _not yet reviewed_ |");
  lines.push("| Mappings hash | _not yet reviewed_ |");
  lines.push("| Outcome | _not yet reviewed_ |");
  lines.push("| Corrections raised | _not yet reviewed_ |");
  lines.push("");
  lines.push(
    `Record the mappings hash exactly as printed by the generator — today \`${currentHash}\`. It is what binds`,
    "the sign-off to the mappings it covers: when the lexicon or the catalogue moves a term, the hash changes",
    "and the status line at the top of this sheet says the sign-off is no longer current.",
  );
  lines.push("");
  lines.push(
    "Until this is filled in, treat every interaction alert as unvalidated mapping over source-backed text.",
    "The wording shown to the clinician is always verbatim from the catalogue; what is unreviewed is *which",
    "drugs a phrase was taken to mean*.",
  );
  lines.push("");

  // Format here, exactly as `generate-site-map.ts` does. `npm run format` runs
  // over the whole tree and reflows these markdown tables; without this the
  // generator's raw output and the committed file disagree the moment anyone
  // formats, and `--check` reports a stale artefact that is not actually stale.
  const rendered = await format(`${lines.join("\n")}\n`, { parser: "markdown", printWidth: 120 });
  const outputPath = path.resolve(process.cwd(), OUTPUT_PATH);

  if (checkOnly) {
    let current = "";
    try {
      current = readFileSync(outputPath, "utf8");
    } catch {
      current = "";
    }
    // Compare everything except the human-maintained sign-off block, so recording
    // a review does not make the report look stale.
    if (beforeSignOff(current) !== beforeSignOff(rendered)) {
      console.error(
        `[lexicon-report] ${OUTPUT_PATH} is stale.\nRun \`npm run medications:lexicon-report\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log(`[lexicon-report] ${OUTPUT_PATH} is up to date (${catalogueTerms.length} catalogue terms).`);
    warnIfSignOffIsStale(recordedSignOff, currentHash, signOffIsCurrent);
    return;
  }

  const output = recordedSignOff.block ? `${beforeSignOff(rendered)}${recordedSignOff.block}` : rendered;
  writeFileSync(outputPath, output);
  console.log(
    `[lexicon-report] wrote ${OUTPUT_PATH}: ${catalogueTerms.length} catalogue terms, ${flags.length} flagged,` +
      ` mappings hash ${currentHash}.`,
  );
  warnIfSignOffIsStale(recordedSignOff, currentHash, signOffIsCurrent);
}

/**
 * Say so, on stdout, when the recorded sign-off does not cover what is rendered.
 *
 * Deliberately a warning and not a non-zero exit. `check:medication-lexicon-report`
 * runs in `verify:pr-local` and in CI, and the sign-off on this sheet is already
 * out of date, so failing here would turn every PR red until a clinician
 * re-attests — which is a decision for the reviewer who signs, not a side effect
 * of adding the binding. The stale state is stated in the document itself, in
 * its first line, which is where the reader of a clinical artefact will meet it.
 */
function warnIfSignOffIsStale(
  signOff: { date: string; hash: string },
  currentHash: string,
  signOffIsCurrent: boolean,
): void {
  if (!signOff.date || signOffIsCurrent) return;
  console.warn(
    `[lexicon-report] WARNING: the sign-off recorded ${signOff.date} does not cover the current mappings ` +
      `(${signOff.hash ? `recorded ${signOff.hash}, ` : "no mappings hash recorded, "}now ${currentHash}). ` +
      "Re-check every term that changed and re-record the sign-off with the current hash.",
  );
}

/**
 * Content hash of exactly what a sign-off covers: the catalogue-term mappings.
 *
 * Scoped to `catalogue` terms and their resolved drug lists because that is the
 * scope the sign-off block itself claims — `external`, `nonDrug` and `mechanism`
 * terms resolve to no catalogue drug and raise no alert. Both halves of a
 * mapping are included: the selector's own inputs (surfaces, deny-list,
 * source-side exclusions) and what they currently resolve to, so a catalogue
 * edit that silently widens a class is caught as well as a lexicon edit.
 * Commit 0e70217cf (2026-08-28) is the case this exists for: it added two
 * medications and two deny-lists, moving `acei` to two drugs, `statins` to
 * three and `fibrates` from two rows to one, while the sheet went on saying
 * "reviewed 2026-08-22" and `--check` stayed green.
 *
 * `sourceDenySlugs` is included alongside the selector's own `denySlugs`
 * because `build-medication-interaction-index.ts` uses it to suppress
 * otherwise-generated alert rows (a source record mentioning the term without
 * declaring a matching counterparty) — the statin and fibrate exclusions are
 * live examples. That suppression changes which rows the index emits just as
 * surely as a selector change does, so a sign-off recorded before a
 * `sourceDenySlugs` edit must not read as current afterward.
 *
 * Not the rendered markdown: reflowing a table or renaming a column must not
 * invalidate a clinician's sign-off, and only the mappings are clinical.
 */
export function catalogueMappingsHash(
  terms: readonly LexiconTerm[],
  expansions: ReadonlyMap<string, readonly string[]>,
): string {
  const payload = terms
    .map((term) => ({
      id: term.id,
      surfaces: [...term.surfaces].sort(),
      denySlugs: [...(term.select?.denySlugs ?? [])].sort(),
      sourceDenySlugs: [...(term.sourceDenySlugs ?? [])].sort(),
      resolves: [...(expansions.get(term.id) ?? [])].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * The document's leading status line.
 *
 * A recorded sign-off covers the mappings AS THEY STOOD when it was recorded,
 * and until now nothing bound it to them: the write path carries the block
 * forward verbatim and `--check` compares only the generated half, so the sheet
 * kept printing "reviewed 2026-08-22" after the mappings moved on 2026-08-28.
 * The Outcome row stays historically true while the table above it is no longer
 * the table that was reviewed — and this line is the half a reader meets first.
 *
 * The covered wording is unchanged on purpose: it is the sentence the sheet
 * already used to scope a sign-off to its date.
 */
export function signOffStatusLine(signOff: { date: string; hash: string }, currentHash: string): string {
  if (!signOff.date) {
    return "**Status: UNREVIEWED.** No clinician has checked these mappings. Record sign-off at the bottom.";
  }
  if (signOff.hash === currentHash) {
    return (
      `**Status: reviewed ${signOff.date}** — see the sign-off at the bottom. That sign-off covers the ` +
      "mappings as they stood on that date only. Any lexicon change made since is NOT covered by it: re-check " +
      "every term the change touches, and say so in the sign-off."
    );
  }
  const reason = signOff.hash
    ? `The catalogue-term mappings have changed since (signed \`${signOff.hash}\`, now \`${currentHash}\`)`
    : `That sign-off records no mappings hash, so nothing binds it to the table below (which now hashes to ` +
      `\`${currentHash}\`)`;
  return (
    `**Status: reviewed ${signOff.date} — NOT current.** ${reason}. This sheet therefore cannot say which of ` +
    "the terms below remain covered by that sign-off: re-check every term the change touched and re-record " +
    "the sign-off with the current mappings hash. A sign-off covers the mappings as they stood on its own date only."
  );
}

/**
 * Read a sign-off a human has already recorded, if there is one.
 *
 * A block still containing `_not yet reviewed_` is a placeholder, not a
 * sign-off, and is treated as absent — that is what keeps a half-filled table
 * from flipping the document's status line to "reviewed".
 */
function readSignOff(outputPath: string): SignOff {
  let current = "";
  try {
    current = readFileSync(outputPath, "utf8");
  } catch {
    return EMPTY_SIGN_OFF;
  }
  return parseSignOff(current);
}

export type SignOff = { block: string; date: string; hash: string };

const EMPTY_SIGN_OFF: SignOff = { block: "", date: "", hash: "" };

/**
 * The sign-off a human has already recorded in a rendered sheet.
 *
 * `hash` is the `Mappings hash` row: the fingerprint of the mappings the
 * reviewer actually looked at. A sign-off recorded before that row existed
 * reports an empty hash, which is treated as "does not cover the current
 * mappings" rather than as a match — the conservative direction, because the
 * whole point is that an unbound sign-off cannot vouch for anything.
 */
export function parseSignOff(content: string): SignOff {
  const marker = content.indexOf("## Sign-off");
  if (marker < 0 || content.includes("_not yet reviewed_")) return EMPTY_SIGN_OFF;
  const block = content.slice(marker);
  const date = block.match(/\|\s*Date\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/)?.[1] ?? "";
  const hash = block.match(/\|\s*Mappings hash\s*\|\s*`?([0-9a-f]{64})`?\s*\|/i)?.[1] ?? "";
  return { block, date, hash };
}

function beforeSignOff(value: string): string {
  const marker = value.indexOf("## Sign-off");
  return marker >= 0 ? value.slice(0, marker) : value;
}

/**
 * Does a `subclassIncludes` token hide inside an unrelated subclass?
 *
 * This is the check that would have caught "ARB" inside "Carbapenem" on the day
 * it was written. A token is treated as legitimate for a subclass when it
 * appears there as a whole word; if it only appears as a bare substring, the
 * match is almost certainly accidental.
 */
export function substringTraps(terms: readonly LexiconTerm[], records: readonly MedicationRecord[]): string[] {
  const subclasses = Array.from(new Set(records.map((record) => record.subclass ?? "").filter(Boolean)));
  const traps: string[] = [];
  for (const term of terms) {
    for (const token of term.select?.subclassIncludes ?? []) {
      const lower = token.toLowerCase();
      for (const subclass of subclasses) {
        if (!subclass.toLowerCase().includes(lower)) continue;
        const words = subclass
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean);
        const tokenWords = lower.split(/[^a-z0-9]+/).filter(Boolean);
        const wholeWord = tokenWords.every((part) => words.includes(part));
        if (!wholeWord) {
          traps.push(
            `\`${term.id}\` matches subclass **${subclass}** only as a substring of \`${token}\` — ` +
              "almost certainly accidental. Use `subclassEquals`, or narrow the token.",
          );
        }
      }
    }
  }
  return traps;
}

/**
 * Two catalogue records sharing a drug name.
 *
 * Not a lexicon fault, but it lands on the clinician reading this sheet: a class
 * that expands to the same name twice looks like a bug here when the duplication
 * is upstream in `data/medications-snapshot.json`. It also matters clinically —
 * a duplicated record means the same drug can carry two different interaction
 * row sets, so a warning present on one and absent on the other is invisible
 * from the drug's name alone. Reported only when a lexicon term actually
 * resolves to the duplicate; an unused duplicate is a catalogue chore, not a
 * safety question for this review.
 *
 * The row sets are compared here rather than left as "confirm they agree",
 * because the first duplicate found (Warfarin) did NOT agree — so the flag has
 * to state the divergence, not ask about it.
 */
function duplicateCatalogueNames(
  slugsByName: Map<string, string[]>,
  expansions: Map<string, string[]>,
  records: readonly MedicationRecord[],
): string[] {
  const resolved = new Set(Array.from(expansions.values()).flat());
  const bySlug = new Map(records.map((record) => [record.slug, record]));
  const rowSet = (slug: string): Set<string> =>
    new Set(
      (bySlug.get(slug)?.sections.find((section) => section.type === "inter")?.rows ?? []).map(
        (row) => `${row.key}::${row.val}`,
      ),
    );

  const flags: string[] = [];
  for (const [name, slugs] of slugsByName) {
    if (slugs.length < 2) continue;
    if (!slugs.some((slug) => resolved.has(slug))) continue;
    const sets = slugs.map(rowSet);
    const shared = [...sets[0]].filter((row) => sets.every((set) => set.has(row))).length;
    const agree = sets.every((set) => set.size === shared);
    const detail = agree
      ? `They carry identical interaction rows, so the duplication is cosmetic.`
      : `They carry **different** interaction rows (${slugs
          .map((slug, index) => `\`${slug}\`: ${sets[index].size}`)
          .join(", ")}; only ${shared} in common), so which record the clinician opens changes which ` +
        `warnings they see. Reconcile them in the catalogue.`;
    flags.push(
      `The catalogue holds ${slugs.length} records named **${name}** ` +
        `(${slugs.map((slug) => `\`${slug}\``).join(", ")}), and a lexicon class resolves to them. ${detail}`,
    );
  }
  return flags;
}

function collectFlags(
  terms: readonly LexiconTerm[],
  expansions: Map<string, string[]>,
  usage: Map<string, { rows: number; severe: number }>,
): string[] {
  const flags: string[] = [];
  for (const term of terms) {
    const slugs = expansions.get(term.id) ?? [];
    const stat = usage.get(term.id) ?? { rows: 0, severe: 0 };
    if (slugs.length === 0) {
      flags.push(`\`${term.id}\` resolves to **no drug at all** — it can never fire.`);
    } else if (slugs.length >= WIDE_EXPANSION && substringDriven(term)) {
      // Scoped to substring selectors on purpose. A raw count is a bad signal
      // for a hand-written `classes` list: `antipsychotics` legitimately covers
      // 26 drugs in a psychiatry catalogue, and flagging it spent a reviewer's
      // attention on a non-issue while the real finding sat below it. A
      // substring selector is the one that can widen without anyone deciding
      // it should, so that is where a size ceiling earns its place. Every
      // catalogue term above 14 drugs today is an explicit `classes` list.
      flags.push(
        `\`${term.id}\` resolves to **${slugs.length} drugs** from a substring selector — wide enough to check` +
          ` the match is deliberate.`,
      );
    }
    // No single-drug flag. It fired on `acei`, `arbs` and `loop-diuretics`,
    // and all three were the catalogue holding exactly one such drug rather
    // than a narrow selector. `missedClassMembers` answers that question with
    // evidence instead of raising it as a suspicion.
    if (stat.severe > 0 && slugs.length === 0) {
      flags.push(`\`${term.id}\` appears in ${stat.severe} CRITICAL/HIGH rows but resolves to nothing.`);
    }
    if (stat.rows === 0) {
      flags.push(`\`${term.id}\` fires on no catalogue row — dead entry, or its phrasing never occurs.`);
    }
    for (const slug of term.sourceDenySlugs ?? []) {
      if (!term.sourceDenyRationales?.[slug]?.trim()) {
        flags.push(`\`${term.id}\` excludes source slug \`${slug}\` without a clinical rationale.`);
      }
    }
  }
  return flags;
}

function substringDriven(term: LexiconTerm): boolean {
  return (term.select?.subclassIncludes ?? []).length > 0;
}

/**
 * Catalogue drugs a term should plausibly cover but does not.
 *
 * The mirror of `substringTraps`. That check finds drugs swept in by accident;
 * this one finds drugs left out — the direction that produces a MISSED alert,
 * which is the dangerous one. A record counts as missed when its own class or
 * subclass names one of the term's phrases and the term did not select it and
 * did not deliberately deny it.
 *
 * A clean run is worth as much as a hit here: it is what turns "`arbs` resolves
 * to one drug — is the selector too narrow?" into "the catalogue holds one ARB".
 *
 * That cuts both ways, which is why this had two blind spots worth naming. A
 * printed "checked, nothing found" that could not have found anything is worse
 * than no line at all, because it retires the question.
 *
 * 1. The old `stem.length < 4` bail silently disabled the whole check for any
 *    three-letter class acronym. `tcas`, `arbs` and `ppis` are the three, and
 *    `tcas`/`arbs` have no surface long enough to carry them, so neither could
 *    ever report — which is how Dosulepin, subclass `TCA`, sat outside that term's
 *    20 CRITICAL/HIGH rows unreported. The floor is now 3, the shortest stem any
 *    real surface produces.
 *
 *    Deliberately still a PREFIX match, not a whole-token one. The leading `\b`
 *    already stops `arb` reaching inside `Carbapenem` — the trap `substringTraps`
 *    exists for — so anchoring the tail buys no safety, and it would newly MISS a
 *    subclass spelled `TCAs`, which is the dangerous direction.
 * 2. The haystack read only `class` and `subclass`, never `tag`. Celecoxib and
 *    Parecoxib are `COX-2 Inhibitor` by subclass but `NSAID` by tag, so the
 *    catalogue does call them NSAIDs — in the one field this check ignored.
 */
export function missedClassMembers(
  terms: readonly LexiconTerm[],
  expansions: Map<string, string[]>,
  records: readonly MedicationRecord[],
): string[] {
  const flags: string[] = [];
  for (const term of terms) {
    const selected = new Set(expansions.get(term.id) ?? []);
    const denied = new Set(term.select?.denySlugs ?? []);
    const missed: string[] = [];
    for (const record of records) {
      if (selected.has(record.slug) || denied.has(record.slug)) continue;
      const haystack = `${record.class ?? ""} ${record.subclass ?? ""} ${record.tag ?? ""}`.toLowerCase();
      const hit = term.surfaces.some((surface) => {
        // Compare singular stems so "NSAIDs" matches a subclass reading "NSAID".
        const stem = surface.toLowerCase().replace(/s$/, "");
        if (stem.length < 3) return false;
        return new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(haystack);
      });
      if (hit) missed.push(`${record.name} (${record.subclass ?? record.class})`);
    }
    if (missed.length > 0) {
      flags.push(
        `\`${term.id}\` does **not** cover ${missed.join(", ")}, whose own catalogue class names the term.` +
          ` A drug left out of a class is a missed alert, not a false one.`,
      );
    }
  }
  return flags;
}

/**
 * Which catalogue drugs this tool can never warn about.
 *
 * The most important number on the sheet and the one hardest to see from the
 * term table: a drug outside both ends of every resolved interaction edge
 * produces silence when a clinician enters it, and silence in this UI is
 * indistinguishable from "checked, nothing found". Rendered as classes rather
 * than individual drug names, because the actionable question is which *kinds*
 * of medicine are dark.
 */
function coverageSection(records: readonly MedicationRecord[], index: IndexShape): string[] {
  const reachable = new Set<string>();
  for (const [sourceSlug, entry] of Object.entries(index.bySlug)) {
    for (const row of entry.rows) {
      const counterparties = row.counterparties ?? [];
      if (counterparties.length > 0) reachable.add(sourceSlug);
      for (const slug of counterparties) reachable.add(slug);
    }
  }
  const dark = records.filter((record) => !reachable.has(record.slug));
  const byClass = new Map<string, string[]>();
  for (const record of dark) {
    const bucket = byClass.get(record.class ?? "(unclassified)") ?? [];
    bucket.push(record.name);
    byClass.set(record.class ?? "(unclassified)", bucket);
  }

  const lines: string[] = [];
  lines.push("## What this tool can never warn about");
  lines.push("");
  lines.push(
    `**${dark.length} of the catalogue's ${records.length} medications sit outside both ends of every resolved`,
    `interaction row.** Entering one of them produces no alert — not because the combination was checked and`,
    "found clear, but because no machine-resolved edge in the corpus includes that drug. On screen those outcomes look the",
    "same, so this list is the honest boundary of the feature.",
  );
  lines.push("");
  lines.push("This is a **corpus coverage** limit, not necessarily a lexicon fault. Widening it means adding an");
  lines.push(
    "interaction row or making an existing row machine-resolvable, with clinical review of the source content.",
  );
  lines.push("");
  lines.push("| Class | Unreachable | Drugs |");
  lines.push("| --- | --- | --- |");
  for (const [className, names] of [...byClass].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    lines.push(`| ${escapePipes(className)} | ${names.length} | ${escapePipes(names.sort().join(", "))} |`);
  }
  lines.push("");
  return lines;
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`[lexicon-report] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
