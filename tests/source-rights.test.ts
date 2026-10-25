import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  acquisitionAttestedContentSha256,
  acquisitionLedgerIssues,
  acquisitionReference,
  sourceAcquisitionRecords,
  type SourceAcquisitionRecord,
} from "@/lib/sources/acquisition-ledger";
import {
  SOURCE_RIGHTS_STATUSES,
  sourceRightsFor,
  sourceRightsIssues,
  sourceRightsStatusCounts,
  type SourceRights,
} from "@/lib/sources/source-rights";

// Synthetic test values only; none of these is a real source's rights position.
const statedRights: SourceRights = {
  status: "permission_granted",
  publicDisplay: "allowed",
  aiUse: "not_allowed",
  evidenceUrl: "https://example.org/permission-letter",
  note: null,
  checkedAt: "2026-10-01",
  recordedBy: "Test Owner",
};

describe("sourceRightsIssues", () => {
  it("accepts an absent field, which means unknown", () => {
    expect(sourceRightsIssues("rec", undefined)).toEqual([]);
  });

  it("accepts a bare unknown status and a fully evidenced stated status", () => {
    expect(sourceRightsIssues("rec", { status: "unknown" })).toEqual([]);
    expect(sourceRightsIssues("rec", { status: "unknown", note: "Asked the publisher" })).toEqual([]);
    expect(sourceRightsIssues("rec", statedRights)).toEqual([]);
  });

  it("rejects a value that is not an object", () => {
    for (const value of [null, "open_licence", ["unknown"], 3]) {
      expect(sourceRightsIssues("rec", value)).toEqual([
        "rec: rights must be an object with a status, or be left out (which means unknown)",
      ]);
    }
  });

  it("rejects an unrecognised status, use permission or field", () => {
    expect(sourceRightsIssues("rec", { status: "public_domain" })).toContain(
      `rec: rights.status must be one of ${SOURCE_RIGHTS_STATUSES.join(", ")}`,
    );
    expect(sourceRightsIssues("rec", {})).toContain(
      `rec: rights.status must be one of ${SOURCE_RIGHTS_STATUSES.join(", ")}`,
    );
    expect(sourceRightsIssues("rec", { status: "unknown", aiUse: "yes" })).toEqual([
      "rec: rights.aiUse must be one of unknown, allowed, not_allowed",
    ]);
    expect(sourceRightsIssues("rec", { status: "unknown", license: "CC BY 4.0" })).toEqual([
      expect.stringContaining("rec: rights.license is not a recognised field"),
    ]);
  });

  it("refuses to call a use allowed while the rights position is unknown", () => {
    expect(sourceRightsIssues("rec", { status: "unknown", publicDisplay: "allowed", aiUse: "not_allowed" })).toEqual([
      'rec: rights.publicDisplay cannot be "allowed" while rights.status is "unknown"',
    ]);
  });

  it("requires who, when and on what evidence for every stated status", () => {
    for (const status of SOURCE_RIGHTS_STATUSES.filter((value) => value !== "unknown")) {
      const issues = sourceRightsIssues("rec", { status });
      expect(issues).toContain(`rec: rights.recordedBy is required when rights.status is ${status}`);
      expect(issues).toContain(`rec: rights.checkedAt is required when rights.status is ${status}`);
      expect(issues).toContain(`rec: rights.evidenceUrl or rights.note is required when rights.status is ${status}`);
    }
    expect(sourceRightsIssues("rec", { ...statedRights, evidenceUrl: null, note: "Emailed reply on file" })).toEqual(
      [],
    );
  });

  it("requires an open licence to name the licence", () => {
    const openLicence: SourceRights = { ...statedRights, status: "open_licence" };
    expect(sourceRightsIssues("rec", openLicence)).toEqual([
      "rec: rights.licence must name the licence when rights.status is open_licence",
    ]);
    expect(sourceRightsIssues("rec", { ...openLicence, licence: "CC BY 4.0" })).toEqual([]);
  });

  it("rejects a malformed date, a non-https evidence link and non-text fields", () => {
    expect(sourceRightsIssues("rec", { ...statedRights, checkedAt: "2026-02-30" })).toContain(
      'rec: rights.checkedAt must be an exact YYYY-MM-DD date, got "2026-02-30"',
    );
    expect(sourceRightsIssues("rec", { ...statedRights, evidenceUrl: "http://example.org/terms" })).toContain(
      "rec: rights.evidenceUrl must be an https link",
    );
    expect(sourceRightsIssues("rec", { ...statedRights, recordedBy: 7 })).toContain(
      "rec: rights.recordedBy must be text or null",
    );
  });
});

describe("sourceRightsFor and sourceRightsStatusCounts", () => {
  it("reads absent rights and absent uses as unknown", () => {
    expect(sourceRightsFor(undefined)).toEqual({ status: "unknown", publicDisplay: "unknown", aiUse: "unknown" });
    expect(sourceRightsFor({ status: "restricted" })).toMatchObject({ publicDisplay: "unknown", aiUse: "unknown" });
  });

  it("counts records with no rights field as unknown", () => {
    const counts = sourceRightsStatusCounts([{}, { rights: { status: "unknown" } }, { rights: statedRights }]);
    expect(counts).toEqual({
      unknown: 2,
      open_licence: 0,
      publisher_terms_allow: 0,
      permission_granted: 1,
      restricted: 0,
    });
  });
});

describe("rights in the source acquisition register", () => {
  const [first] = sourceAcquisitionRecords;
  const base = first as SourceAcquisitionRecord;

  it("asserts no rights position for any real source yet", () => {
    // Recording a real source's rights is the owner's legal judgement (#HGEC4B).
    // When the owner records one, update this count deliberately.
    expect(sourceRightsStatusCounts(sourceAcquisitionRecords).unknown).toBe(sourceAcquisitionRecords.length);
  });

  it("reports rights issues through the ledger validator", () => {
    const record = { ...base, rights: { status: "permission_granted" } } as SourceAcquisitionRecord;
    expect(acquisitionLedgerIssues([record])).toContain(
      `${base.id}: rights.recordedBy is required when rights.status is permission_granted`,
    );
  });

  it("leaves existing attestation digests unchanged while the field is absent", () => {
    const withoutRights = { ...base };
    delete withoutRights.rights;
    expect(acquisitionAttestedContentSha256(withoutRights)).toBe(acquisitionAttestedContentSha256(base));
    expect(acquisitionAttestedContentSha256({ ...base, rights: statedRights })).not.toBe(
      acquisitionAttestedContentSha256(base),
    );
  });

  it("does not carry rights into the catalogue reference readers and retrieval see", () => {
    const reference = acquisitionReference({ ...base, rights: statedRights });
    expect(reference).toEqual(acquisitionReference(base));
    expect(Object.keys(reference)).not.toContain("rights");
  });
});
