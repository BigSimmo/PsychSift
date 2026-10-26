import { describe, expect, it } from "vitest";

import { publicMedicationGovernance } from "@/lib/medication-records";
import { getMedicationRecord } from "@/lib/medication-snapshot";
import type { MedicationRecord } from "@/lib/medications";
import {
  preferBundledMedicationPayload,
  preferBundledMedicationRecord,
} from "@/lib/site-content/prefer-bundled-medication-record";

// The live 2026-08-24 freeze, the release served when the 20 Oct 2026 corrections landed.
const LIVE_FREEZE_RELEASE_ID = "e4a1dd29-14f6-556c-8fb7-f4f947d8b846";
const PUBLISHED_RELEASE_ID = "aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee";

function staleCopy(slug: string, staleText: string): MedicationRecord {
  const bundled = getMedicationRecord(slug);
  if (!bundled) throw new Error(`missing ${slug}`);
  return {
    ...bundled,
    sections: [{ title: "Rapid Summary", type: "summary", rows: [{ key: "Old", val: staleText, tags: [] }] }],
  } as MedicationRecord;
}

describe("preferBundledMedicationRecord", () => {
  it("serves the corrected bundled record over the frozen release, marked unverified", () => {
    const stale = staleCopy("phenytoin", "Corrected Phenytoin = Measured / (0.2 x Albumin + 0.1)");
    const synced = preferBundledMedicationRecord(
      { record: stale, governance: { sourceStatus: "current", validationStatus: "approved", releaseId: "kept" } },
      { activeReleaseId: LIVE_FREEZE_RELEASE_ID, bundledGovernance: publicMedicationGovernance },
    );
    expect(synced.record).toEqual(getMedicationRecord("phenytoin"));
    expect(JSON.stringify(synced.record)).not.toContain("0.2 x Albumin");
    expect(synced.governance?.validationStatus).toBe("unverified");
    expect(synced.governance?.releaseId).toBe("kept");
  });

  it("leaves a real published release alone so a signed-off publish wins", () => {
    const stale = staleCopy("methadone", "usually 20-30 mg daily; up to 40 mg");
    const entry = { record: stale, governance: { validationStatus: "approved" } };
    const synced = preferBundledMedicationRecord(entry, {
      activeReleaseId: PUBLISHED_RELEASE_ID,
      bundledGovernance: publicMedicationGovernance,
    });
    expect(synced).toBe(entry);
  });

  it("leaves the record alone when the release is unknown or the slug is not bundled", () => {
    const stale = staleCopy("methadone", "old");
    const entry = { record: stale };
    expect(
      preferBundledMedicationRecord(entry, { activeReleaseId: null, bundledGovernance: publicMedicationGovernance }),
    ).toBe(entry);
    const ownerOnly = { record: { ...stale, slug: "owner-only-medicine" } as MedicationRecord };
    expect(
      preferBundledMedicationRecord(ownerOnly, {
        activeReleaseId: LIVE_FREEZE_RELEASE_ID,
        bundledGovernance: publicMedicationGovernance,
      }),
    ).toBe(ownerOnly);
  });

  it("swaps render-only search payloads under the same gate", () => {
    const stale = staleCopy(
      "buprenorphine-naloxone",
      "A toddler eating a Buprenorphine tablet will likely just sleep heavily",
    );
    expect(preferBundledMedicationPayload(stale, { activeReleaseId: LIVE_FREEZE_RELEASE_ID })).toEqual(
      getMedicationRecord("buprenorphine-naloxone"),
    );
    expect(preferBundledMedicationPayload(stale, { activeReleaseId: PUBLISHED_RELEASE_ID })).toBe(stale);
  });
});
