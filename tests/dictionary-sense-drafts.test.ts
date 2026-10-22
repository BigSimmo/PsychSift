import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  dictionaryDefinitionReviewIssues,
  dictionaryDefinitionReviews,
  reconcileDefinitionReviews,
} from "@/lib/dictionary-editorial/definition-reviews";
import {
  assertNoDraftIsPublished,
  dictionarySenseBrowseBucket,
  dictionarySenseCollisionGroups,
  dictionarySenseCollisions,
  dictionarySenseDraft,
  dictionarySenseDraftIssues,
  dictionarySenseDrafts,
  normalizeSenseToken,
  type DictionarySenseDraft,
} from "@/lib/dictionary-editorial/sense-drafts";
import {
  dictionarySourceDispositionIssues,
  dictionarySourceDispositions,
  heldDictionarySources,
  SOURCE_RECEIPT_STAGES,
} from "@/lib/dictionary-editorial/source-dispositions";
import { dictionaryEntries, dictionarySource, dictionarySources } from "@/lib/dictionary-data";
import {
  acquisitionLedgerIssues,
  acquisitionSourceReferences,
  acquisitionRecordGeography,
  SOURCE_ACQUISITION_RUNGS,
  acquisitionRecordWarnings,
  sourceAcquisitionRecords,
} from "@/lib/sources/acquisition-ledger";
import { sourceAuthorityIsRuntimeClassifiable, sourceAuthorityRegistry } from "@/lib/source-authority-registry";
import { sourceUsageHref } from "@/lib/sources/source-usage-presentation";
import { canonicalizeSourceReferences } from "@/lib/sources/catalogue-core";
import { repositorySourceReferences } from "@/lib/sources/repository-providers";

describe("dictionary sense drafts", () => {
  it("carries the whole handover corpus", () => {
    expect(dictionarySenseDrafts).toHaveLength(333);
    expect(dictionaryDefinitionReviews).toHaveLength(96);
    expect(dictionarySourceDispositions).toHaveLength(58);
  });

  it("is structurally sound", () => {
    expect(dictionarySenseDraftIssues()).toEqual([]);
  });

  it("keeps every sense id unique and resolvable", () => {
    const ids = new Set(dictionarySenseDrafts.map((draft) => draft.id));
    expect(ids.size).toBe(dictionarySenseDrafts.length);
    for (const draft of dictionarySenseDrafts) {
      expect(dictionarySenseDraft(draft.id)).toBe(draft);
    }
    expect(dictionarySenseDraft("dict-sense-9999")).toBeNull();
  });

  it("preserves the upstream content hash of every record", () => {
    // Not a clinical check: it proves nobody has hand-edited a draft in place,
    // which would break the link back to the reviewed source block.
    for (const draft of dictionarySenseDrafts) {
      expect(draft.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(draft.provenance.rawBlockSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("the publication gate", () => {
  it("holds every draft as unapproved and unpublished", () => {
    expect(() => assertNoDraftIsPublished()).not.toThrow();
    for (const draft of dictionarySenseDrafts) {
      expect(draft.publicationAllowed).toBe(false);
      expect(draft.clinicalApproval.status).toBe("pending");
      expect(draft.clinicalApproval.reviewer).toBeNull();
    }
  });

  it("refuses a draft that has been marked published", () => {
    const leaked = { ...dictionarySenseDrafts[0], publicationAllowed: true } as unknown as DictionarySenseDraft;
    expect(() => assertNoDraftIsPublished([leaked])).toThrow(/must not be published/);
  });

  it("refuses a draft that has been marked approved", () => {
    const approved = {
      ...dictionarySenseDrafts[0],
      clinicalApproval: { status: "approved", reviewer: "someone", reviewedOn: "2026-09-16" },
    } as unknown as DictionarySenseDraft;
    expect(() => assertNoDraftIsPublished([approved])).toThrow(/must not be published/);
  });

  it("keeps drafts out of the published dictionary entirely", () => {
    // The published dictionary is term-first and clinically reviewed. A sense id
    // appearing there would mean a draft had been promoted without sign-off.
    const publishedSlugs = new Set(dictionaryEntries.map((entry) => entry.slug));
    for (const draft of dictionarySenseDrafts) {
      expect(publishedSlugs.has(draft.id)).toBe(false);
    }
  });
});

describe("global ambiguity", () => {
  it("groups every token that carries more than one meaning", () => {
    expect(dictionarySenseCollisionGroups.length).toBeGreaterThanOrEqual(9);
    for (const group of dictionarySenseCollisionGroups) {
      expect(group.senseIds.length).toBeGreaterThan(1);
    }
  });

  it("warns about BD regardless of the category a reader has filtered to", () => {
    // The medicines-notation reader sees only "twice a day". The rule is that the
    // bipolar-disorder meaning must still reach them, because the note they are
    // reading was not written under their filter.
    const medicinesOnly = dictionarySenseDrafts.filter(
      (draft) => draft.category === "Medicines notation and high-risk collisions",
    );
    expect(medicinesOnly.some((draft) => draft.normalizedToken === "bd")).toBe(true);
    expect(medicinesOnly.filter((draft) => draft.normalizedToken === "bd")).toHaveLength(1);

    const meanings = dictionarySenseCollisions("BD");
    expect(meanings.length).toBeGreaterThan(1);
    expect(meanings.map((draft) => draft.expansion)).toContain("twice a day");
    expect(meanings.some((draft) => /bipolar/i.test(draft.expansion))).toBe(true);
  });

  it("resolves collisions case-insensitively without flattening punctuation", () => {
    expect(dictionarySenseCollisions("bd").map((draft) => draft.id)).toEqual(
      dictionarySenseCollisions("BD").map((draft) => draft.id),
    );
    expect(dictionarySenseCollisions("  Bd  ")).toHaveLength(dictionarySenseCollisions("BD").length);
  });

  it("keeps K10 and K10+ apart rather than calling them an ambiguity", () => {
    // The trailing "+" is the whole difference between the Kessler 10 and the
    // Kessler 10 plus supplementary questions. Stripping it would invent a
    // collision between two instruments that are not in fact the same token.
    expect(normalizeSenseToken("K10")).not.toBe(normalizeSenseToken("K10+"));
    expect(dictionarySenseCollisions("K10")).toEqual([]);
    expect(normalizeSenseToken("ACE-III")).toBe("ace-iii");
  });

  it("returns nothing for an unambiguous token", () => {
    expect(dictionarySenseCollisions("this-token-does-not-exist")).toEqual([]);
  });

  it("keeps the ambiguity warning attached to the meaning it qualifies", () => {
    for (const group of dictionarySenseCollisionGroups) {
      for (const draft of dictionarySenseCollisions(group.tokenKey)) {
        expect(draft.context.trim()).not.toBe("");
      }
    }
  });
});

describe("token handling", () => {
  it("keeps a numeric-leading token reachable", () => {
    const fourAt = dictionarySenseDrafts.find((draft) => draft.normalizedToken === "4at");
    expect(fourAt).toBeDefined();
    expect(fourAt?.token).toBe("4AT");
    // Filed under "#", not dropped and not given a digit bucket of its own.
    expect(dictionarySenseBrowseBucket(fourAt!)).toBe("#");
    expect(normalizeSenseToken("4AT")).toBe("4at");
  });

  it("files letter-leading tokens under their own letter", () => {
    const buckets = new Set(dictionarySenseDrafts.map(dictionarySenseBrowseBucket));
    expect(buckets.has("B")).toBe(true);
    // Every bucket is a single letter or the numeric bucket — never a stray digit.
    for (const bucket of buckets) {
      expect(bucket === "#" || /^[A-Z]$/.test(bucket)).toBe(true);
    }
  });

  it("preserves meaningful case and punctuation in the displayed token", () => {
    const withPunctuation = dictionarySenseDrafts.filter((draft) => /[^\p{L}\p{N}]/u.test(draft.token));
    for (const draft of withPunctuation) {
      expect(draft.token).not.toBe(draft.normalizedToken);
      expect(normalizeSenseToken(draft.token)).toBe(draft.normalizedToken);
    }
  });
});

describe("definition reviews", () => {
  it("is structurally sound", () => {
    expect(dictionaryDefinitionReviewIssues()).toEqual([]);
  });

  it("reconciles every review against the live dictionary without applying it", () => {
    const outcomes = reconcileDefinitionReviews();
    expect(outcomes).toHaveLength(96);
    expect(outcomes.filter((outcome) => outcome.outcome === "missing_entry")).toEqual([]);
    expect(outcomes.filter((outcome) => outcome.outcome === "conflict")).toEqual([]);
    expect(outcomes.filter((outcome) => outcome.outcome === "actionable")).toHaveLength(28);
  });

  it("flags a review whose baseline no longer matches as a conflict", () => {
    const [review] = dictionaryDefinitionReviews;
    const drifted = dictionaryEntries.map((entry) =>
      entry.slug === review.entrySlug ? { ...entry, definition: "Someone has since improved this wording." } : entry,
    );
    const [outcome] = reconcileDefinitionReviews([review], drifted);
    expect(outcome.outcome).toBe("conflict");
    expect(outcome.reason).toMatch(/do not restore/i);
  });

  it("reports a missing entry separately from a conflict", () => {
    const [review] = dictionaryDefinitionReviews;
    const [outcome] = reconcileDefinitionReviews([review], []);
    expect(outcome.outcome).toBe("missing_entry");
  });

  it("never marks a review as automatically applicable", () => {
    for (const review of dictionaryDefinitionReviews) {
      expect(review.applyAutomatically).toBe(false);
      expect(review.reviewer).toBeNull();
      expect(review.publicationAllowed).toBe(false);
    }
  });

  it("leaves the published definitions untouched", () => {
    // The 28 actionable proposals are ready for sign-off, not applied. If one had
    // been applied, its live wording would no longer hash to the recorded baseline.
    for (const review of dictionaryDefinitionReviews) {
      const entry = dictionaryEntries.find((candidate) => candidate.slug === review.entrySlug);
      expect(entry).toBeDefined();
      expect(createHash("sha256").update(entry!.definition, "utf8").digest("hex")).toBe(review.baselineWordingSha256);
    }
  });
});

describe("source dispositions", () => {
  it("is structurally sound", () => {
    expect(dictionarySourceDispositionIssues()).toEqual([]);
  });

  it("gives every handover source an outcome", () => {
    expect(dictionarySourceDispositions).toHaveLength(58);
    const admitted = dictionarySourceDispositions.filter(
      (disposition) => disposition.ledgerOutcome === "admitted_as_candidate",
    );
    expect(admitted).toHaveLength(26);
    expect(heldDictionarySources()).toHaveLength(32);
  });

  it("names a blocker and a next action for every held source", () => {
    for (const disposition of heldDictionarySources()) {
      expect(disposition.blockers.length).toBeGreaterThan(0);
      expect(disposition.decisionOwner.trim()).not.toBe("");
      for (const blocker of disposition.blockers) {
        expect(blocker.nextAction.trim()).not.toBe("");
      }
    }
  });

  it("retains admitted sources as link-only candidates after metadata review", () => {
    const admitted = dictionarySourceDispositions.filter(
      (disposition) => disposition.ledgerOutcome === "admitted_as_candidate",
    );
    for (const disposition of admitted) {
      const record = sourceAcquisitionRecords.find((row) => row.id === disposition.ledgerRecordId);
      expect(record).toBeDefined();
      expect(record?.disposition).toBe("candidate");
      // Metadata only: a candidate has not been adopted and has no full text.
      expect(record?.contentMode).toBe("link_only");
      expect(record?.validationStatus).not.toBe("approved");
      expect(acquisitionLedgerIssues([record!])).toEqual([]);
    }
  });

  it("records a month-precision RANZCP date as the first of the month", () => {
    // RANZCP states a last-updated month and no publication day. Month precision
    // says that plainly; day precision would assert a day the College never gave.
    const ect = sourceAcquisitionRecords.find((row) => row.id === "dictionary-ranzcp-ect-ps74");
    expect(ect?.datePrecision).toBe("month");
    expect(ect?.publicationDate).toBe("2019-10-01");
    expect(ect?.version).toBe("PS #74");
  });

  it("records a year-precision publication date as the first of January", () => {
    // WHO gives 2010 for the ASSIST manual and no day. Recording 2010-01-01 at day
    // precision would assert a publication day the publisher never stated.
    const assist = sourceAcquisitionRecords.find((row) => row.id === "dictionary-who-assist-2010");
    expect(assist?.datePrecision).toBe("year");
    expect(assist?.publicationDate).toBe("2010-01-01");
  });

  it("claims nothing past catalogued for any source", () => {
    const beyondCatalogue = SOURCE_RECEIPT_STAGES.slice(2);
    for (const disposition of dictionarySourceDispositions) {
      for (const stage of beyondCatalogue) {
        expect(disposition.stages[stage]).not.toBe("verified");
      }
      expect(disposition.originalBytesSha256).toBeNull();
      expect(disposition.documentId).toBeNull();
      expect(disposition.jobId).toBeNull();
    }
  });

  it("preserves an existing dictionary source identity rather than rewriting it", () => {
    // The one catalogue-identity conflict resolved on the facts rather than by
    // minting a second id: the register row carries the guideline, the dictionary
    // keeps its chapter citation, and `nice-delirium` still means one work.
    const conflict = dictionarySourceDispositions.find(
      (disposition) => disposition.catalogueIdentityOutcome === "conflict",
    );
    expect(conflict?.handoverSourceId).toBe("nice-delirium");
    expect(conflict?.existingDictionarySourceId).toBe("nice-delirium");
    expect(dictionarySources.filter((source) => source.id === "nice-delirium")).toHaveLength(1);
    expect(dictionarySource("nice-delirium")?.url).toContain("/chapter/context");
  });
});

describe("source link routing", () => {
  it("would send a sense id to a page that does not exist", () => {
    // Documents the trap rather than working around it: the dictionary prefix turns
    // a record id straight into `/dictionary/<id>`, which only resolves for term
    // slugs. This is why no draft emits a source usage — see the next test.
    const href = sourceUsageHref({
      modeId: "dictionary",
      recordId: "dict-sense-0045",
      recordLabel: "BD",
      field: "definition",
    });
    expect(href).toBe("/dictionary/dict-sense-0045");
    expect(dictionaryEntries.some((entry) => entry.slug === "dict-sense-0045")).toBe(false);
  });

  it("emits no source usage for any draft", () => {
    // Asserted against the real provider output, not against ids in two different
    // namespaces: an earlier version of this compared draft ids with ledger ids,
    // which can never collide and so could never have failed. What matters is that
    // no provider emits a dictionary usage carrying a sense id, because a citation
    // pointing at an unreachable page is a broken link and an implied endorsement
    // at the same time.
    const senseIds = new Set(dictionarySenseDrafts.map((draft) => draft.id));
    const usages = repositorySourceReferences().map((reference) => reference.usage);
    expect(usages.length).toBeGreaterThan(0);
    for (const usage of usages) {
      expect(senseIds.has(usage.recordId), `${usage.modeId}/${usage.recordId}`).toBe(false);
    }
    // And the same through the canonicalised catalogue the /sources routes render.
    for (const entry of canonicalizeSourceReferences(repositorySourceReferences())) {
      for (const usage of entry.usedBy) {
        expect(senseIds.has(usage.recordId), `${entry.id} -> ${usage.recordId}`).toBe(false);
      }
    }
  });
});

describe("publisher re-reads", () => {
  it("records a dated finding for every source read in this session", () => {
    const read = dictionarySourceDispositions.filter((disposition) => disposition.publisherCheck.checkedOn);
    expect(read.length).toBeGreaterThanOrEqual(35);
    for (const disposition of read) {
      expect(disposition.publisherCheck.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(disposition.publisherCheck.finding.trim()).not.toBe("");
    }
  });

  it("tells 'nobody looked' apart from 'the publisher states no date'", () => {
    // These are different facts and lead to different next actions. A source whose
    // publisher genuinely publishes no date cannot be fixed by looking harder.
    const unread = dictionarySourceDispositions.filter((disposition) => !disposition.publisherCheck.checkedOn);
    for (const disposition of unread) {
      expect(disposition.publisherCheck.finding).toMatch(/not (re-read|attempted)/i);
    }
  });

  it("keeps every source read in this session out of the unsourced-date bucket", () => {
    for (const disposition of dictionarySourceDispositions) {
      if (!disposition.publisherCheck.checkedOn) continue;
      const stale = disposition.blockers.some(
        (blocker) => blocker.code === "publication_event_not_freshly_established_do_not_substitute_other_date",
      );
      expect(stale).toBe(false);
    }
  });

  it("records a continuously updated page by its review date, never as a publication", () => {
    // Healthdirect maintains its articles rather than issuing them and stamps
    // `Last reviewed: <Month Year>`. Before the `continuously_updated` date model
    // the register could not hold them at all, because it demanded a publication
    // date the publisher does not give.
    const continuous = sourceAcquisitionRecords.filter((record) => record.dateModel === "continuously_updated");
    expect(continuous.length).toBeGreaterThanOrEqual(8);
    for (const record of continuous) {
      expect(record.publicationDate).toBeNull();
      expect(record.reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The owner adopted ScriptCheckWA, which the medication pages link to, on 22 Oct 2026.
      expect(["candidate", "adopted"]).toContain(record.disposition);
    }
    // Month precision still means the first of the month, on whichever date the
    // record actually carries.
    for (const record of continuous) {
      if (record.datePrecision === "month") expect(record.reviewDate?.endsWith("-01")).toBe(true);
    }
  });

  it("refuses a continuously updated record that also claims a publication date", () => {
    const [base] = sourceAcquisitionRecords.filter((record) => record.dateModel === "continuously_updated");
    expect(base).toBeDefined();
    const contradictory = { ...base, publicationDate: "2020-01-01" };
    expect(acquisitionLedgerIssues([contradictory]).join(" ")).toMatch(/no publication event/i);
  });

  it("refuses a continuously updated record with no review date", () => {
    const [base] = sourceAcquisitionRecords.filter((record) => record.dateModel === "continuously_updated");
    const undated = { ...base, reviewDate: null };
    expect(acquisitionLedgerIssues([undated]).join(" ")).toMatch(/reviewDate is required/);
  });

  it("still refuses a published record with no publication date", () => {
    // The old rule is intact for everything that is genuinely published. The new
    // date model is an added state, not a relaxation.
    const published = sourceAcquisitionRecords.find((record) => (record.dateModel ?? "published") === "published");
    expect(published).toBeDefined();
    const undated = { ...published!, publicationDate: null };
    expect(acquisitionLedgerIssues([undated]).join(" ")).toMatch(/publicationDate is required/);
  });

  it("resolves nice-delirium as one work with two chapter locators", () => {
    // Not a conflict: /chapter/context and /chapter/Recommendations are two
    // chapters of NICE CG103. The register row points at the guideline; the
    // dictionary keeps its chapter citation, which is the more precise locator.
    const delirium = dictionarySourceDispositions.find(
      (disposition) => disposition.handoverSourceId === "nice-delirium",
    );
    expect(delirium?.ledgerOutcome).toBe("admitted_as_candidate");
    const record = sourceAcquisitionRecords.find((row) => row.id === "dictionary-nice-delirium-cg103");
    expect(record?.canonicalUrl).toBe("https://www.nice.org.uk/guidance/cg103");
    expect(record?.publicationDate).toBe("2010-07-28");
  });

  it("uses the register's own publisher code, which an unrecognised one overrides", () => {
    // The first attempt recorded "Aust Prescr". An unrecognised publisherCode beats
    // the publisher-name match, so the catalogue returned unknown_jurisdiction and
    // the gate read a registered publisher as unregistered. AUSPRES resolves it.
    const prescriber = sourceAcquisitionRecords.find(
      (record) => record.id === "dictionary-australian-prescriber-movement-2019",
    );
    expect(prescriber?.publisherCode).toBe("AUSPRES");
    expect(acquisitionRecordGeography(prescriber!)).toBe("australian_national");
    expect(acquisitionRecordWarnings(prescriber!)).not.toContain("unknown_jurisdiction");
  });

  it("leaves runtime selection alone for every publisher registered for this handover", () => {
    // The new entries are catalogueIdentityOnly, matching the Chief Psychiatrist's
    // own entry: the catalogue can place them in a jurisdiction, and which sources
    // retrieval picks is unchanged.
    const added = [
      "mental-health-tribunal-wa",
      "health-support-services-wa",
      "nsw-agency-for-clinical-innovation",
      "western-sydney-local-health-district",
      "royal-childrens-hospital-melbourne",
      "australasian-adhd-professionals-association",
      "amhocn",
      "centre-of-perinatal-excellence",
      "naccho",
      "american-psychiatric-association",
      "columbia-lighthouse-project",
      "diva-foundation",
    ];
    for (const key of added) {
      const entry = sourceAuthorityRegistry.find((candidate) => candidate.key === key);
      expect(entry, key).toBeDefined();
      expect(sourceAuthorityIsRuntimeClassifiable(entry!), key).toBe(false);
    }
  });

  it("does not register a publisher field that is a description rather than an agency", () => {
    // "Government of Western Australia" would resolve every WA government document
    // to one authority. Four records stayed held rather than buy admission with a
    // catch-all. On 2026-09-26 their pages were read (#JHT39N): three named a real
    // agency and were corrected, and 4AT still names none. A record whose publisher
    // is still a description stays held. The corrected ones may be admitted only
    // under the agency their page names — after the 2026-09-26 owner decision on
    // update stamps, WA-MHAS and WA-MHERL were — and never under the description.
    const vague = dictionarySourceDispositions.filter((disposition) =>
      disposition.blockers.some((blocker) => blocker.code === "publisher_field_is_a_description_not_an_agency"),
    );
    expect(vague.length).toBeGreaterThanOrEqual(1);
    for (const disposition of vague) expect(disposition.ledgerOutcome).toBe("held");
    const descriptions = new Set([
      "Government of Western Australia",
      "WA Health service providers",
      "Mental Health Commission / WA Health",
      "4AT developers",
    ]);
    for (const id of ["WA-MHAS", "WA-AHLO", "WA-MHERL", "4AT-OFFICIAL"]) {
      const disposition = dictionarySourceDispositions.find((candidate) => candidate.handoverSourceId === id);
      expect(disposition?.publisherCheck?.checkedOn, id).toBe("2026-09-26");
      if (disposition?.ledgerOutcome !== "admitted_as_candidate") {
        expect(disposition?.ledgerOutcome, id).toBe("held");
        continue;
      }
      const record = sourceAcquisitionRecords.find((row) => row.id === disposition.ledgerRecordId);
      expect(record, id).toBeDefined();
      expect(descriptions.has(record!.publisher), `${id} admitted under a description`).toBe(false);
      expect(acquisitionRecordGeography(record!), `${id} publisher is not a registered agency`).not.toBe("unknown");
    }
    for (const id of ["WA-AHLO", "4AT-OFFICIAL"]) {
      const disposition = dictionarySourceDispositions.find((candidate) => candidate.handoverSourceId === id);
      expect(disposition?.ledgerOutcome, id).toBe("held");
    }
  });
});

describe("what a candidate actually is", () => {
  it("renders unsigned handover candidates as D band and unverified", () => {
    // Candidate metadata appears in /sources before adoption. Explicitly unsigned
    // fixtures must remain at the lowest band, regardless of owner review of the
    // shipped metadata; metadata review still grants no adoption or full text.
    const added = sourceAcquisitionRecords.filter((record) => record.id.startsWith("dictionary-"));
    expect(added.length).toBeGreaterThanOrEqual(18);

    const unsigned = added.map((record) => ({
      ...record,
      validationStatus: "unverified" as const,
      attestedBy: undefined,
      attestedAt: undefined,
      attestedAgainstSha256: undefined,
    }));
    const entries = canonicalizeSourceReferences(acquisitionSourceReferences(unsigned));
    expect(entries).toHaveLength(added.length);
    for (const entry of entries) {
      expect(entry.rating.band, entry.title).toBe("D");
      expect(entry.validationStatus, entry.title).toBe("unverified");
      expect(entry.warnings, entry.title).toContain("verification_unknown");
    }
  });

  it("gives no added row full text, an index entry or clinical approval", () => {
    const added = sourceAcquisitionRecords.filter((record) => record.id.startsWith("dictionary-"));
    for (const record of added) {
      expect(record.contentMode, record.id).toBe("link_only");
      expect(record.disposition, record.id).toBe("candidate");
      expect(record.validationStatus, record.id).not.toBe("approved");
    }
  });
});

describe("the handover guide states the counts the data actually holds", () => {
  it("keeps the admitted/held split in step with the dispositions", () => {
    // A stale review comment was once applied literally and wrote a number that had
    // been correct two commits earlier into the clinical handover contract. Read the
    // guide against the data rather than trusting either figure.
    const guide = readFileSync(new URL("../docs/dictionary-editorial-drafts.md", import.meta.url), "utf8");
    const admitted = dictionarySourceDispositions.filter(
      (disposition) => disposition.ledgerOutcome === "admitted_as_candidate",
    ).length;
    const held = heldDictionarySources().length;

    const row = guide.match(/58 records: (\d+) admitted as ledger candidates, (\d+) held/);
    expect(row, "the source-outcomes row is missing from the guide").not.toBeNull();
    expect(Number(row![1])).toBe(admitted);
    expect(Number(row![2])).toBe(held);
    expect(admitted + held).toBe(dictionarySourceDispositions.length);
  });
});

// A blocker list is a promise to an operator: do these things and the source becomes
// admissible. Nothing checked that promise, so on 2026-09-16 two reviewers and I between
// us recorded a version blocker that does not exist (`acquisitionLedgerIssues` accepts
// "Not established" as text) while missing the one that does (a jurisdiction written as
// "New South Wales; spinal cord injury" instead of the register's "Australia/NSW"). This
// test does what none of us did: it hands the gate a record with the blockers cleared and
// insists nothing is left over.
// A blocker list is a promise to an operator: clear these and the source becomes
// admissible. Nothing checked that promise, so on 2026-09-16 two reviewers and I between
// us recorded a version blocker that does not exist (acquisitionLedgerIssues accepts
// "Not established" as text) while missing the one that does (a jurisdiction written as
// "New South Wales; spinal cord injury" rather than the register's "Australia/NSW").
//
// The first version of this test hardcoded the remediation, so deleting a blocker left it
// green. It now derives nothing from the fix and everything from the recorded blockers:
// supply only the date, then require the surviving gate issues and the recorded blockers
// to name the same things.
// A blocker list is a promise to an operator: clear these and the source becomes
// admissible. Nothing checked that promise, so on 2026-09-16 two reviewers and I between
// us recorded a version blocker that does not exist as a GATE rejection (acquisitionLedgerIssues
// accepts "Not established" as text) while missing the one that does (a jurisdiction written
// as "New South Wales; spinal cord injury" rather than the register's "Australia/NSW").
//
// Two later corrections shaped what follows. The first draft hardcoded the remediation, so
// deleting a blocker left it green. The second dropped version_unknown from these three
// records while 16 others kept it — and the gate DOES admit the placeholder once the other
// blockers clear, so that inconsistency would have published "Not established" as a version.
// Hence the split below: some blockers the gate enforces, and one it deliberately does not.
describe("a blocker list is a complete remediation path", () => {
  const candidates = JSON.parse(readFileSync("src/data/dictionary-source-candidates.json", "utf8")) as
    Record<string, unknown>[] | { sources: Record<string, unknown>[] };
  const candidateRecords = (Array.isArray(candidates) ? candidates : candidates.sources) as Record<string, unknown>[];
  const byHandoverId = new Map(
    candidateRecords.map((entry) => [(entry.handoverSourceId ?? entry.id) as string, entry]),
  );

  /** Blockers the gate raises. Each maps to the sentence and the warning code it appears as. */
  const GATE_ENFORCED: [RegExp, string][] = [
    [/is not a governed source host|unsafe_location/i, "host_not_in_inspected_governed_url_policy"],
    [
      /unknown_jurisdiction|not in the source authority register|metadata_conflict/i,
      "jurisdiction_not_written_in_register_form",
    ],
  ];

  /**
   * The gate does NOT raise this one, and that is exactly why it is recorded. A version of
   * "Not established" is non-empty text, so acquisitionLedgerIssues accepts it and the source
   * would be admitted with the placeholder published as its version.
   */
  const GOVERNANCE_ONLY = new Set(["version_unknown"]);

  /**
   * capturedFor is written by whoever files the ledger row rather than read from the
   * publisher's page, so the candidate does not carry it and its absence is an artefact of
   * this simulation. rung is NOT filtered: it is derived below from the register itself.
   */
  const SIMULATION_ARTEFACT = /capturedFor is required/i;

  /**
   * The rung the register's own ladder expects, rather than a guess — but the ladder is keyed
   * to the geography the register derives from the record, and a record whose jurisdiction is
   * malformed derives as "unknown". So the correct rung is not knowable until the jurisdiction
   * blocker is cleared, which is itself one of the findings this suite exists to record.
   */
  function expectedRung(record: Record<string, unknown>): number | null {
    const scope = acquisitionRecordGeography(record as Parameters<typeof acquisitionRecordGeography>[0]);
    return SOURCE_ACQUISITION_RUNGS.find((entry) => entry.scope === scope)?.rung ?? null;
  }

  function simulate(handoverSourceId: string, patch: Record<string, unknown> = {}) {
    const candidate = byHandoverId.get(handoverSourceId);
    expect(candidate, `${handoverSourceId} candidate`).toBeDefined();
    const base = {
      ...candidate,
      id: `remediation-sim-${handoverSourceId.toLowerCase()}`,
      disposition: "candidate",
      dispositionReason: "remediation simulation",
      capturedFor: "remediation simulation",
      capturedAt: "2026-09-16",
      publicationDate: "2026-01-15",
      datePrecision: "day",
      reviewDate: null,
      expiryDate: null,
      supersededBy: [],
      topics: (candidate as { topics?: string[] }).topics ?? ["Simulation"],
      ...patch,
    } as Record<string, unknown>;
    delete base.handoverSourceId;
    const rung = expectedRung(base);
    // No derivable rung means the jurisdiction is still wrong, so a rung mismatch here is a
    // consequence of that blocker rather than a separate one. Filed at the ladder's rung when
    // it IS derivable, so a genuine rung mismatch is never filtered away.
    if (rung !== null) base.rung = rung;
    const rungIsDownstream = rung === null;
    return acquisitionLedgerIssues([base as unknown as (typeof sourceAcquisitionRecords)[number]])
      .map((issue) => issue.replace(`${base.id as string}: `, ""))
      .filter((issue) => !SIMULATION_ARTEFACT.test(issue))
      .filter((issue) => !(rungIsDownstream && /rung/i.test(issue)));
  }

  // The three sources whose publisher page could not be read on 2026-09-16: the date is known
  // to be missing, so whatever else the gate reports is what the blocker list must already
  // name. All three were read on 2026-09-26: the two NSW ACI pages stated a date and were
  // admitted, and COPE's page states none.
  const UNREADABLE = ["COPE-EPDS-2026", "NSW-ACI-SCI", "nsw-mental-assessment"];
  /** Blockers that stand for the missing date itself, or for sign-off once admitted. */
  const DATE_BLOCKERS = new Set([
    "publisher_page_unreadable_from_this_session",
    "publication_event_not_stated_by_the_publisher",
    "proposed_candidate_only_native_gate_and_authorisation_required",
  ]);

  for (const handoverSourceId of UNREADABLE) {
    const disposition = () => {
      const entry = dictionarySourceDispositions.find((candidate) => candidate.handoverSourceId === handoverSourceId);
      expect(entry, handoverSourceId).toBeDefined();
      return entry!;
    };

    it(`names every gate issue that survives a date for ${handoverSourceId}`, () => {
      const recorded = new Set(disposition().blockers.map((blocker) => blocker.code));
      for (const issue of simulate(handoverSourceId)) {
        const match = GATE_ENFORCED.find(([pattern]) => pattern.test(issue));
        expect(match, `${handoverSourceId}: no blocker code is mapped to "${issue}"`).toBeDefined();
        expect(
          recorded.has(match![1]),
          `${handoverSourceId} leaves "${issue}" unnamed; blockers are ${[...recorded].join(", ")}`,
        ).toBe(true);
      }
    });

    it(`records no gate-enforced blocker the gate does not raise for ${handoverSourceId}`, () => {
      const surviving = simulate(handoverSourceId);
      for (const blocker of disposition().blockers) {
        // The date itself, which the simulation supplies.
        if (DATE_BLOCKERS.has(blocker.code)) continue;
        if (GOVERNANCE_ONLY.has(blocker.code)) continue;
        const pattern = GATE_ENFORCED.find(([, code]) => code === blocker.code)?.[0];
        expect(pattern, `${handoverSourceId}: blocker ${blocker.code} is mapped to no gate issue`).toBeDefined();
        expect(
          surviving.some((issue) => pattern!.test(issue)),
          `${handoverSourceId} records ${blocker.code}, but the gate raises nothing matching it`,
        ).toBe(true);
      }
    });

    it(`keeps the placeholder version blocked for ${handoverSourceId}, because the gate will not`, () => {
      // Clearing every gate-enforced blocker must NOT be enough to admit the source, or the
      // remediation path ends with "Not established" published as this source's version.
      const entry = disposition();
      if (entry.ledgerOutcome === "admitted_as_candidate") {
        // Admitted only once the publisher's own version or date statement replaced the placeholder.
        const record = sourceAcquisitionRecords.find((row) => row.id === entry.ledgerRecordId);
        expect(record?.version, `${handoverSourceId} admitted with a placeholder version`).not.toMatch(
          /not established|live official reference/i,
        );
        return;
      }
      expect(
        entry.blockers.map((blocker) => blocker.code),
        `${handoverSourceId} drops the governance blocker the gate cannot catch`,
      ).toContain("version_unknown");

      const version = (byHandoverId.get(handoverSourceId) as { version?: unknown } | undefined)?.version;
      expect(String(version ?? "").trim(), `${handoverSourceId} version`).not.toBe("");
      // Proof the gate really does accept it: with jurisdiction and rung corrected, nothing
      // the gate raises stands between this placeholder and the catalogue.
      const remediated = simulate(handoverSourceId, { jurisdiction: "Australia/NSW" });
      const gateStillObjectsToVersion = remediated.some((issue) => /version/i.test(issue));
      expect(
        gateStillObjectsToVersion,
        `${handoverSourceId}: the gate now rejects the placeholder, so this blocker's wording is stale`,
      ).toBe(false);
    });
  }

  it("does not tell an operator the ledger rejects a version the ledger accepts", () => {
    // The falsehood this was written after, which sat on 19 records: "No version or edition
    // identifier is established, which the ledger requires of a non-rejected record."
    // acquisitionLedgerIssues requires only NON-EMPTY TEXT, and every one of those has
    // non-empty text ("Not established", "Live official reference"), so the gate accepts them
    // all. The governance point is real; the stated mechanism was not.
    for (const disposition of dictionarySourceDispositions) {
      const blocker = disposition.blockers.find((entry) => entry.code === "version_unknown");
      if (!blocker) continue;
      const version = (byHandoverId.get(disposition.handoverSourceId) as { version?: unknown } | undefined)?.version;
      const empty = version === null || version === undefined || String(version).trim() === "";
      if (empty) continue; // then the ledger really does reject it, and saying so is correct
      expect(
        blocker.blocker,
        `${disposition.handoverSourceId} claims the ledger requires a version it already accepts`,
      ).not.toMatch(/ledger requires|requires of a non-rejected record/i);
      // Pin the wording to the data, so a changed version cannot leave a stale quotation behind.
      expect(
        blocker.blocker,
        `${disposition.handoverSourceId} quotes a version the candidate no longer holds`,
      ).toContain(JSON.stringify(String(version)));
    }
  });
});

// Owner decision, 2026-09-26: the register may carry a publisher's "last updated"
// stamp for a continuously maintained page, but only ever as "last updated". An
// update is still a third event — a page can be updated for a data refresh, a broken
// link or a typo without anyone reviewing it — so the stamp lives in its own field,
// `lastUpdatedDate`, under its own date model, and never in publicationDate or
// reviewDate.
describe("an update stamp is recorded only as last updated", () => {
  const STAMP_BLOCKER = "publisher_states_an_update_stamp_not_a_publication_or_review_date";
  const byId = new Map(sourceAcquisitionRecords.map((record) => [record.id, record]));
  const stamped = () => dictionarySourceDispositions.filter((disposition) => disposition.establishedUpdateStatement);

  // The stamps are prose ("Updated 14 Aug 2026") and the ledger's date fields are
  // ISO strings, so comparing the two raw would pass however badly the invariant
  // were broken: "Updated 14 Aug 2026" never equals "2026-08-14". The whole point
  // of the guard is to catch a stamp that HAS been normalised into a date field,
  // so the test has to normalise it the same way before comparing.
  const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  /** Every ISO date a stamp could plausibly have been filed as, day and month precision alike. */
  function datesAStampCouldBecome(statement: string): string[] {
    // WA Health pages write the stamp numerically, day first ("20/02/2026").
    const numeric = statement.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (numeric) {
      const mm = numeric[2].padStart(2, "0");
      return [`${numeric[3]}-${mm}`, `${numeric[3]}-${mm}-${numeric[1].padStart(2, "0")}`];
    }
    const month = MONTH_NAMES.findIndex((m) => new RegExp(`\\b${m}`, "i").test(statement));
    const year = statement.match(/\b(\d{4})\b/);
    if (month < 0 || !year) return [];
    const mm = String(month + 1).padStart(2, "0");
    const dates = [`${year[1]}-${mm}`];
    const day = statement.match(/\b(\d{1,2})\b(?!\d)/);
    if (day && Number(day[1]) <= 31) dates.push(`${year[1]}-${mm}-${String(Number(day[1])).padStart(2, "0")}`);
    return dates;
  }

  it("admits a banked stamp only as lastUpdatedDate under the last_updated date model", () => {
    const admitted = stamped().filter((disposition) => disposition.ledgerOutcome === "admitted_as_candidate");
    expect(admitted.length).toBeGreaterThanOrEqual(5);
    for (const disposition of admitted) {
      const id = disposition.handoverSourceId;
      const record = disposition.ledgerRecordId ? byId.get(disposition.ledgerRecordId) : undefined;
      expect(record, `${id} ledger record`).toBeDefined();
      expect(record!.dateModel, `${id} dateModel`).toBe("last_updated");
      // Neither a publication nor a review may be filled from an update stamp.
      expect(record!.publicationDate, `${id} publicationDate`).toBeNull();
      expect(record!.reviewDate, `${id} reviewDate`).toBeNull();
      // The date recorded is the publisher's own stamp, normalised — never invented.
      const dates = datesAStampCouldBecome(disposition.establishedUpdateStatement!);
      const recorded = record!.lastUpdatedDate ?? "";
      if (record!.datePrecision === "month") {
        expect(recorded.endsWith("-01"), `${id} month precision is the first of the month`).toBe(true);
        expect(dates, `${id} lastUpdatedDate is not its stamp`).toContain(recorded.slice(0, 7));
      } else {
        expect(record!.datePrecision, `${id} datePrecision`).toBe("day");
        expect(dates, `${id} lastUpdatedDate is not its stamp`).toContain(recorded);
      }
      // The stamp is no longer a blocker once it is recorded, and it is not a review.
      expect(disposition.blockers.map((blocker) => blocker.code)).not.toContain(STAMP_BLOCKER);
      expect(disposition.establishedReviewDate).toBeUndefined();
    }
  });

  it("keeps every still-held stamped source held on a blocker other than the stamp", () => {
    // The owner decision removed the stamp as an obstacle. A stamped source that is
    // still held must therefore be held for some other, named reason.
    for (const disposition of stamped()) {
      if (disposition.ledgerOutcome === "admitted_as_candidate") continue;
      const codes = disposition.blockers.map((blocker) => blocker.code);
      expect(
        codes.some((code) => code !== STAMP_BLOCKER),
        `${disposition.handoverSourceId} is held on the update stamp alone`,
      ).toBe(true);
      expect(codes, `${disposition.handoverSourceId} still records the resolved stamp blocker`).not.toContain(
        STAMP_BLOCKER,
      );
      expect(disposition.ledgerRecordId).toBeNull();
    }
  });

  it("normalises each banked update stamp to a date, and finds it in no publication or review field", () => {
    const stamps = stamped().map((disposition) => disposition.establishedUpdateStatement!);
    expect(stamps.length).toBeGreaterThanOrEqual(4);

    // A stamp the normaliser cannot read would make the comparison below vacuous,
    // which is the failure this test exists to stop repeating.
    const forbidden = new Set<string>();
    for (const stamp of stamps) {
      const dates = datesAStampCouldBecome(stamp);
      expect(dates.length, `no date could be read from ${JSON.stringify(stamp)}`).toBeGreaterThan(0);
      for (const date of dates) forbidden.add(date);
    }
    expect(forbidden.has("2026-08-14")).toBe(true);

    for (const record of sourceAcquisitionRecords) {
      for (const field of ["publicationDate", "reviewDate"] as const) {
        const value = record[field];
        if (!value) continue;
        expect(forbidden.has(value), `${record.id}.${field} carries a banked update stamp`).toBe(false);
      }
    }
  });

  it("carries lastUpdatedDate on no record outside the last_updated date model", () => {
    const lastUpdated = sourceAcquisitionRecords.filter((record) => record.dateModel === "last_updated");
    expect(lastUpdated.length).toBeGreaterThanOrEqual(5);
    for (const record of sourceAcquisitionRecords) {
      if (record.dateModel === "last_updated") {
        expect(record.lastUpdatedDate, `${record.id} lastUpdatedDate`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(record.publicationDate, `${record.id} publicationDate`).toBeNull();
        expect(record.reviewDate, `${record.id} reviewDate`).toBeNull();
      } else {
        expect(record.lastUpdatedDate ?? null, `${record.id} lastUpdatedDate`).toBeNull();
      }
    }
  });

  it("names the stamp as last updated in the catalogue, never as published or reviewed", () => {
    const lastUpdated = sourceAcquisitionRecords.filter((record) => record.dateModel === "last_updated");
    const entries = canonicalizeSourceReferences(acquisitionSourceReferences(lastUpdated));
    expect(entries).toHaveLength(lastUpdated.length);
    for (const entry of entries) {
      expect(entry.lastUpdatedDate, entry.title).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.publicationDate, entry.title).toBeNull();
      expect(entry.reviewDate, entry.title).toBeNull();
      // Dated, so the stamp satisfies the catalogue's date requirement on its own.
      expect(entry.warnings, entry.title).not.toContain("missing_dates");
    }
  });
});
