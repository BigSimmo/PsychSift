import "server-only";

import { createHash } from "node:crypto";

import formsPdfManifest from "../../../data/forms-pdf-manifest.json";
import formsSnapshot from "../../../data/forms-page-snapshot.json";
import dsmClinicalContent from "../../data/dsm-clinical-content.json";
import therapiesSource from "../../data/therapies-source.json";
import { calculatorEvidence, type CalculatorEvidenceSource } from "@/lib/calculators/calculator-evidence";
import { allCalculatorFixtures } from "@/lib/calculators/calculator-fixtures";
import { factsheets, type FactsheetSource, type FactsheetTranslatedResource } from "@/lib/factsheets-data";
import {
  dictionaryComparisonPairs,
  dictionaryEntries,
  dictionarySources,
  type DictionarySourceRef,
} from "@/lib/dictionary-data";
import {
  formulationMechanisms,
  formulationSourceLibrary,
  type FormulationMechanism,
  type FormulationSource,
} from "@/lib/formulation";
import { linkableEvidence, publishedFormulationConcepts, publishedFormulationGuides } from "@/lib/formulation-concepts";
import { officialFormsRegisterUrl } from "@/lib/form-catalog";
import { normalizeCode, officialForms } from "@/lib/form-register";
import { loadMedicationSnapshot } from "@/lib/medication-snapshot";
import { medicationSourceLinkReferences } from "@/lib/medication-source-links";
import { mhaActMetadata } from "@/lib/mha-act-sections";
import { loadServicesSnapshot } from "@/lib/service-catalog";
import { authoritativeSources, loadSpecifiersContent, type AuthoritativeSource } from "@/lib/specifiers-content";
import { acquisitionSourceReferences } from "@/lib/sources/acquisition-ledger";
import { safeHttpsUrl } from "@/lib/sources/catalogue-core";
import type {
  ClinicalSourceReferenceInput,
  ClinicalSourceType,
  SourceLifecycleStatus,
  SourceUsage,
} from "@/lib/sources/catalogue-types";
import { hasInvalidStructuredSourceDate, strictSourceDate } from "@/lib/sources/source-date-policy";

export type ClinicalSourceProvider = {
  id:
    | "dictionary"
    | "factsheets"
    | "formulation"
    | "therapies"
    | "specifiers"
    | "forms"
    | "mha"
    | "medications"
    | "services"
    | "dsm"
    | "calculators"
    | "acquisitions";
  sourcePaths: readonly string[];
  references(): ClinicalSourceReferenceInput[];
};

function reference(
  usage: SourceUsage,
  overrides: Partial<ClinicalSourceReferenceInput> = {},
): ClinicalSourceReferenceInput {
  return {
    sourceId: null,
    documentId: null,
    title: null,
    aliases: [],
    publisher: null,
    publisherCode: null,
    canonicalUrl: null,
    datasetLocation: null,
    version: null,
    publicationDate: null,
    reviewDate: null,
    expiryDate: null,
    jurisdiction: null,
    evidenceType: "unknown",
    documentStatus: "unknown",
    validationStatus: "unknown",
    contentMode: "metadata_only",
    lifecycleStatus: "active",
    supersedes: [],
    supersededBy: [],
    topics: [],
    usage,
    referenceText: null,
    ...overrides,
  };
}

const dictionarySourceById = new Map<string, (typeof dictionarySources)[number]>(
  dictionarySources.map((source) => [source.id, source]),
);

function dictionaryReference(sourceRef: DictionarySourceRef, usage: SourceUsage, topics: string[]) {
  const source = dictionarySourceById.get(sourceRef.sourceId);
  if (!source) return null;
  return reference(usage, {
    sourceId: source.id,
    title: source.title,
    publisher: source.organisation,
    canonicalUrl: source.url,
    reviewDate: source.accessedOn,
    jurisdiction: source.region,
    validationStatus: "unverified",
    contentMode: "link_only",
    topics,
  });
}

const dictionaryProvider: ClinicalSourceProvider = {
  id: "dictionary",
  sourcePaths: ["src/lib/dictionary-data.ts"],
  references() {
    const references: ClinicalSourceReferenceInput[] = [];
    for (const entry of dictionaryEntries) {
      for (const sourceRef of entry.sourceRefs) {
        for (const field of sourceRef.supports) {
          const projected = dictionaryReference(
            sourceRef,
            { modeId: "dictionary", recordId: entry.slug, recordLabel: entry.term, field },
            [entry.topicSlug],
          );
          if (projected) references.push(projected);
        }
      }
      for (const distinction of entry.distinctions) {
        for (const sourceRef of distinction.sourceRefs) {
          const projected = dictionaryReference(
            sourceRef,
            {
              modeId: "dictionary",
              recordId: entry.slug,
              recordLabel: entry.term,
              field: `distinctions.${distinction.slug}`,
            },
            [entry.topicSlug],
          );
          if (projected) references.push(projected);
        }
      }
    }
    for (const comparison of dictionaryComparisonPairs) {
      for (const sourceRef of comparison.sourceRefs) {
        const projected = dictionaryReference(
          sourceRef,
          {
            modeId: "dictionary",
            recordId: comparison.slugs.join("--"),
            recordLabel: comparison.slugs.join(" / "),
            field: "comparison",
          },
          ["comparison"],
        );
        if (projected) references.push(projected);
      }
    }
    return references;
  },
};

/**
 * The display tag is a reader-facing badge, not a catalogue classification. It
 * recognises two values, so a citation whose tag is neither — a guideline, a
 * standard, a regulatory document — would land in the catalogue's `unknown`
 * band purely because the badge vocabulary is short. `source.evidenceType`
 * lets a citation state its real type; the tag remains the fallback.
 */
function factsheetEvidenceType(source: FactsheetSource): ClinicalSourceType {
  if (source.evidenceType) return source.evidenceType;
  if (source.tag === "Consumer") return "consumer_reference";
  if (source.tag === "Reference") return "professional_reference";
  return "unknown";
}

/**
 * `source.year` is a display string ("2025", "Jun 2026") and is rejected by
 * `strictSourceDate`, which is why this provider used to send `null`. That
 * dropped the exact dates the publishers *do* state. `publicationDate` carries
 * those; a source without one still sends `null` rather than a fabricated day.
 */
function factsheetPublicationDate(source: FactsheetSource): string | null {
  const exact = source.publicationDate;
  if (!exact) return null;
  // `strictSourceDate` already returns null for anything `hasInvalidStructuredSourceDate`
  // would reject, so testing both was redundant.
  return strictSourceDate(exact) ?? null;
}

/**
 * A translated resource is always a governed outbound link (its `url` is
 * required, unlike `FactsheetSource.url`), so it always projects as
 * `link_only` with a real `canonicalUrl` — there is no metadata-only case to
 * branch on the way `factsheetProvider`'s main citations do.
 */
function translatedResourceReference(sheet: (typeof factsheets)[number], resource: FactsheetTranslatedResource) {
  return reference(
    { modeId: "factsheets", recordId: sheet.slug, recordLabel: sheet.title, field: "translatedResources" },
    {
      title: resource.title,
      canonicalUrl: resource.url,
      evidenceType: "consumer_reference",
      contentMode: "link_only",
      topics: [sheet.category],
    },
  );
}

const factsheetProvider: ClinicalSourceProvider = {
  id: "factsheets",
  sourcePaths: ["src/lib/factsheets-data.ts"],
  references: () =>
    factsheets.flatMap((sheet) => [
      ...sheet.sources.map((source) =>
        reference(
          { modeId: "factsheets", recordId: sheet.slug, recordLabel: sheet.title, field: "sources" },
          {
            title: source.title,
            publisher: source.org,
            canonicalUrl: source.url ?? null,
            version: source.version ?? null,
            publicationDate: factsheetPublicationDate(source),
            evidenceType: factsheetEvidenceType(source),
            contentMode: source.url ? "link_only" : "metadata_only",
            topics: [sheet.category],
          },
        ),
      ),
      ...(sheet.translatedResources ?? []).map((resource) => translatedResourceReference(sheet, resource)),
    ]),
};

const formulationProvider: ClinicalSourceProvider = {
  id: "formulation",
  sourcePaths: ["src/data/formulation-content.json", "src/data/formulation-concepts.json"],
  references: () => [
    ...formulationMechanisms.flatMap((mechanism) =>
      mechanism.sources.flatMap((sourceId) => {
        const source = formulationSourceLibrary[sourceId];
        if (!source) return [];
        return [
          reference(
            {
              modeId: "formulation",
              recordId: mechanism.id,
              recordLabel: mechanism.name,
              field: "sources",
            },
            {
              sourceId: source.id,
              title: source.title,
              canonicalUrl: source.url,
              contentMode: "link_only",
              topics: [...mechanism.domains],
            },
          ),
        ];
      }),
    ),
    // Concept and guide citations, projected from the records that actually
    // carry them. A held record contributes nothing, and neither does a
    // citation whose host `source-url-policy.ts` does not govern: the
    // catalogue would have to trust a location this repository has not
    // admitted. `sourceId` stays null so a capture of the same URL merges with
    // this usage instead of splitting into a second catalogue entry.
    ...[...publishedFormulationConcepts, ...publishedFormulationGuides].flatMap((record) =>
      linkableEvidence(record.evidence).map((evidence) =>
        reference(
          {
            modeId: "formulation",
            recordId: record.id,
            recordLabel: record.title,
            field: "evidence",
          },
          {
            sourceId: evidence.nativeSourceId,
            title: evidence.title,
            publisher: evidence.issuer,
            canonicalUrl: evidence.url,
            contentMode: "link_only",
            validationStatus: "unverified",
            topics: record.domains.length ? [...record.domains] : ["Psychiatric formulation"],
          },
        ),
      ),
    ),
  ],
};

type TherapySourceRecord = {
  slug: string;
  name: string;
  reviewStatus: string;
  reviewChecklist?: { sourceChecked?: boolean };
  sources: Array<{ title: string; sourceType: string; reference: string }>;
};

const therapyProvider: ClinicalSourceProvider = {
  id: "therapies",
  sourcePaths: ["src/data/therapies-source.json"],
  references: () =>
    (therapiesSource as TherapySourceRecord[]).flatMap((therapy) =>
      therapy.sources.map((source) =>
        reference(
          { modeId: "therapy-compass", recordId: therapy.slug, recordLabel: therapy.name, field: "sources" },
          {
            title: source.title,
            evidenceType: "uploaded_document",
            validationStatus:
              therapy.reviewStatus === "needs_review" || therapy.reviewChecklist?.sourceChecked === false
                ? "unverified"
                : "unknown",
            referenceText: source.reference,
          },
        ),
      ),
    ),
};

function specifierReviewReferences() {
  const content = loadSpecifiersContent();
  const references: ClinicalSourceReferenceInput[] = [];
  const add = (sourceFamily: string | undefined, usage: SourceUsage) => {
    if (!sourceFamily?.trim()) return;
    references.push(
      reference(usage, {
        title: sourceFamily,
        validationStatus: "unverified",
        referenceText: sourceFamily,
      }),
    );
  };
  for (const specifier of content.universalSpecifiers) {
    add(specifier.review.sourceFamily, {
      modeId: "specifiers",
      recordId: specifier.review.rowKey,
      recordLabel: specifier.title,
      field: "review.sourceFamily",
    });
  }
  for (const category of content.categories) {
    for (const disorder of category.disorders) {
      for (const group of disorder.groups) {
        for (const item of group.items) {
          add(item.review.sourceFamily, {
            modeId: "specifiers",
            recordId: item.review.rowKey,
            recordLabel: item.label,
            field: "review.sourceFamily",
          });
        }
      }
    }
  }
  return references;
}

export function specifierAuthoritativeSourceReferences(
  sources: readonly AuthoritativeSource[],
): ClinicalSourceReferenceInput[] {
  return sources.map((source) =>
    reference(
      {
        modeId: "specifiers",
        recordId: `authoritative-source-${createHash("sha256").update(source.url).digest("hex").slice(0, 16)}`,
        recordLabel: source.label,
        field: "authoritativeSources",
      },
      {
        title: source.label,
        canonicalUrl: source.url,
        contentMode: "link_only",
      },
    ),
  );
}

const specifierProvider: ClinicalSourceProvider = {
  id: "specifiers",
  sourcePaths: ["data/specifiers-content.json"],
  references: () => [...specifierAuthoritativeSourceReferences(authoritativeSources()), ...specifierReviewReferences()],
};

const officialFormByCode = new Map(officialForms.map((form) => [normalizeCode(form.code), form] as const));

function formUsage(code: string, title: string, field: string): SourceUsage {
  return {
    modeId: "forms",
    recordId: `official-form-${normalizeCode(code)}`,
    recordLabel: `Form ${code}: ${title}`,
    field,
  };
}

function officialFormReferences() {
  const references = formsPdfManifest.assets.flatMap((asset) => {
    if (!asset.officialPdfUrl) return [];
    const form = officialFormByCode.get(normalizeCode(asset.code));
    const title = form?.title ?? `Form ${asset.code}`;
    return [
      reference(formUsage(asset.code, title, "officialPdfUrl"), {
        sourceId: `official-mha-form-${normalizeCode(asset.code)}`,
        title: `Form ${asset.code}: ${title}`,
        publisher: "Office of the Chief Psychiatrist WA",
        publisherCode: "OCP WA",
        canonicalUrl: asset.officialPdfUrl,
        version: formsPdfManifest.generatedAt,
        reviewDate: formsPdfManifest.generatedAt,
        jurisdiction: "Australia/WA",
        evidenceType: "regulatory",
        documentStatus: "current",
        validationStatus: "locally_reviewed",
        contentMode: "link_only",
        topics: ["Mental Health Act", "official form"],
      }),
    ];
  });
  return [
    ...references,
    ...officialForms.map((form) =>
      reference(formUsage(form.code, form.title, "officialRegisterUrl"), {
        sourceId: "official-mha-2014-forms-register",
        title: "Mental Health Act 2014 forms",
        publisher: "Office of the Chief Psychiatrist WA",
        publisherCode: "OCP WA",
        canonicalUrl: officialFormsRegisterUrl,
        version: formsPdfManifest.generatedAt,
        reviewDate: formsPdfManifest.generatedAt,
        jurisdiction: "Australia/WA",
        evidenceType: "regulatory",
        documentStatus: "current",
        validationStatus: "locally_reviewed",
        contentMode: "link_only",
        topics: ["Mental Health Act", "official form"],
      }),
    ),
  ];
}

const formsProvider: ClinicalSourceProvider = {
  id: "forms",
  sourcePaths: [
    "data/forms-page-snapshot.json",
    "data/forms-pdf-manifest.json",
    "src/lib/form-catalog.ts",
    "src/lib/form-register.ts",
  ],
  references: () => [
    ...formsSnapshot.sourceDocuments.flatMap((document) => {
      const referencingForms = formsSnapshot.forms.filter((form) => form.sourceDocumentId === document.id);
      const usages: SourceUsage[] = referencingForms.length
        ? referencingForms.map((form) => ({
            modeId: "forms",
            recordId: form.id,
            recordLabel: form.name,
            field: "sourceDocumentId",
          }))
        : [
            {
              modeId: "forms",
              recordId: document.id,
              recordLabel: document.title || document.fileName,
              field: "sourceDocuments",
            },
          ];
      return usages.map((usage) =>
        reference(usage, {
          sourceId: document.id,
          title: document.title || document.fileName,
          datasetLocation: `Forms source document (${document.kind})`,
          topics: [document.kind],
        }),
      );
    }),
    ...officialFormReferences(),
  ],
};

const mhaProvider: ClinicalSourceProvider = {
  id: "mha",
  sourcePaths: ["data/mha-2014-sections.source.json"],
  references: () => [
    reference(
      {
        modeId: "forms",
        recordId: "mental-health-act-2014-wa",
        recordLabel: "Mental Health Act 2014 (WA)",
        field: "act",
      },
      {
        sourceId: "mental-health-act-2014-wa",
        title: "Mental Health Act 2014 (WA)",
        canonicalUrl: mhaActMetadata.sourceUrl,
        version: mhaActMetadata.actVersion,
        reviewDate: mhaActMetadata.actAsAt,
        jurisdiction: "Australia/WA",
        evidenceType: "legislation",
        contentMode: "link_only",
        topics: ["Mental Health Act", "legislation"],
      },
    ),
  ],
};

function medicationSourceRows() {
  return loadMedicationSnapshot().flatMap((medication) =>
    medication.sections.flatMap((section) =>
      section.rows
        .filter((row) => section.title === "Sources" || row.key === "Source Review")
        .map((row) => ({ medication, section, row })),
    ),
  );
}

const medicationProvider: ClinicalSourceProvider = {
  id: "medications",
  sourcePaths: ["data/medications-snapshot.json", "src/data/medication-source-links.json"],
  references: () => [
    ...medicationSourceRows().map(({ medication, section, row }) =>
      reference(
        {
          modeId: "prescribing",
          recordId: medication.slug,
          recordLabel: medication.name,
          field: `${section.title}.${row.key}`,
        },
        {
          title: `${medication.name}: ${row.key || section.title}`,
          validationStatus: "unverified",
          referenceText: row.val,
          topics: [medication.category, medication.class].filter(Boolean),
        },
      ),
    ),
    // Owner-confirmed source links the medication pages render (ledger #05WXHX step 2).
    ...medicationSourceLinkReferences(loadMedicationSnapshot()),
  ],
};

const servicesProvider: ClinicalSourceProvider = {
  id: "services",
  sourcePaths: ["data/services-snapshot.json"],
  references: () =>
    loadServicesSnapshot().services.flatMap((service) => [
      ...service.public_source_urls.map((url) =>
        reference(
          { modeId: "services", recordId: service.id, recordLabel: service.name, field: "public_source_urls" },
          {
            title: service.name,
            canonicalUrl: url,
            contentMode: "link_only",
            topics: [...service.tags.setting_flags, ...service.tags.acuity_flags],
          },
        ),
      ),
      ...service.source_documents.map((sourceDocument) =>
        reference(
          { modeId: "services", recordId: service.id, recordLabel: service.name, field: "source_documents" },
          {
            title: sourceDocument,
            validationStatus: "unverified",
            referenceText: sourceDocument,
            topics: [...service.tags.setting_flags, ...service.tags.acuity_flags],
          },
        ),
      ),
    ]),
};

type DsmClinicalContent = {
  export_format_version: string;
  generated_at: string;
  source_repository: string;
  diagnoses: Array<{ record_id: string; title: string; category?: { label?: string } }>;
};

const dsmProvider: ClinicalSourceProvider = {
  id: "dsm",
  sourcePaths: ["src/data/dsm-clinical-content.json"],
  references: () => {
    const content = dsmClinicalContent as DsmClinicalContent;
    return content.diagnoses.map((diagnosis) =>
      reference(
        { modeId: "dsm", recordId: diagnosis.record_id, recordLabel: diagnosis.title, field: "source_repository" },
        {
          sourceId: content.source_repository,
          title: "DSM clinical content dataset",
          datasetLocation: content.source_repository,
          version: content.export_format_version,
          publicationDate: strictSourceDate(content.generated_at.slice(0, 10)),
          evidenceType: "dataset",
          topics: diagnosis.category?.label ? [diagnosis.category.label] : [],
        },
      ),
    );
  },
};

function isAcademicCalculatorEvidence(source: CalculatorEvidenceSource) {
  return source.type !== "internal_governance_record" && source.type !== "rights_statement";
}

function calculatorEvidenceType(source: CalculatorEvidenceSource): ClinicalSourceType {
  if (source.type === "journal_article") return "primary_study";
  if (source.type === "government_information_paper" || source.type === "government_web_guidance") {
    return "professional_reference";
  }
  return "unknown";
}

/**
 * The evidence registry types `status` as an unrestricted string, so a missing, misspelled or
 * newly introduced value reaches here. Only a status this map names may present a source as
 * active evidence; anything else falls to `inactive`, which keeps the source visible with its
 * not-in-active-use warning rather than letting unvetted or quarantined evidence read as
 * current. `npm run check:calculator-content` fails on any status not listed here, so a new
 * status is a loud failure at the data rather than a silent demotion at the read.
 */
const CALCULATOR_EVIDENCE_LIFECYCLE: Record<string, SourceLifecycleStatus> = {
  reviewed: "active",
  permission_review_required: "inactive",
  not_for_active_use: "excluded",
};

export const KNOWN_CALCULATOR_EVIDENCE_STATUSES = Object.keys(CALCULATOR_EVIDENCE_LIFECYCLE);

function calculatorEvidenceLifecycle(source: CalculatorEvidenceSource): SourceLifecycleStatus {
  return CALCULATOR_EVIDENCE_LIFECYCLE[source.status] ?? "inactive";
}

const calculatorEvidenceById = new Map(calculatorEvidence.sources.map((source) => [source.id, source]));

const calculatorProvider: ClinicalSourceProvider = {
  id: "calculators",
  sourcePaths: ["data/calculators/evidence.json", "src/lib/calculators/calculator-fixtures.ts"],
  references: () =>
    allCalculatorFixtures.flatMap((calculator) =>
      calculator.sourceIds.flatMap((sourceId) => {
        const source = calculatorEvidenceById.get(sourceId);
        if (!source || !isAcademicCalculatorEvidence(source)) return [];
        return [
          reference(
            { modeId: "calculators", recordId: calculator.id, recordLabel: calculator.name, field: "sourceIds" },
            {
              sourceId: source.id,
              title: source.title,
              publisher: source.issuer,
              canonicalUrl: source.url,
              version: source.version,
              reviewDate: strictSourceDate(source.lastReviewed),
              expiryDate: strictSourceDate(source.nextReview),
              jurisdiction: source.jurisdiction,
              evidenceType: calculatorEvidenceType(source),
              documentStatus: source.status === "reviewed" ? "current" : "unknown",
              validationStatus: source.status === "reviewed" ? "locally_reviewed" : "unverified",
              contentMode: "link_only",
              lifecycleStatus: calculatorEvidenceLifecycle(source),
              supersedes: source.supersedes ? [source.supersedes] : [],
              topics: [calculator.domain],
            },
          ),
        ];
      }),
    ),
};

/**
 * Sources captured by the source-acquisition protocol, including candidates
 * awaiting clinical sign-off and rejected candidates kept so the same ground is
 * not searched twice. Captures carry no `sourceId`, so a captured source merges
 * with any content reference to the same URL rather than splitting the entry.
 */
const acquisitionProvider: ClinicalSourceProvider = {
  id: "acquisitions",
  sourcePaths: ["src/data/source-acquisitions.json"],
  references: () => acquisitionSourceReferences(),
};

export const repositorySourceProviders: readonly ClinicalSourceProvider[] = [
  dictionaryProvider,
  factsheetProvider,
  formulationProvider,
  therapyProvider,
  specifierProvider,
  formsProvider,
  mhaProvider,
  medicationProvider,
  servicesProvider,
  dsmProvider,
  calculatorProvider,
  acquisitionProvider,
];

export function repositorySourceReferences() {
  return repositorySourceProviders.flatMap((provider) => provider.references());
}

export function repositorySourceReferenceIssues(
  providerId: string,
  references: readonly ClinicalSourceReferenceInput[],
): string[] {
  const issues: string[] = [];
  for (const sourceReference of references) {
    const usage = sourceReference.usage;
    if (!usage.modeId || !usage.recordId || !usage.recordLabel || !usage.field) {
      issues.push(`Provider ${providerId} returned a reference without a complete usage`);
    }
    if (sourceReference.canonicalUrl && !safeHttpsUrl(sourceReference.canonicalUrl)) {
      issues.push(`Provider ${providerId} returned unsafe structured URL`);
    }
    if (
      [
        sourceReference.publicationDate,
        sourceReference.reviewDate,
        sourceReference.lastUpdatedDate ?? null,
        sourceReference.expiryDate,
      ].some(hasInvalidStructuredSourceDate)
    ) {
      issues.push(`Provider ${providerId} returned an invalid structured date`);
    }
  }
  return issues;
}

function coverageKey(reference: ClinicalSourceReferenceInput) {
  return [
    reference.sourceId,
    reference.canonicalUrl,
    reference.referenceText,
    reference.usage.recordId,
    reference.usage.field,
  ].join("\u0000");
}

type RepositorySourceCoverageInputs = {
  formulationMechanisms?: readonly Pick<FormulationMechanism, "id" | "name" | "sources">[];
  formulationSourceLibrary?: Readonly<Record<string, FormulationSource>>;
};

export function repositorySourceCoverageIssues(inputs: RepositorySourceCoverageInputs = {}): string[] {
  const issues: string[] = [];
  const references = repositorySourceReferences();
  const keys = new Set(references.map(coverageKey));
  const providerReferences = new Map(repositorySourceProviders.map((provider) => [provider.id, provider.references()]));
  const checkedFormulationMechanisms = inputs.formulationMechanisms ?? formulationMechanisms;
  const checkedFormulationSourceLibrary = inputs.formulationSourceLibrary ?? formulationSourceLibrary;

  const dictionaryIds = new Set<string>(dictionarySources.map((source) => source.id));
  const usedDictionaryIds = [
    ...dictionaryEntries.flatMap((entry) => [
      ...entry.sourceRefs.map((source) => source.sourceId),
      ...entry.distinctions.flatMap((distinction) => distinction.sourceRefs.map((source) => source.sourceId)),
    ]),
    ...dictionaryComparisonPairs.flatMap((comparison) => comparison.sourceRefs.map((source) => source.sourceId)),
  ];
  for (const sourceId of usedDictionaryIds) {
    if (!dictionaryIds.has(sourceId)) issues.push(`Dictionary usage references missing source ${sourceId}`);
  }
  const capturedDictionaryIds = new Set(providerReferences.get("dictionary")?.map((item) => item.sourceId));
  for (const source of dictionarySources) {
    if (!capturedDictionaryIds.has(source.id)) issues.push(`Dictionary source ${source.id} has no catalogue usage`);
  }

  for (const mechanism of checkedFormulationMechanisms) {
    for (const sourceId of mechanism.sources) {
      if (!checkedFormulationSourceLibrary[sourceId]) {
        issues.push(`Formulation mechanism ${mechanism.id} references missing source ${sourceId}`);
      }
      const expected = reference(
        { modeId: "formulation", recordId: mechanism.id, recordLabel: mechanism.name, field: "sources" },
        { sourceId, canonicalUrl: checkedFormulationSourceLibrary[sourceId]?.url ?? null },
      );
      if (!keys.has(coverageKey(expected)))
        issues.push(`Formulation source ${sourceId} is missing usage ${mechanism.id}`);
    }
  }
  const usedFormulationSources = new Set(checkedFormulationMechanisms.flatMap((mechanism) => mechanism.sources));
  for (const sourceId of Object.keys(checkedFormulationSourceLibrary)) {
    if (!usedFormulationSources.has(sourceId)) issues.push(`Formulation source ${sourceId} has no mechanism usage`);
  }

  const usedCalculatorEvidenceIds = new Set(allCalculatorFixtures.flatMap((calculator) => calculator.sourceIds));
  for (const calculator of allCalculatorFixtures) {
    for (const sourceId of calculator.sourceIds) {
      const source = calculatorEvidenceById.get(sourceId);
      if (!source) {
        issues.push(`Calculator ${calculator.id} references missing evidence source ${sourceId}`);
        continue;
      }
      if (!isAcademicCalculatorEvidence(source)) continue;
      const expected = reference(
        { modeId: "calculators", recordId: calculator.id, recordLabel: calculator.name, field: "sourceIds" },
        { sourceId, canonicalUrl: source.url },
      );
      if (!keys.has(coverageKey(expected))) {
        issues.push(`Calculator evidence source ${sourceId} is missing usage ${calculator.id}`);
      }
    }
  }
  for (const source of calculatorEvidence.sources) {
    if (isAcademicCalculatorEvidence(source) && !usedCalculatorEvidenceIds.has(source.id)) {
      issues.push(`Calculator evidence source ${source.id} has no calculator usage`);
    }
  }

  for (const { medication, section, row } of medicationSourceRows()) {
    const expected = reference(
      {
        modeId: "prescribing",
        recordId: medication.slug,
        recordLabel: medication.name,
        field: `${section.title}.${row.key}`,
      },
      { referenceText: row.val },
    );
    if (!keys.has(coverageKey(expected))) issues.push(`Medication ${medication.slug} source row is not captured`);
  }

  for (const service of loadServicesSnapshot().services) {
    for (const url of service.public_source_urls) {
      const expected = reference(
        { modeId: "services", recordId: service.id, recordLabel: service.name, field: "public_source_urls" },
        { canonicalUrl: url },
      );
      if (!keys.has(coverageKey(expected))) issues.push(`Service ${service.id} URL ${url} is not captured`);
    }
    for (const sourceDocument of service.source_documents) {
      const expected = reference(
        { modeId: "services", recordId: service.id, recordLabel: service.name, field: "source_documents" },
        { referenceText: sourceDocument },
      );
      if (!keys.has(coverageKey(expected))) {
        issues.push(`Service ${service.id} source document ${sourceDocument} is not captured`);
      }
    }
  }

  const formIds = new Set(providerReferences.get("forms")?.map((item) => item.sourceId));
  for (const document of formsSnapshot.sourceDocuments) {
    if (!formIds.has(document.id)) issues.push(`Forms source document ${document.id} is not captured`);
  }
  const formReferences = providerReferences.get("forms") ?? [];
  for (const form of formsSnapshot.forms) {
    if (
      !formReferences.some(
        (item) =>
          item.sourceId === form.sourceDocumentId &&
          item.usage.recordId === form.id &&
          item.usage.recordLabel === form.name &&
          item.usage.field === "sourceDocumentId",
      )
    ) {
      issues.push(`Forms record ${form.id} source document usage is not captured`);
    }
  }
  for (const asset of formsPdfManifest.assets) {
    if (
      !formReferences.some(
        (item) =>
          item.canonicalUrl === asset.officialPdfUrl &&
          item.usage.recordId === `official-form-${normalizeCode(asset.code)}` &&
          item.usage.field === "officialPdfUrl",
      )
    ) {
      issues.push(`Forms official PDF ${asset.code} is not captured`);
    }
  }
  for (const form of officialForms) {
    if (
      !formReferences.some(
        (item) =>
          item.canonicalUrl === officialFormsRegisterUrl &&
          item.usage.recordId === `official-form-${normalizeCode(form.code)}` &&
          item.usage.field === "officialRegisterUrl",
      )
    ) {
      issues.push(`Forms register usage ${form.code} is not captured`);
    }
  }

  const dsmReferences = providerReferences.get("dsm") ?? [];
  const dsmContent = dsmClinicalContent as DsmClinicalContent;
  for (const diagnosis of dsmContent.diagnoses) {
    if (
      !dsmReferences.some(
        (item) => item.datasetLocation === dsmContent.source_repository && item.usage.recordId === diagnosis.record_id,
      )
    ) {
      issues.push(`DSM source_repository is missing diagnosis usage ${diagnosis.record_id}`);
    }
  }

  return [...new Set(issues)].sort();
}
