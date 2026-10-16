import { describe, expect, it } from "vitest";

import { loadMedicationSnapshot } from "@/lib/medication-snapshot";
import {
  medicationSourceLinkIds,
  medicationSourceLinkReferences,
  medicationSourceLinks,
} from "@/lib/medication-source-links";
import {
  acquisitionAttestedContentSha256,
  acquisitionSourceReferences,
  sourceAcquisitionRecords,
  type SourceAcquisitionRecord,
} from "@/lib/sources/acquisition-ledger";
import { canonicalizeSourceReferences } from "@/lib/sources/catalogue-core";

const TGA_CLOZAPINE_SEARCH = "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?OpenForm&q=clozapine&t=pi";

function candidate(overrides: Partial<SourceAcquisitionRecord> = {}): SourceAcquisitionRecord {
  return {
    id: "fixture-clozapine-pi",
    title: "Australian Product Information: clozapine",
    publisher: "Therapeutic Goods Administration",
    publisherCode: "TGA",
    canonicalUrl: TGA_CLOZAPINE_SEARCH,
    jurisdiction: "Australia",
    version: "fixture version",
    publicationDate: "2026-01-01",
    datePrecision: "day",
    reviewDate: null,
    expiryDate: null,
    evidenceType: "regulatory",
    documentStatus: "current",
    validationStatus: "unverified",
    contentMode: "link_only",
    topics: ["Clozapine"],
    rung: 3,
    capturedAt: "2026-10-03",
    capturedFor: "fixture",
    disposition: "candidate",
    dispositionReason: "fixture",
    supersededBy: [],
    notes: null,
    ...overrides,
  };
}

/** Signs a fixture the way `npm run clinical:review -- --kind source` does: digest of the record as it stands. */
function signed(record: SourceAcquisitionRecord): SourceAcquisitionRecord {
  const reviewed = { ...record, validationStatus: "locally_reviewed" as const };
  return {
    ...reviewed,
    attestedBy: "Dr Alex Morgan",
    attestedAt: "2026-10-03T00:00:00.000Z",
    attestedAgainstSha256: acquisitionAttestedContentSha256(reviewed),
  };
}

/** Signed as adopted: the owner's adoption decision plus a matching attestation. */
function adoptedSigned(overrides: Partial<SourceAcquisitionRecord> = {}): SourceAcquisitionRecord {
  return signed(candidate({ disposition: "adopted", dispositionReason: null, ...overrides }));
}

const links = { clozapine: ["fixture-clozapine-pi"] };

const HIGH_RISK_MEDICATION_SLUGS = [
  "clozapine",
  "lithium-carbonate-ir-sr",
  "sodium-valproate-oral-iv",
  "carbamazepine",
  "lamotrigine",
  "aripiprazole-lai",
  "flupentixol-decanoate",
  "haloperidol-decanoate",
  "olanzapine-pamoate-lai",
  "paliperidone-lai",
  "risperidone-lai",
  "zuclopenthixol-decanoate",
  "zuclopenthixol-acetate",
  "methadone",
  "citalopram",
  "escitalopram",
  "amisulpride",
  "ziprasidone",
  "ziprasidone-im",
  "droperidol",
  "chlorpromazine",
  "amitriptyline",
  "clomipramine",
  "nortriptyline",
  "phenelzine",
  "tranylcypromine",
] as const;

describe("medication source links", () => {
  it("maps only real medication slugs (including all 26 high-risk slugs) to real register records", () => {
    const slugs = new Set(loadMedicationSnapshot().map((record) => record.slug));
    const ids = new Set(sourceAcquisitionRecords.map((record) => record.id));
    for (const [slug, recordIds] of Object.entries(medicationSourceLinkIds)) {
      expect(slugs.has(slug), `unknown medication slug ${slug}`).toBe(true);
      expect(recordIds.length, `empty source links for ${slug}`).toBeGreaterThan(0);
      for (const id of recordIds) expect(ids.has(id), `unknown register record ${id}`).toBe(true);
    }
    for (const slug of HIGH_RISK_MEDICATION_SLUGS) {
      expect(
        (medicationSourceLinkIds as Record<string, readonly string[]>)[slug]?.length,
        `missing high-risk medication slug ${slug}`,
      ).toBeGreaterThan(0);
    }
  });

  it("returns the confirmed source links on the live pages now that the owner has signed the adopted records", () => {
    expect(medicationSourceLinks("clozapine").map((link) => link.id)).toEqual(["wa-health-clozapine-guideline-2024"]);
    expect(medicationSourceLinks("lithium-carbonate-ir-sr").map((link) => link.id)).toEqual([
      "australian-prescriber-lithium-therapy-and-its-interactions",
      "australian-prescriber-lithium-therapy-interactions-correction",
    ]);
  });

  it("hides an unconfirmed record", () => {
    expect(medicationSourceLinks("clozapine", { links, records: [candidate()] })).toEqual([]);
  });

  it("hides a record attested by a single-word product stamp while accepting the owner's two-word display name", () => {
    expect(medicationSourceLinks("clozapine", { links, records: [adoptedSigned()] })).not.toEqual([]);
    const displayName = { ...adoptedSigned(), attestedBy: "Psych Sift" };
    expect(medicationSourceLinks("clozapine", { links, records: [displayName] })).not.toEqual([]);
    const productName = { ...adoptedSigned(), attestedBy: "PsychSift" };
    expect(medicationSourceLinks("clozapine", { links, records: [productName] })).toEqual([]);
  });

  it("hides a reviewed record that carries no attestation", () => {
    const reviewedOnly = candidate({ validationStatus: "locally_reviewed" });
    expect(medicationSourceLinks("clozapine", { links, records: [reviewedOnly] })).toEqual([]);
  });

  it("hides a record whose attestation is stale because content changed after sign-off", () => {
    const stale = { ...signed(candidate()), version: "corrected after sign-off" };
    expect(medicationSourceLinks("clozapine", { links, records: [stale] })).toEqual([]);
  });

  it("hides a rejected record even when it carries a matching attestation", () => {
    const rejected = signed(candidate({ disposition: "rejected" }));
    expect(medicationSourceLinks("clozapine", { links, records: [rejected] })).toEqual([]);
  });

  it("hides a signed record that is still a candidate rather than adopted", () => {
    expect(medicationSourceLinks("clozapine", { links, records: [signed(candidate())] })).toEqual([]);
  });

  it.each([
    ["review_due", { documentStatus: "review_due" as const }],
    ["outdated", { documentStatus: "outdated" as const }],
    ["past its expiry date", { expiryDate: "2026-01-31" }],
    [
      "superseded",
      { supersededBy: ["https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?OpenForm&q=x&t=pi"] },
    ],
  ])("hides an adopted, signed record that is %s", (_label, overrides) => {
    expect(medicationSourceLinks("clozapine", { links, records: [adoptedSigned(overrides)] })).toEqual([]);
  });

  it("hides a confirmed record whose URL is not governed", () => {
    const ungoverned = adoptedSigned({ canonicalUrl: "https://unreviewed-source.example/pi" });
    expect(medicationSourceLinks("clozapine", { links, records: [ungoverned] })).toEqual([]);
  });

  it("returns an adopted, signed, current record as a link", () => {
    expect(medicationSourceLinks("clozapine", { links, records: [adoptedSigned()] })).toEqual([
      {
        id: "fixture-clozapine-pi",
        title: "Australian Product Information: clozapine",
        publisher: "Therapeutic Goods Administration",
        href: TGA_CLOZAPINE_SEARCH,
      },
    ]);
    expect(medicationSourceLinks("lithium-carbonate-ir-sr", { links, records: [adoptedSigned()] })).toEqual([]);
  });

  it("records the medication page as a usage of the linked source in the catalogue", () => {
    const records = [adoptedSigned()];
    const medications = [
      { slug: "clozapine", name: "Clozapine" },
      { slug: "lithium-carbonate-ir-sr", name: "Lithium" },
    ];
    const [entry, ...rest] = canonicalizeSourceReferences([
      ...acquisitionSourceReferences(records),
      ...medicationSourceLinkReferences(medications, { links, records }),
    ]);
    expect(rest).toEqual([]);
    expect(entry.usedBy).toEqual(
      expect.arrayContaining([
        {
          modeId: "sources",
          recordId: "fixture-clozapine-pi",
          recordLabel: records[0].title,
          field: "acquisition_ledger",
        },
        { modeId: "prescribing", recordId: "clozapine", recordLabel: "Clozapine", field: "sourceLinks" },
      ]),
    );
    expect(entry.usedBy).toHaveLength(2);
  });

  it("records no medication usage for a link the page does not show", () => {
    const medications = [{ slug: "clozapine", name: "Clozapine" }];
    expect(medicationSourceLinkReferences(medications, { links, records: [signed(candidate())] })).toEqual([]);
  });
});
