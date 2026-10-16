import { describe, expect, it } from "vitest";

import { formRecords } from "@/lib/forms";
import { defaultServiceRecords } from "@/lib/registry-fixtures";
import {
  buildFirstPublicationCataloguePlan,
  parseFirstPublicationCliArgs,
  runFirstPublicationCli,
  type ClinicalSignOffEntry,
} from "../scripts/publish-site-content-first-catalogue";

const NAMED_REVIEWER = "Dr Jane Citizen";
const REVIEWED_AT = "2026-10-16T01:00:00.000Z";

function formCodeForRecord(form: (typeof formRecords)[number]): string {
  const payload = (form.catalogPayload ?? {}) as { form?: string };
  return String(payload.form ?? form.catalogueLabel ?? form.slug)
    .replace(/^Form\s+/i, "")
    .trim();
}

/** A made-up content pin for fixtures only; the real sign-off sidecars carry their own. */
const SYNTHETIC_CONTENT_PIN = "a".repeat(64);

function signedServiceReviews(): ClinicalSignOffEntry[] {
  return defaultServiceRecords().map((service) => ({
    id: String(service.catalogPayload?.stableId ?? service.slug),
    slug: service.slug,
    status: "reviewed",
    reviewedBy: NAMED_REVIEWER,
    reviewedAt: REVIEWED_AT,
    reviewedContentSha256: SYNTHETIC_CONTENT_PIN,
  }));
}

function signedFormReviews(): ClinicalSignOffEntry[] {
  return formRecords.map((form) => ({
    code: formCodeForRecord(form),
    slug: form.slug,
    status: "reviewed",
    reviewedBy: NAMED_REVIEWER,
    reviewedAt: REVIEWED_AT,
    reviewedContentSha256: SYNTHETIC_CONTENT_PIN,
  }));
}

describe("publish-site-content-first-catalogue CLI (#HTZPQ8 / #ZPHK2F)", () => {
  it("accepts the 54 signed repository forms and refuses service sidecars while Indigenous or legacy records lack named sign-off", () => {
    const formPlan = buildFirstPublicationCataloguePlan({ kind: "form" });
    expect(formPlan.counts.forms).toBe(54);
    expect(() => buildFirstPublicationCataloguePlan({ kind: "service" })).toThrow(
      /First-publication plan refused: \d+ record\(s\) lack clinical sign-off by a named person/,
    );
  });

  it.each([
    ["drafted status", { status: "drafted", reviewedBy: NAMED_REVIEWER, reviewedAt: REVIEWED_AT }],
    ["null reviewer", { status: "reviewed", reviewedBy: null, reviewedAt: REVIEWED_AT }],
    ["product attribution PsychSift", { status: "reviewed", reviewedBy: "PsychSift", reviewedAt: REVIEWED_AT }],
    ["role placeholder Clinician", { status: "reviewed", reviewedBy: "Clinician", reviewedAt: REVIEWED_AT }],
    ["invalid timestamp", { status: "reviewed", reviewedBy: NAMED_REVIEWER, reviewedAt: "2026-10-16" }],
  ])("refuses a batch when any record has %s", (_label, badOverride) => {
    const sampleForm = formRecords[0]!;
    const code = formCodeForRecord(sampleForm);
    expect(() =>
      buildFirstPublicationCataloguePlan({
        kind: "form",
        forms: [sampleForm],
        formReviews: [{ code, slug: sampleForm.slug, reviewedContentSha256: SYNTHETIC_CONTENT_PIN, ...badOverride }],
      }),
    ).toThrow(/First-publication plan refused/);
  });

  it("refuses a sign-off with no valid content pin", () => {
    const sampleForm = formRecords[0]!;
    const review = {
      code: formCodeForRecord(sampleForm),
      slug: sampleForm.slug,
      status: "reviewed" as const,
      reviewedBy: NAMED_REVIEWER,
      reviewedAt: REVIEWED_AT,
    };
    for (const reviewedContentSha256 of [undefined, "", "not-a-hash"]) {
      expect(() =>
        buildFirstPublicationCataloguePlan({
          kind: "form",
          forms: [sampleForm],
          formReviews: [{ ...review, reviewedContentSha256 }],
        }),
      ).toThrow(/content pin/);
    }
  });

  it("builds a deterministic batched first-publication plan once all 222 services and 54 forms have named clinician sign-off", () => {
    const services222 = defaultServiceRecords().slice(0, 222);
    const planA = buildFirstPublicationCataloguePlan({
      kind: "all",
      batchSize: 100,
      services: services222,
      serviceReviews: signedServiceReviews(),
      formReviews: signedFormReviews(),
    });
    const planB = buildFirstPublicationCataloguePlan({
      kind: "all",
      batchSize: 100,
      services: services222,
      serviceReviews: signedServiceReviews(),
      formReviews: signedFormReviews(),
    });

    expect(planA.version).toBe("site-content-first-publication-plan-v1");
    expect(planA.counts).toEqual({
      services: 222,
      forms: 54,
      total: 276,
    });
    expect(planA.expectedRecordCount).toBe(276);
    expect(planA.batchSize).toBe(100);
    expect(planA.batchCount).toBe(3);
    expect(planA.batches.map((batch) => batch.records.length)).toEqual([100, 100, 76]);
    expect(planA.trustedSnapshotDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(planA.planDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(planA.planDigest).toBe(planB.planDigest);

    for (const batch of planA.batches) {
      for (const item of batch.records) {
        expect(item.record.producerClass).toBe("dynamic_registry");
        expect(item.record.validationStatus).toBe("locally_reviewed");
        expect(item.metadata.corpus_scope).toBe("clinical_kb_site");
      }
    }
  });

  it("parses CLI flags and refuses --execute without ALLOW_DESTRUCTIVE_SITE_CONTENT_INIT=true", async () => {
    expect(parseFirstPublicationCliArgs(["--dry-run", "--kind", "service", "--batch-size", "50"])).toMatchObject({
      dryRun: true,
      execute: false,
      kind: "service",
      batchSize: 50,
    });

    await expect(runFirstPublicationCli(["--execute"], {} as NodeJS.ProcessEnv)).rejects.toThrow(
      /ALLOW_DESTRUCTIVE_SITE_CONTENT_INIT=true/,
    );
  });
});
