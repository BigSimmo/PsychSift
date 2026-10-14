# Sources Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only `/sources` application mode that automatically catalogues, organises, rates, ranks and traces every structured academic or clinical source used by production content, while preserving private-document access boundaries and leaving RAG behaviour unchanged.

**Architecture:** Treat Sources as a server-assembled projection over existing source owners. Pure catalogue code normalises references, reuses existing authority and metadata governance, partitions incompatible identities, deduplicates compatible citations, applies a deterministic presentation-only rating and produces client-safe entries. Registered repository providers and a separately scoped Supabase document loader feed that core; route components render the same canonical entries as Catalogue, Topics, Publishers, Method and detail views.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase/Postgres through the existing server/admin clients and owner/public query scope, Tailwind CSS, Vitest/Testing Library, Playwright and the repository's existing source-governance utilities.

**Spec:** `docs/superpowers/specs/2026-09-01-sources-mode-design.md`

**Estimated build time:** 7–10 engineering hours with subagent-driven development, including task-level TDD, two-stage reviews and focused browser verification. Connected Supabase verification, production-readiness checks, deployment and PR work are outside this estimate and remain separately authorized.

## Global Constraints

- Catalogue academic and clinical information sources only; exclude developer documentation, tests, mockups, fixtures used only by tests, build references and incidental prose URLs.
- Keep this feature read-only: no source editor, database migration, new Supabase table, hosted write, ingestion job or synchronisation job.
- Do not change RAG retrieval, relevance scoring, prompts, citations, answer generation or provider evaluation.
- Reuse `ClinicalSourceMetadata`, `normalizeSourceMetadata()` and `classifySourceAuthority()`; do not introduce a second publisher-authority, jurisdiction, currentness or validation system.
- The catalogue score is organisational presentation only. Use the label **Accuracy assurance** and never claim that software has measured factual truth.
- Apply the exact weights from the spec: accuracy assurance 25, reliability 20, evidence quality 20, currency 15, Australian applicability 15 and traceability 5.
- Apply the exact bands from the spec: A 85–100, B 70–84, C 50–69, D below 50 or material uncertainty, plus Excluded before scoring.
- Prefer Australian material only within the bounded score. An Australian source never bypasses validation, identity, lifecycle or evidence-quality controls.
- Never infer publisher, jurisdiction, evidence type, version, approval or currentness from title, filename or free-text citation prose.
- Preserve free-text legacy references as provisional D-band identities; do not parse them into invented citations.
- Use only metadata from accessible documents. Never project document text, chunks, embeddings, summaries, answers, queries, user identifiers, patient data, storage paths or raw metadata to the browser.
- Public documents are visible only when `owner_id IS NULL` and `metadata.public_corpus = true`; authenticated callers additionally see their own UUID-scoped documents.
- Assemble and score on the server. Send only `ClinicalSourceCatalogueEntry` view data and availability status to client components.
- Reuse the shared search composer, `RegistryModeNav`, `InformationPageShell`, existing header-collapse ownership and responsive tokens. Do not add a second search bar or phone header.
- Use 48px minimum phone controls, textual band/warning labels, keyboard-operable controls, restrained live-region result counts, reduced-motion safety and forced-colours legibility.
- Run no live Supabase audit, provider evaluation, production-readiness command, migration, deployment, push or pull request without separate explicit authorization.
- Runtime floors remain Node `>=24.15.0 <25` and npm `11.x`; add no dependency.

## File Structure

| File                                                  | Responsibility                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/sources/catalogue-types.ts`                  | Client-safe catalogue inputs, entries, ratings, warnings, filters and provider contracts                                                                                               |
| `src/lib/sources/catalogue-core.ts`                   | HTTPS validation, deterministic identity, compatibility partitioning, deduplication, authority reuse, rating and default ordering                                                      |
| `src/lib/sources/catalogue-view.ts`                   | Client-safe filter parsing, filtering, sorting, counts, topic and publisher projections                                                                                                |
| `src/lib/sources/repository-providers.ts`             | Registered adapters for every current production clinical source owner: Dictionary, Factsheets, Formulation, Therapy, Specifiers, Forms/MHA, Medication, Services, DSM and calculators |
| `src/lib/sources/document-source-loader.ts`           | Server-only owner/public Supabase query and safe document-to-reference projection                                                                                                      |
| `src/lib/sources/load-source-catalogue.ts`            | Server-only merge of repository and accessible-document references with truthful availability state                                                                                    |
| `scripts/check-source-catalogue.ts`                   | Offline provider/coverage validation; failures versus review debt                                                                                                                      |
| `src/components/sources/sources-catalogue-client.tsx` | URL-backed filters, sort, counts, desktop rows and phone cards                                                                                                                         |
| `src/components/sources/sources-pages.tsx`            | Shared shell plus Catalogue, Topics, Publishers, Method and detail renderers                                                                                                           |
| `src/app/(search-app)/sources/**`                     | Sources mode routes and metadata                                                                                                                                                       |
| `tests/source-catalogue-core.test.ts`                 | Pure identity, deduplication, scoring and ordering contracts                                                                                                                           |
| `tests/source-catalogue-providers.test.ts`            | Adapter inventory, automatic coverage and legacy-debt contracts                                                                                                                        |
| `tests/source-document-loader.test.ts`                | Owner/public scoping, safe projection and unavailable-state contracts                                                                                                                  |
| `tests/sources-mode.dom.test.tsx`                     | Catalogue filtering, semantic labels, derived views and degraded-state DOM contracts                                                                                                   |
| `tests/ui-sources.spec.ts`                            | Focused browser proof for routes, phone/desktop overflow, keyboard, reduced motion, forced colours and axe                                                                             |

---

### Task 1: Canonical catalogue, rating and view model

**Files:**

- Create: `src/lib/sources/catalogue-types.ts`
- Create: `src/lib/sources/catalogue-core.ts`
- Create: `src/lib/sources/catalogue-view.ts`
- Create: `tests/source-catalogue-core.test.ts`

**Interfaces:**

- Consumes: `ClinicalSourceMetadata` from `src/lib/types.ts`, `normalizeSourceMetadata(input: unknown)` from `src/lib/source-metadata.ts`, and `classifySourceAuthority(input: unknown)` from `src/lib/source-authority-registry.ts`.
- Produces: `ClinicalSourceReferenceInput`, `ClinicalSourceCatalogueEntry`, `ClinicalSourceRating`, `SourceCatalogueFilters`, `canonicalizeSourceReferences(inputs)`, `parseSourceCatalogueFilters(params)`, `filterAndSortSourceCatalogue(entries, filters)` and `deriveSourceCatalogueFacets(entries)`.

- [ ] **Step 1: Write the failing core contract tests**

Create `tests/source-catalogue-core.test.ts` with fixtures that prove the score is deterministic, Australian preference is bounded, material uncertainty forces D, exclusion runs before score, unsafe URLs never become links, compatible duplicates merge their usages, incompatible versions/publishers remain separate, and default ordering is band then score then Australian applicability then currency then title.

```ts
import { describe, expect, it } from "vitest";

import { canonicalizeSourceReferences, rateClinicalSource } from "@/lib/sources/catalogue-core";
import type { ClinicalSourceReferenceInput } from "@/lib/sources/catalogue-types";

function reference(overrides: Partial<ClinicalSourceReferenceInput> = {}): ClinicalSourceReferenceInput {
  return {
    sourceId: "akg-guideline",
    documentId: null,
    title: "Example clinical guideline",
    aliases: [],
    publisher: "Armadale Kalamunda Group",
    publisherCode: "AKG",
    canonicalUrl: "https://www.ahs.health.wa.gov.au/example",
    datasetLocation: null,
    version: "1",
    publicationDate: "2025-01-01",
    reviewDate: "2026-01-01",
    expiryDate: null,
    jurisdiction: "Australia/WA",
    evidenceType: "guideline",
    documentStatus: "current",
    validationStatus: "approved",
    contentMode: "link_only",
    lifecycleStatus: "active",
    supersedes: [],
    supersededBy: [],
    topics: ["governance"],
    usage: { modeId: "dictionary", recordId: "mse", recordLabel: "Mental state examination", field: "definition" },
    referenceText: null,
    ...overrides,
  };
}

describe("clinical source catalogue", () => {
  it("uses the published six weights and band thresholds", () => {
    const rating = rateClinicalSource(reference());
    expect(rating.weights).toEqual({
      accuracyAssurance: 25,
      reliability: 20,
      evidenceQuality: 20,
      currency: 15,
      australianApplicability: 15,
      traceability: 5,
    });
    expect(rating.score).toBe(100);
    expect(rating.band).toBe("A");
  });

  it("forces incomplete future references into D without discarding them", () => {
    const [entry] = canonicalizeSourceReferences([
      reference({
        sourceId: null,
        publisher: null,
        publisherCode: null,
        canonicalUrl: null,
        version: null,
        publicationDate: null,
        reviewDate: null,
        jurisdiction: null,
        evidenceType: "unknown",
        validationStatus: "unknown",
        referenceText: "Legacy prose citation",
      }),
    ]);
    expect(entry.rating.band).toBe("D");
    expect(entry.warnings).toEqual(expect.arrayContaining(["ambiguous_identity", "verification_unknown"]));
  });

  it("runs lifecycle exclusion before the numeric score", () => {
    expect(rateClinicalSource(reference({ lifecycleStatus: "excluded" })).band).toBe("excluded");
  });

  it("keeps a substantially stronger international source above a weak Australian source", () => {
    const entries = canonicalizeSourceReferences([
      reference({
        sourceId: "strong-int",
        publisher: "World Health Organization",
        publisherCode: "WHO",
        jurisdiction: "International",
      }),
      reference({
        sourceId: "weak-au",
        publisher: null,
        publisherCode: null,
        validationStatus: "unverified",
        evidenceType: "other",
      }),
    ]);
    expect(entries.map((entry) => entry.sourceId)).toEqual(["strong-int", "weak-au"]);
  });

  it("merges compatible aliases while retaining every usage", () => {
    const entries = canonicalizeSourceReferences([
      reference(),
      reference({
        usage: { modeId: "factsheets", recordId: "depression", recordLabel: "Depression", field: "sources" },
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].usedBy).toHaveLength(2);
  });

  it("does not merge conflicting versions or publishers", () => {
    const entries = canonicalizeSourceReferences([
      reference(),
      reference({ version: "2", publisher: "Different publisher", publisherCode: null }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.warnings.includes("metadata_conflict"))).toBe(true);
  });

  it("removes unsafe outbound locations", () => {
    const [entry] = canonicalizeSourceReferences([reference({ canonicalUrl: "javascript:alert(1)" })]);
    expect(entry.canonicalLocation).toEqual({ kind: "none" });
    expect(entry.warnings).toContain("unsafe_location");
  });
});
```

- [ ] **Step 2: Run the core test to confirm the red state**

Run: `node scripts/run-vitest.mjs run tests/source-catalogue-core.test.ts`

Expected: FAIL because `@/lib/sources/catalogue-core` and `@/lib/sources/catalogue-types` do not exist.

- [ ] **Step 3: Define the client-safe contracts**

Create `src/lib/sources/catalogue-types.ts` with these exact public shapes. Keep raw document rows, raw metadata and identity keys out of `ClinicalSourceCatalogueEntry`.

```ts
import type { AppModeId } from "@/lib/app-modes";

export type ClinicalSourceType =
  | "guideline"
  | "systematic_review"
  | "primary_study"
  | "standard"
  | "legislation"
  | "regulatory"
  | "professional_reference"
  | "consumer_reference"
  | "uploaded_document"
  | "dataset"
  | "other"
  | "unknown";

export type SourceGeographyScope = "wa" | "australian_national" | "australian_state" | "international" | "unknown";
export type SourceLifecycleStatus = "active" | "inactive" | "excluded";
export type SourceContentMode = "indexed_content" | "link_only" | "metadata_only";
export type SourceQualityBand = "A" | "B" | "C" | "D" | "excluded";
export type SourceCatalogueWarning =
  | "ambiguous_identity"
  | "metadata_conflict"
  | "unsafe_location"
  | "missing_publisher"
  | "missing_version"
  | "missing_dates"
  | "unknown_jurisdiction"
  | "unknown_evidence_type"
  | "verification_unknown"
  | "outdated"
  | "superseded";

export type SourceUsage = {
  modeId: AppModeId;
  recordId: string;
  recordLabel: string;
  field: string;
};

export type SourceCanonicalLocation =
  | { kind: "url"; href: string }
  | { kind: "document"; documentId: string; href: string }
  | { kind: "dataset"; label: string }
  | { kind: "none" };

export type ClinicalSourceReferenceInput = {
  sourceId: string | null;
  documentId: string | null;
  title: string | null;
  aliases: string[];
  publisher: string | null;
  publisherCode: string | null;
  canonicalUrl: string | null;
  datasetLocation: string | null;
  version: string | null;
  publicationDate: string | null;
  reviewDate: string | null;
  expiryDate: string | null;
  jurisdiction: string | null;
  evidenceType: ClinicalSourceType;
  documentStatus: "current" | "review_due" | "outdated" | "unknown";
  validationStatus: "approved" | "locally_reviewed" | "unverified" | "unknown";
  contentMode: SourceContentMode;
  lifecycleStatus: SourceLifecycleStatus;
  supersedes: string[];
  supersededBy: string[];
  topics: string[];
  usage: SourceUsage;
  referenceText: string | null;
};

export type ClinicalSourceRating = {
  score: number;
  band: SourceQualityBand;
  dimensions: {
    accuracyAssurance: number;
    reliability: number;
    evidenceQuality: number;
    currency: number;
    australianApplicability: number;
    traceability: number;
  };
  weights: typeof SOURCE_RATING_WEIGHTS;
  reasons: string[];
};

export const SOURCE_RATING_WEIGHTS = {
  accuracyAssurance: 25,
  reliability: 20,
  evidenceQuality: 20,
  currency: 15,
  australianApplicability: 15,
  traceability: 5,
} as const;

export type ClinicalSourceCatalogueEntry = {
  id: string;
  sourceId: string | null;
  title: string;
  aliases: string[];
  version: string | null;
  publisher: string | null;
  publisherCode: string | null;
  sourceType: ClinicalSourceType;
  canonicalLocation: SourceCanonicalLocation;
  geography: { scope: SourceGeographyScope; label: string };
  topics: string[];
  publicationDate: string | null;
  reviewDate: string | null;
  expiryDate: string | null;
  documentStatus: ClinicalSourceReferenceInput["documentStatus"];
  validationStatus: ClinicalSourceReferenceInput["validationStatus"];
  contentMode: SourceContentMode;
  lifecycleStatus: SourceLifecycleStatus;
  supersedes: string[];
  supersededBy: string[];
  usedBy: SourceUsage[];
  rating: ClinicalSourceRating;
  warnings: SourceCatalogueWarning[];
};

export type SourceCatalogueFilters = {
  q: string;
  bands: SourceQualityBand[];
  jurisdictions: SourceGeographyScope[];
  sourceTypes: ClinicalSourceType[];
  publishers: string[];
  topics: string[];
  lifecycleStatuses: SourceLifecycleStatus[];
  documentStatuses: ClinicalSourceReferenceInput["documentStatus"][];
  validationStatuses: ClinicalSourceReferenceInput["validationStatus"][];
  usedBy: AppModeId[];
  sort: "quality" | "title" | "currency";
};
```

- [ ] **Step 4: Implement deterministic identity, compatibility partitioning, rating and ordering**

Create `src/lib/sources/catalogue-core.ts`. Use SHA-256 only for the opaque route ID; never place the full provisional reference text in a URL or log. Preserve its safe upstream display label in the catalogue so legacy academic references are actually findable, but never source that label from raw Supabase metadata or document content.

```ts
import { createHash } from "node:crypto";

import { classifySourceAuthority, normalizeSourceAuthorityText } from "@/lib/source-authority-registry";
import { normalizeSourceMetadata } from "@/lib/source-metadata";
import {
  SOURCE_RATING_WEIGHTS,
  type ClinicalSourceCatalogueEntry,
  type ClinicalSourceReferenceInput,
  type ClinicalSourceRating,
  type SourceCatalogueWarning,
  type SourceGeographyScope,
} from "@/lib/sources/catalogue-types";

function opaqueSourceId(identity: string) {
  return `src_${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

function safeHttpsUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function baseIdentity(input: ClinicalSourceReferenceInput) {
  if (input.documentId) return `document:${input.documentId}`;
  if (input.sourceId) return `source:${input.sourceId.trim().toLowerCase()}`;
  const url = safeHttpsUrl(input.canonicalUrl);
  if (url) return `url:${url}|version:${input.version ?? "unknown"}`;
  if (input.publisher && input.title) {
    return `title:${normalizeSourceAuthorityText(input.publisher)}|${normalizeSourceAuthorityText(input.title)}|${input.version ?? "unknown"}`;
  }
  return `provisional:${normalizeSourceAuthorityText(input.referenceText ?? input.title ?? "unresolved")}`;
}

function compatibilityKey(input: ClinicalSourceReferenceInput) {
  return [input.publisher, input.publisherCode, input.jurisdiction, input.version]
    .map((value) => normalizeSourceAuthorityText(value))
    .join("|");
}
```

Implement the exact scoring tables below. `classifySourceAuthority()` supplies reliability and geographic scope; do not infer either from URLs or prose.

```ts
const ACCURACY = { approved: 25, locally_reviewed: 20, unverified: 5, unknown: 0 } as const;
const EVIDENCE = {
  guideline: 20,
  standard: 20,
  legislation: 20,
  regulatory: 20,
  systematic_review: 18,
  primary_study: 14,
  professional_reference: 12,
  consumer_reference: 8,
  uploaded_document: 6,
  dataset: 6,
  other: 4,
  unknown: 0,
} as const;
const AUSTRALIAN = { wa: 15, australian_national: 13, australian_state: 11, international: 6, unknown: 0 } as const;

// Reliability: recognised official 20, recognised trusted 16,
// unclassified publisher with traceable identity 8, otherwise 0.
// Currency: current 15, review_due 8, unknown 4, outdated 0.
// Traceability: one point each for stable identity, version, a date,
// canonical location and at least one usage; maximum 5.
// Material uncertainty is provisional identity, unsafe location, metadata
// conflict, or validationStatus unverified/unknown. It forces band D.
// lifecycleStatus excluded forces band excluded before numeric thresholds.
```

Export `rateClinicalSource(input)`, `canonicalizeSourceReferences(inputs)` and `compareClinicalSources(left, right)`. Partition each `baseIdentity` group by `compatibilityKey`; when more than one partition exists, add `metadata_conflict` to every resulting entry. Merge and sort `aliases`, `topics`, `usedBy`, `supersedes`, `supersededBy` and warnings deterministically.

- [ ] **Step 5: Implement URL-backed filters and derived facets**

Create `src/lib/sources/catalogue-view.ts`. Parse repeated query parameters (`band`, `jurisdiction`, `type`, `publisher`, `topic`, `lifecycle`, `status`, `validation`, `usedBy`) against values present in the entries, default invalid values away, and support `sort=quality|title|currency`. Search only title, aliases, publisher and topics.

```ts
export function deriveSourceCatalogueFacets(entries: readonly ClinicalSourceCatalogueEntry[]) {
  return {
    total: entries.length,
    australian: entries.filter(
      (entry) => entry.geography.scope !== "international" && entry.geography.scope !== "unknown",
    ).length,
    reviewRequired: entries.filter((entry) => entry.rating.band === "D").length,
    inactiveOrExcluded: entries.filter((entry) => entry.lifecycleStatus !== "active").length,
    topics: countValues(entries.flatMap((entry) => entry.topics)),
    publishers: countValues(entries.map((entry) => entry.publisher).filter((value): value is string => Boolean(value))),
  };
}
```

- [ ] **Step 6: Run and refine the focused core tests**

Run: `node scripts/run-vitest.mjs run tests/source-catalogue-core.test.ts`

Expected: PASS with the six-weight, band, exclusion, bounded-Australian, deduplication, conflict and unsafe-location cases green.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/lib/sources/catalogue-types.ts src/lib/sources/catalogue-core.ts src/lib/sources/catalogue-view.ts tests/source-catalogue-core.test.ts
git commit -m "feat(sources): define catalogue rating and identity"
```

---

### Task 2: Repository providers, automatic coverage and safe document projection

**Files:**

- Create: `src/lib/sources/repository-providers.ts`
- Create: `src/lib/sources/document-source-loader.ts`
- Create: `src/lib/sources/load-source-catalogue.ts`
- Create: `scripts/check-source-catalogue.ts`
- Create: `tests/source-catalogue-providers.test.ts`
- Create: `tests/source-document-loader.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: Task 1 `ClinicalSourceReferenceInput` and `canonicalizeSourceReferences()`, plus existing Dictionary, Factsheets, Formulation, Therapy, Specifiers, Forms/MHA, Medication, Services, DSM, calculator, Supabase authentication and owner/public query owners.
- Produces: `ClinicalSourceProvider`, `repositorySourceProviders`, `repositorySourceReferences()`, `loadVisibleDocumentSourceReferences()`, `loadSourceCatalogue()` and the offline `npm run check:source-catalogue` contract.

- [ ] **Step 1: Write failing provider and document-access tests**

Create `tests/source-catalogue-providers.test.ts` with the exact provider IDs and source-bearing paths below, assert every provider returns at least one valid reference and usage, assert all structured URLs are HTTPS or become `unsafe_location`, assert every dictionary source ID is represented, and assert Therapy/free-text source material remains provisional rather than being split into inferred publishers.

```ts
const expectedProviders = {
  dictionary: ["src/lib/dictionary-data.ts"],
  factsheets: ["src/components/factsheets/factsheets-data.ts"],
  formulation: ["src/data/formulation-content.json"],
  therapies: ["src/data/therapies-source.json"],
  specifiers: ["data/specifiers-content.json"],
  forms: ["data/forms-page-snapshot.json"],
  mha: ["data/mha-2014-sections.source.json"],
  medications: ["data/medications-snapshot.json"],
  services: ["data/services-snapshot.json"],
  dsm: ["src/data/dsm-clinical-content.json"],
  calculators: ["src/components/calculators/calculator-fixtures.ts"],
} as const;

expect(Object.fromEntries(repositorySourceProviders.map((provider) => [provider.id, provider.sourcePaths]))).toEqual(
  expectedProviders,
);
expect(repositorySourceReferences().every((reference) => reference.usage.recordId && reference.usage.field)).toBe(true);
```

Create `tests/source-document-loader.test.ts` with an injected Supabase query double and these cases:

```ts
it("scopes anonymous reads to deliberately public documents", async () => {
  const result = await loadVisibleDocumentSourceReferences({
    viewerId: async () => undefined,
    query: () => queryDouble,
  });
  expect(queryDouble.filters).toContainEqual(["is", "owner_id", null]);
  expect(queryDouble.filters).toContainEqual(["eq", "metadata->>public_corpus", "true"]);
  expect(result.references.every((reference) => reference.documentId)).toBe(true);
});

it("includes a signed-in owner's documents plus public documents", async () => {
  await loadVisibleDocumentSourceReferences({
    viewerId: async () => "11111111-1111-4111-8111-111111111111",
    query: () => queryDouble,
  });
  expect(queryDouble.orFilter).toContain("owner_id.eq.11111111-1111-4111-8111-111111111111");
  expect(queryDouble.orFilter).toContain("metadata->>public_corpus.eq.true");
});

it("returns only allowlisted catalogue fields", () => {
  const [reference] = documentRowsToSourceReferences([
    { ...indexedDocument, storage_path: "private/path", metadata: { ...metadata, patient_name: "hidden" } },
  ]);
  expect(JSON.stringify(reference)).not.toContain("private/path");
  expect(JSON.stringify(reference)).not.toContain("patient_name");
});

it("excludes registry projections and non-indexed uploads", () => {
  expect(documentRowsToSourceReferences([registryProjection, queuedUpload])).toEqual([]);
});
```

- [ ] **Step 2: Run both tests to confirm the red state**

Run: `node scripts/run-vitest.mjs run tests/source-catalogue-providers.test.ts tests/source-document-loader.test.ts`

Expected: FAIL because the provider registry and document loader do not exist.

- [ ] **Step 3: Implement one registered provider contract and all current repository adapters**

Create `src/lib/sources/repository-providers.ts` and mark it `server-only`. Use this exact contract:

```ts
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
    | "calculators";
  sourcePaths: readonly string[];
  references(): ClinicalSourceReferenceInput[];
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
];

export function repositorySourceReferences() {
  return repositorySourceProviders.flatMap((provider) => provider.references());
}
```

Implement adapters conservatively:

- Dictionary: use `dictionarySources`; collect usages from `dictionaryEntries.sourceRefs`, distinction refs and comparison refs; map `organisation`, `region` and `accessedOn` without treating `clinicalApproval: pending` as approval.
- Factsheets: use exported `factsheets`; each sheet's `sources` produces a usage with `modeId: "factsheets"`, record slug/title and field `sources`; `tag` maps only to the explicit source-type vocabulary and unknown tags stay `unknown`.
- Formulation: use `formulationSourceLibrary` and every mechanism's source IDs; link source-library entries to `modeId: "formulation"`; missing publisher, dates and validation remain unknown.
- Therapy: import `src/data/therapies-source.json` server-side; use each explicit `sources[]` item as a provisional uploaded-document reference; do not split names mentioned inside `reference`; `reviewChecklist.sourceChecked === false` and `reviewStatus === "needs_review"` force unverified D.
- Specifiers: emit the seven exact `authoritativeSources()` entries; separately emit one provisional D entry for each distinct `sourceFamily` used by review records because rows do not identify which authoritative URL supports them.
- Forms: import `data/forms-page-snapshot.json`; project each `sourceDocuments[]` record by its stable `id`, safe title/file name, kind and Forms usage only. Do not copy excerpts, extracted text, local artifact paths or generated prose. Unknown authority and validation remain review debt.
- MHA: use `mhaActMetadata.sourceUrl`, `actVersion` and `actAsAt`; classify as WA legislation and record application usage under Forms without copying section text.
- Medication: traverse `loadMedicationSnapshot()` and emit each row whose section title is `Sources` or whose key is `Source Review` as one provisional legacy reference associated with that medication. Do not split publisher or product names from its prose; every distinct row remains visible as D until upstream metadata becomes structured.
- Services: import the production service catalogue. Emit one reference per explicit `public_source_urls[]` URL and one provisional reference per distinct `source_documents[]` identity, preserving every service usage. Ignore `deep_research_citation_tokens`, `search_text`, contact details and analyst notes because they are neither canonical source identities nor safe metadata.
- DSM: import `src/data/dsm-clinical-content.json` server-side and emit its explicit `source_repository` plus export version/generated date as one structured dataset source used by each diagnosis. Do not pretend the snapshot identifies a licensed manual edition or publisher when it does not.
- Calculators: use exported `calculators`; emit each exact `source` string as a provisional reference used by that calculator. Do not infer DOI, journal, evidence type, approval or publisher from the citation prose.

- [ ] **Step 4: Implement the server-only accessible-document loader**

Create `src/lib/sources/document-source-loader.ts` with an injectable query seam. Use `createSupabaseServerClient()` only to resolve the current user and `createAdminClient()` only for the established explicitly-scoped document query. Apply `withOwnerReadScope()` before awaiting the query.

```ts
const DOCUMENT_SOURCE_COLUMNS = "id,owner_id,title,file_name,status,metadata,updated_at";

function createDocumentSourceQuery() {
  return createAdminClient().from("documents").select(DOCUMENT_SOURCE_COLUMNS);
}

type DocumentSourceQuery = ReturnType<typeof createDocumentSourceQuery>;

export type DocumentSourceLoadResult = {
  references: ClinicalSourceReferenceInput[];
  availability: "available" | "unavailable";
};

export type DocumentSourceLoaderDependencies = {
  viewerId(): Promise<string | undefined>;
  query(): DocumentSourceQuery;
};

const defaultDocumentSourceLoaderDependencies: DocumentSourceLoaderDependencies = {
  async viewerId() {
    const client = await createSupabaseServerClient();
    if (!client) return undefined;
    const { data, error } = await client.auth.getUser();
    return error ? undefined : data.user?.id;
  },
  query: createDocumentSourceQuery,
};

export async function loadVisibleDocumentSourceReferences(
  dependencies: DocumentSourceLoaderDependencies = defaultDocumentSourceLoaderDependencies,
): Promise<DocumentSourceLoadResult> {
  try {
    const viewerId = await dependencies.viewerId();
    const query = withOwnerReadScope(dependencies.query(), viewerId);
    const { data, error } = await query.eq("status", "indexed").order("updated_at", { ascending: false });
    if (error) return { references: [], availability: "unavailable" };
    return { references: documentRowsToSourceReferences(data ?? []), availability: "available" };
  } catch {
    return { references: [], availability: "unavailable" };
  }
}
```

`documentRowsToSourceReferences()` must call `normalizeSourceMetadata(row.metadata)`, exclude `source_kind === "registry_record"`, emit internal `/documents/<encoded-id>` locations, and copy only title/file-name fallback, publisher/code, jurisdiction, version, dates, document/validation status and safe topic labels already present in structured metadata. Do not return `owner_id` or raw metadata.

- [ ] **Step 5: Assemble the complete server catalogue with availability state**

Create `src/lib/sources/load-source-catalogue.ts`:

```ts
import "server-only";

export type LoadedSourceCatalogue = {
  entries: ClinicalSourceCatalogueEntry[];
  hostedDocuments: "available" | "unavailable";
};

export async function loadSourceCatalogue(): Promise<LoadedSourceCatalogue> {
  const documents = await loadVisibleDocumentSourceReferences();
  return {
    entries: canonicalizeSourceReferences([...repositorySourceReferences(), ...documents.references]),
    hostedDocuments: documents.availability,
  };
}
```

- [ ] **Step 6: Add the offline automatic-coverage check**

Create `scripts/check-source-catalogue.ts`. It must import only repository providers, never Supabase. It fails on duplicate provider IDs, duplicate registered paths, a provider with no references, dangling dictionary/formulation source IDs, missing coverage for any calculator source, medication Source Review row, service public URL/source-document identity, Forms source-document ID or DSM `source_repository`, unsafe structured URLs or a reference without usage. It reports but does not fail on missing publisher/version/dates/jurisdiction/evidence type/validation; those counts are review debt.

This is the automatic-addition boundary: adding a record or source to any registered production owner above changes the catalogue on the next request with no catalogue edit. Adding a genuinely new source-bearing dataset is intentionally fail-closed work: its provider ID/path must be registered and tested rather than being silently scraped from prose. This preserves automatic capture without broad repository URL scanning or invented clinical metadata.

Add to `package.json`:

```json
"check:source-catalogue": "node scripts/run-tsx.mjs scripts/check-source-catalogue.ts"
```

Keep the script standalone for fast Sources work. Automatic enforcement comes from `tests/source-catalogue-providers.test.ts`, which is already included by the repository's full `npm test`/`verify:cheap` path. Do not modify the gate manifest, CI workflow or `verify-pr-local` selector merely to call the same provider contract twice.

- [ ] **Step 7: Run the focused provider, loader and offline coverage checks**

Run:

```bash
node scripts/run-vitest.mjs run tests/source-catalogue-core.test.ts tests/source-catalogue-providers.test.ts tests/source-document-loader.test.ts
npm run check:source-catalogue
```

Expected: all tests PASS; the offline check reports captured source counts and review-debt counts without contacting Supabase.

- [ ] **Step 8: Commit Task 2**

```bash
git add package.json scripts/check-source-catalogue.ts src/lib/sources/repository-providers.ts src/lib/sources/document-source-loader.ts src/lib/sources/load-source-catalogue.ts tests/source-catalogue-providers.test.ts tests/source-document-loader.test.ts
git commit -m "feat(sources): aggregate governed source providers"
```

---

### Task 3: Sources application mode, routes and accessible interface

**Files:**

- Create: `src/components/sources/sources-catalogue-client.tsx`
- Create: `src/components/sources/sources-pages.tsx`
- Create: `src/app/(search-app)/sources/page.tsx`
- Create: `src/app/(search-app)/sources/topics/page.tsx`
- Create: `src/app/(search-app)/sources/publishers/page.tsx`
- Create: `src/app/(search-app)/sources/method/page.tsx`
- Create: `src/app/(search-app)/sources/[sourceId]/page.tsx`
- Modify: `src/app/(search-app)/dictionary/sources/page.tsx`
- Modify: `src/lib/app-modes.ts`
- Modify: `src/lib/category-identity.ts`
- Modify: `src/lib/category-identity-icons.ts`
- Modify: `src/lib/ui-copy.ts`
- Modify: `src/lib/universal-search-mode-context.ts`
- Modify: `src/lib/tools-catalog.ts`
- Modify: `src/lib/mode-secondary-navigation.ts`
- Modify: `src/components/mode-nav/registry-mode-nav.tsx`
- Modify: `src/components/clinical-dashboard/ClinicalSidebar.tsx`
- Modify: `src/components/clinical-dashboard/use-sidebar-pins.ts`
- Modify: `src/lib/search-shell-props.ts`
- Modify: `src/lib/information-pages.ts`
- Modify: `tests/app-modes.test.ts`
- Modify: `tests/category-identity.test.ts`
- Modify: `tests/ui-copy.test.ts`
- Modify: `tests/tools-catalog.test.ts`
- Modify: `tests/mode-secondary-navigation.test.ts`
- Modify: `tests/search-shell-props.test.ts`
- Modify: `tests/shared-home-empty-state.dom.test.tsx`
- Modify: `tests/sidebar-pins.test.ts`
- Modify: `tests/sidebar-production.dom.test.tsx`
- Modify: `tests/route-reachability.test.ts`
- Create: `tests/sources-mode.dom.test.tsx`

**Interfaces:**

- Consumes: Task 2 `loadSourceCatalogue()` and Task 1 filters/facets.
- Produces: application mode ID `sources`, routes `/sources`, `/sources/topics`, `/sources/publishers`, `/sources/method`, `/sources/[sourceId]`, redirect `/dictionary/sources?*` to `/sources?usedBy=dictionary`, and accessible read-only catalogue components.

- [ ] **Step 1: Restore/link dependencies and read the version-matched Next.js guidance before route code**

Read `docs/agents/codex-dependency-shortcut.md` and use its exact-lock shortcut if available. If dependencies must be restored, wait for the repository run coordinator and run the documented restoration command; do not install during another worktree's test/build lease.

Then locate and read the installed Next.js App Router pages for async `params`, async `searchParams`, Server Components and redirects:

```bash
rg -n "params.*Promise|searchParams.*Promise|redirect\(" node_modules/next/dist/docs -g "*.md" -g "*.mdx"
```

Expected: implementation follows the installed Next version rather than remembered APIs.

- [ ] **Step 2: Write failing mode-wiring and DOM tests**

Extend exhaustive mode tests to require 16 modes, `appModeHomeHref("sources", { query: "RANZCP", run: true }) === "/sources?q=RANZCP&run=1"`, a unique Sources icon, shared-home copy, a Tools catalogue record, the four secondary destinations and Sources in the sidebar's More modes/pinnable set without changing the six default pins.

Create `tests/sources-mode.dom.test.tsx` using a small fixture catalogue. Assert:

```ts
expect(screen.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
expect(screen.getByText("A · Preferred")).toBeVisible();
expect(screen.getByLabelText("Filter by quality band")).toHaveValue("");
expect(screen.getByLabelText("Sort sources")).toHaveValue("quality");
expect(screen.getByRole("status")).toHaveTextContent("2 sources");
expect(screen.getByText("Hosted document sources are temporarily unavailable")).toBeVisible();
expect(screen.queryByText(/storage_path|owner_id|patient/i)).not.toBeInTheDocument();
```

Add interaction cases for `usedBy=dictionary`, band and publisher filters, quality/title sorting, reset, empty state, topic links, publisher grouping, Method weights and detail-page three-location labels.

- [ ] **Step 3: Run mode and DOM tests to confirm the red state**

Run:

```bash
node scripts/run-vitest.mjs run tests/app-modes.test.ts tests/category-identity.test.ts tests/ui-copy.test.ts tests/shared-home-empty-state.dom.test.tsx tests/tools-catalog.test.ts tests/mode-secondary-navigation.test.ts tests/search-shell-props.test.ts tests/sidebar-pins.test.ts tests/sidebar-production.dom.test.tsx tests/sources-mode.dom.test.tsx
```

Expected: FAIL because Sources is not yet an app mode and its components do not exist.

- [ ] **Step 4: Wire Sources through the existing exhaustive mode owners**

Make these exact additions:

- `appModeIds`: append `"sources"`.
- `appModeDefinitions`: label `Sources`, description `Ranked clinical source catalogue and traceability`, href `/sources`, local `tools` search, placeholder `Search sources, publishers, or topics...`, result heading `Sources`, next step `Filter by quality, location, publisher, topic, or usage`.
- `namespaceIsolatedModes`: add `sources`.
- `CATEGORY_ICON_KEYS`: add `libraryBig`; bind it to Lucide `LibraryBig`; use it for both `APP_MODE_ICON.sources` and new `TOOL_ICON["source-catalogue"]` while preserving uniqueness within each axis.
- `APP_MODE_ACCENT.sources`: use `source`.
- `sharedHomePresentation.sources`: title `Sources`, subtitle `Clinical source catalogue.`, suggestions `Australian guidelines`, `RANZCP`, `review required`.
- `preferredDomainsByMode.sources`: `[]` because Sources searches its own catalogue and is not a universal-search domain.
- `ToolCatalogId`: add `source-catalogue`; add a ready, source-backed reference-area record linking to `/sources`.
- `sidebarMoreModeIds`: append `sources`, making the mode reachable from the existing sidebar without adding a second navigation owner.
- `pinnableSidebarModeIds`: append `sources`; leave `defaultSidebarPinnedModeIds` unchanged so the new mode is discoverable and user-pinnable without displacing a current default.

Add the secondary registry and active-route logic:

```ts
sources: [
  { id: "catalogue", label: "Catalogue", href: "/sources" },
  { id: "topics", label: "Topics", href: "/sources/topics" },
  { id: "publishers", label: "Publishers", href: "/sources/publishers" },
  { id: "method", label: "Method", href: "/sources/method" },
],
```

Adopt `sources` into `MODE_NAV_ADOPTED_MODES`, use density `balanced-four`, and map icons `catalogue: LibraryBig`, `publishers: Landmark`, `method: Scale`. Preserve `q` and `usedBy` when navigating Catalogue/Topics/Publishers; Method stays clean. Return active IDs for the four exact routes and no active item on `/sources/[sourceId]`.

In `searchShellPropsForPathname`, resolve `/sources*` to `initialMode: "sources"` and `desktopSearchPlacement: "hero"`; hide the composer only on `/sources/method` and source detail routes. In `information-pages.ts`, classify only `/sources/[sourceId]` as an information page and exclude `topics`, `publishers` and `method` from the dynamic-detail rule.

- [ ] **Step 5: Build the single catalogue client surface**

Create `src/components/sources/sources-catalogue-client.tsx` as a client component. Read `q` and filters from `useSearchParams`; update filters with `router.replace`; never render another search input because the shared composer owns `q`.

Render:

- one `h1` Sources heading;
- four `<dl>` count tiles for visible/all, Australian, review-required and inactive/excluded;
- native labelled selects for band, jurisdiction, source type, publisher, topic, lifecycle, currentness, validation, application usage and sort;
- a reset button only when a filter is active;
- a restrained `<p role="status" aria-live="polite">` result count;
- a semantic desktop table at `md` and a semantic phone list below `md`, with the same band, title, publisher, location, currency, warnings and usage information;
- `<Link href={`/sources/${entry.id}`}>` for detail navigation;
- no raw score as the dominant label: show `A · Preferred`, `B · Strong`, `C · Supplementary`, `D · Review required` or `Excluded`, with the numeric score secondary;
- a degraded-state notice when `hostedDocuments === "unavailable"`.

Use native controls with `min-h-12`; provide visible labels and do not rely on colour alone.

- [ ] **Step 6: Build the shared page renderers and route modules**

Create `src/components/sources/sources-pages.tsx` with these exported server/client boundaries:

```ts
export async function SourcesCataloguePage(): Promise<ReactNode>;
export async function SourcesTopicsPage(): Promise<ReactNode>;
export async function SourcesPublishersPage(): Promise<ReactNode>;
export function SourcesMethodPage(): ReactNode;
export async function SourceDetailPage({ sourceId }: { sourceId: string }): Promise<ReactNode>;
```

All pages use `InformationPageShell`. Topics and Publishers derive from Task 1 facets and link back to URL-filtered Catalogue results. Method prints the exact weights, thresholds, exclusion-first rule, bounded Australian preference, missing-data policy and the statement that this is not RAG relevance or patient-specific guidance. Detail renders identity, canonical/geographic/application locations, all six rating dimensions, dates, lifecycle, content mode, version relations, warnings and usages; render an outbound anchor only for safe URL locations and an internal Link for document locations.

Create route modules with static metadata and async Next route props. `/sources/[sourceId]` calls `notFound()` when the entry is not visible to the current user. Do not use `generateStaticParams()` because private document entries are request-scoped.

Replace `src/app/(search-app)/dictionary/sources/page.tsx` with:

```ts
import { redirect } from "next/navigation";

export default function DictionarySourcesRedirect() {
  redirect("/sources?usedBy=dictionary");
}
```

Retain `src/components/dictionary/dictionary-sources-page.tsx` in this focused change. Removing an exported module requires the repository's dead-code-candidate workflow and is not necessary for the redirect; treat deletion as a separate follow-up only if that gate authorizes it.

- [ ] **Step 7: Run focused wiring, route and DOM tests**

Run:

```bash
node scripts/run-vitest.mjs run tests/app-modes.test.ts tests/category-identity.test.ts tests/ui-copy.test.ts tests/shared-home-empty-state.dom.test.tsx tests/tools-catalog.test.ts tests/mode-secondary-navigation.test.ts tests/search-shell-props.test.ts tests/sidebar-pins.test.ts tests/sidebar-production.dom.test.tsx tests/route-reachability.test.ts tests/sources-mode.dom.test.tsx
```

Expected: PASS with 16 modes, four Sources tabs, the Dictionary redirect, reachable routes, one shared composer owner and accessible catalogue interactions.

- [ ] **Step 8: Commit Task 3**

```bash
git add 'src/app/(search-app)/sources' 'src/app/(search-app)/dictionary/sources/page.tsx' src/components/sources src/components/mode-nav/registry-mode-nav.tsx src/components/clinical-dashboard/ClinicalSidebar.tsx src/components/clinical-dashboard/use-sidebar-pins.ts src/lib/app-modes.ts src/lib/category-identity.ts src/lib/category-identity-icons.ts src/lib/ui-copy.ts src/lib/universal-search-mode-context.ts src/lib/tools-catalog.ts src/lib/mode-secondary-navigation.ts src/lib/search-shell-props.ts src/lib/information-pages.ts tests/app-modes.test.ts tests/category-identity.test.ts tests/ui-copy.test.ts tests/shared-home-empty-state.dom.test.tsx tests/tools-catalog.test.ts tests/mode-secondary-navigation.test.ts tests/search-shell-props.test.ts tests/sidebar-pins.test.ts tests/sidebar-production.dom.test.tsx tests/route-reachability.test.ts tests/sources-mode.dom.test.tsx
git commit -m "feat(sources): add source catalogue mode"
```

---

### Task 4: Browser proof, generated documentation and bounded handoff

**Files:**

- Create: `tests/ui-sources.spec.ts`
- Modify: `tests/ui-dictionary.spec.ts`
- Modify: `scripts/playwright-pr-shards.mjs`
- Modify: `docs/codebase-index.md`
- Modify only generated files changed by: `npm run docs:update`

**Interfaces:**

- Consumes: completed Sources mode from Tasks 1–3 and the repository test coordinator.
- Produces: focused browser evidence, route/documentation synchronization, final diff review and an implementation handoff with provider/hosted checks still explicitly gated.

- [ ] **Step 1: Write the focused browser journey**

Remove `/dictionary/sources` from the old Dictionary page matrix, because it no longer renders `dictionary-sources-main`. Create `tests/ui-sources.spec.ts` using the same external-request blocker and overflow helper as `tests/ui-dictionary.spec.ts`; import `AxeBuilder` from `@axe-core/playwright`. Cover the redirect plus these exact journeys:

```ts
test("Dictionary sources redirects into the Sources catalogue", async ({ page }) => {
  await page.goto("/dictionary/sources", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/sources\?usedBy=dictionary$/);
  await expect(page.getByLabel("Filter by application usage")).toHaveValue("dictionary");
});

test("@critical Sources catalogue filters and opens traceability", async ({ page }) => {
  await page.goto("/sources?usedBy=dictionary", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
  await expect(page.getByLabel("Filter by application usage")).toHaveValue("dictionary");
  await page.getByLabel("Filter by quality band").selectOption("D");
  await expect(page.getByRole("status")).toContainText("source");
  await page
    .getByRole("link", { name: /view source details/i })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 2, name: "Source locations" })).toBeVisible();
  await expect(page.getByText("Application location")).toBeVisible();
});

test("Sources remains operable at phone width and under accessibility media", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "forced-colors emulation is Chromium-only");
  await page.setViewportSize({ width: 320, height: 760 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto("/sources");
  await expect(page.getByTestId("sources-catalogue-main")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  await testInfo.attach("sources-axe", {
    body: JSON.stringify(axe.violations, null, 2),
    contentType: "application/json",
  });
  expect(
    axe.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious"),
  ).toEqual([]);
});
```

Add `tests/ui-sources.spec.ts` to an appropriate shard in `scripts/playwright-pr-shards.mjs`; do not add it to mockup projects.

- [ ] **Step 2: Start the verified local app and run only the Sources browser file**

Run: `npm run ensure`

Use only the printed URL after `/api/local-project-id` confirms this project.

Run: `node scripts/run-playwright.mjs tests/ui-sources.spec.ts --project=chromium`

Expected: PASS for Catalogue/detail navigation, 320px overflow, keyboard focus, reduced motion, forced colours and serious/critical axe violations.

- [ ] **Step 3: Synchronize route documentation**

Add a concise Sources entry to `docs/codebase-index.md`, then run: `npm run docs:update`

Inspect the generated diff. Keep only the documentation, site-map and inventory changes required by the new production routes; do not absorb unrelated snapshots or concurrent work.

Run:

```bash
npm run docs:check-index
npm run sitemap:check
git diff --check
```

Expected: all three PASS.

- [ ] **Step 4: Run the final offline source and focused domain checks**

Run:

```bash
npm run check:source-catalogue
node scripts/run-vitest.mjs run tests/source-catalogue-core.test.ts tests/source-catalogue-providers.test.ts tests/source-document-loader.test.ts tests/sources-mode.dom.test.tsx tests/app-modes.test.ts tests/category-identity.test.ts tests/ui-copy.test.ts tests/shared-home-empty-state.dom.test.tsx tests/tools-catalog.test.ts tests/mode-secondary-navigation.test.ts tests/search-shell-props.test.ts tests/sidebar-pins.test.ts tests/sidebar-production.dom.test.tsx tests/route-reachability.test.ts
```

Expected: PASS. This is local/offline proof only; it does not establish hosted Supabase completeness or production readiness.

- [ ] **Step 5: Confirm the RAG and privacy boundaries in the final diff**

Run:

```bash
git diff --name-only 058693b97 -- | rg "^(src/lib/rag/|src/app/api/(ask|search)|supabase/migrations/)"
rg -n "document_chunks|embedding|rag_queries|patient|storage_path|owner_id" src/components/sources src/lib/sources
```

Expected: the first command prints nothing. The second may find only explicit privacy assertions/tests or server-side scoping; it must find no browser projection of prohibited fields.

- [ ] **Step 6: Check gate receipts and buy one broad local verdict at most**

Run: `npm run receipts` (the former gate-arbiter helper was retired on 2026-09-17), then `npm run verify:pr-local`

- If no matching receipt is present, execute `npm run verify:pr-local` once and record the decisive output.
- If a content-addressed receipt is reused, report the exact reused receipt/SHA and timestamp; do not rerun it.

Do not run live RAG evaluations: this change does not alter retrieval or answers. Do not run `npm run check:production-readiness`, `npm run audit:source-governance`, any live Supabase audit or provider command unless the user separately authorizes that exact connected check.

- [ ] **Step 7: Review the complete diff and commit Task 4**

Inspect `git status --short`, `git diff --stat`, `git diff` and `git diff --check`. Confirm no raw metadata, document content, RAG change, migration, debug output, placeholder, duplicate navigation owner or unrelated file is included.

```bash
git add tests/ui-sources.spec.ts tests/ui-dictionary.spec.ts scripts/playwright-pr-shards.mjs docs/codebase-index.md docs/site-map.md docs/scripts-index.md
git commit -m "test(sources): verify catalogue routes and accessibility"
```

Stage only generated documentation files that actually changed. Do not push, open a PR, deploy or run connected checks.

## Completion Evidence

At handoff, report:

- exact source counts by provider and D-band review-debt count from `check:source-catalogue`;
- exact focused Vitest and Playwright commands with results;
- whether `verify:pr-local` ran, deferred or reused proof;
- that Supabase document metadata was tested locally through injected fixtures;
- that no live Supabase completeness audit, production-readiness gate, RAG evaluation, migration, deployment, push or PR was performed;
- the branch, local commits, final worktree status and any residual legacy-source debt.

## Residual Risk Boundaries

- Free-text therapy and specifier source families remain provisional D entries until upstream content supplies exact structured citations.
- The provider registry automatically incorporates new references added to registered source-bearing schemas. A genuinely new source-bearing dataset must declare a provider and source path; the offline check rejects an invalid or empty provider but does not infer arbitrary new schemas.
- Local fixture proof establishes access projection logic, not current hosted catalogue completeness. A metadata-only hosted read remains a separately authorised acceptance step.
- Catalogue rating is deterministic organisation, not clinical endorsement, patient-specific guidance or evidence of factual accuracy.
