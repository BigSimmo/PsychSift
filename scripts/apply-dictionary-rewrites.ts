/**
 * Apply clinically approved dictionary definition rewrites to the live dictionary.
 *
 * A rewrite in src/data/dictionary-definition-reviews.json is applied only when all three hold:
 *
 *   1. its `clinicalApproval` is well formed (`isDefinitionReviewClinicallyApproved`);
 *   2. its sign-off pin is current (`recordPinState(view, "dictionary-rewrite") === "current"`),
 *      so the wording being applied is exactly the wording the clinician signed;
 *   3. `reconcileDefinitionReviews` says `actionable`: the live entry still hashes to the
 *      review's baseline, so applying cannot overwrite a later improvement.
 *
 * The edit is one string literal per entry in src/lib/dictionary-data.ts, located through the
 * review's `repositoryLocation` and replaced by source offset; every other byte is kept. It
 * refuses — and changes nothing at all — when any approved review is stale, conflicted,
 * ambiguous, or its baseline literal is not found exactly once with the expected escaping.
 *
 * "Applied" is not written anywhere: the review keeps its `baselineWording` (the pin covers
 * it, so editing it would break the sign-off) and gains no new field. Once the live wording
 * equals the approved proposal, `reconcileDefinitionReviews` reports `applied`, and a second
 * run is a no-op.
 *
 * Offline and deterministic. Report-only by default.
 *
 * Usage:
 *   node scripts/run-tsx.mjs scripts/apply-dictionary-rewrites.ts            # report (same as --check)
 *   node scripts/run-tsx.mjs scripts/apply-dictionary-rewrites.ts --write    # apply
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import type { DictionaryEntry } from "@/lib/dictionary-data";
import {
  definitionReviewApprovalDefect,
  dictionaryDefinitionReviewIssues,
  isDefinitionReviewClinicallyApproved,
  reconcileDefinitionReviews,
  type DictionaryDefinitionReview,
} from "@/lib/dictionary-editorial/definition-reviews";

import { collectionOf, recordPinState } from "./lib/clinical-record-review-contract.mjs";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const DICTIONARY_DATA_PATH = "src/lib/dictionary-data.ts";
export const DEFINITION_REVIEWS_PATH = "src/data/dictionary-definition-reviews.json";

const LOCATION = /^src\/lib\/dictionary-data\.ts :: topicSeeds\[slug="([^"]+)"\]\.entries\[(\d+)\]$/;

/** One `[term, definition, …]` tuple in `topicSeeds`, with the definition literal's source span. */
export type DictionarySeedDefinition = {
  topicSlug: string;
  index: number;
  term: string;
  slug: string;
  definition: string;
  /** Source offsets of the definition string literal, quotes included. */
  start: number;
  end: number;
  raw: string;
};

export type DictionaryRewrite = {
  reviewId: string;
  entrySlug: string;
  from: string;
  to: string;
  start: number;
  end: number;
};

export type DictionaryRewritePlan = {
  /** Empty whenever `problems` is non-empty: a refusal applies nothing. */
  toApply: readonly DictionaryRewrite[];
  alreadyApplied: readonly { reviewId: string; entrySlug: string }[];
  problems: readonly string[];
  /** The dictionary source with `toApply` made; identical to the input when nothing applies. */
  nextSource: string;
};

/** Same rule as the dictionary module's private `slugify`; cross-checked against runtime entries by the CLI. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const member of object.properties) {
    if (ts.isPropertyAssignment(member) && ts.isIdentifier(member.name) && member.name.text === name) {
      return member.initializer;
    }
  }
  return undefined;
}

/**
 * Every entry tuple in `topicSeeds`, read from the source text. Throws on any shape it does not
 * recognise, so an unexpected file layout is a refusal rather than a guessed edit.
 */
export function readDictionarySeeds(source: string): DictionarySeedDefinition[] {
  const file = ts.createSourceFile(DICTIONARY_DATA_PATH, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const initializers: ts.Expression[] = [];
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "topicSeeds" && declaration.initializer) {
        initializers.push(declaration.initializer);
      }
    }
  }
  if (initializers.length !== 1) throw new Error(`expected one topicSeeds declaration, found ${initializers.length}`);
  const topics = unwrap(initializers[0]);
  if (!ts.isArrayLiteralExpression(topics)) throw new Error("topicSeeds is not an array literal");

  const seeds: DictionarySeedDefinition[] = [];
  for (const topic of topics.elements) {
    if (!ts.isObjectLiteralExpression(topic)) throw new Error("a topicSeeds element is not an object literal");
    const slug = property(topic, "slug");
    const entries = property(topic, "entries");
    if (!slug || !ts.isStringLiteral(slug)) throw new Error("a topic has no string-literal slug");
    if (!entries || !ts.isArrayLiteralExpression(entries)) throw new Error(`topic ${slug.text} has no entries array`);
    entries.elements.forEach((entry, index) => {
      if (!ts.isArrayLiteralExpression(entry)) throw new Error(`topic ${slug.text} entry ${index} is not a tuple`);
      const [term, definition] = entry.elements;
      if (!term || !ts.isStringLiteral(term) || !definition || !ts.isStringLiteral(definition)) {
        throw new Error(`topic ${slug.text} entry ${index} does not start with two string literals`);
      }
      const start = definition.getStart(file);
      const end = definition.getEnd();
      seeds.push({
        topicSlug: slug.text,
        index,
        term: term.text,
        slug: slugify(term.text),
        definition: definition.text,
        start,
        end,
        raw: source.slice(start, end),
      });
    });
  }
  return seeds;
}

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) found.push(at);
  return found;
}

function refuse(source: string, problems: string[], alreadyApplied: DictionaryRewritePlan["alreadyApplied"] = []) {
  return { toApply: [], alreadyApplied, problems, nextSource: source } satisfies DictionaryRewritePlan;
}

/**
 * Decide, without touching disk, which approved rewrites apply to `source`.
 *
 * @param runtimeEntries when given (the CLI passes the imported `dictionaryEntries`), the entries
 *   read from the source text must match them exactly, proving the locator reads the file the way
 *   the app does.
 */
export function planDictionaryRewrites(
  reviewsDocument: unknown,
  source: string,
  runtimeEntries?: readonly Pick<DictionaryEntry, "slug" | "definition">[],
): DictionaryRewritePlan {
  const reviews = (reviewsDocument as { reviews?: unknown } | null)?.reviews;
  if (!Array.isArray(reviews)) return refuse(source, [`${DEFINITION_REVIEWS_PATH} must hold a "reviews" array.`]);
  const typedReviews = reviews as DictionaryDefinitionReview[];

  let seeds: DictionarySeedDefinition[];
  try {
    seeds = readDictionarySeeds(source);
  } catch (error) {
    return refuse(source, [`${DICTIONARY_DATA_PATH} could not be read safely: ${(error as Error).message}.`]);
  }

  const problems: string[] = dictionaryDefinitionReviewIssues(typedReviews).map((issue) => `review set: ${issue}`);

  if (runtimeEntries) {
    const parsed = JSON.stringify(seeds.map(({ slug, definition }) => [slug, definition]));
    const runtime = JSON.stringify(runtimeEntries.map(({ slug, definition }) => [slug, definition]));
    if (parsed !== runtime) {
      problems.push(`${DICTIONARY_DATA_PATH}: the entries read from the source do not match the runtime dictionary.`);
    }
  }

  const approvals = typedReviews.filter((review) => review.clinicalApproval !== undefined);
  for (const review of approvals) {
    const defect = definitionReviewApprovalDefect(review.clinicalApproval);
    if (defect) problems.push(`${review.id}: ${defect}.`);
  }
  const approved = approvals.filter((review) => isDefinitionReviewClinicallyApproved(review));

  const perSlug = new Map<string, number>();
  for (const review of approved) perSlug.set(review.entrySlug, (perSlug.get(review.entrySlug) ?? 0) + 1);
  for (const [slug, count] of perSlug) {
    if (count > 1) problems.push(`${slug}: ${count} approved reviews target this entry; only one can be applied.`);
  }

  const views = new Map(
    (collectionOf("dictionary-rewrite", reviewsDocument) as { id: string }[]).map((view) => [view.id, view]),
  );
  const entries = seeds.map(({ slug, definition }) => ({ slug, definition }));
  const outcomes = new Map(reconcileDefinitionReviews(approved, entries).map((outcome) => [outcome.reviewId, outcome]));

  const toApply: DictionaryRewrite[] = [];
  const alreadyApplied: { reviewId: string; entrySlug: string }[] = [];
  for (const review of approved) {
    const label = `${review.id} (${review.entrySlug})`;
    const pin = recordPinState(views.get(review.id), "dictionary-rewrite");
    if (pin !== "current") {
      problems.push(
        `${label}: the sign-off pin is ${pin} — the review changed after it was approved. Re-run the clinical review.`,
      );
      continue;
    }
    const outcome = outcomes.get(review.id);
    if (outcome?.outcome === "applied") {
      alreadyApplied.push({ reviewId: review.id, entrySlug: review.entrySlug });
      continue;
    }
    if (outcome?.outcome !== "actionable") {
      problems.push(`${label}: reconcile says ${outcome?.outcome ?? "nothing"} — ${outcome?.reason ?? "no outcome"}`);
      continue;
    }
    const proposed = review.proposedWording as string;
    if (proposed === review.baselineWording) {
      problems.push(`${label}: the proposed wording is identical to the baseline; there is nothing to apply.`);
      continue;
    }
    const location = LOCATION.exec(review.repositoryLocation);
    if (!location) {
      problems.push(`${label}: repositoryLocation "${review.repositoryLocation}" is not a dictionary-data.ts entry.`);
      continue;
    }
    const seed = seeds.find(
      (candidate) => candidate.topicSlug === location[1] && candidate.index === Number(location[2]),
    );
    if (!seed || seed.slug !== review.entrySlug) {
      problems.push(`${label}: repositoryLocation does not resolve to this entry in ${DICTIONARY_DATA_PATH}.`);
      continue;
    }
    if (seeds.filter((candidate) => candidate.slug === review.entrySlug).length !== 1) {
      problems.push(`${label}: more than one dictionary entry has this slug.`);
      continue;
    }
    const expectedLiteral = JSON.stringify(review.baselineWording);
    if (seed.raw !== expectedLiteral) {
      problems.push(
        `${label}: the definition literal is escaped or quoted differently (${seed.raw}); edit it by hand.`,
      );
      continue;
    }
    const found = occurrences(source, expectedLiteral);
    if (found.length !== 1 || found[0] !== seed.start) {
      problems.push(
        `${label}: the baseline literal occurs ${found.length} times in ${DICTIONARY_DATA_PATH}; exactly one is required.`,
      );
      continue;
    }
    toApply.push({
      reviewId: review.id,
      entrySlug: review.entrySlug,
      from: review.baselineWording,
      to: proposed,
      start: seed.start,
      end: seed.end,
    });
  }

  if (problems.length > 0) return refuse(source, problems, alreadyApplied);

  let nextSource = source;
  for (const rewrite of [...toApply].sort((left, right) => right.start - left.start)) {
    nextSource = `${nextSource.slice(0, rewrite.start)}${JSON.stringify(rewrite.to)}${nextSource.slice(rewrite.end)}`;
  }
  const verification = verifyAppliedSource(source, nextSource, toApply);
  if (verification) return refuse(source, [verification], alreadyApplied);
  return { toApply, alreadyApplied, problems: [], nextSource };
}

/**
 * Null when `next` differs from `before` in exactly the planned definitions and nothing else the
 * dictionary reads; otherwise why not. Used after the literal swap and again after formatting.
 */
export function verifyAppliedSource(
  before: string,
  next: string,
  rewrites: readonly Pick<DictionaryRewrite, "entrySlug" | "to">[],
): string | null {
  let beforeSeeds: DictionarySeedDefinition[];
  let nextSeeds: DictionarySeedDefinition[];
  try {
    beforeSeeds = readDictionarySeeds(before);
    nextSeeds = readDictionarySeeds(next);
  } catch (error) {
    return `the rewritten dictionary could not be read back: ${(error as Error).message}.`;
  }
  if (beforeSeeds.length !== nextSeeds.length) return "the rewritten dictionary has a different number of entries.";
  const targets = new Map(rewrites.map((rewrite) => [rewrite.entrySlug, rewrite.to]));
  for (const [index, previous] of beforeSeeds.entries()) {
    const current = nextSeeds[index];
    const expected = targets.get(previous.slug) ?? previous.definition;
    if (current.slug !== previous.slug || current.term !== previous.term || current.definition !== expected) {
      return `the rewritten dictionary changed ${previous.slug} unexpectedly.`;
    }
  }
  return null;
}

async function formatLikeTheRepository(root: string, path: string, before: string, next: string): Promise<string> {
  const prettier = await import("prettier");
  const info = await prettier.getFileInfo(path, { ignorePath: join(root, ".prettierignore") });
  if (info.ignored) return next;
  const options = { ...((await prettier.resolveConfig(path)) ?? {}), filepath: path };
  // Only reformat a file that was already formatted, so no unrelated line is ever touched.
  if (!(await prettier.check(before, options))) return next;
  return prettier.format(next, options);
}

function writeAtomically(path: string, content: string) {
  const temporary = `${path}.apply-rewrites-${process.pid}.tmp`;
  try {
    writeFileSync(temporary, content, "utf8");
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export type ApplyRunOptions = {
  root: string;
  write: boolean;
  runtimeEntries?: readonly Pick<DictionaryEntry, "slug" | "definition">[];
  log?: (line: string) => void;
};

/** Read, plan, report, and (with `write`) apply. Returns the process exit code. */
export async function runApplyDictionaryRewrites({
  root,
  write,
  runtimeEntries,
  log = console.log,
}: ApplyRunOptions): Promise<{ exitCode: number; plan: DictionaryRewritePlan; wrote: boolean }> {
  const dictionaryPath = join(root, DICTIONARY_DATA_PATH);
  const reviewsDocument: unknown = JSON.parse(readFileSync(join(root, DEFINITION_REVIEWS_PATH), "utf8"));
  const source = readFileSync(dictionaryPath, "utf8");
  const plan = planDictionaryRewrites(reviewsDocument, source, runtimeEntries);

  for (const applied of plan.alreadyApplied) log(`already applied: ${applied.reviewId} (${applied.entrySlug})`);
  if (plan.problems.length > 0) {
    log(`Refusing: nothing was changed. ${plan.problems.length} problem(s):`);
    for (const problem of plan.problems) log(`- ${problem}`);
    return { exitCode: 1, plan, wrote: false };
  }
  if (plan.toApply.length === 0) {
    log("No approved rewrite is waiting to be applied.");
    return { exitCode: 0, plan, wrote: false };
  }
  for (const rewrite of plan.toApply) {
    log(`${write ? "applying" : "would apply"}: ${rewrite.reviewId} (${rewrite.entrySlug})`);
    log(`  from: ${rewrite.from}`);
    log(`  to:   ${rewrite.to}`);
  }
  if (!write) {
    log(`Report only: ${plan.toApply.length} rewrite(s) would be applied. Re-run with --write to apply.`);
    return { exitCode: 0, plan, wrote: false };
  }

  const formatted = await formatLikeTheRepository(root, dictionaryPath, source, plan.nextSource);
  const problem = verifyAppliedSource(source, formatted, plan.toApply);
  if (problem) {
    log(`Refusing after formatting: nothing was changed. ${problem}`);
    return { exitCode: 1, plan, wrote: false };
  }
  // Refuse if the file moved underneath us while we planned.
  if (readFileSync(dictionaryPath, "utf8") !== source) {
    log(`Refusing: ${DICTIONARY_DATA_PATH} changed during the run. Nothing was changed; run again.`);
    return { exitCode: 1, plan, wrote: false };
  }
  writeAtomically(dictionaryPath, formatted);
  log(`Applied ${plan.toApply.length} rewrite(s) to ${DICTIONARY_DATA_PATH}.`);
  return { exitCode: 0, plan, wrote: true };
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--write" && arg !== "--check");
  if (unknown.length > 0 || (args.includes("--write") && args.includes("--check"))) {
    console.error("usage: apply-dictionary-rewrites.ts [--check | --write]");
    process.exit(2);
  }
  const { dictionaryEntries } = await import("@/lib/dictionary-data");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { exitCode } = await runApplyDictionaryRewrites({
    root,
    write: args.includes("--write"),
    runtimeEntries: dictionaryEntries,
  });
  process.exit(exitCode);
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
