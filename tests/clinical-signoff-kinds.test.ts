import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { indigenousContentTerm } from "../scripts/lib/indigenous-content.mjs";
import {
  applyClinicalReview,
  collectionOf,
  indigenousContentIn,
  signOffEligibilityProblem,
  finalizeClinicalReview,
  recordPinState,
  reviewProblems,
  signOffQueue,
} from "../scripts/lib/clinical-record-review-contract.mjs";
import {
  clinicalPackCode,
  conductClinicalBatchReview,
  main as clinicalReviewMain,
  renderClinicalPack,
} from "../scripts/review-clinical-record.mjs";

import differentialCuratedReview from "../data/differential-curated-review.json";
import formulationConcepts from "../src/data/formulation-concepts.json";
import formulationContent from "../src/data/formulation-content.json";
import dictionaryDefinitionReviews from "../src/data/dictionary-definition-reviews.json";
import specifiersContent from "../data/specifiers-content.json";

import { curatedDifferentials } from "@/lib/differential-curated";
import { curatedProvenanceFor, curatedProvenanceLabel } from "@/lib/differential-detail";
import { conceptReviewState, mechanismReviewState } from "@/lib/formulation-review-status";

/**
 * The sign-off kinds added for the Differentials overlays and the Formulation library.
 *
 * Two jobs. First, the enforcement the forms already have: every record signed off on disk
 * must still carry a current content pin, so an edit to signed text turns this file red
 * until the owner signs it again. Second, the round trip: a sign-off written through the
 * flat view lands in the record's native fields exactly where the app reads it, and nowhere
 * else.
 */

const NOW = new Date(Math.max(Date.now(), Date.parse("2026-10-07T00:00:00.000Z")));
const REVIEWED_AT = "2026-09-25T05:00:00.000Z";
const REVIEWER = "Dr Clinical Owner";
const context = { curated: curatedDifferentials, sourceLibrary: formulationContent.sourceLibrary };

type Json = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);

/** The record as the owner would first meet it, whatever has been signed on disk since. */
function asUnsigned(kind: string, document: unknown, id: string) {
  const copy = clone(document) as Record<string, Json[]>;
  const key =
    { differential: "entries", "formulation-mechanism": "mechanisms", "formulation-guide": "guides" }[kind] ??
    "concepts";
  const record = copy[key].find((entry) => (entry.id ?? entry.slug) === id)!;
  expect(record, `${kind} ${id} exists`).toBeTruthy();
  if (kind === "formulation-mechanism") {
    Object.assign(record, { reviewStatus: "clinical_review_required" });
    for (const field of ["reviewedBy", "reviewedAt", "reviewedContentSha256"]) delete record[field];
  } else if (kind === "differential") {
    Object.assign(record, { status: "drafted", reviewedBy: null, reviewedAt: null, reviewedContentSha256: null });
  } else {
    const review = record.review as Json;
    record.review = { status: "clinical_review_required", reviewer: null, preparedAt: review.preparedAt };
  }
  return copy;
}

function sign(kind: string, document: unknown, id: string) {
  const unsigned = asUnsigned(kind, document, id);
  const view = collectionOf(kind, unsigned).find((record: Json) => (record.id ?? record.slug) === id);
  const signed = finalizeClinicalReview(view, kind, {
    reviewedBy: REVIEWER,
    reviewedAt: REVIEWED_AT,
    context,
    now: NOW,
  });
  return { before: unsigned, after: applyClinicalReview(clone(unsigned), kind, signed) };
}

describe("sign-offs on disk", () => {
  it.each([
    ["differential", differentialCuratedReview],
    ["formulation-guide", formulationConcepts],
    ["formulation-concept", formulationConcepts],
    ["formulation-mechanism", formulationContent],
    ["specifier", specifiersContent],
    ["dictionary-rewrite", dictionaryDefinitionReviews],
  ])("every %s record is unsigned or carries a current pin", (kind, document) => {
    expect(reviewProblems(collectionOf(kind, document), kind, context)).toEqual([]);
  });

  it("lists exactly the authored differential overlays, and no overlay carries its own attestation", () => {
    const slugs = differentialCuratedReview.entries.map((entry) => entry.slug);
    expect([...slugs].sort()).toEqual(Object.keys(curatedDifferentials).sort());
    for (const entry of Object.values(curatedDifferentials)) expect(entry).not.toHaveProperty("review");
  });

  it("walks the highest-consequence differentials first", () => {
    const unsigned = differentialCuratedReview.entries.map((entry) => ({ ...entry, status: "drafted" }));
    expect(signOffQueue("differential", unsigned, context).slice(0, 2)).toEqual([
      "neuroleptic-malignant-syndrome",
      "serotonin-toxicity",
    ]);
  });
});

describe("Formulation guide and concept sign-off", () => {
  it("writes the sign-off into review, where the page reads it, and nothing else", () => {
    const signed = sign("formulation-guide", formulationConcepts, "guide-08");
    const original = signed.before as unknown as typeof formulationConcepts;
    const next = signed.after as typeof formulationConcepts;
    const before = original.guides.find((guide) => guide.id === "guide-08")!;
    const after = next.guides.find((guide) => guide.id === "guide-08")! as Json & { review: Json };

    expect(after.review).toMatchObject({
      status: "reviewed",
      reviewer: REVIEWER,
      reviewedAt: REVIEWED_AT,
      preparedAt: before.review.preparedAt,
    });
    expect(after.review.reviewedContentSha256).toMatch(/^[a-f0-9]{64}$/);
    const withoutReview = (record: object) =>
      Object.fromEntries(Object.entries(record).filter(([key]) => key !== "review"));
    expect(withoutReview(after)).toEqual(withoutReview(before));
    expect(next.concepts).toEqual(original.concepts);
    expect(next.guides.filter((guide) => guide.id !== "guide-08")).toEqual(
      original.guides.filter((guide) => guide.id !== "guide-08"),
    );
    expect(conceptReviewState(after as never)).toMatchObject({ reviewed: true, detail: `Reviewed by ${REVIEWER}.` });
  });

  it("catches an edit to signed text, including search terms, which reach the public site content", () => {
    const next = sign("formulation-concept", formulationConcepts, "hopelessness").after as typeof formulationConcepts;
    const view = () => collectionOf("formulation-concept", next).find((record: Json) => record.id === "hopelessness");
    expect(recordPinState(view(), "formulation-concept")).toBe("current");

    const edited = clone(next);
    edited.concepts.find((concept) => concept.id === "hopelessness")!.searchTerms.push("despair");
    const editedView = collectionOf("formulation-concept", edited).find((record: Json) => record.id === "hopelessness");
    expect(recordPinState(editedView, "formulation-concept")).toBe("stale");

    next.concepts.find((concept) => concept.id === "hopelessness")!.summary += " Edited.";
    expect(recordPinState(view(), "formulation-concept")).toBe("stale");
    expect(reviewProblems(collectionOf("formulation-concept", next), "formulation-concept", { now: NOW })).toEqual([
      expect.stringContaining("content changed since sign-off"),
    ]);
  });

  it("refuses a native status it does not recognise rather than reading it as signed", () => {
    const document = clone(formulationConcepts);
    document.guides[0].review.status = "approved";
    expect(reviewProblems(collectionOf("formulation-guide", document), "formulation-guide").join("\n")).toMatch(
      /status must be one of drafted, reviewed/,
    );
  });
});

describe("Formulation mechanism sign-off", () => {
  it("advances reviewStatus and names the reviewer without the pre-review wording", () => {
    const next = sign("formulation-mechanism", formulationContent, "avoidance").after as typeof formulationContent;
    const after = next.mechanisms.find((mechanism) => mechanism.id === "avoidance")! as Json;
    expect(after).toMatchObject({ reviewStatus: "reviewed", reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT });

    const state = mechanismReviewState(after as never);
    expect(state.reviewed).toBe(true);
    expect(state.detail).toBe(`Reviewed by ${REVIEWER}.`);
    expect(state.detail).not.toMatch(/pending/);
    expect(
      reviewProblems(collectionOf("formulation-mechanism", next), "formulation-mechanism", { ...context, now: NOW }),
    ).toEqual([]);
  });

  it("pins the source library entries the page lists, so a library edit sends it back for review", () => {
    const next = sign("formulation-mechanism", formulationContent, "avoidance").after as typeof formulationContent;
    const view = collectionOf("formulation-mechanism", next).find((record: Json) => record.id === "avoidance");
    expect(recordPinState(view, "formulation-mechanism", context)).toBe("current");

    const library = clone(formulationContent.sourceLibrary) as Record<string, { url: string }>;
    const firstSource = (view.sources as string[])[0];
    library[firstSource].url = "https://example.org/moved";
    expect(recordPinState(view, "formulation-mechanism", { sourceLibrary: library })).toBe("stale");
  });
});

describe("Differential overlay sign-off", () => {
  it("pins the whole overlay, and an edit to it sends the record back for review", () => {
    const next = sign("differential", differentialCuratedReview, "serotonin-toxicity").after;
    const row = collectionOf("differential", next).find((entry: Json) => entry.slug === "serotonin-toxicity");
    expect(row).toMatchObject({ status: "reviewed", reviewedBy: REVIEWER });
    expect(recordPinState(row, "differential", context)).toBe("current");

    const edited = clone(curatedDifferentials);
    edited["serotonin-toxicity"].doNow = [...(edited["serotonin-toxicity"].doNow ?? []), "An added step"];
    expect(recordPinState(row, "differential", { curated: edited })).toBe("stale");
  });

  it("names the reviewer in place of 'verify before use' once signed", () => {
    const entry = curatedDifferentials["serotonin-toxicity"];
    expect(curatedProvenanceFor(entry)).toBe(curatedProvenanceLabel);
    expect(curatedProvenanceFor({ ...entry, review: { reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT } })).toBe(
      `Locally authored, reviewed by ${REVIEWER} on 25 September 2026`,
    );
    expect(curatedProvenanceFor({ ...entry, review: { reviewedBy: REVIEWER, reviewedAt: "not a date" } })).toBe(
      curatedProvenanceLabel,
    );
  });
});

describe("batch sign-off from a review pack", () => {
  const unsignedDifferentials = () => ({
    entries: differentialCuratedReview.entries.map((entry) => ({
      ...entry,
      status: "drafted",
      reviewedBy: null,
      reviewedAt: null,
      reviewedContentSha256: null,
    })),
  });
  const answers = (...values: string[]) => {
    const queue = [...values];
    return async () => queue.shift() ?? "quit";
  };
  const sink = () => ({ write: () => true });

  it("derives the code from the content, so an edit after the pack changes it", () => {
    const records = collectionOf("differential", unsignedDifferentials());
    const code = clinicalPackCode("differential", records, context);
    expect(code).toMatch(/^[a-f0-9]{8}$/);
    const edited = clone(curatedDifferentials);
    edited.delirium.doNow = [...(edited.delirium.doNow ?? []), "An added step"];
    expect(clinicalPackCode("differential", records, { curated: edited })).not.toBe(code);
  });

  it("writes a pack that carries the code and every record, with its text escaped", () => {
    const records = collectionOf("differential", unsignedDifferentials());
    const html = renderClinicalPack("differential", records, context, { reviewedBy: "PsychSift" });
    expect(html).toContain(clinicalPackCode("differential", records, context));
    for (const entry of differentialCuratedReview.entries) expect(html).toContain(`id="${entry.slug}"`);
    expect(html).toContain("--reviewed-by &quot;PsychSift&quot;");
    expect(html).not.toMatch(/<script/i);
  });

  it("signs every record not excluded, once the three answers are yes and the code matches", async () => {
    const records = collectionOf("differential", unsignedDifferentials());
    const code = clinicalPackCode("differential", records, context);
    const result = await conductClinicalBatchReview({
      kind: "differential",
      records,
      context,
      reviewedBy: REVIEWER,
      exclude: ["akathisia"],
      ask: answers("yes", "yes", "yes", code.toUpperCase()),
      output: sink(),
      now: () => new Date(REVIEWED_AT),
    });
    expect(result.status).toBe("reviewed");
    expect(result.signed).toHaveLength(records.length - 1);
    expect(result.signed.map((record: Json) => record.slug)).not.toContain("akathisia");
    for (const record of result.signed) {
      expect(record).toMatchObject({ status: "reviewed", reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT });
      expect(recordPinState(record, "differential", context)).toBe("current");
    }
  });

  it("signs nothing on a no, a quit, or a code that does not match", async () => {
    const records = collectionOf("differential", unsignedDifferentials());
    const code = clinicalPackCode("differential", records, context);
    const run = (ask: () => Promise<string>) =>
      conductClinicalBatchReview({ kind: "differential", records, context, reviewedBy: REVIEWER, ask, output: sink() });
    expect(await run(answers("yes", "no"))).toEqual({ status: "incomplete", signed: [] });
    expect(await run(answers("quit"))).toEqual({ status: "quit", signed: [] });
    expect(await run(answers("yes", "yes", "yes", "00000000"))).toEqual({ status: "code-mismatch", signed: [] });
    expect(code).not.toBe("00000000");
  });

  it("refuses to exclude a record that is not in the set", async () => {
    const records = collectionOf("differential", unsignedDifferentials());
    await expect(
      conductClinicalBatchReview({
        kind: "differential",
        records,
        context,
        reviewedBy: REVIEWER,
        exclude: ["not-a-slug"],
        ask: answers(),
        output: sink(),
      }),
    ).rejects.toThrow(/not-a-slug/);
  });
});

describe("specifier sign-off", () => {
  const records = () => collectionOf("specifier", specifiersContent);

  it("offers only records with real text: written definitions and the universal specifiers", () => {
    const all = records();
    const signable = all.filter((record: Json) => record.status !== "pending");
    expect(signable.every((record: Json) => record.kind === "universal" || record.definitionStatus === "defined")).toBe(
      true,
    );
    const placeholders = all.filter((record: Json) => record.kind === "item" && record.definitionStatus !== "defined");
    expect(placeholders.length).toBeGreaterThan(0);
    for (const record of placeholders) expect(record.status).not.toBe("drafted");
  });

  it("writes the sign-off into the item's review, recounts pending items, and touches nothing else", () => {
    const document = clone(specifiersContent);
    const target = collectionOf("specifier", document).find(
      (record: Json) => record.kind === "item" && record.definitionStatus === "defined",
    );
    for (const category of document.categories)
      for (const disorder of category.disorders)
        for (const group of disorder.groups)
          for (const item of group.items) {
            if (item.review.rowKey === target.id)
              Object.assign(item.review, {
                clinicianReviewStatus: "clinician-review-pending",
                reviewedBy: null,
                reviewedAt: null,
                reviewedContentSha256: null,
              });
          }
    document.stats.itemsPendingClinicianReview += 1;
    const beforeViews = collectionOf("specifier", document);
    const view = beforeViews.find((record: Json) => record.id === target.id);
    expect(view).toBeTruthy();
    const signed = finalizeClinicalReview(view, "specifier", {
      reviewedBy: REVIEWER,
      reviewedAt: REVIEWED_AT,
      now: NOW,
    });
    const next = applyClinicalReview(document, "specifier", signed) as typeof specifiersContent;
    const after = collectionOf("specifier", next);
    const signedView = after.find((record: Json) => record.id === view.id);
    expect(signedView).toMatchObject({ status: "reviewed", reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT });
    expect(recordPinState(signedView, "specifier")).toBe("current");
    const changed = after.filter(
      (record: Json, index: number) => JSON.stringify(record) !== JSON.stringify(beforeViews[index]),
    );
    expect(changed.map((record: Json) => record.id)).toEqual([view.id]);
    expect(next.stats.itemsPendingClinicianReview).toBe(document.stats.itemsPendingClinicianReview - 1);
  });

  it("sends a signed definition back for review when its text is edited", () => {
    const view = {
      ...records().find((record: Json) => record.kind === "item" && record.definitionStatus === "defined"),
      status: "drafted",
      reviewedBy: null,
      reviewedAt: null,
      reviewedContentSha256: null,
    };
    const signed = finalizeClinicalReview(view, "specifier", {
      reviewedBy: REVIEWER,
      reviewedAt: REVIEWED_AT,
      now: NOW,
    });
    const edited = { ...signed, definition: { ...(signed.definition as Json), meaning: "Edited." } };
    expect(recordPinState(edited, "specifier")).toBe("stale");
  });
});

describe("dictionary rewrite approval", () => {
  const records = () => collectionOf("dictionary-rewrite", dictionaryDefinitionReviews);

  it("offers only reviews that propose new wording", () => {
    for (const record of records()) {
      expect(record.status).toBe(
        record.proposedWording
          ? recordPinState(record, "dictionary-rewrite") === "current"
            ? "reviewed"
            : "drafted"
          : "pending",
      );
    }
  });

  it("records the approval beside the review and leaves the wording and publication flags alone", () => {
    const view = {
      ...records().find((record: Json) => record.proposedWording),
      status: "drafted",
      reviewedBy: null,
      reviewedAt: null,
      reviewedContentSha256: null,
    };
    const signed = finalizeClinicalReview(view, "dictionary-rewrite", {
      reviewedBy: REVIEWER,
      reviewedAt: REVIEWED_AT,
      now: NOW,
    });
    const next = applyClinicalReview(clone(dictionaryDefinitionReviews), "dictionary-rewrite", signed) as {
      reviews: Json[];
    };
    const before = dictionaryDefinitionReviews.reviews.find((review) => review.id === view.id)!;
    const after = next.reviews.find((review) => review.id === view.id)!;
    expect(after.clinicalApproval).toMatchObject({ status: "approved", reviewer: REVIEWER, reviewedAt: REVIEWED_AT });
    const withoutApproval = Object.fromEntries(Object.entries(after).filter(([key]) => key !== "clinicalApproval"));
    const beforeWithoutApproval: Json = { ...before };
    delete beforeWithoutApproval.clinicalApproval;
    expect(withoutApproval).toEqual(beforeWithoutApproval);
    const view2 = collectionOf("dictionary-rewrite", next).find((record: Json) => record.id === view.id);
    expect(recordPinState(view2, "dictionary-rewrite")).toBe("current");
    expect(recordPinState({ ...view2, proposedWording: "Changed." }, "dictionary-rewrite")).toBe("stale");
  });
});

describe("owner rule 2026-09-26: Indigenous content is never signed off", () => {
  it("recognises Indigenous content and leaves other text alone", () => {
    for (const text of [
      "Aboriginal and Torres Strait Islander people",
      "First Nations social and emotional wellbeing",
      "SEWB framework",
      "Call 13YARN",
      "Thirrili postvention",
      "non-Indigenous reviewers",
    ]) {
      expect(indigenousContentTerm({ text })).not.toBeNull();
    }
    expect(indigenousContentTerm({ text: "Serotonin toxicity with clonus" })).toBeNull();
  });

  it("holds Indigenous Formulation records out of every queue and refuses to sign them", () => {
    const concepts = collectionOf("formulation-concept", formulationConcepts);
    const queue = signOffQueue("formulation-concept", concepts);
    const held = concepts.filter((record: Json) => indigenousContentIn(record, "formulation-concept"));
    expect(held.map((record: Json) => record.id)).toContain("first-nations-sewb");
    for (const record of held) {
      expect(queue).not.toContain(record.id);
      expect(signOffEligibilityProblem(record, "formulation-concept")).toMatch(/Indigenous content/);
      expect(() =>
        finalizeClinicalReview(record, "formulation-concept", {
          reviewedBy: REVIEWER,
          reviewedAt: REVIEWED_AT,
          now: NOW,
        }),
      ).toThrow(/Indigenous content/);
    }
    const guides = collectionOf("formulation-guide", formulationConcepts);
    expect(signOffQueue("formulation-guide", guides)).not.toContain("guide-07");
  });

  it("reports an Indigenous record found signed, so CI goes red until it is returned to drafted", () => {
    const record = collectionOf("formulation-concept", formulationConcepts).find(
      (entry: Json) => entry.id === "first-nations-sewb",
    );
    const forged = { ...record, status: "reviewed", reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT };
    expect(reviewProblems([forged], "formulation-concept", { now: NOW }).join("\n")).toMatch(/Indigenous content/);
  });
});

describe("differential overlay context", () => {
  it("re-reads the authored overlays when the file changes, so a walk never pins stale text", async () => {
    // The walk reloads its context before every record. The overlays are a TS module, and a
    // module import is cached by URL, so without a content-derived URL an edit made mid-walk
    // would be shown and pinned as the text from the start of the session.
    const root = mkdtempSync(join(tmpdir(), "differential-context-"));
    try {
      for (const file of [
        "data/differential-curated-review.json",
        "data/differentials-snapshot.json",
        "src/lib/differential-curated.ts",
      ]) {
        mkdirSync(join(root, file, ".."), { recursive: true });
        copyFileSync(join(process.cwd(), file), join(root, file));
      }
      const show = async () => {
        let text = "";
        const output = { write: (chunk: string) => ((text += chunk), true) };
        await clinicalReviewMain(["--kind", "differential", "--code", "delirium"], {
          root,
          output,
          errorOutput: { write: () => true },
        });
        return text;
      };
      expect(await show()).not.toContain("EDITED-MID-WALK");

      const overlayPath = join(root, "src/lib/differential-curated.ts");
      const firstDoNow = (curatedDifferentials.delirium?.doNow ?? [])[0];
      expect(firstDoNow, "delirium has a Do now step to edit").toBeTruthy();
      const source = readFileSync(overlayPath, "utf8");
      const needle = JSON.stringify(firstDoNow).slice(1, -1);
      expect(source).toContain(needle);
      writeFileSync(overlayPath, source.replace(needle, `EDITED-MID-WALK ${needle}`));

      expect(await show()).toContain("EDITED-MID-WALK");
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });
});
