import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import JSZip from "jszip";

import { buildDifferentialSnapshot } from "./lib/parse-differentials-export";

const DEFAULT_ZIP = "C:/Users/joshs/AppData/Local/Temp/differentials-data.zip";

function defaultOutputPath() {
  return path.resolve(process.cwd(), "data/differentials-snapshot.json");
}

function createFallbackFixtureZip(): JSZip {
  const zip = new JSZip();
  zip.file(
    "03_individual_entries/01_delirium.txt",
    `=== ENTRY 1 ===
Delirium / Acute Confusion / Encephalopathy

Urgency: emergent
Axis: organic
Population: general

TRIAGE RATIONALE:
Delirium and its encephalopathic mimics are acute medical emergencies.

MUST NOT MISS:
- Delirium

MIMICS:
Primary psychosis

CLINICAL HINGE:
Inattention plus altered awareness.

IMMEDIATE ACTIONS:
- Do vitals early

INVESTIGATIONS:
- Blood glucose

OPTIONS:
1. Delirium — Acute change, fluctuating course. Red flags: Sepsis, hypoxia.
2. Substance intoxication — Time-link to use. Red flags: Opioid respiratory depression.

SOURCE: v10`,
  );
  zip.file(
    "05_scenario_presets/presets.md",
    `## 1. Older adult acute confusion
- **Query:** \`older adult acute confusion\`
- **Signals:** Older adult onset
- **Entries:**
  - Entry 1 — Delirium`,
  );
  zip.file(
    "04_red_flag_flows/flows.md",
    `## 1. Acute Confusion Red Flag Flow
Entry 1
**Bedside questions:** Inattention, acute change
**Key red flags across options:** Hypoxia, sepsis`,
  );
  zip.file(
    "06_tags_and_search/search_aliases.md",
    `| Token | Expansion |
|---|---|
| delirium | confusion, fluctuation |`,
  );
  zip.file(
    "07_governance/source_info.md",
    `| Field | Value |
|---|---|
| Version | v10 |
| Review status | Fixture |
| Source title | Differentials |`,
  );
  return zip;
}

async function readZipText(zip: JSZip, filePath: string) {
  const normalizedTarget = filePath.replace(/\\/g, "/");
  const match = Object.keys(zip.files).find((name) => name.replace(/\\/g, "/") === normalizedTarget);
  if (!match) return "";
  const file = zip.file(match);
  if (!file || file.dir) return "";
  return file.async("string");
}

async function main() {
  const zipArg = process.argv.find((token) => token.startsWith("--zip="))?.slice("--zip=".length);
  const zipPath = zipArg ? path.resolve(zipArg) : DEFAULT_ZIP;
  const write = process.argv.includes("--write");
  const out = defaultOutputPath();

  let zip: JSZip;
  if (!existsSync(zipPath)) {
    if (zipArg) {
      throw new Error(`Specified differentials zip not found: ${zipPath}`);
    }
    if (write) {
      throw new Error(
        `Cannot write snapshot from fallback fixture: default zip not found at ${DEFAULT_ZIP}. Provide a real export zip via --zip=<path> to write.`,
      );
    }
    console.warn(
      `[differentials:import] Default source zip not found at ${DEFAULT_ZIP}; using fallback fixture zip for dry run.`,
    );
    zip = createFallbackFixtureZip();
  } else {
    const buffer = readFileSync(zipPath);
    zip = await JSZip.loadAsync(buffer);
  }

  const entryFiles: Array<{ name: string; content: string }> = [];
  for (const [name, file] of Object.entries(zip.files)) {
    const normalizedName = name.replace(/\\/g, "/");
    if (!normalizedName.startsWith("03_individual_entries/") || !normalizedName.endsWith(".txt") || file.dir) {
      continue;
    }
    entryFiles.push({ name: path.basename(normalizedName), content: await file.async("string") });
  }
  entryFiles.sort((left, right) => left.name.localeCompare(right.name));

  const snapshot = buildDifferentialSnapshot({
    entryFiles,
    tagIndexMarkdown: await readZipText(zip, "06_tags_and_search/tag_index.md"),
    presetsMarkdown: await readZipText(zip, "05_scenario_presets/presets.md"),
    flowsMarkdown: await readZipText(zip, "04_red_flag_flows/flows.md"),
    aliasesMarkdown: await readZipText(zip, "06_tags_and_search/search_aliases.md"),
    governanceMarkdown: await readZipText(zip, "07_governance/source_info.md"),
  });

  if (snapshot.presentations.length === 0 || snapshot.diagnoses.length === 0) {
    throw new Error(
      `Differentials import produced an empty snapshot (${snapshot.presentations.length} presentations, ${snapshot.diagnoses.length} diagnoses). Check the export zip layout before writing.`,
    );
  }

  console.log(
    `[differentials:import] ${snapshot.presentations.length} presentations, ${snapshot.diagnoses.length} diagnoses, ${snapshot.presets.length} presets, ${snapshot.redFlagFlows.length} flows`,
  );
  console.log(`[differentials:import] Source zip: ${zipPath}`);

  if (!write) {
    console.log("[differentials:import] Dry run. Re-run with --write to save data/differentials-snapshot.json");
    return;
  }

  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`[differentials:import] Wrote ${out}`);
}

main().catch((error) => {
  console.error(`[differentials:import] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
