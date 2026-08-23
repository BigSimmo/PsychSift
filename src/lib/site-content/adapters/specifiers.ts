import { loadSpecifiersContent, specifierCatalogItems } from "@/lib/specifiers-content";
import { createSiteContentRecord } from "@/lib/site-content/site-content-manifest";

export function specifierSiteContentRecords() {
  const content = loadSpecifiersContent();
  return specifierCatalogItems().map((item) =>
    createSiteContentRecord({
      logicalId: `specifiers:${item.review.rowKey}`,
      producerClass: "static_repository",
      domain: "specifiers",
      route: `/specifiers/${item.slug}`,
      title: item.label,
      body: `${item.label}. ${item.disorderName}. ${item.groupLabel}. ${item.categoryName}.`,
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: "unverified",
      sourceStatus: "review_due",
      publicationVersion: content.project.contentVersion,
      sourceLineage: [],
    }),
  );
}
