import {
  acquisitionLedgerIssues,
  acquisitionRecordWarnings,
  acquisitionReviewQueue,
  SOURCE_ACQUISITION_RUNGS,
  sourceAcquisitionRecords,
} from "../src/lib/sources/acquisition-ledger";
import { canonicalizeSourceReferences } from "../src/lib/sources/catalogue-core";
import { repositorySourceReferences } from "../src/lib/sources/repository-providers";
import { SOURCE_RIGHTS_STATUSES, sourceRightsStatusCounts } from "../src/lib/sources/source-rights";

const records = sourceAcquisitionRecords;
const rungLabels = new Map(SOURCE_ACQUISITION_RUNGS.map((entry) => [entry.rung, entry.label]));

console.log(`Source acquisition ledger: ${records.length} captured sources`);
for (const { rung, label } of SOURCE_ACQUISITION_RUNGS) {
  const atRung = records.filter((record) => record.rung === rung);
  if (atRung.length > 0) console.log(`- rung ${rung} (${label}): ${atRung.length}`);
}
for (const disposition of ["adopted", "candidate", "rejected"] as const) {
  console.log(`${disposition}: ${records.filter((record) => record.disposition === disposition).length}`);
}

// Informational only (finding R-07): an unknown rights position is the expected
// state until the owner records one, so it never fails this check.
const rightsCounts = sourceRightsStatusCounts(records);
console.log(`Rights and licence status unknown: ${rightsCounts.unknown} of ${records.length}`);
for (const status of SOURCE_RIGHTS_STATUSES) {
  if (status !== "unknown" && rightsCounts[status] > 0) console.log(`- rights ${status}: ${rightsCounts[status]}`);
}

const issues = acquisitionLedgerIssues(records);

// The band a captured source actually reaches depends on every reference to it,
// not just the ledger row, so an adopted source is judged on the merged entry a
// reader sees at /sources rather than on the ledger row in isolation.
const catalogue = new Map(
  canonicalizeSourceReferences(repositorySourceReferences()).flatMap((entry) =>
    entry.usedBy
      .filter((usage) => usage.field === "acquisition_ledger")
      .map((usage) => [usage.recordId, entry] as const),
  ),
);

for (const record of records) {
  if (record.disposition !== "adopted") continue;
  const entry = catalogue.get(record.id);
  if (!entry) {
    issues.push(`${record.id}: adopted but absent from the canonical catalogue`);
    continue;
  }
  if (entry.rating.band === "D") {
    const contributors = entry.usedBy
      .filter((usage) => usage.field !== "acquisition_ledger")
      .map((usage) => `${usage.modeId}/${usage.recordId}`);
    issues.push(
      `${record.id}: adopted but lands at D band (${entry.warnings.join(", ")})` +
        (contributors.length > 0 ? `; weaker metadata also contributed by ${contributors.join(", ")}` : ""),
    );
  }
}

const queue = acquisitionReviewQueue(records);
if (queue.length > 0) {
  console.log(`\nAwaiting clinical sign-off (${queue.length}). These sit at D band until reviewed:`);
  for (const record of queue) {
    console.log(`- rung ${record.rung} ${rungLabels.get(record.rung)}: ${record.title} (${record.publisher})`);
  }
}

const reviewed = records.filter(
  (record) => record.disposition !== "rejected" && record.validationStatus !== "unverified",
);
if (reviewed.length > 0) {
  console.log(`\nReviewed captures and the band they reach:`);
  for (const record of reviewed) {
    const band = catalogue.get(record.id)?.rating.band ?? "?";
    const warnings = acquisitionRecordWarnings(record);
    console.log(`- ${band}: ${record.title}${warnings.length > 0 ? ` (${warnings.join(", ")})` : ""}`);
  }
}

if (issues.length > 0) {
  console.error("\nSource acquisition ledger failed:");
  for (const issue of [...new Set(issues)].sort()) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log("\nSource acquisition ledger passed.");
}
