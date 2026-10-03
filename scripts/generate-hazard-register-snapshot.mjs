#!/usr/bin/env node
/**
 * Build `data/hazard-register-snapshot.json` — the input to the developer hub's
 * hazard register panel.
 *
 * This repository holds ONE live hazard record, and the whole point of this
 * generator is that it arrives at the page with its own authority intact rather
 * than as a coverage claim nobody has made:
 *
 *   1. `docs/clinical-hazard-controls.json` — the PsychSift answer pipeline
 *      (H1-H6). Machine-checked by `check:clinical-hazard-controls`, and its
 *      own `authority` field says it establishes static evidence only.
 *
 * Two further areas were retired on 2026-09-26 with the prototypes they
 * covered: the Caring Contacts workspace (whose hazard log was a draft no
 * clinician ever signed) and Ward Flow (which never had a register). They are
 * kept as a short `retired` record so the page can say they once existed and
 * why nothing is shown for them, without re-rendering a register that no
 * longer has a source.
 *
 * Run: npm run snapshot:hazards
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const HAZARD_SNAPSHOT_VERSION = "hazard-register-snapshot-v1";
export const REVIEW_TIME_ZONE = "Australia/Perth";

const CONTROLS_JSON = "docs/clinical-hazard-controls.json";
const ANALYSIS_MD = "docs/clinical-hazard-analysis.md";

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

/** Strip the markdown emphasis and links a table cell carries, leaving readable text. */
export function plainCell(cell) {
  return cell
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split one markdown table row into cells.
 *
 * Splitting on a bare `|` would cut a cell containing an escaped pipe or a pipe
 * inside code, so the leading and trailing delimiters are removed first and the
 * split is done on the remainder — the shape every table in these documents uses.
 */
export function tableCells(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === "\\" && trimmed[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(plainCell(cell));
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(plainCell(cell));
  return cells;
}

/** Every `H-…` row in a markdown table, from anywhere in the document. */
export function parseHazardRows(markdown) {
  const rows = [];
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = tableCells(line);
    // Header and alignment rows have no hazard id in column one.
    if (!/^H-[A-Z0-9]+$/i.test(cells[0])) continue;
    if (cells.length !== 8) {
      throw new Error(`Hazard row ${cells[0]} expected 8 cells, received ${cells.length}`);
    }
    const [id, hazard, cause, harm, control, residualRisk, owner, status] = cells;
    rows.push({ id, hazard, cause, harm, control, residualRisk, owner, status });
  }
  return rows;
}

/**
 * Normalise a markdown hazard-log status cell to the three states such a log's
 * "How to read the columns" section defines. An unrecognised value is passed through
 * rather than coerced: a status this parser has not seen is a change to the
 * document, and the page must show it rather than silently file it as controlled.
 */
export function normaliseStatus(status) {
  const value = status.toLowerCase();
  if (value.includes("unmitigated")) return "unmitigated";
  if (value.startsWith("partial")) return "partial";
  // Any Controlled* status (including governance-gated / blueprint / fallback wording)
  // is a code-level control that has not received clinical sign-off of the register itself.
  if (value.includes("unreviewed") || value.startsWith("controlled")) return "controlled-unreviewed";
  return status;
}

/** The `### H1 — …` headings in the analysis document, which the JSON register has no titles for. */
export function parseAnalysisTitles(markdown) {
  // Annotated because this file is plain JavaScript: without it TypeScript
  // infers the empty literal's type, `{}`, and every consumer sees a map with
  // no keys.
  /** @type {Record<string, string>} */
  const titles = {};
  for (const line of markdown.split("\n")) {
    const match = /^#{2,4}\s+(H[0-9]+)\s+[—-]\s+(.*)$/.exec(line.trim());
    // First heading wins: H5 carries a second, narrower heading for one
    // sub-topic, and the broad one is the hazard's own title.
    if (match && !titles[match[1]]) titles[match[1]] = plainCell(match[2]);
  }
  return titles;
}

/** Whether a review date has passed, given "today". Undated reviews are never "current". */
function reviewDateIsValid(reviewExpiresAt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewExpiresAt ?? "")) return false;
  const parsed = new Date(`${reviewExpiresAt}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === reviewExpiresAt;
}

function perthTodayIso(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REVIEW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function reviewExpired(reviewExpiresAt, now) {
  return !reviewDateIsValid(reviewExpiresAt) || reviewExpiresAt < perthTodayIso(now);
}

function buildPsychSiftRegister(now) {
  const controls = JSON.parse(read(CONTROLS_JSON));
  const titles = parseAnalysisTitles(read(ANALYSIS_MD));

  return {
    id: "psychsift-answer-pipeline",
    name: "PsychSift answer pipeline",
    scope: "Retrieval, answer generation, citations and copy/export.",
    sourcePath: CONTROLS_JSON,
    exists: true,
    // Its own words, not a summary of them: this is the sentence that stops the
    // panel being read as clinical assurance.
    authority: controls.authority,
    signedOff: false,
    gate: "check:clinical-hazard-controls",
    reviewedAt: controls.reviewedAt ?? null,
    reviewExpiresAt: controls.reviewExpiresAt ?? null,
    reviewExpired: reviewExpired(controls.reviewExpiresAt, now),
    hazards: controls.hazards.map((hazard) => ({
      id: hazard.id,
      title: titles[hazard.id] ?? null,
      status: hazard.state,
      owner: hazard.owner ?? null,
      residualRisk: hazard.residualRisk ?? null,
      controlCount: (hazard.controlPaths ?? []).length,
      testCount: (hazard.tests ?? []).length,
      reviewExpiresAt: hazard.reviewExpiresAt ?? null,
      reviewExpired: reviewExpired(hazard.reviewExpiresAt, now),
    })),
    openAssuranceDecisions: (controls.assuranceDecisions ?? [])
      .filter((decision) => decision.state !== "closed")
      .map((decision) => ({
        id: decision.id,
        owner: decision.owner ?? null,
        residualRisk: decision.residualRisk ?? null,
      })),
  };
}

/**
 * Registers retired with the prototypes they covered. Recorded, not rendered as
 * registers: their source documents were deleted, so there is nothing left to
 * parse, and dropping them silently would let a reader assume they never existed.
 */
export const RETIRED_REGISTERS = [
  { name: "Caring Contacts", retiredAt: "2026-09-26", status: "draft never signed; retired" },
  { name: "Ward Flow", retiredAt: "2026-09-26", status: "no register ever written; retired" },
];

export function buildHazardSnapshot(now = new Date()) {
  const registers = [buildPsychSiftRegister(now)];

  const allHazards = registers.flatMap((register) => register.hazards);
  return {
    version: HAZARD_SNAPSHOT_VERSION,
    generatedAt: now.toISOString().slice(0, 10),
    counts: {
      registers: registers.length,
      registersMissing: registers.filter((register) => !register.exists).length,
      registersUnsigned: registers.filter((register) => register.exists && !register.signedOff).length,
      hazards: allHazards.length,
      unmitigated: allHazards.filter((hazard) => hazard.status === "unmitigated").length,
      reviewExpired: allHazards.filter((hazard) => hazard.reviewExpired).length,
    },
    registers,
    retired: RETIRED_REGISTERS.map((entry) => ({ ...entry })),
  };
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) {
  const snapshot = buildHazardSnapshot();
  const target = join(repoRoot, "data/hazard-register-snapshot.json");
  writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(
    `[hazard-register] wrote data/hazard-register-snapshot.json ` +
      `(${snapshot.counts.hazards} hazards across ${snapshot.counts.registers} registers, ` +
      `${snapshot.counts.unmitigated} unmitigated, ${snapshot.counts.registersMissing} register(s) missing)`,
  );
}
