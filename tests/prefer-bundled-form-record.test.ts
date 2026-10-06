import { describe, expect, it, vi } from "vitest";

import { FORMS_AWAITING_REVIEW_NOTE, loadFormCatalogDetails } from "@/lib/form-catalog";
import { formRecords } from "@/lib/forms";
import { preferBundledFormRecord, siteContentSnapshotReleaseId } from "@/lib/site-content/prefer-bundled-form-record";
import type { ServiceRecord } from "@/lib/services";

const RETAINED_BOOTSTRAP_RELEASE_ID = "ddc94ecf-3527-5b4d-846b-af5724b428ca";
const PUBLISHED_RELEASE_ID = "aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee";

describe("preferBundledFormRecord", () => {
  it("replaces a stale canonical form projection while the active release is retained bootstrap", () => {
    const bundled = formRecords[0];
    expect(bundled).toBeTruthy();
    const stale = {
      ...bundled,
      subtitle: "STALE PURPOSE THAT MUST NOT SURFACE",
      verification: {
        ...bundled.verification,
        notes: ["stale note without the awaiting-review caveat"],
      },
      catalogPayload: {
        ...(bundled.catalogPayload as Record<string, unknown>),
        contentReviewStatus: "reviewed",
        purpose: "STALE PURPOSE THAT MUST NOT SURFACE",
      },
    } as ServiceRecord;

    const synced = preferBundledFormRecord(
      "form",
      {
        record: stale,
        governance: { sourceStatus: "current", validationStatus: "locally_reviewed" },
      },
      { activeReleaseId: RETAINED_BOOTSTRAP_RELEASE_ID },
    );

    expect(synced.record).toEqual(bundled);
    expect(synced.record.subtitle).not.toBe("STALE PURPOSE THAT MUST NOT SURFACE");
    expect((synced.record.catalogPayload as { contentReviewStatus?: string }).contentReviewStatus).toBe(
      (bundled.catalogPayload as { contentReviewStatus?: string }).contentReviewStatus,
    );
    // `sourceStatus` describes the approved form on the OCP register, which the handover
    // re-verified rather than changed, so it stays canonical.
    expect(synced.governance?.sourceStatus).toBe("current");
  });

  it("leaves a newer published form projection alone after durable cutover", () => {
    const bundled = formRecords[0]!;
    const published = {
      ...bundled,
      subtitle: "PUBLISHED CLINICIAN-REVIEWED PURPOSE",
      catalogPayload: {
        ...(bundled.catalogPayload as Record<string, unknown>),
        contentReviewStatus: "reviewed",
        purpose: "PUBLISHED CLINICIAN-REVIEWED PURPOSE",
      },
    } as ServiceRecord;

    const synced = preferBundledFormRecord(
      "form",
      { record: published, governance: { sourceStatus: "current", validationStatus: "locally_reviewed" } },
      { activeReleaseId: PUBLISHED_RELEASE_ID },
    );

    expect(synced.record).toBe(published);
    expect(synced.record.subtitle).toBe("PUBLISHED CLINICIAN-REVIEWED PURPOSE");
    expect(synced.governance?.validationStatus).toBe("locally_reviewed");
  });

  it("does not prefer the bundle when no active release id is supplied", () => {
    const bundled = formRecords[0]!;
    const stale = { ...bundled, subtitle: "stale" } as ServiceRecord;
    const synced = preferBundledFormRecord("form", { record: stale });
    expect(synced.record).toBe(stale);
  });

  /**
   * The canonical governance describes the release payload this helper has just thrown
   * away. Carrying its sign-off across onto drafted guidance would put an `approved` or
   * `locally_reviewed` badge on text nobody has signed off, which is the one thing the
   * awaiting-review caveat exists to prevent.
   */
  it("narrows a release sign-off to unverified when the bundled form still awaits review", async () => {
    // Every shipped form is signed off, so the drafted branch cannot be reached from the
    // catalogue. The helper re-reads the bundled record, so stand one in.
    const base = formRecords[0]!;
    const drafted = {
      ...base,
      verification: {
        ...base.verification,
        notes: [...new Set([...(base.verification?.notes ?? []), FORMS_AWAITING_REVIEW_NOTE])],
      },
    } as ServiceRecord;

    vi.resetModules();
    vi.doMock("@/lib/forms", () => ({ getFormRecord: () => drafted, formRecords: [drafted] }));
    const { preferBundledFormRecord: scoped } = await import("@/lib/site-content/prefer-bundled-form-record");

    for (const claimed of ["approved", "locally_reviewed", "unverified"]) {
      const synced = scoped(
        "form",
        {
          record: { ...drafted, subtitle: "stale" },
          governance: { sourceStatus: "current", validationStatus: claimed },
        },
        { activeReleaseId: RETAINED_BOOTSTRAP_RELEASE_ID },
      );
      expect(synced.governance?.validationStatus, claimed).toBe("unverified");
      expect(synced.governance?.sourceStatus, claimed).toBe("current");
    }

    vi.doUnmock("@/lib/forms");
    vi.resetModules();
  });

  it("leaves a signed-off release claim alone once the bundled form is reviewed", () => {
    const bundled = formRecords.find((row) => !(row.verification?.notes ?? []).includes(FORMS_AWAITING_REVIEW_NOTE));
    expect(bundled, "expected a reviewed form in the bundled catalogue").toBeTruthy();

    const synced = preferBundledFormRecord(
      "form",
      {
        record: { ...bundled!, subtitle: "stale" },
        governance: { sourceStatus: "current", validationStatus: "locally_reviewed" },
      },
      { activeReleaseId: RETAINED_BOOTSTRAP_RELEASE_ID },
    );

    // The swap itself never downgrades; only an unreviewed payload does.
    expect(synced.record).toEqual(bundled);
    expect(synced.governance?.validationStatus).toBe("locally_reviewed");
  });

  it("does not invent governance for a caller that passes none", () => {
    const bundled = formRecords[0]!;
    const synced = preferBundledFormRecord(
      "form",
      { record: { ...bundled, subtitle: "stale" } },
      { activeReleaseId: RETAINED_BOOTSTRAP_RELEASE_ID },
    );
    expect(synced).not.toHaveProperty("governance");
  });

  it("leaves non-form kinds untouched", () => {
    const record = { slug: "svc", title: "Service" } as ServiceRecord;
    const mapped = { record, extra: 1 };
    expect(preferBundledFormRecord("service", mapped, { activeReleaseId: RETAINED_BOOTSTRAP_RELEASE_ID })).toBe(mapped);
  });

  it("keeps every drafted form's awaiting-review caveat in the bundled population the API prefers", () => {
    const drafted = loadFormCatalogDetails().filter((row) => row.contentReviewStatus === "drafted");
    // Measured 2026-10-06: every form is signed off. A later drafted form still has to
    // carry the caveat, which is what the loop below checks.
    expect(drafted).toEqual([]);
    for (const details of drafted) {
      const resolved =
        formRecords.find((row) => (row.catalogPayload as { form?: string } | undefined)?.form === details.form) ?? null;
      expect(resolved, details.form).toBeTruthy();
      expect(resolved!.verification?.notes ?? []).toContain(FORMS_AWAITING_REVIEW_NOTE);
      const synced = preferBundledFormRecord(
        "form",
        { record: { ...resolved!, subtitle: "stale" } },
        { activeReleaseId: RETAINED_BOOTSTRAP_RELEASE_ID },
      );
      expect(synced.record.verification?.notes ?? []).toContain(FORMS_AWAITING_REVIEW_NOTE);
    }
  });

  it("reads releaseId from a public-records snapshot object", () => {
    expect(siteContentSnapshotReleaseId({ releaseId: RETAINED_BOOTSTRAP_RELEASE_ID })).toBe(
      RETAINED_BOOTSTRAP_RELEASE_ID,
    );
    expect(siteContentSnapshotReleaseId(null)).toBeNull();
    expect(siteContentSnapshotReleaseId({ state: "current" })).toBeNull();
  });
});
