#!/usr/bin/env node

/**
 * Local, clinician-input Therapy sign-off workflow.
 *
 * Report-only by default. `--write` requires an interactive TTY and answers typed by
 * the reviewer. There is no yes, answers, provider, or production mode. `--walk` only
 * chooses the order: it steps through every record still awaiting review, one screen at
 * a time, and each record still needs its own seven answers and its own typed
 * confirmation.
 *
 * Batch sign-off exists by owner decision, 2026-09-26. `--pack` writes a review pack
 * (sign-off-packs/therapy.html) showing every record awaiting review that lists
 * references, exactly as the seven checks display it, plus a sign-off code derived from
 * the content hash of every record in the pack. `--write --batch` asks the seven checks
 * once for the whole set and then requires that code to be typed back. The code is
 * recomputed from the files at signing time, so if any record changed (or one was added)
 * after the pack was written, it no longer matches and nothing is signed. The pack code
 * is what ties a batch sign-off to the exact text the reviewer read.
 *
 * Usage:
 *   npm run therapy:review
 *   npm run therapy:review -- --slug <slug>
 *   npm run therapy:review -- --pack [--reviewed-by "<public attribution>"]
 *   npm run therapy:review -- --write --slug <slug> --reviewed-by "<public attribution>"
 *   npm run therapy:review -- --write --walk --reviewed-by "<public attribution>"
 *   npm run therapy:review -- --write --batch --reviewed-by "<public attribution>" [--exclude <slug>,<slug>]
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  THERAPY_GENERATED_PATHS,
  THERAPY_HASHED_ASSET_RE,
  THERAPY_REVIEW_CHECKS,
  assertValidTherapyReviewRecords,
  finalizeTherapyReview,
  publicReviewerAttributionProblem,
  therapyReviewedContentSha256,
} from "./lib/therapy-review-contract.mjs";
import { createPrompt } from "./lib/confirm.mjs";
import { INDIGENOUS_CONTENT_RULE, indigenousContentTerm } from "./lib/indigenous-content.mjs";
import { parseExcludeList, renderSignOffPack, signOffPackCode } from "./lib/sign-off-pack.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = join(ROOT, THERAPY_GENERATED_PATHS.source);
const PUBLIC_DATA_PATH = join(ROOT, THERAPY_GENERATED_PATHS.publicDirectory);
const FIXED_GENERATED_PATHS = Object.freeze([
  join(ROOT, THERAPY_GENERATED_PATHS.serverIndex),
  join(ROOT, THERAPY_GENERATED_PATHS.manifest),
  join(PUBLIC_DATA_PATH, THERAPY_GENERATED_PATHS.retiredHomeAlias),
]);
const GENERATOR_PATH = join(ROOT, "scripts", "build-therapies-index.mjs");
const PACK_PATH = join(ROOT, "sign-off-packs", "therapy.html");
const REVIEWED_BY_PLACEHOLDER = "<your public name>";

function usage() {
  return [
    "Usage: npm run therapy:review -- [--slug <slug>] [--write --reviewed-by <public attribution>]",
    "       npm run therapy:review -- --pack [--reviewed-by <public attribution>]",
    "       npm run therapy:review -- --write --walk --reviewed-by <public attribution>",
    "       npm run therapy:review -- --write --batch --reviewed-by <public attribution> [--exclude <slug>,<slug>]",
    "",
    "Without --write this is a report-only queue/record inspection and touches nothing.",
    "--write requires a real interactive TTY and one exact --slug, --walk, or --batch.",
    "--walk steps through every record awaiting review in catalogue order, one at a time.",
    "Each record is saved the moment you confirm it, so quitting keeps everything signed so far.",
    "",
    "Batch sign-off (owner decision, 2026-09-26): --pack writes sign-off-packs/therapy.html, a",
    "review pack of every record awaiting review that lists references, with a sign-off code.",
    "--write --batch asks the seven checks once for the whole set, then asks for that code. The",
    "code is recomputed from the files at signing time, so if anything in the set changed since",
    "the pack was written, nothing is signed. The code is what ties the batch to the text you read.",
    "--exclude leaves the named records unsigned; it is only valid with --batch.",
    "",
    "Every checklist answer is entered interactively; no automatic-yes, answers, or provider mode exists.",
    "",
    "reviewedBy is shipped in the public Therapy catalogue. Use only a display-approved",
    "professional name or governance-owner label; never enter an email address, account id,",
    "AHPRA/registration number, provider number, employee/staff id, or another private identifier.",
  ].join("\n");
}

export function parseTherapyReviewArgs(argv) {
  const args = {
    help: false,
    write: false,
    walk: false,
    pack: false,
    batch: false,
    slug: undefined,
    reviewedBy: undefined,
    exclude: undefined,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      if (seen.has("help")) throw new Error("--help may only be supplied once.");
      seen.add("help");
      args.help = true;
      continue;
    }
    if (token === "--write" || token === "--walk" || token === "--pack" || token === "--batch") {
      const name = token.slice(2);
      if (seen.has(name)) throw new Error(`${token} may only be supplied once.`);
      seen.add(name);
      args[name] = true;
      continue;
    }
    if (token === "--slug" || token === "--reviewed-by" || token === "--exclude") {
      const name = token.slice(2);
      if (seen.has(name)) throw new Error(`${token} may only be supplied once.`);
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
      seen.add(name);
      if (token === "--slug") args.slug = value;
      else if (token === "--exclude") args.exclude = parseExcludeList(value);
      else args.reviewedBy = value;
      index += 1;
      continue;
    }
    throw new Error(
      `Unknown option: ${token}. Therapy attestations cannot be supplied through yes, answer, or provider flags.`,
    );
  }
  if (args.pack && (args.write || args.walk || args.batch || args.slug !== undefined)) {
    throw new Error("--pack only writes the review pack; leave out --write, --walk, --batch and --slug.");
  }
  if (args.exclude !== undefined && !args.batch) throw new Error("--exclude is only valid with --write --batch.");
  if (args.walk && !args.write) throw new Error("--walk is a sign-off mode; use it with --write.");
  if (args.walk && args.slug !== undefined) throw new Error("--walk goes through the whole queue; leave out --slug.");
  if (args.batch && !args.write) throw new Error("--batch is a sign-off mode; use it with --write.");
  if (args.batch && args.walk) throw new Error("--batch signs the whole pack at once; leave out --walk.");
  if (args.batch && args.slug !== undefined) throw new Error("--batch signs the whole pack; leave out --slug.");
  return args;
}

/**
 * The Source correspondence check asks the reviewer to compare the record with its
 * references. A record that lists none cannot honestly pass it, so it cannot be signed
 * off until a source is added.
 */
export function therapyHasReferences(record) {
  const references = Array.isArray(record.references) ? record.references.join(" ") : String(record.references ?? "");
  return references.trim().length > 0;
}

/** Records the walk offers, in catalogue order: awaiting review, with references to check against. */
export function therapyWalkQueue(records) {
  return records
    .filter(
      (record) =>
        record.reviewStatus !== "reviewed" && therapyHasReferences(record) && !therapyIndigenousContent(record),
    )
    .map((record) => record.slug);
}

/** The Indigenous term in a record's content, or null. Such a record is never offered or signed. */
export function therapyIndigenousContent(record) {
  const content = Object.fromEntries(
    Object.entries(record).filter(
      ([key]) =>
        !["reviewStatus", "reviewChecklist", "reviewedBy", "reviewedAt", "reviewedContentSha256"].includes(key),
    ),
  );
  return indigenousContentTerm(content);
}

/** Records awaiting review that list no references, so cannot be signed off yet. */
export function therapyNeedsSource(records) {
  return records
    .filter((record) => record.reviewStatus !== "reviewed" && !therapyHasReferences(record))
    .map((record) => record.slug);
}

function writeLine(output, value = "") {
  output.write(`${value}\n`);
}

function printable(value) {
  if (value === null || value === undefined || value === "") return "(not provided)";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function renderedProseEntries(record) {
  return Object.entries(record).filter(
    ([key, value]) =>
      !["reviewStatus", "reviewChecklist", "reviewedBy", "reviewedAt", "reviewedContentSha256"].includes(key) &&
      (typeof value === "string" || Array.isArray(value)),
  );
}

/** The [field, value] pairs one check displays for a record, shared by the walk screen and the pack. */
function checkEntries(record, check) {
  return check.fields.flatMap((field) =>
    field === "all rendered prose" ? renderedProseEntries(record) : [[field, record[field]]],
  );
}

function showCheck(record, check, output) {
  writeLine(output);
  writeLine(output, `=== ${check.label} (${check.authority}) ===`);
  for (const [field, value] of checkEntries(record, check)) {
    writeLine(output, `\n[${field}]`);
    writeLine(output, printable(value));
  }
}

function normalizeAnswer(value) {
  const answer = String(value).trim().toLowerCase();
  if (answer === "yes") return true;
  if (answer === "no") return false;
  if (answer === "quit" || answer === "q") return "quit";
  if (answer === "skip") return "skip";
  return null;
}

/**
 * Testable interactive core. `commit` is called exactly once only after seven
 * explicit yes answers and the exact final confirmation.
 */
export async function conductTherapyReview({ record, reviewedBy, ask, commit, now = () => new Date(), output }) {
  const attributionProblem = publicReviewerAttributionProblem(reviewedBy);
  if (attributionProblem) throw new Error(attributionProblem);

  const answers = {};
  for (const check of THERAPY_REVIEW_CHECKS) {
    showCheck(record, check, output);
    let decision = null;
    while (decision === null) {
      decision = normalizeAnswer(
        await ask(`\nEnter yes only if you personally attest "${check.label}"; otherwise enter no, skip or quit: `),
      );
      if (decision === null) writeLine(output, "Enter exactly yes, no, skip, or quit.");
    }
    if (decision === "quit") return { status: "quit", record };
    if (decision === "skip") {
      writeLine(output, "Skipped. Nothing was changed for this record.");
      return { status: "skipped", record };
    }
    answers[check.key] = decision;
  }

  if (Object.values(answers).some((answer) => answer !== true)) {
    writeLine(output, "At least one check was not attested. The source remains unchanged and needs_review.");
    return { status: "incomplete", record };
  }

  const expectedConfirmation = `REVIEW ${record.slug}`;
  const confirmation = await ask(`\nType ${expectedConfirmation} to write this clinician sign-off: `);
  if (confirmation !== expectedConfirmation) {
    writeLine(output, "Confirmation did not match. The source remains unchanged.");
    return { status: "cancelled", record };
  }

  const reviewedAt = now().toISOString();
  const reviewed = finalizeTherapyReview(record, { answers, reviewedBy, reviewedAt, now: new Date(reviewedAt) });
  await commit(reviewed);
  return { status: "reviewed", record: reviewed };
}

/** The records a pack shows and a batch signs, in catalogue order (the walk queue). */
function therapyPackRecords(records) {
  const queue = new Set(therapyWalkQueue(records));
  return records.filter((record) => queue.has(record.slug));
}

/** The sign-off code for the current pack: derived from every pack record's content hash. */
export function therapyPackCode(records) {
  return signOffPackCode(
    therapyPackRecords(records).map((record) => ({
      code: record.slug,
      sha256: therapyReviewedContentSha256(record),
    })),
  );
}

/**
 * The review pack as a self-contained HTML page; each record is shown exactly as the seven checks display it.
 *
 * @param {Array<Record<string, any>>} records
 * @param {{ reviewedBy?: string, generatedAt?: string }} [options]
 */
export function renderTherapyPack(records, { reviewedBy, generatedAt = new Date().toISOString() } = {}) {
  if (reviewedBy !== undefined) {
    const attributionProblem = publicReviewerAttributionProblem(reviewedBy);
    if (attributionProblem) throw new Error(attributionProblem);
  }
  const packRecords = therapyPackRecords(records);
  const needsSource = therapyNeedsSource(records);
  return renderSignOffPack({
    title: "Therapy sign-off pack",
    code: therapyPackCode(records),
    reviewedBy,
    intro: [
      `This pack holds every Therapy record awaiting sign-off that lists references to check it against (${packRecords.length}).`,
      `${needsSource.length} records awaiting review list no references yet, so they are left out until a source is added.`,
      "The name you sign with is shown publicly in the Therapy catalogue. Use only a display-approved professional name.",
    ],
    questions: THERAPY_REVIEW_CHECKS.map((check) => `I personally attest: ${check.label} (${check.authority})`),
    batchCommand: `npm.cmd run therapy:review -- --write --batch --reviewed-by "${reviewedBy ?? REVIEWED_BY_PLACEHOLDER}" --exclude <slugs>`,
    records: packRecords.map((record) => ({
      code: record.slug,
      heading: `${record.name} (${record.slug})`,
      sections: THERAPY_REVIEW_CHECKS.flatMap((check) =>
        checkEntries(record, check).map(([field, value]) => ({
          label: `${check.label}: ${field}`,
          text: printable(value),
        })),
      ),
    })),
    generatedAt,
  });
}

function normalizeBatchAnswer(value) {
  const answer = String(value).trim().toLowerCase();
  if (answer === "yes") return true;
  if (answer === "no") return false;
  if (answer === "quit" || answer === "q") return "quit";
  return null;
}

/**
 * Testable batch core, no file IO. Asks each of the seven checks once for the whole set,
 * then requires the pack's sign-off code, recomputed from `records` as they are now. Any no,
 * a quit, or a code that does not match returns without signing anything.
 *
 * @param {{
 *   records: Array<Record<string, any>>,
 *   reviewedBy: string,
 *   exclude?: string[],
 *   ask: (question: string) => Promise<string>,
 *   output: { write: (chunk: string) => unknown },
 *   now?: () => Date,
 * }} options
 */
export async function conductTherapyBatchReview({
  records,
  reviewedBy,
  exclude = [],
  ask,
  output,
  now = () => new Date(),
}) {
  const attributionProblem = publicReviewerAttributionProblem(reviewedBy);
  if (attributionProblem) throw new Error(attributionProblem);

  const packRecords = therapyPackRecords(records);
  const packSlugs = new Set(packRecords.map((record) => record.slug));
  const unknown = exclude.filter((slug) => !packSlugs.has(slug));
  if (unknown.length) {
    throw new Error(`--exclude names records that are not in the pack: ${unknown.join(", ")}.`);
  }
  const excluded = new Set(exclude);
  const toSign = packRecords.filter((record) => !excluded.has(record.slug));
  const code = therapyPackCode(records);

  if (toSign.length === 0) {
    writeLine(output, "Nothing to sign: every record in the pack is excluded or already signed off.");
    return { status: "nothing-to-sign", signed: [] };
  }

  writeLine(output);
  writeLine(output, `This will sign off ${toSign.length} Therapy records as: ${reviewedBy}`);
  writeLine(output, `Excluded (left unsigned): ${exclude.length ? exclude.join(", ") : "none"}.`);

  for (const check of THERAPY_REVIEW_CHECKS) {
    let decision = null;
    while (decision === null) {
      decision = normalizeBatchAnswer(
        await ask(
          `\nEnter yes only if you personally attest "${check.label}" (${check.authority}) for every one of these ${toSign.length} records; otherwise enter no or quit: `,
        ),
      );
      if (decision === null) writeLine(output, "Enter exactly yes, no, or quit.");
    }
    if (decision === "quit") {
      writeLine(output, "Stopped. Nothing was signed.");
      return { status: "quit", signed: [] };
    }
    if (decision !== true) {
      writeLine(output, "That check was not attested for the whole set. Nothing was signed.");
      return { status: "incomplete", signed: [] };
    }
  }

  const typed = await ask("\nType the sign-off code printed at the top of the pack: ");
  if (
    String(typed ?? "")
      .trim()
      .toLowerCase() !== code
  ) {
    writeLine(
      output,
      "The code does not match. Either the set changed since the pack was written, or the code was mistyped. Nothing was signed.",
    );
    return { status: "code-mismatch", signed: [] };
  }

  const reviewedAt = now().toISOString();
  const answers = Object.fromEntries(THERAPY_REVIEW_CHECKS.map((check) => [check.key, true]));
  const reviewedByRecord = new Map(
    toSign.map((record) => [
      record,
      finalizeTherapyReview(record, { answers, reviewedBy, reviewedAt, now: new Date(reviewedAt) }),
    ]),
  );
  const nextRecords = records.map((record) => reviewedByRecord.get(record) ?? record);
  assertValidTherapyReviewRecords(nextRecords, { now: new Date(reviewedAt) });
  return { status: "reviewed", records: nextRecords, signed: toSign.map((record) => record.slug) };
}

function replaceFileAtomically(path, contents, { expectedRaw } = {}) {
  if (expectedRaw !== undefined && readFileSync(path, "utf8") !== expectedRaw) {
    throw new Error("Therapy source changed after review began; refusing to overwrite concurrent work.");
  }
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx");
    writeFileSync(descriptor, contents);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (expectedRaw !== undefined && readFileSync(path, "utf8") !== expectedRaw) {
      throw new Error(
        "Therapy source changed while sign-off was being written; refusing to overwrite concurrent work.",
      );
    }
    renameSync(temporary, path);
  } finally {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { force: true });
    }
  }
}

/** Compact, same-directory atomic replacement for the canonical one-line JSON. */
export function writeTherapySourceAtomically(path, records, { expectedRaw } = {}) {
  replaceFileAtomically(path, JSON.stringify(records), { expectedRaw });
}

function listGeneratedCataloguePaths() {
  if (!existsSync(PUBLIC_DATA_PATH)) return [];
  return readdirSync(PUBLIC_DATA_PATH)
    .filter((name) => THERAPY_HASHED_ASSET_RE.test(name))
    .map((name) => join(PUBLIC_DATA_PATH, name));
}

function captureGeneratedFiles(fixedGeneratedPaths, listGeneratedPaths) {
  const paths = new Set([...fixedGeneratedPaths, ...listGeneratedPaths()]);
  return new Map([...paths].map((path) => [path, existsSync(path) ? readFileSync(path) : null]));
}

function restoreGeneratedFiles(snapshot, fixedGeneratedPaths, listGeneratedPaths) {
  const currentPaths = new Set([...fixedGeneratedPaths, ...listGeneratedPaths()]);
  for (const path of currentPaths) {
    if (!snapshot.has(path) && existsSync(path)) rmSync(path, { force: true });
  }
  for (const [path, contents] of snapshot) {
    if (contents === null) {
      if (existsSync(path)) rmSync(path, { force: true });
    } else {
      replaceFileAtomically(path, contents);
    }
  }
}

function sourceMatchesIntendedBytes(sourcePath, intendedRaw) {
  try {
    return readFileSync(sourcePath, "utf8") === intendedRaw;
  } catch {
    return false;
  }
}

function acquireReviewTransactionLock(sourcePath) {
  const lockPath = `${sourcePath}.review.lock`;
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(lockPath, "wx");
    created = true;
    writeFileSync(descriptor, `${process.pid}\n`, "utf8");
    fsyncSync(descriptor);
  } catch (error) {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } finally {
      if (created && existsSync(lockPath)) rmSync(lockPath, { force: true });
    }
    if (error?.code === "EEXIST") {
      throw new Error("Another Therapy review transaction is active; refusing a concurrent write.");
    }
    throw error;
  }
  return () => {
    try {
      closeSync(descriptor);
    } finally {
      rmSync(lockPath, { force: true });
    }
  };
}

/**
 * Commit source plus every generator-owned asset as one recoverable unit. A
 * failure restores all pre-review bytes while source still matches this
 * transaction. A concurrent source edit observed at the post-generator or
 * guarded-replacement boundaries is preserved; generated assets return to
 * their pre-review state and the transaction fails.
 */
export function persistTherapyReviewTransaction({
  sourcePath = SOURCE_PATH,
  records,
  expectedRaw,
  fixedGeneratedPaths = FIXED_GENERATED_PATHS,
  listGeneratedPaths = listGeneratedCataloguePaths,
  runGenerator = regenerateAndValidate,
}) {
  const releaseLock = acquireReviewTransactionLock(sourcePath);
  try {
    if (typeof expectedRaw !== "string" || readFileSync(sourcePath, "utf8") !== expectedRaw) {
      throw new Error("Therapy source changed after review began; refusing to overwrite concurrent work.");
    }
    const sourceBefore = Buffer.from(expectedRaw);
    const intendedRaw = JSON.stringify(records);
    const generatedBefore = captureGeneratedFiles(fixedGeneratedPaths, listGeneratedPaths);
    replaceFileAtomically(sourcePath, intendedRaw, { expectedRaw });

    let generatorError = null;
    try {
      runGenerator();
    } catch (error) {
      generatorError = error;
    }

    // This comparison is the optimistic CAS boundary for non-cooperating
    // editors. It runs after generation and before any rollback. The guarded
    // replacement rechecks the exact JSON again before replacing source bytes.
    const sourceMatchedBeforeRollback = sourceMatchesIntendedBytes(sourcePath, intendedRaw);
    if (generatorError === null && sourceMatchedBeforeRollback) return;

    const failure =
      generatorError ?? new Error("Canonical Therapy source changed while generated assets were being written.");
    try {
      restoreGeneratedFiles(generatedBefore, fixedGeneratedPaths, listGeneratedPaths);
    } catch (rollbackError) {
      throw new AggregateError(
        [failure, rollbackError],
        "Therapy sign-off failed and rollback could not restore the safe pre-review generated state.",
      );
    }

    let sourceRestored = false;
    // Recheck after restoring potentially large assets so a concurrent edit
    // arriving during rollback is preserved too.
    if (sourceMatchedBeforeRollback && sourceMatchesIntendedBytes(sourcePath, intendedRaw)) {
      try {
        replaceFileAtomically(sourcePath, sourceBefore, { expectedRaw: intendedRaw });
        sourceRestored = true;
      } catch (rollbackError) {
        // An expected-byte refusal means a non-cooperating edit won the race;
        // preserve it. Other I/O failures with our intended source still in
        // place mean rollback genuinely could not complete.
        if (sourceMatchesIntendedBytes(sourcePath, intendedRaw)) {
          throw new AggregateError(
            [failure, rollbackError],
            "Therapy sign-off failed and rollback could not restore the pre-review source bytes.",
          );
        }
      }
    }

    if (sourceRestored) {
      throw new Error("Therapy sign-off failed; exact pre-review source and generated asset bytes were restored.", {
        cause: failure,
      });
    }
    throw new Error(
      "Therapy sign-off failed after the canonical source changed concurrently; concurrent source bytes were preserved and generated assets were restored to their exact pre-review bytes.",
      { cause: failure },
    );
  } finally {
    releaseLock();
  }
}

function regenerateAndValidate() {
  execFileSync(process.execPath, [GENERATOR_PATH], { cwd: ROOT, stdio: "inherit" });
  execFileSync(process.execPath, [GENERATOR_PATH, "--check"], { cwd: ROOT, stdio: "inherit" });
}

function readCanonicalSource() {
  const raw = readFileSync(SOURCE_PATH, "utf8");
  return { raw, records: JSON.parse(raw) };
}

function writeTherapyPackFile(records, reviewedBy, output) {
  const html = renderTherapyPack(records, { reviewedBy, generatedAt: new Date().toISOString() });
  mkdirSync(dirname(PACK_PATH), { recursive: true });
  writeFileSync(PACK_PATH, html, "utf8");
  writeLine(output, `Wrote the Therapy review pack: ${PACK_PATH}`);
  writeLine(output, `Records in the pack: ${therapyWalkQueue(records).length}`);
  writeLine(output, `Sign-off code: ${therapyPackCode(records)}`);
}

function showReport(records, slug, output) {
  const pending = records.filter((record) => record.reviewStatus !== "reviewed");
  writeLine(output, `Therapy review queue: ${pending.length} needs_review / ${records.length} total.`);
  if (!slug) {
    const first = pending[0];
    if (first) writeLine(output, `Next record: ${first.slug} — ${first.name}`);
    writeLine(
      output,
      "Report only. Pass --slug <slug> to inspect one record; add --write only during clinician sign-off.",
    );
    return;
  }
  const record = records.find((entry) => entry.slug === slug);
  if (!record) throw new Error(`Unknown Therapy slug: ${slug}`);
  writeLine(output, `${record.slug} — ${record.name}`);
  writeLine(output, `Status: ${record.reviewStatus}`);
  for (const check of THERAPY_REVIEW_CHECKS) {
    writeLine(output, `- ${check.key}: ${String(record.reviewChecklist?.[check.key])} (${check.authority})`);
  }
  writeLine(output, "Report only; no file was changed.");
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const errorOutput = io.errorOutput ?? process.stderr;
  const args = parseTherapyReviewArgs(argv);
  if (args.help) {
    writeLine(output, usage());
    return 0;
  }

  const { raw, records } = readCanonicalSource();
  assertValidTherapyReviewRecords(records);
  if (args.reviewedBy !== undefined) {
    const attributionProblem = publicReviewerAttributionProblem(args.reviewedBy);
    if (attributionProblem) throw new Error(attributionProblem);
  }
  if (args.pack) {
    const needsSource = therapyNeedsSource(records);
    if (needsSource.length) {
      writeLine(output, `${needsSource.length} records list no references yet, so they are left out of the pack.`);
    }
    writeTherapyPackFile(records, args.reviewedBy, output);
    return 0;
  }
  if (!args.write) {
    showReport(records, args.slug, output);
    return 0;
  }

  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      "--write requires an interactive TTY; piped, scripted, and agent-supplied attestations are refused.",
    );
  }
  if (!args.walk && !args.batch && !args.slug) {
    throw new Error(
      "--write requires one exact --slug, --walk to step through the queue one record at a time, or --batch to sign a review pack.",
    );
  }
  if (!args.reviewedBy) throw new Error("--write requires --reviewed-by with a display-approved public attribution.");
  if (args.batch) return runBatch({ raw, records, args, input, output, errorOutput });
  const slugs = args.walk ? therapyWalkQueue(records) : [args.slug];
  if (!args.walk) {
    const record = records.find((entry) => entry.slug === args.slug);
    if (!record) throw new Error(`Unknown Therapy slug: ${args.slug}`);
    if (record.reviewStatus === "reviewed") {
      throw new Error(`${args.slug} is already reviewed; this tool will not overwrite an existing attestation.`);
    }
    if (!therapyHasReferences(record)) {
      throw new Error(
        `${args.slug} lists no references, so the Source correspondence check cannot be attested. Add a source first.`,
      );
    }
    const indigenous = therapyIndigenousContent(record);
    if (indigenous) {
      throw new Error(`${args.slug} contains Indigenous content ("${indigenous}"); ${INDIGENOUS_CONTENT_RULE}.`);
    }
  }
  const needsSource = args.walk ? therapyNeedsSource(records) : [];
  if (needsSource.length) {
    writeLine(
      output,
      `${needsSource.length} records list no references yet, so they are left out of this walk until a source is added.`,
    );
  }
  if (slugs.length === 0) {
    writeLine(output, "Nothing waiting: every Therapy record is already signed off.");
    return 0;
  }

  writeLine(errorOutput, "CLINICAL AUTHORITY: the first five checks may only be attested by a qualified clinician.");
  writeLine(
    errorOutput,
    "PRIVACY: reviewedBy is public. Do not enter contact, registration, provider, staff, or account ids.",
  );
  const signed = [];
  const skipped = [];
  let reached = 0;
  const prompt = createPrompt({ input, output });
  try {
    for (const [position, slug] of slugs.entries()) {
      reached = position + 1;
      // Re-read before every record: each sign-off rewrites the source, so every save
      // is checked against the file as it is now, never against a stale copy.
      const current = position === 0 ? { raw, records } : readCanonicalSource();
      assertValidTherapyReviewRecords(current.records);
      const recordIndex = current.records.findIndex((record) => record.slug === slug);
      if (recordIndex === -1 || current.records[recordIndex].reviewStatus === "reviewed") {
        skipped.push(slug);
        continue;
      }
      const record = current.records[recordIndex];
      if (args.walk) {
        writeLine(output);
        writeLine(output, "=".repeat(60));
        writeLine(output, `${record.slug} - ${record.name}  (${position + 1} of ${slugs.length})`);
        writeLine(output, "=".repeat(60));
      }
      const result = await conductTherapyReview({
        record,
        reviewedBy: args.reviewedBy,
        ask: prompt.ask,
        output,
        commit: async (reviewed) => {
          const nextRecords = current.records.map((entry, index) => (index === recordIndex ? reviewed : entry));
          assertValidTherapyReviewRecords(nextRecords);
          persistTherapyReviewTransaction({ sourcePath: SOURCE_PATH, records: nextRecords, expectedRaw: current.raw });
        },
      });
      if (result.status === "reviewed") {
        signed.push(slug);
        writeLine(output, `Recorded local clinician sign-off for ${slug}; generated Therapy assets are current.`);
      } else if (result.status === "quit") {
        writeLine(output, "Stopped. Nothing was saved for this record.");
        reached = position;
        break;
      } else {
        skipped.push(slug);
      }
    }
    return 0;
  } finally {
    prompt.close();
    if (args.walk) {
      const notReached = slugs.length - reached;
      writeLine(output);
      writeLine(output, `Signed off this session: ${signed.length ? signed.join(", ") : "none"}.`);
      if (skipped.length) writeLine(output, `Left unsigned: ${skipped.join(", ")}.`);
      if (notReached > 0) writeLine(output, `Not reached yet: ${notReached}. The next walk starts with them.`);
    }
  }
}

async function runBatch({ raw, records, args, input, output, errorOutput }) {
  const needsSource = therapyNeedsSource(records);
  if (needsSource.length) {
    writeLine(
      output,
      `${needsSource.length} records list no references yet, so they are not in the pack or this batch.`,
    );
  }
  if (therapyWalkQueue(records).length === 0) {
    writeLine(output, "Nothing waiting: every Therapy record with references is already signed off.");
    return 0;
  }
  writeLine(errorOutput, "CLINICAL AUTHORITY: the first five checks may only be attested by a qualified clinician.");
  writeLine(
    errorOutput,
    "PRIVACY: reviewedBy is public. Do not enter contact, registration, provider, staff, or account ids.",
  );
  const prompt = createPrompt({ input, output });
  let result;
  try {
    result = await conductTherapyBatchReview({
      records,
      reviewedBy: args.reviewedBy,
      exclude: args.exclude ?? [],
      ask: prompt.ask,
      output,
    });
  } finally {
    prompt.close();
  }
  if (result.status === "code-mismatch") {
    // Re-read so the fresh pack shows the files as they are now.
    const current = readCanonicalSource();
    assertValidTherapyReviewRecords(current.records);
    writeTherapyPackFile(current.records, args.reviewedBy, output);
    writeLine(output, "Read the fresh pack, then run the batch again with its code.");
    return 0;
  }
  if (result.status !== "reviewed") return 0;
  persistTherapyReviewTransaction({ sourcePath: SOURCE_PATH, records: result.records, expectedRaw: raw });
  writeLine(
    output,
    `Signed off ${result.signed.length} Therapy records as ${args.reviewedBy}; generated Therapy assets are current.`,
  );
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(existsSync(process.argv[1]) ? realpathSync(resolve(process.argv[1])) : resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`therapy:review: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
