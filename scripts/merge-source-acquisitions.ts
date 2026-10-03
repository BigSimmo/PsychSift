#!/usr/bin/env node
/**
 * Tooling for `src/data/source-acquisitions.json`, the hand-appended ledger of
 * captured clinical sources. Many concurrent ingestion sessions append to the
 * same file, and appending at the end makes every pair of PRs conflict on the
 * same few lines.
 *
 * The fix (owner-approved 2026-09-17): keep one file, but order records by
 * sha1(id) — the same dispersal trick `scripts/generate-site-map.ts` and
 * `scripts/generate-repo-awareness-snapshot.ts` already use for the same
 * reason. Independent additions land at scattered positions in the sorted
 * file and git's three-way merge resolves both hunks untouched.
 *
 * This script does NOT reorder the live data file and is not wired into CI.
 * It provides the tooling only:
 *
 *   --fix-order [--file <path>]                 rewrite the file in hash order
 *   --check-order [--file <path>]                exit 1 when not in hash order
 *   --base <ref> --ours <ref> --theirs <ref>     three-way merge by record id
 *     [--file <path>] [--write]
 *
 * Modes are mutually exclusive; `--base`/`--ours`/`--theirs` together select
 * three-way merge mode.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { format as prettierFormat, resolveConfig as resolvePrettierConfig } from "prettier";

import type { SourceAcquisitionRecord } from "../src/lib/sources/acquisition-ledger";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_RELATIVE_PATH = "src/data/source-acquisitions.json";

// ---------------------------------------------------------------------------
// Hash-dispersal ordering
// ---------------------------------------------------------------------------

/**
 * A SHA-1 of the record id is uniformly distributed, so two records added on
 * independent branches land far apart in the sorted file and git's
 * three-way merge resolves both hunks without a conflict. Mirrors
 * `dispersalKey` in `scripts/generate-site-map.ts` and
 * `scripts/generate-repo-awareness-snapshot.ts`.
 */
export function dispersalKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

export function compareRecordsByHash(left: SourceAcquisitionRecord, right: SourceAcquisitionRecord): number {
  return dispersalKey(left.id).localeCompare(dispersalKey(right.id)) || left.id.localeCompare(right.id);
}

export function sortRecordsByHash(records: readonly SourceAcquisitionRecord[]): SourceAcquisitionRecord[] {
  return [...records].sort(compareRecordsByHash);
}

export function isSortedByHash(records: readonly SourceAcquisitionRecord[]): boolean {
  for (let i = 1; i < records.length; i++) {
    if (compareRecordsByHash(records[i - 1], records[i]) > 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// JSON shape handling — the file may be a bare array or an object wrapping one
// ---------------------------------------------------------------------------

export type LedgerShape = { kind: "array" } | { kind: "wrapped"; key: string; container: Record<string, unknown> };

export function parseLedgerShape(parsed: unknown): {
  shape: LedgerShape;
  records: SourceAcquisitionRecord[];
} {
  if (Array.isArray(parsed)) {
    return { shape: { kind: "array" }, records: parsed as SourceAcquisitionRecord[] };
  }
  if (parsed && typeof parsed === "object") {
    const container = parsed as Record<string, unknown>;
    const arrayEntry = Object.entries(container).find(([, value]) => Array.isArray(value));
    if (arrayEntry) {
      const [key, value] = arrayEntry;
      return {
        shape: { kind: "wrapped", key, container },
        records: value as SourceAcquisitionRecord[],
      };
    }
  }
  throw new Error(
    "Unrecognized src/data/source-acquisitions.json shape: expected a JSON array of records, or an object with exactly one array-valued property wrapping them.",
  );
}

export function rebuildLedger(shape: LedgerShape, records: SourceAcquisitionRecord[]): unknown {
  if (shape.kind === "array") return records;
  return { ...shape.container, [shape.key]: records };
}

async function formatLedgerJson(value: unknown, filePath: string): Promise<string> {
  const options = (await resolvePrettierConfig(filePath)) ?? {};
  const json = JSON.stringify(value);
  return prettierFormat(json, { ...options, filepath: filePath, parser: "json" });
}

// ---------------------------------------------------------------------------
// Three-way merge by record id
// ---------------------------------------------------------------------------

/** Order-insensitive-key, order-sensitive-array structural equality. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => [key, sortKeysDeep(inner)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  return value;
}

function recordsEqual(a: SourceAcquisitionRecord, b: SourceAcquisitionRecord): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function toIdMap(
  records: readonly SourceAcquisitionRecord[],
  label: string,
  errors: string[],
): Map<string, SourceAcquisitionRecord> {
  const map = new Map<string, SourceAcquisitionRecord>();
  for (const record of records) {
    if (map.has(record.id)) {
      errors.push(`${record.id}: duplicate id within ${label}`);
      continue;
    }
    map.set(record.id, record);
  }
  return map;
}

export type MergeResult = {
  records: SourceAcquisitionRecord[];
  errors: string[];
};

/**
 * Three-way merge of the ledger by record id, per record:
 *  - added on one side (not in base) -> included;
 *  - added identically on both sides -> included once;
 *  - added differently on both sides -> fail, naming the id;
 *  - changed on one side only -> that side's version;
 *  - changed identically on both sides -> included once;
 *  - changed differently on both sides -> fail, naming the id;
 *  - deleted on one side, unchanged on the other -> deleted;
 *  - deleted on one side, changed on the other -> fail, naming the id;
 *  - deleted on both sides -> deleted.
 * Duplicate ids within a single side fail before any comparison. The result
 * is returned sorted in hash order. Pure — takes no git dependency, so it is
 * directly testable against fixture arrays.
 */
export function mergeLedgerRecords(
  base: readonly SourceAcquisitionRecord[],
  ours: readonly SourceAcquisitionRecord[],
  theirs: readonly SourceAcquisitionRecord[],
): MergeResult {
  const errors: string[] = [];
  const baseMap = toIdMap(base, "base", errors);
  const oursMap = toIdMap(ours, "ours", errors);
  const theirsMap = toIdMap(theirs, "theirs", errors);
  if (errors.length > 0) return { records: [], errors };

  const allIds = new Set<string>([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()]);
  const merged: SourceAcquisitionRecord[] = [];

  for (const id of allIds) {
    const baseRecord = baseMap.get(id);
    const oursRecord = oursMap.get(id);
    const theirsRecord = theirsMap.get(id);
    const inBase = baseMap.has(id);
    const inOurs = oursMap.has(id);
    const inTheirs = theirsMap.has(id);

    if (!inBase) {
      // Added on ours, theirs, or both.
      if (inOurs && inTheirs) {
        if (recordsEqual(oursRecord!, theirsRecord!)) {
          merged.push(oursRecord!);
        } else {
          errors.push(`${id}: added differently on both sides`);
        }
      } else if (inOurs) {
        merged.push(oursRecord!);
      } else {
        merged.push(theirsRecord!);
      }
      continue;
    }

    // Present in base: work out whether each side changed it.
    const oursChanged = inOurs ? !recordsEqual(oursRecord!, baseRecord!) : false;
    const theirsChanged = inTheirs ? !recordsEqual(theirsRecord!, baseRecord!) : false;

    if (!inOurs && !inTheirs) {
      continue; // deleted on both sides
    }
    if (!inOurs) {
      // Deleted on ours.
      if (theirsChanged) errors.push(`${id}: deleted on one side and changed on the other`);
      // else: deleted on ours, unchanged on theirs -> deleted.
      continue;
    }
    if (!inTheirs) {
      // Deleted on theirs.
      if (oursChanged) errors.push(`${id}: deleted on one side and changed on the other`);
      continue;
    }

    // Present on both sides.
    if (!oursChanged && !theirsChanged) {
      merged.push(baseRecord!);
    } else if (oursChanged && !theirsChanged) {
      merged.push(oursRecord!);
    } else if (!oursChanged && theirsChanged) {
      merged.push(theirsRecord!);
    } else if (recordsEqual(oursRecord!, theirsRecord!)) {
      merged.push(oursRecord!); // changed identically on both sides
    } else {
      errors.push(`${id}: changed differently on both sides`);
    }
  }

  if (errors.length > 0) return { records: [], errors };
  return { records: sortRecordsByHash(merged), errors: [] };
}

// ---------------------------------------------------------------------------
// Git access (three-way merge mode only — never exercised by unit tests)
// ---------------------------------------------------------------------------

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function readLedgerAtRef(
  ref: string,
  relativePath: string,
): { shape: LedgerShape; records: SourceAcquisitionRecord[] } {
  let raw: string;
  try {
    raw = execFileSync("git", ["show", `${ref}:${relativePath}`], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(
      `Could not read ${relativePath} at ${ref}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseLedgerShape(JSON.parse(raw));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type Flags = {
  mode: "fix-order" | "check-order" | "three-way" | null;
  file?: string;
  base?: string;
  ours?: string;
  theirs?: string;
  write: boolean;
};

function parseArgs(argv: readonly string[]): Flags {
  const flags: Flags = { mode: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--fix-order":
        flags.mode = "fix-order";
        break;
      case "--check-order":
        flags.mode = "check-order";
        break;
      case "--write":
        flags.write = true;
        break;
      case "--file":
        flags.file = argv[++i];
        break;
      case "--base":
        flags.base = argv[++i];
        break;
      case "--ours":
        flags.ours = argv[++i];
        break;
      case "--theirs":
        flags.theirs = argv[++i];
        break;
      default:
        throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  if (flags.base || flags.ours || flags.theirs) {
    if (!flags.base || !flags.ours || !flags.theirs) {
      throw new Error("--base, --ours and --theirs must all be given together");
    }
    if (flags.mode) {
      throw new Error("--base/--ours/--theirs cannot be combined with --fix-order or --check-order");
    }
    flags.mode = "three-way";
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const relativeFile = flags.file ?? DEFAULT_RELATIVE_PATH;
  const absPath = path.resolve(process.cwd(), relativeFile);
  const gitRelativePath = toPosixPath(path.relative(repoRoot, absPath));

  if (flags.mode === "fix-order") {
    const raw = readFileSync(absPath, "utf8");
    const { shape, records } = parseLedgerShape(JSON.parse(raw));
    const sorted = sortRecordsByHash(records);
    const formatted = await formatLedgerJson(rebuildLedger(shape, sorted), absPath);
    writeFileSync(absPath, formatted);
    console.log(`Sorted ${sorted.length} records by sha1(id) and wrote ${relativeFile}`);
    return;
  }

  if (flags.mode === "check-order") {
    const raw = readFileSync(absPath, "utf8");
    const { records } = parseLedgerShape(JSON.parse(raw));
    if (isSortedByHash(records)) {
      console.log(`${relativeFile} is in sha1(id) order (${records.length} records).`);
      return;
    }
    console.error(
      `${relativeFile} is not sorted by sha1(id). Run \`npm run source-acquisitions:merge -- --fix-order\`.`,
    );
    process.exitCode = 1;
    return;
  }

  if (flags.mode === "three-way") {
    const baseLedger = readLedgerAtRef(flags.base!, gitRelativePath);
    const oursLedger = readLedgerAtRef(flags.ours!, gitRelativePath);
    const theirsLedger = readLedgerAtRef(flags.theirs!, gitRelativePath);

    const { records, errors } = mergeLedgerRecords(baseLedger.records, oursLedger.records, theirsLedger.records);
    if (errors.length > 0) {
      console.error("Source acquisition merge failed:");
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `Merged ${records.length} records (base ${baseLedger.records.length}, ours ${oursLedger.records.length}, theirs ${theirsLedger.records.length}).`,
    );

    if (flags.write) {
      const formatted = await formatLedgerJson(rebuildLedger(oursLedger.shape, records), absPath);
      writeFileSync(absPath, formatted);
      console.log(`Wrote merged ledger to ${relativeFile}`);
    }
    return;
  }

  console.error(
    "Usage: merge-source-acquisitions.ts --fix-order|--check-order [--file <path>]\n" +
      "   or: merge-source-acquisitions.ts --base <ref> --ours <ref> --theirs <ref> [--file <path>] [--write]",
  );
  process.exitCode = 1;
}

const isMainModule = isDirectEntrypoint(import.meta.url);
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
