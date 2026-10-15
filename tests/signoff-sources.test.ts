import { describe, expect, it } from "vitest";

import {
  applyClinicalReview,
  collectionOf,
  finalizeClinicalReview,
  indigenousContentIn,
  recordKinds,
  recordPinState,
  reviewProblems,
  signOffEligibilityProblem,
  signOffQueue,
} from "../scripts/lib/clinical-record-review-contract.mjs";
import {
  display,
  duplicateSources,
  loadContext,
  possibleDuplicateSources,
} from "../scripts/lib/signoff-kinds/sources.mjs";
import { renderClinicalPack } from "../scripts/review-clinical-record.mjs";

import sourceAcquisitions from "../src/data/source-acquisitions.json";

import {
  acquisitionAttestedContentSha256,
  acquisitionLedgerIssues,
  acquisitionReviewQueue,
  type SourceAcquisitionRecord,
} from "@/lib/sources/acquisition-ledger";
import { acquisitionSignOffRatings, signedValidationStatus } from "@/lib/sources/acquisition-sign-off-rating";
import { canonicalizeSourceReferences } from "@/lib/sources/catalogue-core";
import { repositorySourceReferences } from "@/lib/sources/repository-providers";

/**
 * The `source` sign-off kind (scripts/lib/signoff-kinds/sources.mjs): the owner's review of a
 * candidate source in src/data/source-acquisitions.json, written into the ledger's own
 * validationStatus and attestation fields so the queue, /sources and check:source-acquisitions
 * all read it without a second file.
 */

const NOW = new Date(Math.max(Date.now(), Date.parse("2026-10-16T06:00:00.000Z")));
const REVIEWED_AT = "2026-09-25T05:00:00.000Z";
const REVIEWER = "Dr Clinical Owner";
const ATTESTATION_FIELDS = ["attestedBy", "attestedAt", "attestedAgainstSha256"];

type Json = Record<string, unknown>;
const ledger = sourceAcquisitions as unknown as Json[];
const clone = <T>(value: T): T => structuredClone(value);
const context = {
  duplicates: duplicateSources(ledger) as Record<string, string[]>,
  possibleDuplicates: possibleDuplicateSources(ledger) as Record<string, string[]>,
};
const views = () => collectionOf("source", ledger) as Json[];
const rowsText = (rows: unknown[][]) => rows.map(([label, value]) => `${label}\n${JSON.stringify(value)}`).join("\n");

/** The record as the owner first meets it, whatever has been signed on disk since. */
function asUnsigned(id: string) {
  return ledger.map((native) => {
    if (native.id !== id) return clone(native);
    const copy = clone(native);
    for (const field of ATTESTATION_FIELDS) delete copy[field];
    return { ...copy, validationStatus: "unverified" };
  });
}

function sign(id: string) {
  const before = asUnsigned(id);
  const view = (collectionOf("source", before) as Json[]).find((record) => record.id === id)!;
  const signed = finalizeClinicalReview(view, "source", { reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT, now: NOW });
  return { before, after: applyClinicalReview(clone(before), "source", signed) as Json[] };
}

/** The first record the walk-through offers: in the review queue and not held. */
const firstOffered = () =>
  views().find((record) => record.disposition === "candidate" && !indigenousContentIn(record, "source"))!.id as string;

describe("source sign-offs on disk", () => {
  it("every ledger record is unsigned or carries a current pin", () => {
    expect(reviewProblems(views(), "source", { now: new Date() })).toEqual([]);
    for (const record of views()) {
      expect(["unsigned", "current"]).toContain(recordPinState(record, "source"));
    }
  });

  it("offers exactly the acquisition review queue, in its order, less the records held from sign-off", () => {
    const queue = acquisitionReviewQueue().map((record) => record.id);
    const drafted = views()
      .filter((record) => record.status === "drafted")
      .map((record) => record.id);
    expect(drafted).toEqual(queue);

    const held = views().filter((record) => record.status === "drafted" && signOffEligibilityProblem(record, "source"));
    const offered = signOffQueue("source", views());
    expect(offered).toEqual(queue.filter((id) => !held.some((record) => record.id === id)));
    expect(offered.length + held.length).toBe(acquisitionReviewQueue().length);
    // The owner rule of 2026-09-26 holds Indigenous content back; this one is the named example.
    expect(held.map((record) => record.id)).toContain("therapy-wa-aboriginal-impact-policy");
    for (const record of held) expect(indigenousContentIn(record, "source")).not.toBeNull();
  });

  it("reads a review recorded only in prose, and every rejection, as pending rather than signed", () => {
    for (const record of views().filter((entry) => entry.status === "pending")) {
      const native = ledger.find((entry) => entry.id === record.id)!;
      expect(native.disposition === "rejected" || !native.attestedBy).toBe(true);
    }
    expect(views().filter((record) => record.validationStatus === "locally_reviewed").length).toBeGreaterThan(0);
  });

  it("asks questions about a source, not about clinical wording", () => {
    expect(
      (recordKinds as unknown as Record<string, { checklist: Json[] }>).source!.checklist.map(
        (check) => check.question,
      ),
    ).toEqual([
      "The title, publisher, version and dates match the publisher's own page.",
      "The document status shown (current, review due or outdated) is right, and the source is suitable for the use it was captured for.",
      "It is safe to mark this source as reviewed.",
    ]);
  });
});

describe("source sign-off round trip", () => {
  it("writes validationStatus and the three attestation fields of the target record, and nothing else", () => {
    const id = firstOffered();
    const { before, after } = sign(id);
    expect(after).toHaveLength(before.length);
    for (const [index, native] of after.entries()) {
      if (native.id !== id) {
        expect(native).toEqual(before[index]);
        continue;
      }
      const changed = Object.keys({ ...before[index], ...native }).filter(
        (key) => JSON.stringify(native[key]) !== JSON.stringify(before[index]![key]),
      );
      expect(changed.sort()).toEqual(["attestedAgainstSha256", "attestedAt", "attestedBy", "validationStatus"]);
      expect(native).toMatchObject({
        validationStatus: "locally_reviewed",
        attestedBy: REVIEWER,
        attestedAt: REVIEWED_AT,
      });
      // The pin is the ledger's own digest, so check:source-acquisitions agrees with it.
      expect(native.attestedAgainstSha256).toBe(
        acquisitionAttestedContentSha256(native as unknown as SourceAcquisitionRecord),
      );
    }
    expect(acquisitionLedgerIssues(after as unknown as SourceAcquisitionRecord[])).toEqual([]);

    const view = (collectionOf("source", after) as Json[]).find((record) => record.id === id)!;
    expect(view).toMatchObject({ status: "reviewed", reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT });
    expect(recordPinState(view, "source")).toBe("current");
    expect(reviewProblems(collectionOf("source", after), "source", { now: NOW })).toEqual([]);
    expect(signOffQueue("source", collectionOf("source", after))).not.toContain(id);
    expect(
      acquisitionReviewQueue(after as unknown as SourceAcquisitionRecord[]).map((record) => record.id),
    ).not.toContain(id);
  });

  it.each([
    ["title", "A different title"],
    ["publisher", "Someone else"],
    ["canonicalUrl", "https://www.health.wa.gov.au/elsewhere"],
    ["version", "Second edition"],
    ["publicationDate", "2001-01-01"],
    ["reviewDate", "2030-01-01"],
    ["documentStatus", "outdated"],
    ["evidenceType", "other"],
    ["contentMode", "metadata_only"],
    ["topics", ["Something else"]],
    ["rung", 5],
    ["capturedFor", "A different use"],
    ["disposition", "adopted"],
    ["dispositionReason", "Changed"],
    ["supersededBy", ["another-source"]],
    ["notes", "An edited note"],
  ])("goes stale when %s is edited after sign-off", (field, value) => {
    const id = firstOffered();
    const { after } = sign(id);
    const edited = after.map((native) => (native.id === id ? { ...native, [field]: value } : native));
    const view = (collectionOf("source", edited) as Json[]).find((record) => record.id === id)!;
    expect(recordPinState(view, "source")).toBe("stale");
    expect(signOffQueue("source", collectionOf("source", edited))).toContain(id);
    expect(acquisitionLedgerIssues(edited as unknown as SourceAcquisitionRecord[])).toContain(
      `${id}: attestedAgainstSha256 is stale; content changed after sign-off`,
    );
  });

  it("refuses a record that is not in the queue", () => {
    const rejected = views().find((record) => record.disposition === "rejected")!;
    expect(signOffEligibilityProblem(rejected, "source")).toMatch(/Only a drafted source/);
  });
});

describe("source sign-off screen", () => {
  it("marks each record that duplicates another record's canonical URL", () => {
    expect(context.duplicates).toEqual({
      "ps-diff-src-au-ausprescr-movement-2019": ["dictionary-australian-prescriber-movement-2019"],
      "dictionary-australian-prescriber-movement-2019": ["ps-diff-src-au-ausprescr-movement-2019"],
      "ps-diff-src-au-ausprescr-lithium-2020": ["australian-prescriber-lithium-therapy-and-its-interactions"],
      "australian-prescriber-lithium-therapy-and-its-interactions": ["ps-diff-src-au-ausprescr-lithium-2020"],
    });
    for (const [id, others] of Object.entries(context.duplicates)) {
      const record = views().find((entry) => entry.id === id)!;
      const text = rowsText(display.source(record, context));
      expect(text).toContain(`DUPLICATE of ${others.join(", ")}`);
    }
    const unique = views().find((record) => !context.duplicates[record.id as string] && record.status === "drafted")!;
    expect(rowsText(display.source(unique, context))).not.toContain("DUPLICATE of");
  });

  it("shows every pinned field a reader or the rating uses", () => {
    for (const record of views()) {
      const text = rowsText(display.source(record, context));
      for (const field of [
        "title",
        "publisher",
        "publisherCode",
        "canonicalUrl",
        "jurisdiction",
        "version",
        "publicationDate",
        "reviewDate",
        "expiryDate",
        "datePrecision",
        "documentStatus",
        "evidenceType",
        "contentMode",
        "capturedFor",
        "capturedAt",
        "disposition",
        "dispositionReason",
        "notes",
        "validationStatus",
      ]) {
        const value = record[field];
        if (typeof value !== "string" || field === "documentStatus") continue;
        expect(text, `${record.id} ${field}`).toContain(JSON.stringify(value).slice(1, -1));
      }
      for (const topic of record.topics as string[]) expect(text).toContain(topic);
      expect(text).toContain(`${record.rung}: `);
    }
  });

  it("puts the duplicate warning in the review pack as well", () => {
    const unsigned = collectionOf(
      "source",
      ledger.map((record) => {
        const copy = clone(record);
        for (const field of ATTESTATION_FIELDS) delete copy[field];
        if (copy.disposition !== "rejected") copy.validationStatus = "unverified";
        return copy;
      }),
    );
    const html = renderClinicalPack("source", unsigned, context, { generatedAt: NOW });
    expect(html).toContain("DUPLICATE of australian-prescriber-lithium-therapy-and-its-interactions");
  });

  it("loads the duplicates and the band and score for the screen", async () => {
    const loaded = (await loadContext("source", process.cwd())) as Json;
    expect(loaded.duplicates).toEqual(context.duplicates);
    const ratings = loaded.ratings as Record<string, Json>;
    expect(Object.keys(ratings).sort()).toEqual(ledger.map((record) => record.id).sort());
    const text = rowsText(
      display.source(
        collectionOf("source", asUnsigned(firstOffered())).find((record: Json) => record.id === firstOffered())!,
        loaded,
      ),
    );
    expect(text).toMatch(/After this sign-off: band [A-D], score \d+\/100, validation locally_reviewed/);
  }, 60_000);
});

describe("source sign-off ratings", () => {
  const records = sourceAcquisitions as unknown as SourceAcquisitionRecord[];
  const references = repositorySourceReferences();
  const ratings = acquisitionSignOffRatings(records, references);

  it("rates the /sources entry exactly as the full catalogue does", () => {
    const catalogue = canonicalizeSourceReferences(references);
    for (const record of records) {
      const entry = catalogue.find((candidate) =>
        candidate.usedBy.some((usage) => usage.field === "acquisition_ledger" && usage.recordId === record.id),
      )!;
      expect(ratings[record.id]!.catalogue?.now, record.id).toMatchObject({
        band: entry.rating.band,
        score: entry.rating.score,
        validationStatus: entry.validationStatus,
        usages: entry.usedBy.length,
      });
    }
  });

  it("shows signing lift accuracy assurance from unverified to locally reviewed", () => {
    expect(signedValidationStatus("unverified")).toBe("locally_reviewed");
    expect(signedValidationStatus("approved")).toBe("approved");
    for (const record of acquisitionReviewQueue(records)) {
      const { now, ifReviewed } = ratings[record.id]!.standalone;
      expect(ifReviewed.score - now.score).toBe(15);
      expect(ifReviewed.warnings).not.toContain("verification_unknown");
    }
  });
});
