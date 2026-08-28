import { describe, expect, it } from "vitest";

import {
  buildStaticSiteContentDomainEvidence,
  type StaticSiteContentManifest,
} from "@/lib/site-content/site-content-manifest";

type ManifestRecord = StaticSiteContentManifest["records"][number];

function record(
  logicalId: string,
  domain: ManifestRecord["domain"],
  sourceStatus: ManifestRecord["sourceStatus"],
  validationStatus: ManifestRecord["validationStatus"],
): ManifestRecord {
  return {
    logicalId,
    domain,
    route: `/${logicalId}`,
    contentHash: `sha256:${"1".repeat(64)}`,
    lineageDigest: `sha256:${"2".repeat(64)}`,
    validationStatus,
    sourceStatus,
    eligible: false,
    exclusionReason: "test_fixture",
  };
}

describe("static site-content domain evidence", () => {
  it("aggregates every eligible static producer without promoting weaker review evidence", () => {
    const manifest: StaticSiteContentManifest = {
      version: "clinical-kb-site-static-manifest-v1",
      gitSha: "4".repeat(40),
      registryVersion: "site-content-registry-v1",
      generatedAt: "2026-08-28T00:00:00.000Z",
      records: [
        record("dsm:reviewed", "dsm", "current", "approved"),
        record("dsm:unreviewed", "dsm", "unknown", "unverified"),
        record("formulation:reviewed", "formulation", "review_due", "locally_reviewed"),
        record("therapies:reviewed", "therapies", "outdated", "approved"),
        record("tools:reviewed", "tools", "current", "locally_reviewed"),
      ],
      staticManifestDigest: `sha256:${"3".repeat(64)}`,
    };

    expect(buildStaticSiteContentDomainEvidence(manifest)).toEqual([
      {
        domain: "dsm",
        recordCount: 2,
        reviewState: "unreviewed",
        sourceStatus: "unknown",
        validationStatus: "unverified",
      },
      {
        domain: "formulation",
        recordCount: 1,
        reviewState: "reviewed",
        sourceStatus: "review_due",
        validationStatus: "locally_reviewed",
      },
      {
        domain: "therapies",
        recordCount: 1,
        reviewState: "reviewed",
        sourceStatus: "outdated",
        validationStatus: "approved",
      },
      {
        domain: "tools",
        recordCount: 1,
        reviewState: "reviewed",
        sourceStatus: "current",
        validationStatus: "locally_reviewed",
      },
    ]);
  });
});
