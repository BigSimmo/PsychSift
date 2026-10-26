import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  buildMedicationSnapshotProvenance,
  diffMedicationSnapshots,
  isMedicationsRemote,
  judgeMedicationImport,
  parseAcceptedChanges,
} from "./lib/medication-import-guard.mjs";

type MedicationExportRecord = {
  slug: string;
  name: string;
  class: string;
  subclass: string;
  category: string;
  accent: string;
  tag: string;
  schedule: string;
  stats: unknown[];
  sections: unknown[];
  quick: unknown[];
};

function defaultExportPath() {
  return path.resolve("C:/Dev/Apps/Medications/medications-export.zip");
}

function canonicalSnapshotPath() {
  return path.resolve("C:/Dev/Apps/Medications/scripts/src/drugs-snapshot.json");
}

function outputPath() {
  return path.resolve(process.cwd(), "data/medications-snapshot.json");
}

function provenancePath() {
  return path.resolve(process.cwd(), "data/medications-snapshot.provenance.json");
}

/**
 * The Medications checkout's HEAD commit, or null when the source is not inside a Medications
 * checkout (for example an export saved in this repository) or git is missing.
 */
function upstreamCommitFor(source: string): string | null {
  const git = (args: string[]) =>
    execFileSync("git", ["-C", path.dirname(source), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    if (!isMedicationsRemote(git(["remote", "get-url", "origin"]))) return null;
    return git(["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

const CLOZAPINE_OVERVIEW =
  "Antipsychotic for treatment-resistant schizophrenia. Treatment requires registration and blood monitoring through the clozapine monitoring service because of serious, potentially fatal adverse effects.";

function normalizeRecord(record: MedicationExportRecord): MedicationExportRecord {
  const slug = String(record.slug).trim().toLowerCase();
  const sections = Array.isArray(record.sections) ? record.sections : [];
  // Keep the clinically signed-off wording while the canonical Medications
  // snapshot catches up; otherwise every refresh silently reintroduces the old overview.
  const normalizedSections =
    slug === "clozapine"
      ? sections.map((section) => {
          if (!section || typeof section !== "object" || Array.isArray(section)) return section;
          const entry = section as { rows?: unknown[]; [key: string]: unknown };
          return {
            ...entry,
            rows: Array.isArray(entry.rows)
              ? entry.rows.map((row) =>
                  row && typeof row === "object" && !Array.isArray(row) && (row as { key?: unknown }).key === "Overview"
                    ? { ...row, val: CLOZAPINE_OVERVIEW }
                    : row,
                )
              : entry.rows,
          };
        })
      : sections;
  return {
    slug,
    name: String(record.name).trim(),
    class: String(record.class ?? "").trim(),
    subclass: String(record.subclass ?? "").trim(),
    category: String(record.category ?? "").trim(),
    accent: String(record.accent ?? "#0f766e").trim(),
    tag: String(record.tag ?? "").trim(),
    schedule: String(record.schedule ?? "").trim(),
    stats: Array.isArray(record.stats) ? record.stats : [],
    sections: normalizedSections,
    quick: Array.isArray(record.quick) ? record.quick : [],
  };
}

function loadFromCanonicalSnapshot(): MedicationExportRecord[] {
  const snapshotPath = canonicalSnapshotPath();
  if (!existsSync(snapshotPath)) {
    throw new Error(`Canonical snapshot not found at ${snapshotPath}`);
  }
  const records = JSON.parse(readFileSync(snapshotPath, "utf8")) as MedicationExportRecord[];
  if (!Array.isArray(records)) {
    throw new Error(`Canonical snapshot is not an array: ${snapshotPath}`);
  }
  return records.map(normalizeRecord);
}

function loadFromZip(zipPath: string): MedicationExportRecord[] {
  const script = `
import json, zipfile, sys
zip_path = sys.argv[1]
records = []
with zipfile.ZipFile(zip_path) as zf:
    for name in zf.namelist():
        if not name.startswith("all-medications/") or not name.endswith(".json"):
            continue
        records.append(json.loads(zf.read(name).decode("utf-8")))
records.sort(key=lambda item: item["name"].lower())
print(json.dumps(records))
`;
  const output = execFileSync("python", ["-c", script, zipPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return (JSON.parse(output) as MedicationExportRecord[]).map(normalizeRecord);
}

function main() {
  const zipArg = process.argv.find((token) => token.startsWith("--zip="))?.slice("--zip=".length);
  const zipPath = zipArg ? path.resolve(zipArg) : defaultExportPath();
  const out = outputPath();
  mkdirSync(path.dirname(out), { recursive: true });

  let records: MedicationExportRecord[];
  let source: string;
  let sourceKind: "canonical-snapshot" | "export-zip";
  if (existsSync(canonicalSnapshotPath())) {
    records = loadFromCanonicalSnapshot();
    source = canonicalSnapshotPath();
    sourceKind = "canonical-snapshot";
  } else if (existsSync(zipPath)) {
    records = loadFromZip(zipPath);
    source = zipPath;
    sourceKind = "export-zip";
  } else {
    throw new Error(`No canonical snapshot and zip not found at ${zipPath}`);
  }

  const slugs = new Set<string>();
  for (const record of records) {
    if (!record.slug) throw new Error(`Medication missing slug: ${record.name}`);
    if (slugs.has(record.slug)) throw new Error(`Duplicate slug: ${record.slug}`);
    slugs.add(record.slug);
  }

  // Refuse to overwrite medicines already here unless each change is accepted by name, so an
  // import cannot silently undo corrections made in this repository (scripts/lib/medication-import-guard.mjs).
  const current = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as MedicationExportRecord[]) : [];
  const diff = diffMedicationSnapshots(current, records);
  const verdict = judgeMedicationImport(diff, parseAcceptedChanges(process.argv));
  if (!verdict.ok) {
    console.error(`[medications:import] ${verdict.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[medications:import] ${verdict.message}`);
  if (process.argv.includes("--dry-run")) {
    console.log("[medications:import] Dry run: nothing written.");
    return;
  }

  const snapshotText = `${JSON.stringify(records, null, 2)}\n`;
  writeFileSync(out, snapshotText, "utf8");
  // Audit 2026-10-24 E2E-09: record which upstream version this snapshot is.
  const provenance = buildMedicationSnapshotProvenance({
    sourceKind,
    sourceName: path.basename(source),
    upstreamCommit: upstreamCommitFor(source),
    sourceModifiedAt: statSync(source).mtime.toISOString(),
    importedAt: new Date().toISOString(),
    recordCount: records.length,
    snapshotSha256: createHash("sha256").update(snapshotText, "utf8").digest("hex"),
  });
  writeFileSync(provenancePath(), `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  console.log(`[medications:import] Wrote ${records.length} medications from ${source}`);
  console.log(
    `[medications:import] Upstream commit: ${provenance.upstreamCommit ?? "not known (source is not a git checkout)"}`,
  );
  console.log(`[medications:import] Output: ${out}`);
}

main();
