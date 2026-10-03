#!/usr/bin/env node

/**
 * Local clinical sign-off for forms, Act-section summaries, statutory timeframes, the
 * locally authored differential overlays, and Formulation guides, mechanisms and concepts.
 *
 * This is how the clinical owner attests clinical content. No agent may ever record a
 * sign-off: `--write` refuses anything but a real interactive terminal, asks every
 * checklist question itself, and needs an exact typed confirmation. There is no yes,
 * answers or provider mode.
 *
 * Batch sign-off (owner decision, 2026-09-26): `--pack` writes every waiting record of one
 * kind to a readable HTML review pack headed by a sign-off code; `--write --batch` asks the
 * three questions once for the whole set and signs it only when the owner types that code.
 * The code is derived from each record's content pin, recomputed at signing time, so a set
 * that changed after its pack was written cannot be signed (scripts/lib/sign-off-pack.mjs).
 *
 * Report-only by default: it lists what is waiting and touches nothing.
 *
 * Usage:
 *   npm run clinical:review
 *   npm run clinical:review -- --kind form
 *   npm run clinical:review -- --kind form --code 3C
 *   npm run clinical:review -- --write --kind form --code 3C --reviewed-by "<public name>"
 *
 * Plain-English guide: docs/clinical-sign-off-how-to.md. The contract, including exactly
 * what the content pin covers, is scripts/lib/clinical-record-review-contract.mjs.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyClinicalReview,
  clinicalReviewConfirmation,
  collectionOf,
  finalizeClinicalReview,
  reviewerAttributionProblem,
  recordId,
  recordKinds,
  indigenousContentIn,
  recordContentSha256,
  recordPinState,
  renderedFormGuidance,
  reviewProblems,
  sameRecordId,
  signOffEligibilityProblem,
  signOffQueue,
} from "./lib/clinical-record-review-contract.mjs";
import { createPrompt } from "./lib/confirm.mjs";
import { parseExcludeList, renderSignOffPack, signOffPackCode } from "./lib/sign-off-pack.mjs";
import { signOffKindModules } from "./lib/signoff-kinds/index.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIND_NAMES = Object.keys(recordKinds);

function usage() {
  return [
    `Usage: npm run clinical:review -- [--kind <kind>] [--code <code>]`,
    "       npm run clinical:review -- --write --kind <kind> --code <code> --reviewed-by <public name>",
    "       npm run clinical:review -- --write --walk --kind <kind> --reviewed-by <public name>",
    "       npm run clinical:review -- --pack --kind <kind> [--reviewed-by <public name>]",
    "       npm run clinical:review -- --write --batch --kind <kind> --reviewed-by <public name> [--exclude a,b]",
    "",
    "--pack writes every waiting record of one kind to sign-off-packs/<kind>.html, headed by a",
    "sign-off code. --batch signs that whole set with one set of answers once you type the code;",
    "--exclude leaves out the records you are not happy with. If the set changed after the pack",
    "was written, the code no longer matches and nothing is signed.",
    "",
    `Kinds: ${KIND_NAMES.join(", ")}.`,
    "",
    "--walk steps through every unsigned record of one kind, one screen at a time (forms: 3C,",
    "10B, 10E, 11B, 11E, 6C, then catalogue order; every other kind: file order). Each record",
    "is saved the moment you confirm it, so quitting keeps everything signed so far.",
    "",
    "Without --write this only reports what is waiting and changes nothing.",
    "--write needs a real interactive terminal, one --kind, --reviewed-by, and --code, --walk or --batch.",
    "Every checklist answer is typed by you; there is no automatic-yes, answers or provider mode.",
    "",
    '--code is the form code (3C, or "1A attachment" in quotes), the section number (26),',
    "the timeframe id, the differential slug (delirium), or the Formulation record id.",
    "",
    "reviewedBy is shown publicly in the app. Use your display name (for example",
    '"Dr <your surname>" with your own surname); never an email address, AHPRA number,',
    "provider number or staff id.",
    "",
    "Guide: docs/clinical-sign-off-how-to.md",
  ].join("\n");
}

export function parseClinicalReviewArgs(argv) {
  const args = {
    help: false,
    write: false,
    walk: false,
    pack: false,
    batch: false,
    kind: undefined,
    code: undefined,
    reviewedBy: undefined,
    exclude: undefined,
  };
  const seen = new Set();
  const valueFlags = { "--kind": "kind", "--code": "code", "--reviewed-by": "reviewedBy", "--exclude": "exclude" };
  const booleanFlags = new Set(["--help", "-h", "--write", "--walk", "--pack", "--batch"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (booleanFlags.has(token)) {
      const name = token === "-h" ? "help" : token.slice(2);
      if (seen.has(name)) throw new Error(`${token} may only be supplied once.`);
      seen.add(name);
      args[name] = true;
      continue;
    }
    if (Object.hasOwn(valueFlags, token)) {
      const name = valueFlags[token];
      if (seen.has(name)) throw new Error(`${token} may only be supplied once.`);
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
      seen.add(name);
      args[name] = value;
      index += 1;
      continue;
    }
    throw new Error(
      `Unknown option: ${token}. Sign-off answers cannot be supplied through yes, answers or provider flags.`,
    );
  }
  if (args.kind !== undefined && !KIND_NAMES.includes(args.kind)) {
    throw new Error(`--kind must be one of: ${KIND_NAMES.join(", ")}.`);
  }
  if (args.code !== undefined && args.kind === undefined) throw new Error("--code needs --kind as well.");
  if (args.walk && !args.write) throw new Error("--walk is a sign-off mode; use it with --write.");
  if (args.walk && args.code !== undefined) throw new Error("--walk goes through the whole queue; leave out --code.");
  if (args.pack && (args.write || args.walk || args.batch || args.code !== undefined)) {
    throw new Error("--pack only writes a review pack; use it with --kind alone (and optionally --reviewed-by).");
  }
  if (args.pack && args.kind === undefined) throw new Error("--pack needs --kind.");
  if (args.batch && !args.write) throw new Error("--batch is a sign-off mode; use it with --write.");
  if (args.batch && (args.walk || args.code !== undefined)) {
    throw new Error("--batch signs the whole pack; leave out --walk and --code.");
  }
  if (args.exclude !== undefined && !args.batch) throw new Error("--exclude only applies to --batch.");
  return args;
}

function writeLine(output, value = "") {
  output.write(`${value}\n`);
}

function printable(value) {
  if (value === null || value === undefined || value === "") return "(not provided)";
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.length ? value.map((item) => `- ${item}`).join("\n") : "(none)";
  }
  return JSON.stringify(value, null, 2);
}

function catalogEntryFor(context, code) {
  return (context.catalog?.forms ?? []).find((entry) => sameRecordId(entry?.form, code)) ?? {};
}

function actTextFor(context, section) {
  return (context.actSource?.sections ?? []).find((entry) => entry.section === section);
}

function cardText(card) {
  const face = [card.title, card.detail].filter(Boolean).join("\n  ");
  const sheet = card.sheet?.body && card.sheet.body !== card.title ? `\n  Tap for detail: ${card.sheet.body}` : "";
  return `${face}${sheet}`;
}

/**
 * What the owner reads before answering: the form's guidance exactly as the Forms page
 * renders it (fallback sentences and the Priority-facts cards included). All of it is
 * inside the content pin.
 */
const DISPLAY = {
  form(record, context) {
    const entry = catalogEntryFor(context, record.code);
    const shown = renderedFormGuidance(entry);
    const cards = shown.priorityCards;
    return [
      ["Form", `${record.code} - ${entry.name ?? ""}`],
      ["Drafted from", record.basis],
      ["Operational sections", (record.sections ?? []).map((section) => `s ${section}`).join(", ")],
      ["Contextual sections", (record.contextualSections ?? []).map((section) => `s ${section}`).join(", ")],
      ["Card: Clock / review", cardText(cards.clock)],
      ["Card: Made by / authority", cardText(cards.authority)],
      ["Card: Criteria / threshold", cardText(cards.criteria)],
      ["Purpose", shown.purpose],
      ["Made by", shown.maker],
      ["Also involved", shown.involved],
      ["When it applies", shown.threshold],
      ["Clock", shown.clock],
      ["Destination", shown.destination],
      ["Authorises", shown.authorises],
      ["Does not authorise", shown.doesNotAuthorise],
      ["Authority boundaries", shown.boundaries],
      [
        "Comes before / alongside / after",
        [shown.before, shown.parallel, shown.after].map((list) => list.join(", ") || "-").join("  /  "),
      ],
      ["Filing and copies", shown.copies],
      ["Documentation stem", shown.documentationStem],
      ["Common traps", shown.traps],
      ["Safety pearl", shown.safetyPearl],
      ["Legal note", shown.legalNote],
      ["Practice pearls", shown.practicePearls],
      ["Pre-use checks", shown.preUseChecks],
      ["Timings on the form", entry.sourceFacts?.timings],
      ["Section cue", entry.sourceFacts?.sectionCue ?? shown.sourceNote],
    ];
  },
  section(record, context) {
    const act = actTextFor(context, record.section);
    return [
      ["Section", `s ${record.section} - ${record.title}`],
      ["Act text (verbatim)", act?.text ?? "(Act text not found in data/mha-2014-sections.source.json)"],
      ["Drafted summary", record.summary],
    ];
  },
  timeframe(record, context) {
    const act = actTextFor(context, record.section);
    return [
      ["Timeframe", record.id],
      ["Forms", (record.formCodes ?? []).join(", ")],
      ["Trigger", record.trigger],
      ["Quote", record.quote],
      ["Duration", record.duration ? `${record.duration.value} ${record.duration.unit}` : undefined],
      ["Clock starts", record.anchor],
      [`Act text, s ${record.section} (verbatim)`, act?.text ?? "(Act text not found)"],
    ];
  },
  differential(record, context) {
    const entry = context.curated?.[record.slug] ?? {};
    const facts = (entry.atAGlance ?? []).map((fact) => `${fact.label}: ${fact.value}`);
    const discriminators = (entry.discriminators ?? []).map(
      (row) =>
        `Versus ${titleForSlug(context, row.relatedSlug)}\n    Points to ${titleForSlug(context, row.relatedSlug)}: ${row.favoursRelated}\n    Points back to this diagnosis: ${row.favoursFocus}`,
    );
    return [
      ["Diagnosis", `${titleForSlug(context, record.slug)} (${record.slug})`],
      ["Shown on the page as", "Locally authored - verify before use (until you sign it off)"],
      ["At a glance", facts],
      ["Do now (numbered steps)", entry.doNow ?? []],
      ["How to tell it apart", discriminators],
      ["Warning shown about the exported record", entry.contentNote],
      [
        "Exported body withheld",
        entry.generatedBodyUnreliable
          ? "Yes. The exported sections are not shown at all, because they were judged unreliable."
          : "No",
      ],
    ];
  },
  specifier(record) {
    if (record.kind === "universal") {
      return [
        ["Universal specifier", record.title],
        ["Description", record.description],
        ["Source status", record.sourceVerificationStatus],
        ["Source family", record.sourceFamily],
      ];
    }
    return [
      ["Specifier", record.label],
      [
        "On the site today",
        "Hidden. This definition was generated, and automated review found scattered clinical errors among these. " +
          "Signing it off means it is correct against DSM-5-TR and will be shown on the specifier's page.",
      ],
      ["Where it sits", `${record.categoryName} > ${record.disorderName} > ${record.groupLabel}`],
      ["ICD-11 context", record.icd11Context],
      ["Meaning", record.definition?.meaning],
      ["Clinical note", record.definition?.clinicalNote],
      ["Source family", record.definition?.sourceFamily ?? record.sourceFamily],
      ["Source status", record.sourceVerificationStatus],
    ];
  },
  "dictionary-rewrite"(record) {
    return [
      ["Entry", `${record.title} (${record.entrySlug}), ${record.category}`],
      ["Current wording on the site", record.baselineWording],
      ["Proposed wording", record.proposedWording],
      ["Verdict", record.verdict],
      ["Why", record.rationale],
      ["Citation", record.legacyCitation],
      [
        "What approving does",
        "Records your approval of the proposed wording. The site keeps the current wording until the approved rewrite is applied in a separate step.",
      ],
    ];
  },
  "formulation-guide": formulationDisplay,
  "formulation-mechanism": formulationDisplay,
  "formulation-concept": formulationDisplay,
};

function titleForSlug(context, slug) {
  return context.titles?.[slug] ?? slug;
}

const FORMULATION_HIDDEN_FIELDS = new Set(["id", "status", "reviewedBy", "reviewedAt", "reviewedContentSha256"]);

/**
 * A guide module's blocks as readable text: headings, paragraphs and list items, with each
 * citation as its marker. tests/clinical-signoff-display-parity.test.ts checks it against
 * the data the guide page renders.
 */
export function guideBlocksText(blocks) {
  // A citation span renders as a marker linked to the evidence entry with that label.
  const spanText = (span) => (span?.citation ? ` [${span.citation}]` : (span?.text ?? ""));
  const spansText = (spans) => (Array.isArray(spans) ? spans.map(spanText).join("") : "");
  return blocks
    .map((block) => {
      if (block?.kind === "heading") return `\n## ${block.text ?? ""}`;
      if (block?.kind === "paragraph") return spansText(block.spans);
      if (Array.isArray(block?.items)) return block.items.map((item) => `- ${spansText(item)}`).join("\n");
      return JSON.stringify(block);
    })
    .join("\n");
}

/**
 * Each evidence entry as the page's EvidenceList shows it: label, title, detail line,
 * limitations, link state. tests/clinical-signoff-display-parity.test.ts renders
 * EvidenceList for every Formulation record and requires every line of it here.
 */
export function evidenceText(evidence) {
  return evidence.map((entry) => {
    const lines = [`[${entry?.label ?? "?"}] ${entry?.title ?? ""}`];
    const detail = [entry?.issuer, entry?.identifier, entry?.locator].filter(Boolean).join(" · ");
    if (detail) lines.push(`    ${detail}`);
    for (const limitation of entry?.limitations ?? []) lines.push(`    Limitation: ${limitation}`);
    if (entry?.admission === "held")
      lines.push("    Link withheld: this source remains held and is cited as metadata only.");
    else if (entry?.urlStatus === "host_not_governed") {
      lines.push("    Link withheld: this publisher’s host is not on the governed source list.");
    } else if (entry?.url) lines.push(`    Link: ${entry.url}`);
    return lines.join("\n");
  });
}

/**
 * A Formulation record, every attested field in file order, with the guide blocks and
 * evidence references made readable. Everything shown is inside the content pin.
 */
function formulationDisplay(record, context) {
  const rows = [["Record", `${record.title ?? record.name ?? record.id} (${record.id})`]];
  for (const [key, value] of Object.entries(record)) {
    if (FORMULATION_HIDDEN_FIELDS.has(key)) continue;
    if (key === "blocks" && Array.isArray(value)) rows.push(["Guide text", guideBlocksText(value)]);
    else if (key === "evidence" && Array.isArray(value)) rows.push(["Evidence", evidenceText(value)]);
    else if (key === "sources" && Array.isArray(value) && context?.sourceLibrary) {
      rows.push([
        "Sources (as the page lists them)",
        value.map((id) => {
          const entry = context.sourceLibrary[id];
          return entry
            ? `${entry.title}\n    ${entry.url ?? "(no link)"}`
            : `${id} (not in the source library; not shown)`;
        }),
      ]);
    } else rows.push([key, value]);
  }
  return rows;
}

for (const kindModule of signOffKindModules) Object.assign(DISPLAY, kindModule.display);

function showRecord(kind, record, context, output) {
  for (const [label, value] of DISPLAY[kind](record, context)) {
    writeLine(output, `\n[${label}]`);
    writeLine(output, printable(value));
  }
}

function normalizeAnswer(value) {
  const answer = String(value).trim().toLowerCase();
  if (answer === "yes") return true;
  if (answer === "no") return false;
  if (answer === "quit" || answer === "q") return "quit";
  return null;
}

/**
 * Testable interactive core. `commit` is called exactly once, and only after every
 * checklist question is answered yes and the exact confirmation is typed.
 */
export async function conductClinicalReview({
  kind,
  record,
  context = {},
  reviewedBy,
  ask,
  commit,
  now = () => new Date(),
  output,
}) {
  const attributionProblem = reviewerAttributionProblem(reviewedBy);
  if (attributionProblem) throw new Error(attributionProblem);
  const eligibility = signOffEligibilityProblem(record, kind, context);
  if (eligibility) throw new Error(eligibility);

  showRecord(kind, record, context, output);
  writeLine(output);
  writeLine(output, "Answer yes only if you agree with the statement. Any no leaves this record unsigned.");
  const checklist = recordKinds[kind].checklist;
  for (const [position, check] of checklist.entries()) {
    writeLine(output);
    writeLine(output, `Question ${position + 1} of ${checklist.length}: ${check.question}`);
    let decision = null;
    while (decision === null) {
      decision = normalizeAnswer(await ask("Type yes, no, or quit: "));
      if (decision === null) writeLine(output, "Please type exactly yes, no, or quit.");
    }
    if (decision === "quit") {
      writeLine(output, "Stopped. Nothing was changed.");
      return { status: "quit", record };
    }
    if (decision === false) {
      writeLine(output, "Not signed off. Nothing was changed, and this record stays awaiting clinical review.");
      return { status: "incomplete", record };
    }
  }

  const expected = clinicalReviewConfirmation(kind, record);
  const confirmation = await ask(`\nTo sign this off, type its code (${expected}), or quit to stop: `);
  if (normalizeAnswer(confirmation) === "quit" && !sameRecordId(confirmation, expected)) {
    writeLine(output, "Stopped. Nothing was saved for this record.");
    return { status: "quit", record };
  }
  if (!sameRecordId(confirmation, expected)) {
    writeLine(output, "That did not match. Nothing was changed.");
    return { status: "cancelled", record };
  }

  const reviewed = finalizeClinicalReview(record, kind, {
    reviewedBy,
    reviewedAt: now().toISOString(),
    context,
  });
  await commit(reviewed);
  return { status: "reviewed", record: reviewed };
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** A kind's data file, or `{ status: "absent" }` for an optional kind whose file is not there yet. */
export function loadKindDocument(kind, { root = DEFAULT_ROOT } = {}) {
  const definition = recordKinds[kind];
  const path = join(root, definition.path);
  if (!existsSync(path)) {
    if (definition.optional) return { status: "absent", path };
    throw new Error(`${definition.path} is missing.`);
  }
  const raw = readFileSync(path, "utf8");
  return { status: "ok", path, raw, document: JSON.parse(raw) };
}

export async function loadContext(kind, root) {
  for (const kindModule of signOffKindModules) {
    if (Object.hasOwn(kindModule.kinds, kind)) return (await kindModule.loadContext?.(kind, root)) ?? {};
  }
  if (kind === "form") return { catalog: readJson(join(root, "data", "forms-catalog.json")) };
  if (kind === "differential") {
    // Node 24 strips the module's type-only syntax, as scripts/build-cross-mode-differentials-index.mjs relies on.
    // Its "module type not specified" notice is noise to a clinician reading the screen, so only that one is muted.
    const emitWarning = process.emitWarning;
    process.emitWarning = (warning, ...rest) => {
      const code = typeof rest[0] === "object" ? rest[0]?.code : rest[1];
      if (code !== "MODULE_TYPELESS_PACKAGE_JSON") emitWarning.call(process, warning, ...rest);
    };
    let curatedDifferentials;
    // The walk re-reads its context before every record so each sign-off pins the overlay as
    // it is now. Node caches a module by URL, so the URL carries the file's content hash: an
    // edit made mid-walk is imported fresh instead of pinning the text as it was at the start.
    const curatedPath = join(root, "src", "lib", "differential-curated.ts");
    const curatedVersion = createHash("sha256").update(readFileSync(curatedPath)).digest("hex").slice(0, 16);
    try {
      ({ curatedDifferentials } = await import(`${pathToFileURL(curatedPath).href}?v=${curatedVersion}`));
    } finally {
      process.emitWarning = emitWarning;
    }
    const snapshot = readJson(join(root, "data", "differentials-snapshot.json"));
    const titles = Object.fromEntries((snapshot.diagnoses ?? []).map((entry) => [entry.slug, entry.title]));
    return { curated: curatedDifferentials, titles };
  }
  if (kind === "formulation-mechanism") {
    return { sourceLibrary: readJson(join(root, "src", "data", "formulation-content.json")).sourceLibrary };
  }
  if (kind.startsWith("formulation-")) return {};
  const actPath = join(root, "data", "mha-2014-sections.source.json");
  return { actSource: existsSync(actPath) ? readJson(actPath) : undefined };
}

async function showKindQueue(kind, root, output) {
  const definition = recordKinds[kind];
  const loaded = loadKindDocument(kind, { root });
  if (loaded.status === "absent") {
    writeLine(
      output,
      `${definition.heading}: ${definition.path} does not exist yet, so there is nothing to sign off here. Skipped.`,
    );
    return;
  }
  const records = collectionOf(kind, loaded.document);
  const context = await loadContext(kind, root);
  const reviewed = records.filter((record) => record.status === "reviewed");
  const stale = reviewed.filter((record) => recordPinState(record, kind, context) !== "current");
  const waiting = signOffQueue(kind, records, context);
  const pending = records.filter((record) => record.status === "pending").length;
  const heldIndigenous = records.filter(
    (record) => record.status === "drafted" && indigenousContentIn(record, kind, context),
  ).length;
  writeLine(
    output,
    `${definition.heading} (${definition.path}): ${reviewed.length - stale.length} of ${records.length} signed off` +
      (pending ? `; ${pending} not ready to sign (no written text, or not in the review queue).` : "."),
  );
  if (stale.length) {
    writeLine(
      output,
      `  Edited since sign-off, needs signing again: ${stale.map((record) => recordId(record, kind)).join(", ")}`,
    );
  }
  if (heldIndigenous) {
    writeLine(
      output,
      `  Held, not offered: ${heldIndigenous} contain Aboriginal, Torres Strait Islander or other Indigenous content and need Aboriginal governance review.`,
    );
  }
  if (waiting.length) {
    writeLine(output, `  Next: ${waiting[0]}`);
    writeLine(output, `  Waiting (${waiting.length}): ${waiting.join(", ")}`);
  } else {
    writeLine(output, "  Nothing waiting.");
  }
}

async function showOneRecord(kind, code, root, output) {
  const loaded = loadKindDocument(kind, { root });
  if (loaded.status === "absent") {
    writeLine(output, `${recordKinds[kind].path} does not exist yet, so there is nothing to show. Skipped.`);
    return;
  }
  const record = collectionOf(kind, loaded.document).find((entry) => sameRecordId(recordId(entry, kind), code));
  if (!record) throw new Error(`No ${kind} with code ${code} in ${recordKinds[kind].path}.`);
  const context = await loadContext(kind, root);
  showRecord(kind, record, context, output);
  const pin = recordPinState(record, kind, context);
  writeLine(output);
  writeLine(
    output,
    `Status: ${record.status}` +
      (record.reviewedBy ? `, signed off by ${record.reviewedBy} at ${record.reviewedAt}` : "") +
      (pin === "stale" ? " - EDITED SINCE SIGN-OFF, needs signing again" : ""),
  );
}

/** The records a pack or batch covers: the kind's waiting queue, in walk order. */
function packRecords(kind, records, context) {
  return signOffQueue(kind, records, context).map((code) =>
    records.find((record) => sameRecordId(recordId(record, kind), code)),
  );
}

/** The sign-off code for one kind's waiting set, from each record's content pin as it is now. */
export function clinicalPackCode(kind, records, context = {}) {
  return signOffPackCode(
    packRecords(kind, records, context).map((record) => ({
      code: recordId(record, kind),
      sha256: recordContentSha256(record, kind, context),
    })),
  );
}

function batchCommandFor(kind, reviewedBy) {
  const name = reviewedBy ?? "<your public name>";
  return `npm.cmd run clinical:review -- --write --batch --kind ${kind} --reviewed-by "${name}" --exclude <codes>`;
}

/**
 * The HTML review pack: every waiting record exactly as the walk-through shows it.
 *
 * @param {string} kind
 * @param {any[]} records
 * @param {Record<string, unknown>} [context]
 * @param {{ reviewedBy?: string, generatedAt?: Date }} [options]
 */
export function renderClinicalPack(kind, records, context = {}, { reviewedBy, generatedAt = new Date() } = {}) {
  const waiting = packRecords(kind, records, context);
  return renderSignOffPack({
    title: `Sign-off pack: ${recordKinds[kind].heading}`,
    code: clinicalPackCode(kind, records, context),
    intro: [
      "Everything below is shown exactly as the one-at-a-time walk-through shows it, and each record's sign-off is pinned to this text.",
    ],
    questions: recordKinds[kind].checklist.map((check) => check.question),
    batchCommand: batchCommandFor(kind, reviewedBy),
    generatedAt: generatedAt.toISOString(),
    records: waiting.map((record) => {
      const code = recordId(record, kind);
      return {
        code,
        heading: `${recordKinds[kind].noun} ${code}`,
        sections: DISPLAY[kind](record, context).map(([label, value]) => ({ label, text: printable(value) })),
      };
    }),
  });
}

/**
 * Testable interactive core of a batch sign-off. It asks the kind's questions once for the
 * whole set, then requires the pack's sign-off code, recomputed here from the records as
 * they are now. Returns the signed records (views); writes nothing.
 *
 * @param {{
 *   kind: string,
 *   records: any[],
 *   context?: Record<string, unknown>,
 *   reviewedBy: string,
 *   exclude?: string[],
 *   ask: (question: string) => Promise<string>,
 *   output: { write: (chunk: string) => unknown },
 *   now?: () => Date,
 * }} options
 * @returns {Promise<{ status: string, signed: any[] }>}
 */
export async function conductClinicalBatchReview({
  kind,
  records,
  context = {},
  reviewedBy,
  exclude = [],
  ask,
  output,
  now = () => new Date(),
}) {
  const attributionProblem = reviewerAttributionProblem(reviewedBy);
  if (attributionProblem) throw new Error(attributionProblem);
  const waiting = packRecords(kind, records, context);
  const waitingCodes = waiting.map((record) => recordId(record, kind));
  const unknown = exclude.filter((code) => !waitingCodes.some((id) => sameRecordId(id, code)));
  if (unknown.length) {
    throw new Error(`Not in this set, so cannot be excluded: ${unknown.join(", ")}. Check the codes in the pack.`);
  }
  const toSign = waiting.filter((record) => !exclude.some((code) => sameRecordId(code, recordId(record, kind))));
  if (toSign.length === 0) {
    writeLine(output, "Nothing to sign: every waiting record is excluded.");
    return { status: "empty", signed: [] };
  }
  const expectedCode = clinicalPackCode(kind, records, context);

  writeLine(
    output,
    `You are signing off ${toSign.length} ${recordKinds[kind].heading.toLowerCase()} as ${reviewedBy}.`,
  );
  if (exclude.length) writeLine(output, `Left out (stay awaiting review): ${exclude.join(", ")}.`);
  writeLine(output, "Answer yes only if the statement is true of EVERY record in the pack you are signing.");
  for (const [position, check] of recordKinds[kind].checklist.entries()) {
    writeLine(output);
    writeLine(output, `Question ${position + 1} of ${recordKinds[kind].checklist.length}: ${check.question}`);
    let decision = null;
    while (decision === null) {
      decision = normalizeAnswer(await ask("Type yes, no, or quit: "));
      if (decision === null) writeLine(output, "Please type exactly yes, no, or quit.");
    }
    if (decision === "quit") {
      writeLine(output, "Stopped. Nothing was changed.");
      return { status: "quit", signed: [] };
    }
    if (decision === false) {
      writeLine(output, "Not signed. Nothing was changed. Exclude the records you are not happy with and try again.");
      return { status: "incomplete", signed: [] };
    }
  }
  const typed = String(await ask("\nType the sign-off code printed at the top of the pack: "))
    .trim()
    .toLowerCase();
  if (typed !== expectedCode) {
    writeLine(
      output,
      "That code does not match this set. Either it was mistyped, or a record changed after the pack was written. " +
        "Nothing was signed. Write a fresh pack with --pack and read that one.",
    );
    return { status: "code-mismatch", signed: [] };
  }
  const reviewedAt = now().toISOString();
  const signed = toSign.map((record) => finalizeClinicalReview(record, kind, { reviewedBy, reviewedAt, context }));
  return { status: "reviewed", signed };
}

const SETUP_COMMAND = "npm ci --include=dev";

/**
 * The project's formatter, loaded before the first question. Every saved file must be
 * formatted exactly as the repository expects, or the owner's own push would be refused;
 * so if it cannot load, refuse up front rather than after he has read a form.
 */
export async function loadFormatter() {
  try {
    const prettier = await import("prettier");
    if (typeof prettier.format !== "function") throw new Error("prettier.format is missing");
    return prettier;
  } catch {
    throw new Error(
      `The project's tools are not installed on this computer, so nothing can be saved yet. ` +
        `In this terminal, run: ${SETUP_COMMAND}   (it takes a few minutes), then try again.`,
    );
  }
}

async function formatJson(prettier, document, path) {
  const options = (await prettier.resolveConfig(path)) ?? {};
  return prettier.format(`${JSON.stringify(document, null, 2)}\n`, { ...options, filepath: path });
}

const STALE_LOCK_MS = 30 * 60 * 1000;

function lockIsStale(lockPath) {
  try {
    const pid = Number.parseInt(readFileSync(lockPath, "utf8"), 10);
    if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) return true;
    if (!Number.isInteger(pid) || pid <= 0) return true;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
    }
  } catch {
    return false;
  }
}

function acquireLock(path, notice = (message) => process.stderr.write(`${message}\n`)) {
  const lockPath = `${path}.review.lock`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, "wx");
      writeFileSync(descriptor, `${process.pid}\n`, "utf8");
      fsyncSync(descriptor);
      return () => {
        try {
          closeSync(descriptor);
        } finally {
          rmSync(lockPath, { force: true });
        }
      };
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (error?.code !== "EEXIST") throw error;
      if (attempt === 0 && lockIsStale(lockPath)) {
        notice(`Removed a leftover lock from an earlier sign-off session that did not finish (${basename(lockPath)}).`);
        rmSync(lockPath, { force: true });
        continue;
      }
      throw new Error(
        `Another sign-off is saving ${basename(path)} right now. Close any other sign-off window and try again; ` +
          `if none is open, wait 30 minutes or delete the file ${basename(lockPath)} in the data folder.`,
      );
    }
  }
  throw new Error(`Could not lock ${basename(path)}.`);
}

/**
 * Same-directory temp file + fsync + rename, guarded by a lock and by the exact bytes
 * read when the review began, so a concurrent edit is never overwritten.
 */
export function writeDataFileAtomically(path, contents, expectedRaw, { notice } = {}) {
  const release = acquireLock(path, notice);
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    if (readFileSync(path, "utf8") !== expectedRaw) {
      throw new Error(
        `${basename(path)} changed after the review began; refusing to overwrite it. Nothing was written.`,
      );
    }
    descriptor = openSync(temporary, "wx");
    writeFileSync(descriptor, contents);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (readFileSync(path, "utf8") !== expectedRaw) {
      throw new Error(`${basename(path)} changed while the sign-off was being written; nothing was written.`);
    }
    renameSync(temporary, path);
  } finally {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { force: true });
      release();
    }
  }
}

function regenerateFormsReviewSheet(root, errorOutput) {
  try {
    execFileSync(
      process.execPath,
      [join(root, "scripts", "run-tsx.mjs"), "scripts/build-forms-content-review-sheet.ts"],
      {
        cwd: root,
        stdio: "ignore",
      },
    );
  } catch {
    writeLine(errorOutput, "Note: the forms review sheet was not refreshed. Claude will refresh it when committing.");
  }
}

async function runBatch(args, { input, output, errorOutput, root }) {
  if (!args.reviewedBy) throw new Error("--write needs --reviewed-by with your public display name.");
  const attributionProblem = reviewerAttributionProblem(args.reviewedBy);
  if (attributionProblem) throw new Error(attributionProblem);
  const prettier = await loadFormatter();
  const kind = args.kind;
  const loaded = loadKindDocument(kind, { root });
  if (loaded.status === "absent") throw new Error(`${recordKinds[kind].path} does not exist yet.`);
  const context = await loadContext(kind, root);
  const records = collectionOf(kind, loaded.document);
  if (signOffQueue(kind, records, context).length === 0) {
    writeLine(output, `Nothing waiting: every ${kind} is already signed off.`);
    return 0;
  }
  writeLine(
    errorOutput,
    "CLINICAL AUTHORITY: only the clinical owner may sign this off, after reading the pack in full.",
  );
  writeLine(
    errorOutput,
    "PRIVACY: your reviewer name is shown publicly. Do not enter an email or registration number.",
  );
  const prompt = createPrompt({ input, output });
  let result;
  try {
    result = await conductClinicalBatchReview({
      kind,
      records,
      context,
      reviewedBy: args.reviewedBy,
      exclude: parseExcludeList(args.exclude),
      ask: prompt.ask,
      output,
    });
  } finally {
    prompt.close();
  }
  if (result.status !== "reviewed") return 0;
  let nextDocument = loaded.document;
  for (const reviewed of result.signed) nextDocument = applyClinicalReview(nextDocument, kind, reviewed);
  const problems = reviewProblems(collectionOf(kind, nextDocument), kind, context);
  if (problems.length) throw new Error(`Refusing to write an invalid sign-off:\n- ${problems.join("\n- ")}`);
  writeDataFileAtomically(loaded.path, await formatJson(prettier, nextDocument, loaded.path), loaded.raw, {
    notice: (message) => writeLine(errorOutput, message),
  });
  if (kind === "form") regenerateFormsReviewSheet(root, errorOutput);
  writeLine(output, `Saved: ${result.signed.length} records signed off.`);
  writeLine(output, "Your sign-offs are saved on this computer. See the guide for how to send them.");
  return 0;
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const errorOutput = io.errorOutput ?? process.stderr;
  const root = io.root ?? DEFAULT_ROOT;
  const args = parseClinicalReviewArgs(argv);
  if (args.help) {
    writeLine(output, usage());
    return 0;
  }

  if (!args.write) {
    if (args.reviewedBy !== undefined) {
      const problem = reviewerAttributionProblem(args.reviewedBy);
      if (problem) throw new Error(problem);
    }
    if (args.pack) {
      const loaded = loadKindDocument(args.kind, { root });
      if (loaded.status === "absent") throw new Error(`${recordKinds[args.kind].path} does not exist yet.`);
      const records = collectionOf(args.kind, loaded.document);
      const context = await loadContext(args.kind, root);
      const count = signOffQueue(args.kind, records, context).length;
      if (count === 0) {
        writeLine(output, `Nothing waiting: every ${args.kind} is already signed off. No pack written.`);
        return 0;
      }
      const directory = join(root, "sign-off-packs");
      mkdirSync(directory, { recursive: true });
      const path = join(directory, `${args.kind}.html`);
      writeFileSync(path, renderClinicalPack(args.kind, records, context, { reviewedBy: args.reviewedBy }));
      writeLine(output, `Review pack written: ${path}`);
      writeLine(output, `${count} records. Sign-off code: ${clinicalPackCode(args.kind, records, context)}`);
      writeLine(output, "Open it in your browser, read it all, then run the command printed at the top of the pack.");
      return 0;
    }
    if (args.code !== undefined) {
      await showOneRecord(args.kind, args.code, root, output);
    } else {
      writeLine(output, "Clinical sign-off queue.");
      writeLine(output);
      for (const kind of args.kind ? [args.kind] : KIND_NAMES) await showKindQueue(kind, root, output);
      writeLine(output);
      writeLine(
        output,
        'To sign a set: npm run clinical:review -- --pack --kind <kind>, read it, then --write --batch --kind <kind> --reviewed-by "<your public name>"',
      );
    }
    writeLine(output, "Report only; no file was changed.");
    return 0;
  }

  if (!input.isTTY || !output.isTTY) {
    throw new Error("--write requires an interactive TTY; piped, scripted and agent-supplied sign-offs are refused.");
  }
  if (!args.kind) throw new Error("--write needs one --kind.");
  if (args.batch) return runBatch(args, { input, output, errorOutput, root });
  if (!args.walk && !args.code) {
    throw new Error(
      "--write needs --code for one record, --walk to step through the queue one record at a time, or --batch to sign a review pack.",
    );
  }
  if (!args.reviewedBy) throw new Error("--write needs --reviewed-by with your public display name.");
  const attributionProblem = reviewerAttributionProblem(args.reviewedBy);
  if (attributionProblem) throw new Error(attributionProblem);

  const prettier = await loadFormatter();
  const kind = args.kind;
  const first = loadKindDocument(kind, { root });
  if (first.status === "absent") {
    throw new Error(`${recordKinds[kind].path} does not exist yet; there is nothing to sign off for ${kind}.`);
  }
  const codes = args.walk
    ? signOffQueue(kind, collectionOf(kind, first.document), await loadContext(kind, root))
    : [args.code];
  if (args.walk && codes.length === 0) {
    writeLine(output, `Nothing waiting: every ${kind} is already signed off.`);
    return 0;
  }
  if (!args.walk) {
    // Fail before any prompt for an unknown or ineligible single record.
    const record = collectionOf(kind, first.document).find((entry) => sameRecordId(recordId(entry, kind), args.code));
    if (!record) throw new Error(`No ${kind} with code ${args.code} in ${recordKinds[kind].path}.`);
    const eligibility = signOffEligibilityProblem(record, kind, await loadContext(kind, root));
    if (eligibility) throw new Error(eligibility);
  }

  writeLine(errorOutput, "CLINICAL AUTHORITY: only the clinical owner may sign this off, after reading it in full.");
  writeLine(
    errorOutput,
    "PRIVACY: your reviewer name is shown publicly. Do not enter an email or registration number.",
  );
  const signed = [];
  const skipped = [];
  const prompt = createPrompt({ input, output });
  try {
    for (const [position, code] of codes.entries()) {
      // Re-read before every record, so each save is checked against the file as it is now.
      const loaded = loadKindDocument(kind, { root });
      const context = await loadContext(kind, root);
      const record = collectionOf(kind, loaded.document).find((entry) => sameRecordId(recordId(entry, kind), code));
      if (!record || signOffEligibilityProblem(record, kind, context)) {
        skipped.push(code);
        continue;
      }
      writeLine(output);
      writeLine(output, "=".repeat(60));
      writeLine(
        output,
        args.walk
          ? `${recordKinds[kind].noun} ${code}  (${position + 1} of ${codes.length})`
          : `${recordKinds[kind].noun} ${code}`,
      );
      if (record.status === "reviewed") {
        writeLine(output, `Signed off before (${record.reviewedAt}), but the text has been edited since.`);
      }
      writeLine(output, "=".repeat(60));
      const result = await conductClinicalReview({
        kind,
        record,
        context,
        reviewedBy: args.reviewedBy,
        ask: prompt.ask,
        output,
        commit: async (reviewed) => {
          const nextDocument = applyClinicalReview(loaded.document, kind, reviewed);
          const problems = reviewProblems([reviewed], kind, context);
          if (problems.length) throw new Error(`Refusing to write an invalid sign-off:\n- ${problems.join("\n- ")}`);
          writeDataFileAtomically(loaded.path, await formatJson(prettier, nextDocument, loaded.path), loaded.raw, {
            notice: (message) => writeLine(errorOutput, message),
          });
        },
      });
      if (result.status === "reviewed") {
        signed.push(code);
        writeLine(output, `Saved: ${recordKinds[kind].noun} ${code} is signed off.`);
      } else if (result.status === "quit") {
        break;
      } else {
        skipped.push(code);
      }
    }
  } finally {
    prompt.close();
    if (kind === "form" && signed.length) regenerateFormsReviewSheet(root, errorOutput);
    writeLine(output);
    writeLine(output, `Signed off this session: ${signed.length ? signed.join(", ") : "none"}.`);
    if (skipped.length) writeLine(output, `Left unsigned: ${skipped.join(", ")}.`);
    if (signed.length) {
      writeLine(output, "Your sign-offs are saved on this computer. See the guide for how to send them.");
    }
  }
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      if (error?.code === "ABORT_ERR") {
        console.error("Stopped. Every record you confirmed before this point is saved.");
        process.exitCode = 130;
        return;
      }
      console.error(`clinical:review: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
