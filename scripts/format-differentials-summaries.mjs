import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = join(root, "data", "differentials-snapshot.json");
const diffDirPath = join(root, "data", "differentials");
const diffJsonPath = join(diffDirPath, "differentials.json");

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
let updatedCount = 0;

const deliriumSpaceJoined =
  "In older or medically unwell patients, assume delirium until proved otherwise Cannabis and stimulants can closely mimic primary psychosis Reassess once partially cleared Escalate early to medical/neurology review if red flags are present Consider MRI, EEG, CSF, and autoimmune testing when the syndrome is atypical Clarify positive symptoms, negative symptoms, cognition, and functional trajectory";

const deliriumFormatted =
  "In older or medically unwell patients, assume delirium until proved otherwise, Cannabis and stimulants can closely mimic primary psychosis, Reassess once partially cleared, Escalate early to medical/neurology review if red flags are present, Consider MRI, EEG, CSF, and autoimmune testing when the syndrome is atypical, Clarify positive symptoms, negative symptoms, cognition, and functional trajectory.";

const catatoniaSpaceJoined =
  "Use structured screen (Bush-Francis), examine motor signs, check vitals/hydration/CK, think benzodiazepine challenge early Catatonia is more often mood-linked than many clinicians expect Treat the catatonia specifically Benzodiazepines and/or ECT are first-line Run a full delirium workup Hypoactive delirium is a major mimic";

const catatoniaFormatted =
  "Use structured screen (Bush-Francis), examine motor signs, check vitals/hydration/CK, think benzodiazepine challenge early, Catatonia is more often mood-linked than many clinicians expect, Treat the catatonia specifically, Benzodiazepines and/or ECT are first-line, Run a full delirium workup, Hypoactive delirium is a major mimic.";

for (const diagnosis of snapshot.diagnoses) {
  for (const section of diagnosis.sections || []) {
    if (section.id === "immediate-action" && Array.isArray(section.items) && section.items.length > 1) {
      if (section.summary === deliriumSpaceJoined) {
        section.summary = deliriumFormatted;
        updatedCount += 1;
      } else if (section.summary === catatoniaSpaceJoined) {
        section.summary = catatoniaFormatted;
        updatedCount += 1;
      } else {
        const spaceJoined = section.items.join(" ");
        if (section.summary === spaceJoined) {
          const formatted =
            section.items
              .map((item) => item.trim().replace(/\.+$/, ""))
              .filter(Boolean)
              .join(", ") + ".";
          section.summary = formatted;
          updatedCount += 1;
        }
      }
    }
  }
}

console.log(`Updated ${updatedCount} diagnosis section summaries with proper commas and terminal periods.`);

if (updatedCount !== 86) {
  console.warn(`Expected 86 summaries to be updated, but updated ${updatedCount}`);
}

writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

mkdirSync(diffDirPath, { recursive: true });
writeFileSync(diffJsonPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

console.log("Successfully wrote data/differentials-snapshot.json and data/differentials/differentials.json");
