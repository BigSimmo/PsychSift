import { describe, expect, it } from "vitest";

import { FACTSHEET_DEMO_NOTICE, factsheets } from "@/lib/factsheets-data";
import { buildStaticSiteContentRecords } from "@/lib/site-content/adapters";
import { buildStaticSiteContentManifest, siteContentValueHash } from "@/lib/site-content/site-content-manifest";
import { SITE_CONTENT_REGISTRY_VERSION } from "@/lib/site-content/site-content-registry";

describe("Factsheet short-summary context", () => {
  it("preserves demonstration-use context and content month without inventing clinician approval", () => {
    const records = buildStaticSiteContentRecords().filter((record) => record.domain === "factsheets");
    expect(records).toHaveLength(factsheets.length);
    for (const sheet of factsheets) {
      const record = records.find((entry) => entry.logicalId === `factsheets:${sheet.slug}`)!;
      expect(record.body).toContain(FACTSHEET_DEMO_NOTICE);
      expect(record.body).toContain(`Content month: ${sheet.reviewedOn}`);
      expect(record.body).not.toContain("Review date:");
      // Local correspondence review and currentness are distinct from clinician approval.
      expect(record.validationStatus).toBe("locally_reviewed");
      expect(record.sourceStatus).toBe("current");
      expect(record.sourceLineage).toContainEqual(
        expect.objectContaining({
          sourceId: "repository:src/lib/factsheets-data.ts:summary-context",
          sourceHash: siteContentValueHash({ notice: FACTSHEET_DEMO_NOTICE, dateMeaning: "content-month" }),
        }),
      );
    }
    const manifest = buildStaticSiteContentManifest(records, {
      gitSha: "b0edabf0b73a806535aa3289e5de8023cf39997f",
      registryVersion: SITE_CONTENT_REGISTRY_VERSION,
      generatedAt: "2026-10-17T00:00:00.000Z",
    });
    expect(manifest.records.every((entry) => entry.eligible)).toBe(true);
  });
});
