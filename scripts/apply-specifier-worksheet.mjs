#!/usr/bin/env node
/**
 * Parse a completed specifier entry worksheet (`docs/specifier-entry-worksheet-with-catatonia.md`)
 * and propagate the shared criteria + disorder-specific overrides into `data/specifiers-content.json`,
 * then rebuild `data/specifiers-search-index.json`.
 *
 * Refuses to write while any required worksheet prompt is still blank (`_(blank)_` or `> _`).
 *
 * Usage:
 *   node scripts/apply-specifier-worksheet.mjs --worksheet docs/specifier-entry-worksheet-with-catatonia.md --dry-run
 *   node scripts/apply-specifier-worksheet.mjs --worksheet docs/specifier-entry-worksheet-with-catatonia.md --write
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const EXPECTED_CATATONIA_ROW_KEYS = Object.freeze([
  "specifier:ndv:autism-spectrum-disorder:co-occurring:with-catatonia",
  "specifier:psy:brief-psychotic-disorder:features:with-catatonia",
  "specifier:psy:schizophreniform-disorder:features:with-catatonia",
  "specifier:psy:schizophrenia:features:with-catatonia",
  "specifier:psy:schizoaffective-disorder:features:with-catatonia",
  "specifier:psy:psychotic-disorder-due-to-another-medical-condition:features:with-catatonia",
  "specifier:bip:bipolar-i-disorder:episode-specifiers:with-catatonia",
  "specifier:bip:bipolar-ii-disorder:episode-specifiers:with-catatonia",
  "specifier:dep:major-depressive-disorder:episode-specifiers:with-catatonia",
]);

function isBlankPlaceholder(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return true;
  if (trimmed.includes("_(blank)_")) return true;
  if (/^>_?/.test(trimmed) || /^_\(.*\)_$/.test(trimmed)) return true;
  return false;
}

function cleanField(value) {
  return String(value ?? "")
    .replace(/^>\s*/, "")
    .trim();
}

export function parseWorksheetArgs(argv) {
  let worksheet = "docs/specifier-entry-worksheet-with-catatonia.md";
  let mode = "dry-run";
  let sawMode = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--worksheet") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--worksheet requires a path.");
      }
      worksheet = next;
      index += 1;
      continue;
    }
    if (token === "--dry-run" || token === "--write") {
      if (sawMode) {
        throw new Error("Specify at most one of --dry-run or --write.");
      }
      sawMode = true;
      mode = token === "--write" ? "write" : "dry-run";
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { worksheet, write: mode === "write", dryRun: mode === "dry-run" };
}

export function parseCatatoniaWorksheet(markdown) {
  const problems = [];
  const normalized = String(markdown).replace(/\r\n/g, "\n");
  const sectionParts = normalized.split(/^##\s+2[\s.—-]+/m);
  const sharedSection = sectionParts[0] ?? "";
  const disordersSection = (sectionParts[1] ?? "").split(/^##\s+3[\s.—-]+/m)[0] ?? "";

  const quoteBlocks = [];
  let currentQuoteLines = [];
  for (const line of sharedSection.split("\n")) {
    const match = line.match(/^>\s*(.*)$/);
    if (match) {
      const cleaned = cleanField(match[1]);
      if (cleaned) currentQuoteLines.push(cleaned);
    } else if (currentQuoteLines.length > 0) {
      const trimmedLine = line.trim();
      if (trimmedLine === "") {
        quoteBlocks.push(currentQuoteLines.join(" "));
        currentQuoteLines = [];
      } else if (!/^#{1,6}\s|^[-*+]\s|^\d+\.\s/.test(trimmedLine)) {
        const cleaned = cleanField(trimmedLine);
        if (cleaned) currentQuoteLines.push(cleaned);
      } else {
        quoteBlocks.push(currentQuoteLines.join(" "));
        currentQuoteLines = [];
      }
    }
  }
  if (currentQuoteLines.length > 0) {
    quoteBlocks.push(currentQuoteLines.join(" "));
  }
  const quoteMatches = quoteBlocks;
  if (quoteMatches.length < 4) {
    problems.push(`Section 1 must contain 4 blockquote answers (found ${quoteMatches.length}).`);
  }

  const [threshold = "", exclusions = "", impact = "", sourceFamily = ""] = quoteMatches;
  const sharedLabels = [
    ["Section 1.1 (threshold / what has to be present)", threshold],
    ["Section 1.2 (exclusions / differential)", exclusions],
    ["Section 1.3 (what applying it changes)", impact],
    ["Section 1.4 (sourceFamily)", sourceFamily],
  ];
  for (const [label, value] of sharedLabels) {
    if (isBlankPlaceholder(value)) {
      problems.push(`${label} is still blank.`);
    }
  }

  const entriesByRowKey = new Map();
  const subsectionBlocks = disordersSection.split(/^###\s+/m).slice(1);
  for (const block of subsectionBlocks) {
    const keyMatch = block.match(/`(specifier:[^`\n]+:with-catatonia)`/);
    if (!keyMatch) continue;
    const rowKey = keyMatch[1].trim();

    const unchangedMatch = block.match(/-\s*Shared definition applies unchanged\?[^\n]*→\s*([^\n]+)/);
    const diffMatch = block.match(/-\s*If no, what differs here[\s\S]*?:\s*([^\n]+)/);
    const icd11Match = block.match(/-\s*ICD-11 route for this disorder[\s\S]*?:\s*([^\n]+)/);

    const rawUnchanged = cleanField(unchangedMatch?.[1] ?? "").toLowerCase();
    const rawDifference = cleanField(diffMatch?.[1] ?? "");
    const rawIcd11 = cleanField(icd11Match?.[1] ?? "");

    if (isBlankPlaceholder(rawUnchanged) || (rawUnchanged !== "yes" && rawUnchanged !== "no")) {
      problems.push(`${rowKey}: "Shared definition applies unchanged?" must be answered "yes" or "no".`);
    }
    const unchanged = rawUnchanged === "yes";
    const difference = isBlankPlaceholder(rawDifference) ? "" : rawDifference;
    if (rawUnchanged === "no" && !difference) {
      problems.push(`${rowKey}: marked "no" for unchanged definition, but difference note is blank.`);
    }
    if (isBlankPlaceholder(rawIcd11)) {
      problems.push(`${rowKey}: ICD-11 route (icd11Context) is still blank.`);
    }

    entriesByRowKey.set(rowKey, {
      rowKey,
      unchanged,
      difference,
      icd11Context: rawIcd11,
    });
  }

  for (const expectedKey of EXPECTED_CATATONIA_ROW_KEYS) {
    if (!entriesByRowKey.has(expectedKey)) {
      problems.push(`Missing worksheet subsection for ${expectedKey}.`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Worksheet is incomplete; refusing to apply:\n- ${problems.join("\n- ")}`);
  }

  return {
    shared: {
      threshold,
      exclusions,
      impact,
      sourceFamily,
    },
    entries: EXPECTED_CATATONIA_ROW_KEYS.map((key) => entriesByRowKey.get(key)),
  };
}

function shortContentHash(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 8);
}

export function applyCatatoniaWorksheet(document, parsed) {
  const byRowKey = new Map(parsed.entries.map((entry) => [entry.rowKey, entry]));
  const matched = new Set();

  const categories = (document.categories ?? []).map((category) => ({
    ...category,
    disorders: (category.disorders ?? []).map((disorder) => {
      const matchedOverrides = (disorder.groups ?? []).flatMap((group) =>
        (group.items ?? []).map((item) => byRowKey.get(item?.review?.rowKey)).filter(Boolean),
      );
      const distinctIcd11 = [...new Set(matchedOverrides.map((entry) => entry.icd11Context).filter(Boolean))];
      if (distinctIcd11.length > 1) {
        throw new Error(
          `Conflicting ICD-11 routes for disorder ${disorder.id ?? disorder.name}: ${distinctIcd11.join(" vs ")}`,
        );
      }
      const nextIcd11Context = distinctIcd11[0] || disorder.icd11Context || undefined;
      const groups = (disorder.groups ?? []).map((group) => ({
        ...group,
        items: (group.items ?? []).map((item) => {
          const rowKey = item?.review?.rowKey;
          const override = byRowKey.get(rowKey);
          if (!override) return item;
          matched.add(rowKey);
          const itemIcd11Note = override.icd11Context ? `ICD-11 route: ${override.icd11Context}` : "";
          const meaning = override.unchanged
            ? parsed.shared.threshold
            : `${parsed.shared.threshold} ${override.difference}`.trim();
          const clinicalNote = [parsed.shared.exclusions, parsed.shared.impact, itemIcd11Note]
            .filter(Boolean)
            .join(" ")
            .trim();
          const definition = {
            meaning,
            clinicalNote,
            sourceFamily: parsed.shared.sourceFamily,
            status: "defined",
          };
          const contentHash = shortContentHash({
            rowKey,
            label: item.label,
            definition,
            definitionStatus: "defined",
            icd11Context: nextIcd11Context,
          });
          const nextReview = {
            rowKey,
            contentHash,
            sourceFamily: parsed.shared.sourceFamily,
            sourceVerificationStatus: "source-verified",
            clinicianReviewStatus: "clinician-review-pending",
            changedSinceReview: true,
          };
          return {
            ...item,
            definition,
            definitionStatus: "defined",
            review: nextReview,
          };
        }),
      }));
      return {
        ...disorder,
        ...(nextIcd11Context ? { icd11Context: nextIcd11Context } : {}),
        groups,
      };
    }),
  }));

  for (const expectedKey of EXPECTED_CATATONIA_ROW_KEYS) {
    if (!matched.has(expectedKey)) {
      throw new Error(`Specifier rowKey ${expectedKey} was not found in data/specifiers-content.json.`);
    }
  }

  const allItems = categories.flatMap((category) =>
    category.disorders.flatMap((disorder) => disorder.groups.flatMap((group) => group.items)),
  );
  const itemsWithDefinitions = allItems.filter((item) => item.definitionStatus === "defined").length;

  return {
    ...document,
    stats: {
      ...document.stats,
      itemsWithDefinitions,
    },
    categories,
  };
}

export async function main(argv = process.argv.slice(2), { root = process.cwd(), output = process.stdout } = {}) {
  const args = parseWorksheetArgs(argv);
  const worksheetPath = resolve(root, args.worksheet);
  if (!existsSync(worksheetPath)) {
    throw new Error(`Worksheet file not found: ${worksheetPath}`);
  }
  const markdown = readFileSync(worksheetPath, "utf8");
  const parsed = parseCatatoniaWorksheet(markdown);

  const specifiersPath = join(root, "data", "specifiers-content.json");
  const document = JSON.parse(readFileSync(specifiersPath, "utf8"));
  const nextDocument = applyCatatoniaWorksheet(document, parsed);

  if (!args.write) {
    output.write(
      `Dry run passed: ${parsed.entries.length} "With catatonia" specifier rows ready to update from ${args.worksheet}.\n`,
    );
    return 0;
  }

  let formatted = `${JSON.stringify(nextDocument, null, 2)}\n`;
  try {
    const prettier = await import("prettier");
    const config = (await prettier.resolveConfig(specifiersPath)) ?? {};
    formatted = await prettier.format(formatted, { ...config, filepath: specifiersPath });
  } catch {
    // Fall back to 2-space JSON formatting if prettier is unavailable.
  }

  writeFileSync(specifiersPath, formatted, "utf8");
  execFileSync(process.execPath, [join(root, "scripts", "build-specifiers-search-index.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  output.write(
    `Updated ${parsed.entries.length} "With catatonia" specifier rows in data/specifiers-content.json and rebuilt data/specifiers-search-index.json.\n`,
  );
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(existsSync(process.argv[1]) ? realpathSync(resolve(process.argv[1])) : resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`apply-specifier-worksheet: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
