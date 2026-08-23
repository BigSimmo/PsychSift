import { calculators } from "@/components/calculators/calculator-fixtures";
import { factsheets } from "@/components/factsheets/factsheets-data";
import { dictionaryEntries } from "@/lib/dictionary-data";
import { dsmDiagnoses } from "@/lib/dsm";
import { buildDefaultDifferentialRows } from "@/lib/differential-fixtures";
import { buildDefaultMedicationRows } from "@/lib/medication-fixtures";
import type { DifferentialRecordRow } from "@/lib/differential-records";
import type { MedicationRecordRow } from "@/lib/medication-records";
import { formulationMechanisms } from "@/lib/formulation";
import { buildDefaultFormRows, buildDefaultServiceRows } from "@/lib/registry-fixtures";
import {
  clinicalRegistryRowsToCorpusEntries,
  differentialRowsToCorpusEntries,
  medicationRowsToCorpusEntries,
} from "@/lib/registry-corpus";
import type { RegistryRecordRow } from "@/lib/registry-records";
import { createSiteContentRecord } from "@/lib/site-content/site-content-manifest";
import type { SiteContentRecord } from "@/lib/site-content/site-content-contracts";
import { therapyRecords } from "@/lib/therapies";
import { toolCatalogRecords } from "@/lib/tools-catalog";

import { registryEntriesToSiteContentRecords } from "./registry";
import { specifierSiteContentRecords } from "./specifiers";

type SiteContentAdapterDefinition = {
  producerKey: string;
  producerClass: SiteContentRecord["producerClass"];
  build: () => SiteContentRecord[];
};

function dsmRecords() {
  return dsmDiagnoses.map((diagnosis) =>
    createSiteContentRecord({
      logicalId: `dsm:${diagnosis.record_id}`,
      producerClass: "static_repository",
      domain: "dsm",
      route: `/dsm/diagnoses/${diagnosis.slug}`,
      title: diagnosis.title,
      body: `${diagnosis.title}. ICD code ${diagnosis.icd_code}. Category ${diagnosis.category.label}.`,
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: "unverified",
      sourceStatus: "unknown",
      publicationVersion: "dsm-clinical-content-export-v1",
      sourceLineage: [],
    }),
  );
}

function formulationRecords() {
  return formulationMechanisms.map((mechanism) =>
    createSiteContentRecord({
      logicalId: `formulation:${mechanism.id}`,
      producerClass: "static_repository",
      domain: "formulation",
      route: `/formulation/${mechanism.id}`,
      title: mechanism.name,
      body: `${mechanism.name}. ${mechanism.summary} ${mechanism.definition}`,
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: "unverified",
      sourceStatus: "review_due",
      publicationVersion: mechanism.version,
      sourceLineage: [],
    }),
  );
}

function therapyRecordsForManifest() {
  return therapyRecords.map((therapy) =>
    createSiteContentRecord({
      logicalId: `therapies:${therapy.slug}`,
      producerClass: "static_repository",
      domain: "therapies",
      route: `/therapy-compass/${therapy.slug}`,
      title: therapy.name,
      body: `${therapy.name}. ${therapy.category ?? "Therapy"}. ${therapy.clinicalSummary ?? "Description unavailable."}`,
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: therapy.reviewStatus === "reviewed" ? "locally_reviewed" : "unverified",
      sourceStatus: therapy.reviewStatus === "reviewed" ? "current" : "review_due",
      publicationVersion: `therapy-review-${therapy.reviewStatus}`,
      sourceLineage: [],
    }),
  );
}

function dictionaryRecords() {
  return dictionaryEntries.map((entry) =>
    createSiteContentRecord({
      logicalId: `dictionary:${entry.slug}`,
      producerClass: "static_repository",
      domain: "dictionary",
      route: `/dictionary/${entry.slug}`,
      title: entry.term,
      body: `${entry.term}. Reviewed exclusion: source governance includes an excluded source and clinical approval is pending.`,
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: "unverified",
      sourceStatus: "review_due",
      publicationVersion: entry.review.checkedOn,
      sourceLineage: [],
    }),
  );
}

function factsheetRecords() {
  return factsheets.map((sheet) =>
    createSiteContentRecord({
      logicalId: `factsheets:${sheet.slug}`,
      producerClass: "static_repository",
      domain: "factsheets",
      route: `/factsheets/${sheet.slug}`,
      title: sheet.title,
      body: `${sheet.title}. ${sheet.category}. Reviewed exclusion: source governance and clinician approval are incomplete.`,
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: "unverified",
      sourceStatus: "review_due",
      publicationVersion: sheet.reviewedOn,
      sourceLineage: [],
    }),
  );
}

function calculatorRecords() {
  return calculators.map((calculator) =>
    createSiteContentRecord({
      logicalId: `calculators:${calculator.id}`,
      producerClass: "static_repository",
      domain: "calculators",
      route: "/calculators",
      title: calculator.name,
      body: `${calculator.name}. ${calculator.summary} ${calculator.indication}`,
      sourceRole: "tool_reference",
      access: "public",
      validationStatus: "unverified",
      sourceStatus: "unknown",
      publicationVersion: "calculator-source-review-pending",
      sourceLineage: [],
    }),
  );
}

function toolRecords() {
  const eligibleIds = new Set(["differentials", "forms", "services"]);
  return toolCatalogRecords
    .filter((tool) => eligibleIds.has(tool.id))
    .map((tool) =>
      createSiteContentRecord({
        logicalId: `tools:${tool.id}`,
        producerClass: "static_repository",
        domain: "tools",
        route: tool.href,
        title: tool.title,
        body: `${tool.title}. ${tool.description} Best for: ${tool.bestFor}.`,
        sourceRole: "tool_reference",
        access: "public",
        validationStatus: "locally_reviewed",
        sourceStatus: "current",
        publicationVersion: "tools-catalog-v1",
        sourceLineage: [],
      }),
    )
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
}

const seedActor = "00000000-0000-4000-8000-000000000000";
const seedPublicationVersion = "repository-seed-v1";

function completeSeedRows<T extends { slug: string; kind?: string }>(rows: readonly T[]) {
  return rows.map((row) => ({
    ...row,
    id: `seed:${row.kind ?? "record"}:${row.slug}`,
    created_at: seedPublicationVersion,
    updated_at: seedPublicationVersion,
    last_reviewed_at: null,
    review_due_at: null,
  }));
}

function serviceSeedRecords() {
  return registryEntriesToSiteContentRecords(
    clinicalRegistryRowsToCorpusEntries(completeSeedRows(buildDefaultServiceRows(seedActor)) as RegistryRecordRow[]),
  );
}

function formSeedRecords() {
  return registryEntriesToSiteContentRecords(
    clinicalRegistryRowsToCorpusEntries(completeSeedRows(buildDefaultFormRows(seedActor)) as RegistryRecordRow[]),
  );
}

function medicationSeedRecords() {
  return registryEntriesToSiteContentRecords(
    medicationRowsToCorpusEntries(completeSeedRows(buildDefaultMedicationRows(seedActor)) as MedicationRecordRow[]),
  );
}

function differentialSeedRecords() {
  return registryEntriesToSiteContentRecords(
    differentialRowsToCorpusEntries(
      completeSeedRows(buildDefaultDifferentialRows(seedActor)) as DifferentialRecordRow[],
    ),
  );
}

export const siteContentAdapterDefinitions: readonly SiteContentAdapterDefinition[] = [
  { producerKey: "services", producerClass: "dynamic_registry", build: serviceSeedRecords },
  { producerKey: "forms", producerClass: "dynamic_registry", build: formSeedRecords },
  { producerKey: "medications", producerClass: "dynamic_registry", build: medicationSeedRecords },
  { producerKey: "differentials", producerClass: "dynamic_registry", build: differentialSeedRecords },
  { producerKey: "specifiers", producerClass: "static_repository", build: specifierSiteContentRecords },
  { producerKey: "dsm", producerClass: "static_repository", build: dsmRecords },
  { producerKey: "formulation", producerClass: "static_repository", build: formulationRecords },
  { producerKey: "therapies", producerClass: "static_repository", build: therapyRecordsForManifest },
  { producerKey: "dictionary", producerClass: "static_repository", build: dictionaryRecords },
  { producerKey: "factsheets", producerClass: "static_repository", build: factsheetRecords },
  { producerKey: "calculators", producerClass: "static_repository", build: calculatorRecords },
  { producerKey: "tools", producerClass: "static_repository", build: toolRecords },
];

export function buildStaticSiteContentRecords() {
  return siteContentAdapterDefinitions
    .filter((adapter) => adapter.producerClass === "static_repository")
    .flatMap((adapter) => adapter.build());
}

export function buildDynamicSiteContentSeedRecords() {
  return siteContentAdapterDefinitions
    .filter((adapter) => adapter.producerClass === "dynamic_registry")
    .flatMap((adapter) => adapter.build());
}

export function buildAllSiteContentRecords() {
  return [...buildStaticSiteContentRecords(), ...buildDynamicSiteContentSeedRecords()];
}

export { buildRegistryPublicReconciliationReport, registryEntriesToSiteContentRecords } from "./registry";
export { specifierSiteContentRecords } from "./specifiers";
