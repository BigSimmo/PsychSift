import { describe, expect, it } from "vitest";

import {
  buildMedicationSnapshotProvenance,
  diffMedicationSnapshots,
  isMedicationsRemote,
  judgeMedicationImport,
  parseAcceptedChanges,
} from "../scripts/lib/medication-import-guard.mjs";

/**
 * The import must not silently undo corrections made in this repository, such as the 629 medicine
 * fixes from the 20 Oct 2026 content audit (#3692). A changed or removed medicine needs to be
 * accepted by name; a new one does not.
 */

const phenytoin = {
  slug: "phenytoin",
  name: "Phenytoin",
  sections: [{ key: "Albumin", val: "0.2 x albumin (g/L) + 0.1" }],
};
const lithium = { slug: "lithium", name: "Lithium", sections: [] };

describe("medication import guard", () => {
  it("lets an import through when nothing already here changes", () => {
    const diff = diffMedicationSnapshots([phenytoin], [phenytoin, lithium]);
    expect(diff).toEqual({ added: ["lithium"], removed: [], changed: [] });
    expect(judgeMedicationImport(diff, parseAcceptedChanges([])).ok).toBe(true);
  });

  // The failure this exists for: the Medications export still carries the uncorrected value.
  it("stops an import that would revert a corrected medicine, and names the field", () => {
    const reverted = { ...phenytoin, sections: [{ key: "Albumin", val: "0.2 x albumin (g/dL) + 0.1" }] };
    const diff = diffMedicationSnapshots([phenytoin, lithium], [reverted, lithium]);
    expect(diff.changed).toEqual([{ slug: "phenytoin", fields: ["sections"] }]);

    const verdict = judgeMedicationImport(diff, parseAcceptedChanges([]));
    expect(verdict.ok).toBe(false);
    expect(verdict.unaccepted).toEqual(["phenytoin"]);
    expect(verdict.message).toContain("changed  phenytoin: sections");
    expect(verdict.message).toContain("Nothing was written.");
  });

  it("stops an import that would drop a medicine", () => {
    const diff = diffMedicationSnapshots([phenytoin, lithium], [phenytoin]);
    const verdict = judgeMedicationImport(diff, parseAcceptedChanges([]));
    expect(verdict).toMatchObject({ ok: false, unaccepted: ["lithium"] });
    expect(verdict.message).toContain("removed  lithium");
  });

  it("needs every changed medicine accepted by name, or all of them", () => {
    const diff = { added: [], removed: ["lithium"], changed: [{ slug: "phenytoin", fields: ["sections"] }] };
    expect(judgeMedicationImport(diff, parseAcceptedChanges(["--accept-changes=phenytoin"]))).toMatchObject({
      ok: false,
      unaccepted: ["lithium"],
    });
    expect(judgeMedicationImport(diff, parseAcceptedChanges(["--accept-changes=Phenytoin, lithium"])).ok).toBe(true);
    expect(judgeMedicationImport(diff, parseAcceptedChanges(["--accept-changes=all"])).ok).toBe(true);
  });
});

describe("medication snapshot provenance (audit 2026-10-24 E2E-09)", () => {
  const base = {
    sourceKind: "canonical-snapshot" as const,
    sourceName: "drugs-snapshot.json",
    sourceModifiedAt: "2026-10-20T01:02:03.000Z",
    importedAt: "2026-10-25T00:00:00.000Z",
    recordCount: 96,
    snapshotSha256: "a".repeat(64),
  };

  it("records the upstream commit, dates, count and hash", () => {
    expect(buildMedicationSnapshotProvenance({ ...base, upstreamCommit: " 51F24A3\n" })).toEqual({
      schemaVersion: 1,
      upstreamRepository: "BigSimmo/Medications",
      sourceKind: "canonical-snapshot",
      sourceName: "drugs-snapshot.json",
      upstreamCommit: "51f24a3",
      sourceModifiedAt: "2026-10-20T01:02:03.000Z",
      importedAt: "2026-10-25T00:00:00.000Z",
      recordCount: 96,
      snapshotSha256: "a".repeat(64),
    });
  });

  it("says the commit is not known rather than recording anything that is not a commit", () => {
    expect(buildMedicationSnapshotProvenance({ ...base, upstreamCommit: null }).upstreamCommit).toBeNull();
    expect(
      buildMedicationSnapshotProvenance({ ...base, upstreamCommit: "fatal: not a git repository" }).upstreamCommit,
    ).toBeNull();
  });
});

describe("isMedicationsRemote", () => {
  it("accepts only the BigSimmo/Medications remote, so another checkout's HEAD is never recorded", () => {
    expect(isMedicationsRemote("https://github.com/BigSimmo/Medications.git")).toBe(true);
    expect(isMedicationsRemote("git@github.com:BigSimmo/Medications.git\n")).toBe(true);
    expect(isMedicationsRemote("https://github.com/BigSimmo/Medications")).toBe(true);
    expect(isMedicationsRemote("https://github.com/BigSimmo/PsychSift.git")).toBe(false);
    expect(isMedicationsRemote("https://github.com/BigSimmo/Medications-archive.git")).toBe(false);
    expect(isMedicationsRemote(null)).toBe(false);
  });
});
