import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ACQUISITION_METADATA_DEFECTS,
  acquisitionAttestedContentSha256,
  acquisitionLedgerIssues,
  acquisitionRecordGeography,
  acquisitionRecordMetadataDefects,
  acquisitionRecordWarnings,
  acquisitionReviewQueue,
  acquisitionSourceReferences,
  isTgaProductInformationSearchUrl,
  LIVE_PRODUCT_INFORMATION_VERSION,
  SOURCE_ACQUISITION_RUNGS,
  sourceAcquisitionRecords,
  type SourceAcquisitionRecord,
} from "@/lib/sources/acquisition-ledger";
import { sourceAuthorityForPublisher } from "@/lib/source-authority-registry";
import { canonicalizeSourceReferences } from "@/lib/sources/catalogue-core";
import {
  classifySourceAuthority,
  sourceCatalogueDesignation,
  sourceCatalogueGeographyScope,
} from "@/lib/source-authority-registry";
import type { ClinicalSourceReferenceInput } from "@/lib/sources/catalogue-types";

const baseRecord: SourceAcquisitionRecord = {
  id: "ocp-wa-test-guideline",
  title: "Chief Psychiatrist's Guideline for further opinions",
  publisher: "Office of the Chief Psychiatrist WA",
  publisherCode: "OCP WA",
  canonicalUrl: "https://www.chiefpsychiatrist.wa.gov.au/publication/guideline-further-opinions/",
  jurisdiction: "Australia/WA",
  version: "December 2025",
  publicationDate: "2025-12-19",
  datePrecision: "day",
  reviewDate: null,
  expiryDate: null,
  evidenceType: "guideline",
  documentStatus: "current",
  validationStatus: "unverified",
  contentMode: "link_only",
  topics: ["Mental Health Act 2014"],
  rung: 2,
  capturedAt: "2026-09-06",
  capturedFor: "Test capture",
  disposition: "candidate",
  dispositionReason: "Awaiting sign-off",
  supersededBy: [],
  notes: null,
};

// A real Australian clinical publisher that is deliberately absent from the source authority
// register, so the "unrecognised publisher" path has a genuine example to exercise.
const unregisteredPublisher = "Beyond Blue";

function record(overrides: Partial<SourceAcquisitionRecord> = {}): SourceAcquisitionRecord {
  return { ...baseRecord, ...overrides };
}

function issuesFor(overrides: Partial<SourceAcquisitionRecord> = {}) {
  return acquisitionLedgerIssues([record(overrides)]);
}

describe("source acquisition ledger", () => {
  it("retains catalogue geography without granting runtime authority by publisher code", () => {
    expect(sourceCatalogueGeographyScope(baseRecord)).toBe("wa");
    expect(sourceCatalogueDesignation(baseRecord)).toBe("trusted");
    const runtime = classifySourceAuthority({
      source_kind: "document",
      publisher: baseRecord.publisher,
      publisher_code: baseRecord.publisherCode,
      jurisdiction: baseRecord.jurisdiction,
      document_status: "current",
      clinical_validation_status: "locally_reviewed",
      extraction_quality: "good",
    });
    expect(runtime.authority).toBeNull();
    expect(runtime.designation).toBe("unclassified");
    expect(runtime.tier).toBe("supplementary");
    expect(runtime.australianAugmentationEligible).toBe(false);
  });

  it.each([
    { publisherCode: "UNKNOWN" },
    { publisher: "Unrelated publisher" },
    { publisher: "World Health Organization" },
    { jurisdiction: "United Kingdom" },
  ])("rejects conflicting catalogue geography %j", (override) => {
    expect(sourceCatalogueGeographyScope({ ...baseRecord, ...override })).toBeNull();
    expect(sourceCatalogueDesignation({ ...baseRecord, ...override })).toBe("unclassified");
    const [conflicting] = canonicalizeSourceReferences(
      acquisitionSourceReferences([record({ validationStatus: "locally_reviewed", ...override })]),
    );
    expect(conflicting.rating.dimensions.reliability).toBe(8);
  });

  it("requires jurisdiction for a catalogue designation resolved only by publisher alias", () => {
    expect(sourceCatalogueDesignation({ ...baseRecord, publisherCode: null })).toBe("trusted");
    expect(sourceCatalogueDesignation({ ...baseRecord, publisherCode: null, jurisdiction: null })).toBe("unclassified");
  });

  it.each([
    { publisherCode: "CAHS", publisher: "WA Health", designation: "official", reliability: 20 },
    { publisherCode: "NMHS", publisher: "WA Health", designation: "official", reliability: 20 },
    { publisherCode: "SMHS", publisher: "WA Health", designation: "official", reliability: 20 },
    { publisherCode: "OCPWA", publisher: "WA Health", designation: "trusted", reliability: 16 },
    { publisherCode: "CAHS", publisher: "World Health Organization", designation: "unclassified", reliability: 8 },
  ])("rates compatible publisher identity for $publisherCode / $publisher", (identity) => {
    const source = record({
      publisherCode: identity.publisherCode,
      publisher: identity.publisher,
      validationStatus: "locally_reviewed",
    });
    expect(sourceCatalogueDesignation(source)).toBe(identity.designation);
    const [entry] = canonicalizeSourceReferences(acquisitionSourceReferences([source]));
    expect(entry.rating.dimensions.reliability).toBe(identity.reliability);
  });

  it("accepts the committed ledger without any outstanding issue", () => {
    expect(acquisitionLedgerIssues(sourceAcquisitionRecords)).toEqual([]);
    expect(sourceAcquisitionRecords.length).toBeGreaterThan(0);
  });

  // Scoped to sources still in play, because that is where the library applies the
  // metadata floor. Metadata that could not be established is frequently the reason
  // a source was rejected, so holding a rejection to the floor would make the
  // register unable to record the searches that found nothing citable.
  it("captures every committed source still in play with complete metadata, so none carries a metadata defect", () => {
    const inPlay = sourceAcquisitionRecords.filter((entry) => entry.disposition !== "rejected");
    expect(inPlay.length).toBeGreaterThan(0);
    for (const entry of inPlay) {
      expect(acquisitionRecordMetadataDefects(entry), `${entry.id} carries a metadata defect`).toEqual([]);
    }
  });

  // The exemption above is only safe while a rejection stays a rejection. Every
  // committed rejection must still carry the identity needed to recognise the same
  // source next time, and the reason it was not used.
  it("requires every committed rejection to record its identity and the reason it was rejected", () => {
    const rejections = sourceAcquisitionRecords.filter((entry) => entry.disposition === "rejected");
    for (const entry of rejections) {
      expect(entry.title.trim(), `${entry.id} has no title`).not.toBe("");
      expect(entry.publisher.trim(), `${entry.id} has no publisher`).not.toBe("");
      expect(entry.jurisdiction.trim(), `${entry.id} has no jurisdiction`).not.toBe("");
      expect(entry.dispositionReason?.trim(), `${entry.id} does not say why it was rejected`).toBeTruthy();
      expect(acquisitionRecordGeography(entry), `${entry.id} cannot be placed in a jurisdiction`).not.toBe("unknown");
    }
  });

  it("treats an unreviewed capture as awaiting sign-off rather than as broken metadata", () => {
    const warnings = acquisitionRecordWarnings(record());
    expect(warnings).toContain("verification_unknown");
    expect(warnings.filter((warning) => (ACQUISITION_METADATA_DEFECTS as readonly string[]).includes(warning))).toEqual(
      [],
    );
    expect(issuesFor()).toEqual([]);
  });

  it("lifts a signed-off capture out of D band using catalogue identity without granting runtime authority", () => {
    const [unreviewed] = canonicalizeSourceReferences(acquisitionSourceReferences([record()]));
    const [reviewed] = canonicalizeSourceReferences(
      acquisitionSourceReferences([record({ validationStatus: "locally_reviewed" })]),
    );

    expect(unreviewed.rating.band).toBe("D");
    expect(reviewed.rating.band).toBe("A");
    expect(reviewed.rating.dimensions.reliability).toBe(16);
    expect(reviewed.rating.dimensions.australianApplicability).toBe(15);
    expect(reviewed.rating.score).toBeGreaterThan(unreviewed.rating.score);
    expect(reviewed.geography.scope).toBe("wa");
  });
});

describe("source acquisition rungs", () => {
  it("maps every rung to the geography the catalogue derives independently", () => {
    expect(SOURCE_ACQUISITION_RUNGS.map((entry) => entry.scope)).toEqual([
      "wa",
      "wa",
      "australian_national",
      "australian_state",
      "international",
    ]);
  });

  it("rejects a source filed at a rung its publisher does not belong to", () => {
    expect(acquisitionRecordGeography(record())).toBe("wa");
    expect(issuesFor({ rung: 5 })).toEqual([
      "ocp-wa-test-guideline: filed at rung 5 (expects international) but the register places it in wa",
    ]);
  });

  it("rejects an unknown rung", () => {
    expect(issuesFor({ rung: 9 as SourceAcquisitionRecord["rung"] })).toContain(
      "ocp-wa-test-guideline: rung must be one of 1, 2, 3, 4 or 5",
    );
  });

  it("names the register as the blocker when a publisher is not recognised, and warns that fixing it moves retrieval", () => {
    // The example publisher has to be one the register genuinely does not carry, so assert that
    // here rather than trusting the constant: Therapeutic Guidelines used to sit in this slot and
    // the premise silently went false the day it was registered.
    expect(sourceAuthorityForPublisher(unregisteredPublisher)).toBeNull();
    const [issue] = issuesFor({ publisher: unregisteredPublisher, publisherCode: null, canonicalUrl: null });
    expect(issue).toContain("is not in the source authority register");
    expect(issue).toContain("can never leave D band");
    expect(issue).toContain("changes retrieval selection");
  });
});

describe("source acquisition metadata floor", () => {
  it.each([
    ["publisher", { publisher: "" }],
    ["version", { version: "" }],
    ["jurisdiction", { jurisdiction: "" }],
    ["capturedFor", { capturedFor: "" }],
  ] as const)("requires %s", (_field, overrides) => {
    expect(issuesFor(overrides).length).toBeGreaterThan(0);
  });

  it("requires an exact publication date and rejects a bare year", () => {
    expect(issuesFor({ publicationDate: "2025" })).toContain(
      'ocp-wa-test-guideline: publicationDate must be an exact YYYY-MM-DD date, got "2025"',
    );
  });

  it("requires a year-precision date to be recorded as the first of January", () => {
    expect(issuesFor({ publicationDate: "2020-06-01", datePrecision: "year" })).toContain(
      "ocp-wa-test-guideline: year-precision publicationDate must be recorded as the first of January",
    );
    expect(issuesFor({ publicationDate: "2020-01-01", datePrecision: "year" })).toEqual([]);
  });

  it("requires a month-precision date to be recorded as the first of the month", () => {
    expect(issuesFor({ publicationDate: "2025-12-19", datePrecision: "month" })).toContain(
      "ocp-wa-test-guideline: month-precision publicationDate must be recorded as the first of the month",
    );
  });

  it("refuses a URL on a host the source policy does not govern, and says how to fix it", () => {
    const [issue] = issuesFor({ canonicalUrl: "https://example.com/guideline" });
    expect(issue).toContain("example.com is not a governed source host");
    expect(issue).toContain("GOVERNED_SOURCE_HOSTS");
  });

  it("rejects a duplicate ledger id", () => {
    expect(acquisitionLedgerIssues([record(), record()])).toContain("ocp-wa-test-guideline: duplicate ledger id");
  });

  it("rejects an id that is not a slug", () => {
    expect(acquisitionLedgerIssues([record({ id: "Not A Slug" })])).toContain(
      "Not A Slug: id must be a lower-case hyphenated slug",
    );
  });
});

// Owner decision, 2026-09-26: a publisher's "last updated" stamp may be recorded for
// a continuously maintained page, but only as that — never as a publication or a
// review. The `last_updated` model is an added state beside the other two, not a
// relaxation of either.
describe("source acquisition last_updated date model", () => {
  const lastUpdated: Partial<SourceAcquisitionRecord> = {
    dateModel: "last_updated",
    version: "Last updated: 5 December 2025",
    publicationDate: null,
    reviewDate: null,
    lastUpdatedDate: "2025-12-05",
    datePrecision: "day",
  };

  it("accepts a last_updated record that carries only its update stamp", () => {
    expect(issuesFor(lastUpdated)).toEqual([]);
  });

  it("rejects a last_updated record that also claims a publication date", () => {
    expect(issuesFor({ ...lastUpdated, publicationDate: "2025-12-05" }).join(" ")).toMatch(
      /a last-updated source has no publication event/,
    );
  });

  it("rejects a last_updated record that also claims a review date", () => {
    expect(issuesFor({ ...lastUpdated, reviewDate: "2025-12-05" }).join(" ")).toMatch(
      /a last-updated source states no review/,
    );
  });

  it("rejects a last_updated record with no update stamp", () => {
    expect(issuesFor({ ...lastUpdated, lastUpdatedDate: null })).toContain(
      "ocp-wa-test-guideline: lastUpdatedDate is required",
    );
    const withoutField = record(lastUpdated);
    delete withoutField.lastUpdatedDate;
    expect(acquisitionLedgerIssues([withoutField])).toContain("ocp-wa-test-guideline: lastUpdatedDate is required");
  });

  it("requires a month-precision update stamp to be recorded as the first of the month", () => {
    expect(issuesFor({ ...lastUpdated, lastUpdatedDate: "2024-12-19", datePrecision: "month" })).toContain(
      "ocp-wa-test-guideline: month-precision lastUpdatedDate must be recorded as the first of the month",
    );
    expect(issuesFor({ ...lastUpdated, lastUpdatedDate: "2024-12-01", datePrecision: "month" })).toEqual([]);
  });

  it("requires a year-precision update stamp to be recorded as the first of January", () => {
    expect(issuesFor({ ...lastUpdated, lastUpdatedDate: "2024-06-01", datePrecision: "year" })).toContain(
      "ocp-wa-test-guideline: year-precision lastUpdatedDate must be recorded as the first of January",
    );
    expect(issuesFor({ ...lastUpdated, lastUpdatedDate: "2024-01-01", datePrecision: "year" })).toEqual([]);
  });

  it("requires the update stamp to be an exact date, not the publisher's prose", () => {
    expect(issuesFor({ ...lastUpdated, lastUpdatedDate: "December 2024" })).toContain(
      'ocp-wa-test-guideline: lastUpdatedDate must be an exact YYYY-MM-DD date, got "December 2024"',
    );
  });

  it("refuses an update stamp on a record that is not last_updated", () => {
    // A published or continuously updated record carrying the stamp would render a
    // "last updated" date under a model that says the publisher gave something else.
    expect(issuesFor({ lastUpdatedDate: "2025-12-05" }).join(" ")).toMatch(
      /lastUpdatedDate is recorded only under dateModel "last_updated"/,
    );
    expect(
      issuesFor({
        dateModel: "continuously_updated",
        publicationDate: null,
        reviewDate: "2025-12-05",
        lastUpdatedDate: "2025-12-05",
      }).join(" "),
    ).toMatch(/lastUpdatedDate is recorded only under dateModel "last_updated"/);
  });

  it("leaves the published and continuously updated rules unchanged", () => {
    expect(issuesFor({ publicationDate: null }).join(" ")).toMatch(/publicationDate is required/);
    expect(issuesFor({ dateModel: "continuously_updated", publicationDate: null, reviewDate: null }).join(" ")).toMatch(
      /reviewDate is required/,
    );
  });

  it("carries the stamp into the catalogue as its own date, so it is neither published nor reviewed", () => {
    const captured = record(lastUpdated);
    expect(acquisitionRecordWarnings(captured)).not.toContain("missing_dates");
    const [reference] = acquisitionSourceReferences([captured]);
    expect(reference.lastUpdatedDate).toBe("2025-12-05");
    const [entry] = canonicalizeSourceReferences([reference]);
    expect(entry.lastUpdatedDate).toBe("2025-12-05");
    expect(entry.publicationDate).toBeNull();
    expect(entry.reviewDate).toBeNull();
  });

  it("adds no lastUpdatedDate to a record or catalogue entry that has none", () => {
    const [reference] = acquisitionSourceReferences([record()]);
    expect("lastUpdatedDate" in reference).toBe(false);
    const [entry] = canonicalizeSourceReferences([reference]);
    expect("lastUpdatedDate" in entry).toBe(false);
  });
});

describe("source acquisition dispositions", () => {
  it("refuses to let unreviewed evidence be adopted into clinical content", () => {
    expect(issuesFor({ disposition: "adopted" })).toContain(
      "ocp-wa-test-guideline: an adopted source must be reviewed before clinical content cites it",
    );
    expect(issuesFor({ disposition: "adopted", validationStatus: "locally_reviewed" })).toEqual([]);
  });

  it("requires a reason for anything not adopted, so a rejection is recoverable later", () => {
    expect(issuesFor({ disposition: "rejected", dispositionReason: null })).toContain(
      "ocp-wa-test-guideline: a rejected source must record why",
    );
    expect(issuesFor({ disposition: "candidate", dispositionReason: "  " })).toContain(
      "ocp-wa-test-guideline: a candidate source must record why",
    );
  });

  it("keeps a rejected source in the register as excluded, and exempts it from the metadata floor", () => {
    const rejected = record({
      disposition: "rejected",
      dispositionReason: "Superseded by the 2020 Australian guideline",
      version: "",
    });
    expect(acquisitionLedgerIssues([rejected])).toEqual([]);

    const [entry] = canonicalizeSourceReferences(acquisitionSourceReferences([rejected]));
    expect(entry.lifecycleStatus).toBe("excluded");
    expect(entry.rating.band).toBe("excluded");
  });
});

describe("source acquisition catalogue integration", () => {
  it("merges a capture with the content that cites the same source, so one entry lists both usages", () => {
    const contentReference: ClinicalSourceReferenceInput = {
      ...acquisitionSourceReferences([record({ validationStatus: "locally_reviewed" })])[0],
      usage: {
        modeId: "factsheets",
        recordId: "further-opinions",
        recordLabel: "Requesting a further opinion",
        field: "sources",
      },
    };

    const entries = canonicalizeSourceReferences([
      ...acquisitionSourceReferences([record({ validationStatus: "locally_reviewed" })]),
      contentReference,
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].usedBy.map((usage) => `${usage.modeId}:${usage.field}`).sort()).toEqual([
      "factsheets:sources",
      "sources:acquisition_ledger",
    ]);
  });

  it("files every capture under the sources mode so the register is traceable", () => {
    for (const reference of acquisitionSourceReferences()) {
      expect(reference.usage.modeId).toBe("sources");
      expect(reference.usage.field).toBe("acquisition_ledger");
      expect(reference.usage.recordId).toBeTruthy();
      expect(reference.sourceId).toBeNull();
    }
  });

  it("queues unreviewed captures for sign-off, most local first", () => {
    const queue = acquisitionReviewQueue([
      record({
        id: "national",
        rung: 3,
        publisher: "Royal Australian and New Zealand College of Psychiatrists",
        publisherCode: "RANZCP",
        jurisdiction: "Australia",
      }),
      record({ id: "local" }),
      record({ id: "already-reviewed", validationStatus: "locally_reviewed" }),
    ]);

    expect(queue.map((entry) => entry.id)).toEqual(["local", "national"]);
  });
});

/**
 * Structured attestation (#4DFNHJ). Before this, who signed a record off and when
 * lived only in prose in `dispositionReason` and `notes`, so the 2026-09-16
 * metadata corrections invalidated six earlier owner sign-offs with nothing in the
 * gate able to notice. The digest is the Therapy catalogue's proven
 * `therapyReviewedContentSha256` pattern applied to the source ledger.
 */
describe("source acquisition attestation", () => {
  function attested(overrides: Partial<SourceAcquisitionRecord> = {}) {
    const signed = record({
      validationStatus: "locally_reviewed",
      attestedBy: "Owner",
      attestedAt: "2026-09-18",
      ...overrides,
    });
    return { ...signed, attestedAgainstSha256: acquisitionAttestedContentSha256(signed) };
  }

  it("leaves a record with no attestation alone, and every attestation on disk is complete and current", () => {
    expect(issuesFor()).toEqual([]);
    // Owner sign-offs arrive through npm run clinical:review -- --kind source; each must carry
    // all three fields, and acquisitionLedgerIssues (run over the real ledger elsewhere) keeps
    // every one current.
    for (const entry of sourceAcquisitionRecords.filter((record) => record.attestedAgainstSha256 !== undefined)) {
      expect(entry.attestedBy?.trim()).toBeTruthy();
      expect(entry.attestedAt).toBeTruthy();
      expect(entry.attestedAgainstSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(acquisitionAttestedContentSha256(entry)).toBe(entry.attestedAgainstSha256);
    }
  });

  it("accepts an attestation written against the record as it stands", () => {
    expect(acquisitionLedgerIssues([attested()])).toEqual([]);
  });

  it("reports an attestation as stale once the metadata it covers changes", () => {
    const signed = attested();
    const corrected = { ...signed, version: "December 2025 revision" };
    expect(acquisitionLedgerIssues([corrected])).toEqual([
      "ocp-wa-test-guideline: attestedAgainstSha256 is stale; content changed after sign-off",
    ]);
  });

  it("does not treat writing the digest itself as a change to the record", () => {
    const signed = attested();
    expect(acquisitionAttestedContentSha256(signed)).toBe(signed.attestedAgainstSha256);
    expect(acquisitionAttestedContentSha256({ ...signed, attestedBy: "Someone else" })).toBe(
      signed.attestedAgainstSha256,
    );
  });

  it("requires an attestation to name who signed off and when", () => {
    const signed = attested();
    expect(acquisitionLedgerIssues([{ ...signed, attestedBy: null }])).toEqual([
      "ocp-wa-test-guideline: an attestation must record attestedBy, attestedAt and attestedAgainstSha256; missing attestedBy",
    ]);
  });

  it.each([
    ["attestedBy", null],
    ["attestedAt", ""],
    ["attestedAgainstSha256", "  "],
  ])("reports an attestation field %s that is present but empty, with no sign-off recorded", (field, value) => {
    expect(issuesFor({ [field]: value })).toEqual([
      `ocp-wa-test-guideline: ${field} present but empty; remove the field, or record a complete attestation with clinical:review`,
    ]);
  });

  it("rejects a malformed digest rather than calling it stale", () => {
    expect(issuesFor({ attestedBy: "Owner", attestedAt: "2026-09-18", attestedAgainstSha256: "not-a-digest" })).toEqual(
      ["ocp-wa-test-guideline: attestedAgainstSha256 must be a lower-case 64-character SHA-256 digest"],
    );
  });

  it("holds attestedAt to the same exact-date rule as every other ledger date", () => {
    expect(issuesFor({ attestedBy: "Owner", attestedAt: "September 2026", attestedAgainstSha256: null })).toContain(
      'ocp-wa-test-guideline: attestedAt must be an exact YYYY-MM-DD date, got "September 2026"',
    );
  });
});

// Owner decision, 2026-10-22: the TGA Product Information search is signed once per
// medicine with no fixed version. The model is confined to that one URL shape and
// carries no date at all, so it never records a date nobody read.
describe("source acquisition live_product_information date model", () => {
  const PI_SEARCH = "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?OpenForm&q=sodium%20valproate&t=pi";
  const live: Partial<SourceAcquisitionRecord> = {
    id: "tga-product-information-test",
    title: "Australian Product Information: sodium valproate",
    publisher: "Therapeutic Goods Administration",
    publisherCode: "TGA",
    canonicalUrl: PI_SEARCH,
    jurisdiction: "Australia",
    dateModel: "live_product_information",
    version: LIVE_PRODUCT_INFORMATION_VERSION,
    publicationDate: null,
    evidenceType: "regulatory",
    rung: 3,
  };
  const liveIssues = (overrides: Partial<SourceAcquisitionRecord> = {}) =>
    issuesFor({ ...live, ...overrides }).join(" ");

  it("accepts a TGA PI search with no date as a candidate", () => {
    expect(issuesFor(live)).toEqual([]);
  });

  it("refuses the model on any other publisher or URL", () => {
    expect(liveIssues({ publisherCode: "WAHEALTH" })).toMatch(/only for the TGA Product Information search/);
    expect(
      liveIssues({ canonicalUrl: "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?OpenForm&q=&t=pi" }),
    ).toMatch(/only for the TGA Product Information search/);
    expect(
      liveIssues({ canonicalUrl: "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?OpenForm&q=x&t=cmi" }),
    ).toMatch(/only for the TGA Product Information search/);
  });

  it("refuses any recorded date and any other version text", () => {
    expect(liveIssues({ publicationDate: "2026-01-01" })).toMatch(/has no publication, review, update or expiry date/);
    expect(liveIssues({ reviewDate: "2026-01-01" })).toMatch(/has no publication, review, update or expiry date/);
    expect(liveIssues({ expiryDate: "2027-01-01" })).toMatch(/has no publication, review, update or expiry date/);
    expect(liveIssues({ version: "unknown" })).toMatch(/records version/);
  });

  it("still requires a publication date of an ordinary TGA record", () => {
    expect(issuesFor({ ...live, dateModel: undefined })).toContain(
      "tga-product-information-test: publicationDate is required",
    );
  });

  it("recognises only the PI search URL", () => {
    expect(isTgaProductInformationSearchUrl(PI_SEARCH)).toBe(true);
    expect(
      isTgaProductInformationSearchUrl("http://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?q=x&t=pi"),
    ).toBe(false);
    expect(isTgaProductInformationSearchUrl("https://www.tga.gov.au/?q=x&t=pi")).toBe(false);
    expect(isTgaProductInformationSearchUrl(null)).toBe(false);
  });
});
