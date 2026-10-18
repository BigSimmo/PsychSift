import {
  isSpecifierClinicianReviewed,
  publicSpecifierRecords,
  type PublicSpecifierRecord,
  type SpecifierCatalogItem,
} from "@/lib/specifiers-content";
import type { SpecifierRecord } from "@/lib/specifiers";
import type { SiteContentRecord } from "@/lib/site-content/site-content-contracts";
import { siteContentProducerForMode } from "@/lib/site-content/site-content-registry";
import { createSiteContentRecord, siteContentValueHash } from "@/lib/site-content/site-content-manifest";

function curatedBody(record: SpecifierRecord) {
  return [
    record.summary,
    `Clinical signal: ${record.clinicalSignal}`,
    `Decision question: ${record.decisionQuestion}`,
    `Applies to: ${record.appliesTo.join(", ")}`,
    `Fit: ${record.fit.join(" ")}`,
    `Not fit: ${record.notFit.join(" ")}`,
    `Checks: ${record.checks.join(" ")}`,
    `Treatment lens: ${record.treatmentLens}`,
  ].join("\n");
}

function catalogueBody(item: SpecifierCatalogItem) {
  // Same fail-closed gate as catalogueValidation: unsigned or changed-since-review definitions
  // are not published as site content (owner ruling, 18 Oct 2026 00:10 AWST;
  // docs/decisions/2026-10-18-unsigned-clinical-text-withheld-from-site-content.md).
  const clinicianReviewed = !item.review.changedSinceReview && isSpecifierClinicianReviewed(item.review);
  return [
    `Disorder: ${item.disorderName}`,
    `Group: ${item.groupLabel}`,
    item.icd11Context && `Context: ${item.icd11Context}`,
    clinicianReviewed ? item.definition?.meaning : undefined,
    clinicianReviewed ? item.definition?.clinicalNote : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function catalogueValidation(item: SpecifierCatalogItem): SiteContentRecord["validationStatus"] {
  // The same fail-closed decision every specifier surface renders: status, named reviewer and
  // a parseable timestamp, and nothing changed since.
  return !item.review.changedSinceReview && isSpecifierClinicianReviewed(item.review)
    ? "locally_reviewed"
    : "unverified";
}

function catalogueSourceStatus(item: SpecifierCatalogItem): SiteContentRecord["sourceStatus"] {
  return item.review.sourceVerificationStatus === "source-verified" && !item.review.changedSinceReview
    ? "current"
    : "review_due";
}

function sourceHash(item: SpecifierCatalogItem) {
  return /^[0-9a-f]{64}$/i.test(item.review.contentHash)
    ? item.review.contentHash.toLowerCase()
    : siteContentValueHash(item);
}

export function specifierSiteContentRecord(source: PublicSpecifierRecord): SiteContentRecord {
  const producer = siteContentProducerForMode("specifiers");
  if (!producer) throw new Error("Specifiers site-content producer is not registered.");
  if (source.source === "curated") {
    return createSiteContentRecord({
      version: "site-content-record-v1",
      logicalId: `specifiers:${source.slug}`,
      producerClass: "static_repository",
      domain: "specifiers",
      route: producer.routeBuilder(source.slug),
      title: source.record.name,
      body: curatedBody(source.record),
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: "unverified",
      sourceStatus: "review_due",
      sourceLineage: [
        {
          sourceId: `repository:src/lib/specifiers.ts#${source.slug}`,
          sourceHash: siteContentValueHash(source.record),
          relationship: "derived_from",
        },
      ],
    });
  }
  return createSiteContentRecord({
    version: "site-content-record-v1",
    logicalId: `specifiers:${source.slug}`,
    producerClass: "static_repository",
    domain: "specifiers",
    route: producer.routeBuilder(source.slug),
    title: source.item.label,
    body: catalogueBody(source.item),
    sourceRole: "clinical_reference",
    access: "public",
    validationStatus: catalogueValidation(source.item),
    sourceStatus: catalogueSourceStatus(source.item),
    sourceLineage: [
      {
        sourceId: source.item.review.rowKey,
        sourceHash: sourceHash(source.item),
        relationship: "derived_from",
      },
    ],
  });
}

export function buildSpecifierSiteContentRecords(): SiteContentRecord[] {
  return publicSpecifierRecords().map(specifierSiteContentRecord);
}
