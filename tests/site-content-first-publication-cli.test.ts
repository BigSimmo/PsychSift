import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { formRecords } from "@/lib/forms";
import { defaultServiceRecords } from "@/lib/registry-fixtures";
import {
  buildFirstPublicationCataloguePlan,
  parseFirstPublicationCliArgs,
  runFirstPublicationCli,
  type ClinicalSignOffEntry,
  type SignOffPinCheck,
} from "../scripts/publish-site-content-first-catalogue";

const NAMED_REVIEWER = "Dr Jane Citizen";
const REVIEWED_AT = "2026-10-16T01:00:00.000Z";
const REVIEWED_SHA256 = "eb950d3c48dba095ef61d7b0645709d90316ed475b5eb6602b670e62e6e07ad1";

// A distinct digest per record, so the plan check below proves each record is matched to
// its own sign-off, not to one shared pin.
function fixtureDigest(kind: string, key: string): string {
  return createHash("sha256").update(`${kind}:${key}`).digest("hex");
}

const fixturePinCheck: SignOffPinCheck = (kind, review) =>
  review.reviewedContentSha256 === fixtureDigest(kind, String(kind === "form" ? review.code : review.id))
    ? "current"
    : "stale";

type RepositoryFormReview = ClinicalSignOffEntry & { code: string };

function repositoryFormReview(code: string): RepositoryFormReview {
  const document = JSON.parse(readFileSync("data/forms-content-review.json", "utf8")) as {
    forms: RepositoryFormReview[];
  };
  const review = document.forms.find((entry) => entry.code === code);
  if (!review) throw new Error(`No repository review for Form ${code}.`);
  return review;
}

function formCodeForRecord(form: (typeof formRecords)[number]): string {
  const payload = (form.catalogPayload ?? {}) as { form?: string };
  return String(payload.form ?? form.catalogueLabel ?? form.slug)
    .replace(/^Form\s+/i, "")
    .trim();
}

function signedServiceReviews(): ClinicalSignOffEntry[] {
  return defaultServiceRecords().map((service) => ({
    id: String(service.catalogPayload?.stableId ?? service.slug),
    slug: service.slug,
    status: "reviewed",
    reviewedBy: NAMED_REVIEWER,
    reviewedAt: REVIEWED_AT,
    reviewedContentSha256: fixtureDigest("service", String(service.catalogPayload?.stableId ?? service.slug)),
  }));
}

function signedFormReviews(): ClinicalSignOffEntry[] {
  return formRecords.map((form) => ({
    code: formCodeForRecord(form),
    slug: form.slug,
    status: "reviewed",
    reviewedBy: NAMED_REVIEWER,
    reviewedAt: REVIEWED_AT,
    reviewedContentSha256: fixtureDigest("form", formCodeForRecord(form)),
  }));
}

describe("publish-site-content-first-catalogue CLI (#HTZPQ8 / #ZPHK2F)", () => {
  it("accepts the 45 signed repository forms and refuses service sidecars while Indigenous or legacy records lack named sign-off", () => {
    // The 20 Oct 2026 clinical content audit edited eight signed forms and the 26 Oct 2026
    // re-audit edited Form 3B; all nine went back to drafted until the owner signs each one
    // again. The whole catalogue is refused until then, naming exactly those nine; the 45
    // still signed are accepted on their own.
    expect(() => buildFirstPublicationCataloguePlan({ kind: "form" })).toThrow(
      /First-publication plan refused: 9 record\(s\) lack a current clinical sign-off by a named person/,
    );
    const signedForms = formRecords.filter(
      (form) => repositoryFormReview(formCodeForRecord(form)).status === "reviewed",
    );
    const formPlan = buildFirstPublicationCataloguePlan({ kind: "form", forms: signedForms });
    expect(formPlan.counts.forms).toBe(45);
    expect(() => buildFirstPublicationCataloguePlan({ kind: "service" })).toThrow(
      /First-publication plan refused: \d+ record\(s\) lack a current clinical sign-off by a named person/,
    );
  });

  it.each([
    [
      "drafted status",
      {
        status: "drafted",
        reviewedBy: NAMED_REVIEWER,
        reviewedAt: REVIEWED_AT,
        reviewedContentSha256: REVIEWED_SHA256,
      },
    ],
    [
      "null reviewer",
      { status: "reviewed", reviewedBy: null, reviewedAt: REVIEWED_AT, reviewedContentSha256: REVIEWED_SHA256 },
    ],
    [
      "product attribution PsychSift",
      { status: "reviewed", reviewedBy: "PsychSift", reviewedAt: REVIEWED_AT, reviewedContentSha256: REVIEWED_SHA256 },
    ],
    [
      "role placeholder Clinician",
      { status: "reviewed", reviewedBy: "Clinician", reviewedAt: REVIEWED_AT, reviewedContentSha256: REVIEWED_SHA256 },
    ],
    [
      "invalid timestamp",
      {
        status: "reviewed",
        reviewedBy: NAMED_REVIEWER,
        reviewedAt: "2026-10-16",
        reviewedContentSha256: REVIEWED_SHA256,
      },
    ],
    [
      "missing content sha256",
      { status: "reviewed", reviewedBy: NAMED_REVIEWER, reviewedAt: REVIEWED_AT, reviewedContentSha256: null },
    ],
    [
      "malformed content sha256",
      {
        status: "reviewed",
        reviewedBy: NAMED_REVIEWER,
        reviewedAt: REVIEWED_AT,
        reviewedContentSha256: "not-a-sha256",
      },
    ],
  ])("refuses a batch when any record has %s", (_label, badOverride) => {
    const sampleForm = formRecords[0]!;
    const code = formCodeForRecord(sampleForm);
    expect(() =>
      buildFirstPublicationCataloguePlan({
        kind: "form",
        forms: [sampleForm],
        formReviews: [{ code, slug: sampleForm.slug, ...badOverride }],
      }),
    ).toThrow(/First-publication plan refused/);
  });

  it("refuses a form whose content changed after its sign-off, and accepts it while the pin is current", () => {
    // Form 3C, because Form 1A went back to drafted after the 20 Oct 2026 clinical content audit.
    const sampleForm = formRecords.find((form) => formCodeForRecord(form) === "3C")!;
    const signed = repositoryFormReview("3C");
    expect(signed.status).toBe("reviewed");

    const current = buildFirstPublicationCataloguePlan({ kind: "form", forms: [sampleForm], formReviews: [signed] });
    expect(current.counts.forms).toBe(1);

    // A well-formed digest that is not the one the signed content produces: the content no longer matches.
    const stalePin = createHash("sha256").update("edited after sign-off").digest("hex");
    expect(() =>
      buildFirstPublicationCataloguePlan({
        kind: "form",
        forms: [sampleForm],
        formReviews: [{ ...signed, reviewedContentSha256: stalePin }],
      }),
    ).toThrow(/content changed since sign-off/);
  });

  it("refuses a current sign-off that reaches a different form only through a slug alias", () => {
    // Form 3C, because Form 1A went back to drafted after the 20 Oct 2026 clinical content audit.
    const otherForm = formRecords.find((form) => formCodeForRecord(form) !== "3C")!;
    const signed = repositoryFormReview("3C");
    expect(() =>
      buildFirstPublicationCataloguePlan({
        kind: "form",
        forms: [otherForm],
        formReviews: [{ ...signed, slug: otherForm.slug }],
      }),
    ).toThrow(/its review names "3C", not this record/);
  });

  it("refuses a service sign-off when the curated records it pins were not loaded", () => {
    const sampleService = defaultServiceRecords()[0]!;
    const [review] = signedServiceReviews();
    expect(() =>
      buildFirstPublicationCataloguePlan({ kind: "service", services: [sampleService], serviceReviews: [review!] }),
    ).toThrow(/content pin could not be checked/);
  });

  it("builds a deterministic batched first-publication plan once all 222 services and 54 forms have named clinician sign-off", () => {
    const services222 = defaultServiceRecords().slice(0, 222);
    const planA = buildFirstPublicationCataloguePlan({
      kind: "all",
      batchSize: 100,
      services: services222,
      serviceReviews: signedServiceReviews(),
      formReviews: signedFormReviews(),
      pinState: fixturePinCheck,
    });
    const planB = buildFirstPublicationCataloguePlan({
      kind: "all",
      batchSize: 100,
      services: services222,
      serviceReviews: signedServiceReviews(),
      formReviews: signedFormReviews(),
      pinState: fixturePinCheck,
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

  it("parses CLI flags and refuses --execute without ALLOW_DESTRUCTIVE_SITE_CONTENT_INIT=true and live Supabase credentials", async () => {
    expect(parseFirstPublicationCliArgs(["--dry-run", "--kind", "service", "--batch-size", "50"])).toMatchObject({
      dryRun: true,
      execute: false,
      kind: "service",
      batchSize: 50,
    });

    await expect(runFirstPublicationCli(["--execute"], { NODE_ENV: "test" })).rejects.toThrow(
      /ALLOW_DESTRUCTIVE_SITE_CONTENT_INIT=true/,
    );

    await expect(
      runFirstPublicationCli(["--execute"], {
        NODE_ENV: "test",
        ALLOW_DESTRUCTIVE_SITE_CONTENT_INIT: "true",
      }),
    ).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);

    // With every safeguard satisfied, --execute still fails and says nothing was published,
    // because no live write path exists; it never returns a plan that reads like a publication.
    await expect(
      runFirstPublicationCli(["--execute"], {
        NODE_ENV: "test",
        ALLOW_DESTRUCTIVE_SITE_CONTENT_INIT: "true",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-key",
      }),
    ).rejects.toThrow(/not implemented.*nothing was published/);
  });
});
