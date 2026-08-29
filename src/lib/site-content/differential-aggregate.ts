import "server-only";

import { buildDiagnosisTitleSlugMap, buildTermLinkMap } from "@/lib/differential-diagnosis-links";
import { cleanDifferentialItem, type DifferentialDetailContext } from "@/lib/differential-detail";
import { differentialSourceStatus, differentialValidationStatus } from "@/lib/differential-records";
import type {
  DifferentialPresentationWorkflow,
  DifferentialRecord,
  DifferentialSection,
} from "@/lib/differential-snapshot";

import type { PublicSiteContentPartition, PublicSiteContentRecord } from "./public-site-content";

type DifferentialPublication = PublicSiteContentRecord<Record<string, unknown>>;

type DifferentialReleaseCatalog = Readonly<{
  diagnoses: Map<string, DifferentialPublication & { payload: DifferentialRecord }>;
  presentations: Map<string, DifferentialPublication & { payload: DifferentialPresentationWorkflow }>;
}>;

export type DifferentialDiagnosisAggregate = Readonly<{
  record: DifferentialRecord;
  detailContext: DifferentialDetailContext;
  governance: Record<string, unknown>;
}>;

export type DifferentialPresentationAggregate = Readonly<{
  workflow: DifferentialPresentationWorkflow;
  candidates: Array<
    DifferentialPresentationWorkflow["candidates"][number] & {
      record: DifferentialRecord;
    }
  >;
  governance: Record<string, unknown>;
}>;

export type DifferentialReleaseSearchCatalog = Readonly<{
  diagnoses: DifferentialRecord[];
  presentations: DifferentialPresentationWorkflow[];
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDifferentialSection(value: unknown): value is DifferentialSection {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    isStringArray(value.items) &&
    ["fit", "warning", "question", "action", "test", "overlap"].includes(String(value.tone))
  );
}

function isDifferentialRecord(value: unknown): value is DifferentialRecord {
  if (!isObject(value) || !isObject(value.safetySnapshot)) return false;
  return (
    typeof value.slug === "string" &&
    typeof value.title === "string" &&
    ["emergent", "urgent", "routine"].includes(String(value.status)) &&
    typeof value.subtitle === "string" &&
    typeof value.clinicalHinge === "string" &&
    typeof value.safetySnapshot.summary === "string" &&
    isStringArray(value.safetySnapshot.tags) &&
    Array.isArray(value.sections) &&
    value.sections.every(isDifferentialSection) &&
    Array.isArray(value.related) &&
    value.related.every(
      (related) =>
        isObject(related) &&
        typeof related.id === "string" &&
        typeof related.label === "string" &&
        ["most-likely", "possible", "less-likely", "must-not-miss"].includes(String(related.likelihood)) &&
        typeof related.note === "string",
    ) &&
    isStringArray(value.currentPresentation) &&
    isStringArray(value.investigations) &&
    isStringArray(value.immediateActions)
  );
}

function isPresentationWorkflow(value: unknown): value is DifferentialPresentationWorkflow {
  if (!isObject(value) || !isObject(value.safetySnapshot) || !isObject(value.sourceStatus)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    ["emergent", "urgent", "routine"].includes(String(value.status)) &&
    typeof value.subtitle === "string" &&
    Number.isSafeInteger(value.selectedCount) &&
    Number.isSafeInteger(value.totalCount) &&
    typeof value.safetySnapshot.summary === "string" &&
    isStringArray(value.safetySnapshot.tags) &&
    Array.isArray(value.criteria) &&
    value.criteria.every(
      (criterion) =>
        isObject(criterion) &&
        typeof criterion.id === "string" &&
        typeof criterion.title === "string" &&
        ["fit", "warning", "question", "action", "test", "overlap"].includes(String(criterion.tone)),
    ) &&
    Array.isArray(value.candidates) &&
    value.candidates.every(
      (candidate) =>
        isObject(candidate) &&
        typeof candidate.slug === "string" &&
        typeof candidate.selected === "boolean" &&
        isObject(candidate.comparison) &&
        Object.values(candidate.comparison).every((item) => typeof item === "string"),
    ) &&
    isStringArray(value.reviewChecklist) &&
    typeof value.highestUrgencyNote === "string" &&
    typeof value.sourceStatus.label === "string" &&
    typeof value.sourceStatus.version === "string" &&
    typeof value.sourceStatus.lastUpdated === "string"
  );
}

function hasValidGovernance(publication: DifferentialPublication) {
  return (
    publication.governance.sourceStatus === "current" &&
    ["locally_reviewed", "approved"].includes(String(publication.governance.validationStatus))
  );
}

function releaseCatalog(
  partition: PublicSiteContentPartition<Record<string, unknown>>,
): DifferentialReleaseCatalog | null {
  const diagnoses = new Map<string, DifferentialPublication & { payload: DifferentialRecord }>();
  const presentations = new Map<string, DifferentialPublication & { payload: DifferentialPresentationWorkflow }>();
  for (const publication of partition.records) {
    if (publication.domain !== "differentials" || !hasValidGovernance(publication)) return null;
    if (publication.logical_id !== `differential:${publication.record_kind}:${publication.slug}`) return null;
    if (publication.record_kind === "diagnosis") {
      if (!isDifferentialRecord(publication.payload) || publication.payload.slug !== publication.slug) return null;
      if (diagnoses.has(publication.slug)) return null;
      diagnoses.set(publication.slug, publication as DifferentialPublication & { payload: DifferentialRecord });
      continue;
    }
    if (publication.record_kind === "presentation") {
      if (!isPresentationWorkflow(publication.payload) || publication.payload.id !== publication.slug) return null;
      if (presentations.has(publication.slug)) return null;
      presentations.set(
        publication.slug,
        publication as DifferentialPublication & { payload: DifferentialPresentationWorkflow },
      );
      continue;
    }
    return null;
  }
  return { diagnoses, presentations };
}

function detailSource(publication: DifferentialPublication): DifferentialDetailContext["source"] {
  const validationStatus = differentialValidationStatus(String(publication.governance.validationStatus));
  return {
    version: publication.publication_version,
    exportedAt: publication.publication_version,
    reviewStatus: validationStatus,
    sourceTitle: "Canonical public differential release",
    sourceStatus: differentialSourceStatus(String(publication.governance.sourceStatus)),
    validationStatus,
  };
}

export function buildDifferentialReleaseSearchCatalog(
  partition: PublicSiteContentPartition<Record<string, unknown>>,
): DifferentialReleaseSearchCatalog | null {
  const catalog = releaseCatalog(partition);
  if (!catalog) return null;

  if (partition.state === "current") {
    for (const diagnosis of catalog.diagnoses.values()) {
      if (diagnosis.payload.related.some((related) => !catalog.diagnoses.has(related.id))) return null;
    }
    for (const presentation of catalog.presentations.values()) {
      if (presentation.payload.candidates.some((candidate) => !catalog.diagnoses.has(candidate.slug))) return null;
    }
  }

  const diagnoses = new Map(catalog.diagnoses);
  if (partition.state === "updating") {
    let removedDependency = true;
    while (removedDependency) {
      removedDependency = false;
      for (const [slug, diagnosis] of diagnoses) {
        if (diagnosis.payload.related.some((related) => !diagnoses.has(related.id))) {
          diagnoses.delete(slug);
          removedDependency = true;
        }
      }
    }
  }
  const presentations = [...catalog.presentations.values()].filter((presentation) =>
    presentation.payload.candidates.every((candidate) => diagnoses.has(candidate.slug)),
  );

  return {
    diagnoses: [...diagnoses.values()].map((publication) => publication.payload),
    presentations: presentations.map((publication) => publication.payload),
  };
}

export function buildDifferentialDiagnosisAggregate(
  partition: PublicSiteContentPartition<Record<string, unknown>>,
  slug: string,
): DifferentialDiagnosisAggregate | null {
  const catalog = releaseCatalog(partition);
  const target = catalog?.diagnoses.get(slug);
  if (!catalog || !target) return null;

  const relatedSlugs = [...new Set(target.payload.related.map((related) => related.id))];
  if (relatedSlugs.some((relatedSlug) => !catalog.diagnoses.has(relatedSlug))) return null;
  const relatedMapDetails: DifferentialDetailContext["relatedMapDetails"] = {};
  for (const relatedSlug of relatedSlugs) {
    const related = catalog.diagnoses.get(relatedSlug)!.payload;
    relatedMapDetails[relatedSlug] = {
      slug: related.slug,
      title: related.title,
      status: related.status,
      clinicalHinge: related.clinicalHinge,
      safetySummary: related.safetySnapshot.summary,
    };
  }

  const diagnoses = [...catalog.diagnoses.values()].map((publication) => publication.payload);
  const routableSlugs = new Set(diagnoses.map((record) => record.slug));
  const termLinks = buildTermLinkMap(
    [...target.payload.safetySnapshot.tags, ...target.payload.sections.flatMap((section) => section.items)],
    {
      excludeSlug: target.payload.slug,
      titleMap: buildDiagnosisTitleSlugMap(diagnoses),
      routableSlugs,
    },
  );
  const overlapLinks: Record<string, string> = {};
  for (const section of target.payload.sections) {
    if (section.tone !== "overlap") continue;
    for (const item of section.items) {
      const cleaned = cleanDifferentialItem(item);
      if (termLinks[cleaned]) overlapLinks[cleaned] = termLinks[cleaned];
    }
  }
  const comparePresentation = [...catalog.presentations.values()]
    .map((publication) => publication.payload)
    .find((workflow) => workflow.candidates.some((candidate) => candidate.slug === target.payload.slug));

  return {
    record: target.payload,
    detailContext: {
      knownRelatedSlugs: relatedSlugs,
      relatedMapDetails,
      termLinks,
      overlapLinks,
      comparePresentation: comparePresentation
        ? { slug: comparePresentation.id, title: comparePresentation.title }
        : null,
      source: detailSource(target),
    },
    governance: target.governance,
  };
}

export function buildDifferentialPresentationAggregate(
  partition: PublicSiteContentPartition<Record<string, unknown>>,
  slug: string,
): DifferentialPresentationAggregate | null {
  const catalog = releaseCatalog(partition);
  const target = catalog?.presentations.get(slug);
  if (!catalog || !target) return null;
  const candidates = [] as DifferentialPresentationAggregate["candidates"];
  for (const candidate of target.payload.candidates) {
    const diagnosis = catalog.diagnoses.get(candidate.slug);
    if (!diagnosis) return null;
    candidates.push({ ...candidate, record: diagnosis.payload });
  }
  return { workflow: target.payload, candidates, governance: target.governance };
}
