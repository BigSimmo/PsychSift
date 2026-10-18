import { readFileSync } from "node:fs";

import { calculators } from "@/lib/calculators/calculator-fixtures";
import { FACTSHEET_DEMO_NOTICE, factsheets } from "@/lib/factsheets-data";
import { THERAPY_CATALOGUE_ASSETS } from "@/data/therapy-catalogue-assets";
import type { Therapy } from "@/lib/therapy-compass-types";
import { dictionaryEntries, dictionarySource } from "@/lib/dictionary-data";
import { dsmDiagnoses } from "@/lib/dsm";
import type { DifferentialRecordRow } from "@/lib/differential-records";
import { formulationMechanisms, formulationSourceLibrary } from "@/lib/formulation";
import { publishedFormulationGuides } from "@/lib/formulation-concepts";
import type { MedicationRecordRow } from "@/lib/medication-records";
import {
  clinicalRegistryRowsToCorpusEntries,
  differentialRowsToCorpusEntries,
  medicationRowsToCorpusEntries,
  type RegistryCorpusEntry,
} from "@/lib/registry-corpus";
import type { RegistryRecordRow } from "@/lib/registry-records";
import type { SiteContentRecord } from "@/lib/site-content/site-content-contracts";
import { siteContentProducerForMode } from "@/lib/site-content/site-content-registry";
import {
  compareCanonicalSiteContentIdentifiers,
  createSiteContentRecord,
  siteContentValueHash,
} from "@/lib/site-content/site-content-manifest";
import { therapyNeedsReview } from "@/lib/therapies";
import { publicKnowledgeToolCatalogRecords } from "@/lib/tools-catalog";

import {
  adoptCanonicalRegistryProjection,
  buildRegistryReconciliationReport,
  type CanonicalPublicRegistrySnapshot,
  type CanonicalRegistrySiteContentProjection,
  type RegistryReconciliationCandidate,
} from "./registry";
import { buildSpecifierSiteContentRecords } from "./specifiers";

function staticProducer(modeId: Parameters<typeof siteContentProducerForMode>[0]) {
  const producer = siteContentProducerForMode(modeId);
  if (!producer || producer.producerClass !== "static_repository") {
    throw new Error(`Static site-content producer ${modeId} is not registered.`);
  }
  return producer;
}

function repositoryLineage(path: string, value: unknown): SiteContentRecord["sourceLineage"] {
  return [{ sourceId: `repository:${path}`, sourceHash: siteContentValueHash(value), relationship: "derived_from" }];
}

function buildDsmRecords() {
  const producer = staticProducer("dsm");
  return dsmDiagnoses.map((diagnosis) =>
    createSiteContentRecord({
      version: "site-content-record-v1",
      logicalId: `dsm:${diagnosis.slug}`,
      producerClass: "static_repository",
      domain: "dsm",
      route: producer.routeBuilder(diagnosis.slug),
      title: diagnosis.title,
      body: [
        `ICD code: ${diagnosis.icd_code}`,
        `Category: ${diagnosis.category.label}`,
        ...diagnosis.key_features.map((item) => `${item.label}: ${item.text}`),
        ...diagnosis.clinical_checkpoints.map((item) => `${item.label}: ${item.text}`),
        diagnosis.differentials.length ? `Differentials: ${diagnosis.differentials.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: "unverified",
      sourceStatus: "unknown",
      sourceLineage: repositoryLineage("src/data/dsm-clinical-content.json", diagnosis),
    }),
  );
}

function buildFormulationRecords() {
  const producer = staticProducer("formulation");
  const mechanisms = formulationMechanisms.map((mechanism) =>
    createSiteContentRecord({
      version: "site-content-record-v1",
      logicalId: `formulation:${mechanism.id}`,
      producerClass: "static_repository",
      domain: "formulation",
      route: producer.routeBuilder(mechanism.id),
      title: mechanism.name,
      body: [
        mechanism.definition,
        mechanism.summary,
        `Core process: ${mechanism.coreProcess}`,
        `Clinical clues: ${mechanism.clinicalClues.join("; ")}`,
        `Caveats: ${mechanism.caveats.join(" ")}`,
        `Formulation use: ${mechanism.formulationUse}`,
        `Treatment implications: ${mechanism.treatmentImplications.join("; ")}`,
      ].join("\n"),
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: "unverified",
      sourceStatus: "review_due",
      sourceLineage: [
        ...repositoryLineage("src/data/formulation-content.json", mechanism),
        ...mechanism.sources.flatMap((sourceId) => {
          const source = formulationSourceLibrary[sourceId];
          return source
            ? [
                {
                  sourceId: `reference:${source.id}`,
                  sourceHash: siteContentValueHash(source),
                  relationship: "references" as const,
                },
              ]
            : [];
        }),
      ],
    }),
  );
  // Published guide modules share the /formulation/[slug] route family. Without a
  // static site-content row and a search-index entry they have no inbound path.
  const guides = publishedFormulationGuides.map((guide) =>
    createSiteContentRecord({
      version: "site-content-record-v1",
      logicalId: `formulation:${guide.id}`,
      producerClass: "static_repository",
      domain: "formulation",
      route: producer.routeBuilder(guide.id),
      title: guide.title,
      body: [guide.summary, ...guide.searchTerms].filter(Boolean).join("\n"),
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: "unverified",
      sourceStatus: "review_due",
      sourceLineage: repositoryLineage("src/data/formulation-concepts.json", guide),
    }),
  );
  return [...mechanisms, ...guides];
}

function loadPublicFullTherapyRecords(): Therapy[] {
  const assetUrl = new URL(`../../../../public/therapy-compass-data/${THERAPY_CATALOGUE_ASSETS.full}`, import.meta.url);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(assetUrl, "utf8"));
  } catch {
    throw new Error(`Canonical public Therapy catalogue is unreadable: ${THERAPY_CATALOGUE_ASSETS.full}.`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`Canonical public Therapy catalogue is not an array: ${THERAPY_CATALOGUE_ASSETS.full}.`);
  }
  return value as Therapy[];
}

const fullTherapyRecords = loadPublicFullTherapyRecords();

export function therapySiteContentRecord(therapy: Therapy) {
  const producer = staticProducer("therapy-compass");
  const needsReview = therapyNeedsReview(therapy);
  return createSiteContentRecord({
    version: "site-content-record-v1",
    logicalId: `therapies:${therapy.slug}`,
    producerClass: "static_repository",
    domain: "therapies",
    route: producer.routeBuilder(therapy.slug),
    title: therapy.name,
    // Owner ruling 18 Oct 2026 00:10 AWST: unsigned therapy text is not used as
    // answer evidence or site content. A record awaiting review is indexed by
    // name and category only, matching the Clinical Ask catalogue evidence gate.
    // See docs/decisions/2026-10-18-unsigned-clinical-text-withheld-from-site-content.md.
    body: (needsReview
      ? [therapy.category && `Category: ${therapy.category}`]
      : [
          therapy.category && `Category: ${therapy.category}`,
          therapy.clinicalSummary,
          therapy.bestUsedFor && `Best used for: ${therapy.bestUsedFor}`,
          therapy.targetSymptoms && `Targets: ${therapy.targetSymptoms}`,
          therapy.indications && `Indications: ${therapy.indications}`,
          therapy.contraindicationsOrCautions &&
            `Contraindications and cautions: ${therapy.contraindicationsOrCautions}`,
          therapy.patientPopulation && `Patient population: ${therapy.patientPopulation}`,
          therapy.setting && `Setting: ${therapy.setting}`,
          therapy.deliverySteps && `Delivery: ${therapy.deliverySteps}`,
          therapy.patientExplanation && `Patient explanation: ${therapy.patientExplanation}`,
          therapy.mechanism && `Mechanism: ${therapy.mechanism}`,
          therapy.evidenceLevel && `Evidence level: ${therapy.evidenceLevel}`,
          therapy.evidenceNotes && `Evidence notes: ${therapy.evidenceNotes}`,
          therapy.limitations && `Limitations: ${therapy.limitations}`,
          therapy.warnings.length > 0 && `Warnings: ${therapy.warnings.join("; ")}`,
        ]
    )
      .filter(Boolean)
      .join("\n"),
    sourceRole: "clinical_reference",
    access: "public",
    validationStatus: needsReview ? "unverified" : "locally_reviewed",
    sourceStatus: needsReview ? "review_due" : "current",
    sourceLineage: repositoryLineage(`public/therapy-compass-data/${THERAPY_CATALOGUE_ASSETS.full}`, therapy),
  });
}

function buildTherapyRecords() {
  return fullTherapyRecords.map(therapySiteContentRecord);
}

function buildDictionaryRecords() {
  const producer = staticProducer("dictionary");
  return dictionaryEntries.map((entry) =>
    createSiteContentRecord({
      version: "site-content-record-v1",
      logicalId: `dictionary:${entry.slug}`,
      producerClass: "static_repository",
      domain: "dictionary",
      route: producer.routeBuilder(entry.slug),
      title: entry.term,
      body: [
        entry.definition,
        entry.meaning,
        ...entry.context,
        `Purpose: ${entry.comparison.purpose}`,
        `Clinical context: ${entry.comparison.clinicalContext}`,
      ].join("\n"),
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: entry.review.clinicalApproval === "pending" ? "unverified" : "locally_reviewed",
      sourceStatus: entry.review.status === "source-linked" ? "current" : "review_due",
      sourceLineage: [
        ...repositoryLineage("src/lib/dictionary-data.ts", entry),
        ...entry.sourceRefs.flatMap((reference) => {
          const source = dictionarySource(reference.sourceId);
          return source
            ? [
                {
                  sourceId: `reference:${source.id}`,
                  sourceHash: siteContentValueHash(source),
                  relationship: "references" as const,
                },
              ]
            : [];
        }),
      ],
    }),
  );
}

function buildFactsheetRecords() {
  const producer = staticProducer("factsheets");
  return factsheets.map((sheet) =>
    createSiteContentRecord({
      version: "site-content-record-v1",
      logicalId: `factsheets:${sheet.slug}`,
      producerClass: "static_repository",
      domain: "factsheets",
      route: producer.routeBuilder(sheet.slug),
      title: sheet.title,
      body: [
        sheet.brand,
        `Audience: ${sheet.audience}`,
        sheet.summary,
        FACTSHEET_DEMO_NOTICE,
        `Content month: ${sheet.reviewedOn}`,
      ]
        .filter(Boolean)
        .join("\n"),
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: "locally_reviewed",
      sourceStatus: "current",
      sourceLineage: [
        ...repositoryLineage("src/components/factsheets/factsheets-data.ts", sheet),
        ...repositoryLineage("src/lib/factsheets-data.ts:summary-context", {
          notice: FACTSHEET_DEMO_NOTICE,
          dateMeaning: "content-month",
        }),
        ...sheet.sources.map((source) => ({
          sourceId: `reference:${source.org}:${source.n}`,
          sourceHash: siteContentValueHash(source),
          relationship: "references" as const,
        })),
      ],
    }),
  );
}

function buildCalculatorRecords() {
  const producer = staticProducer("calculators");
  return calculators.map((calculator) => {
    const descriptiveMetadata = {
      id: calculator.id,
      abbrev: calculator.abbrev,
      name: calculator.name,
      domain: calculator.domain,
      indication: calculator.indication,
      timeEstimate: calculator.timeEstimate,
      source: calculator.source,
      caution: calculator.caution ?? null,
    };
    return createSiteContentRecord({
      version: "site-content-record-v1",
      logicalId: `calculators:${calculator.id}`,
      producerClass: "static_repository",
      domain: "calculators",
      route: producer.routeBuilder(calculator.id),
      title: `${calculator.abbrev} — ${calculator.name}`,
      body: [
        calculator.indication,
        `Domain: ${calculator.domain}`,
        `Completion time: ${calculator.timeEstimate}`,
        `Source: ${calculator.source}`,
        calculator.caution,
      ]
        .filter(Boolean)
        .join("\n"),
      sourceRole: "tool_reference",
      access: "public",
      validationStatus: "locally_reviewed",
      sourceStatus: "current",
      sourceLineage: repositoryLineage("src/components/calculators/calculator-fixtures.ts", descriptiveMetadata),
    });
  });
}

function buildToolRecords() {
  const producer = staticProducer("tools");
  return publicKnowledgeToolCatalogRecords.map((tool) =>
    createSiteContentRecord({
      version: "site-content-record-v1",
      logicalId: `tools:${tool.id}`,
      producerClass: "static_repository",
      domain: "tools",
      route: producer.routeBuilder(tool.id),
      title: tool.title,
      body: [
        tool.description,
        `Best for: ${tool.bestFor}`,
        tool.detail,
        `Check first: ${tool.checkFirst.join("; ")}`,
        `Needed input: ${tool.neededInput.join("; ")}`,
        `Output: ${tool.output}`,
      ].join("\n"),
      sourceRole: "tool_reference",
      access: "public",
      validationStatus: tool.sourceBacked ? "locally_reviewed" : "unverified",
      sourceStatus: tool.status === "review_due" ? "review_due" : tool.sourceBacked ? "current" : "unknown",
      sourceLineage: repositoryLineage("src/lib/tools-catalog.ts", tool),
    }),
  );
}

export type DynamicSiteContentRows = {
  clinicalRegistryRows: readonly RegistryRecordRow[];
  medicationRows: readonly MedicationRecordRow[];
  differentialRows: readonly DifferentialRecordRow[];
};

export type DynamicSiteContentReconciliation = Omit<RegistryReconciliationCandidate, "entry" | "logicalId"> & {
  kind: RegistryCorpusEntry["kind"];
  recordId: string;
};

/** The logical identity a persisted registry row publishes under. Exported so a read-only
 *  reconciliation report derives it from here rather than reimplementing the rule. */
export function dynamicLogicalId(entry: RegistryCorpusEntry) {
  if (entry.kind === "differential") return `differentials:${entry.subkind}:${entry.slug}`;
  const domain = entry.kind === "medication" ? "medications" : `${entry.kind}s`;
  return `${domain}:${entry.slug}`;
}

export function buildDynamicSiteContentProjections(
  rows: DynamicSiteContentRows,
  reconciliation: readonly DynamicSiteContentReconciliation[],
  trustedPublicSnapshots: readonly CanonicalPublicRegistrySnapshot[],
): CanonicalRegistrySiteContentProjection[] {
  const entries = [
    ...clinicalRegistryRowsToCorpusEntries(rows.clinicalRegistryRows),
    ...medicationRowsToCorpusEntries(rows.medicationRows),
    ...differentialRowsToCorpusEntries(rows.differentialRows),
  ];
  const entryKey = (kind: RegistryCorpusEntry["kind"], recordId: string) => `${kind}\u0000${recordId}`;
  const entriesById = new Map<string, RegistryCorpusEntry>();
  for (const entry of entries) {
    const key = entryKey(entry.kind, entry.recordId);
    if (entriesById.has(key)) {
      throw new Error(`Duplicate persisted dynamic entry ID for ${entry.kind} row ${entry.recordId}.`);
    }
    entriesById.set(key, entry);
  }
  const decisionsById = new Map<string, DynamicSiteContentReconciliation>();
  for (const decision of reconciliation) {
    const key = entryKey(decision.kind, decision.recordId);
    if (decisionsById.has(key)) {
      throw new Error(`Duplicate reconciliation decision for persisted ${decision.kind} row ${decision.recordId}.`);
    }
    if (!entriesById.has(key)) {
      throw new Error(
        `Reconciliation decision does not match a persisted entry: ${decision.kind}/${decision.recordId}.`,
      );
    }
    decisionsById.set(key, decision);
  }
  if (entriesById.size !== decisionsById.size) {
    throw new Error("A reconciliation decision is required for every persisted dynamic entry.");
  }
  const candidates = entries.map((entry) => {
    const decision = decisionsById.get(entryKey(entry.kind, entry.recordId))!;
    const { kind: _kind, recordId: _recordId, ...identity } = decision;
    void _kind;
    void _recordId;
    return {
      ...identity,
      entry,
      logicalId: dynamicLogicalId(entry),
    } satisfies RegistryReconciliationCandidate;
  });
  buildRegistryReconciliationReport(candidates, trustedPublicSnapshots);
  const byLogicalId = new Map<string, RegistryReconciliationCandidate[]>();
  for (const candidate of candidates) {
    const group = byLogicalId.get(candidate.logicalId) ?? [];
    group.push(candidate);
    byLogicalId.set(candidate.logicalId, group);
  }
  return [...byLogicalId.entries()]
    .sort(([left], [right]) => compareCanonicalSiteContentIdentifiers(left, right))
    .map(([logicalId, group]) => {
      const trustedPublicSnapshot = trustedPublicSnapshots.find((snapshot) => snapshot.logicalId === logicalId);
      if (!trustedPublicSnapshot) {
        throw new Error(`Trusted canonical-public snapshot evidence is required for ${logicalId}.`);
      }
      return adoptCanonicalRegistryProjection(group, trustedPublicSnapshot);
    });
}

export function buildStaticSiteContentRecords(): SiteContentRecord[] {
  return [
    ...buildSpecifierSiteContentRecords(),
    ...buildDsmRecords(),
    ...buildFormulationRecords(),
    ...buildTherapyRecords(),
    ...buildDictionaryRecords(),
    ...buildFactsheetRecords(),
    ...buildCalculatorRecords(),
    ...buildToolRecords(),
  ];
}

export const staticSiteContentRecords = buildStaticSiteContentRecords();
export const allSiteContentRecords = [...staticSiteContentRecords];

export { buildSpecifierSiteContentRecords } from "./specifiers";
export * from "./registry";
