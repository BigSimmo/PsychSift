import { normalizeSearchText } from "@/lib/catalog-search";
import { analyzeClinicalQuery, clinicalFacetSynonymTerms } from "@/lib/clinical-search";
import { consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";
import { demoSearch } from "@/lib/demo-data";
import { documentsSearchHref } from "@/lib/document-flow-routes";
import {
  differentialPresentations,
  differentialRecords,
  rankDifferentialRecords,
  rankPresentationWorkflows,
} from "@/lib/differentials";
import { diagnosisOwnSummary } from "@/lib/differential-snapshot";
import { dsmDiagnosisSummary, rankDsmDiagnoses } from "@/lib/dsm";
import { dictionaryKindLabel, searchDictionary } from "@/lib/dictionary";
import { formRecords, rankFormRecords, type FormRecord } from "@/lib/forms";
import { logger } from "@/lib/logger";
import { defaultMedicationRecords } from "@/lib/medication-seed";
import { analyzeMedicationCatalogQuery } from "@/lib/medication-query";
import { medicationIndication, rankMedicationRecords, type MedicationRecord } from "@/lib/medications";
import { catalogueSearchScope, readCatalogueWithSeedFallback } from "@/lib/site-content/catalogue-seed-fallback";
import { readCanonicalSiteContentRecords } from "@/lib/site-content/site-content-publication";
import { preferBundledFormRecord, siteContentSnapshotReleaseId } from "@/lib/site-content/prefer-bundled-form-record";
import { bundledServicesMissingFrom, preferBundledServiceRecord } from "@/lib/site-content/bundled-service-catalogue";
import { searchChunksWithTelemetry } from "@/lib/rag/rag";
import { registryCorpusDetailHref } from "@/lib/registry-corpus-links";
import { rankServiceRecords, serviceRecords, type ServiceRecord } from "@/lib/services";
import { searchFormulationMechanisms } from "@/lib/formulation";
import { searchSpecifiers as searchPsychiatricSpecifiers } from "@/lib/specifiers";
import { smartSearchExpansions } from "@/lib/smart-search-intent";
import { searchTherapyRecords, therapyNeedsReview } from "@/lib/therapies";
import { rankToolRecords } from "@/lib/tools-catalog";
import type { ClinicalQueryAnalysis, SearchResult } from "@/lib/types";
import { universalSearchDomains, type UniversalSearchDomain } from "@/lib/universal-search-domains";
import { universalSearchPreferredDomains } from "@/lib/universal-search-mode-context";
import type { AppModeId } from "@/lib/app-modes";

// Server-side federated cross-entity search: one parallel in-process fan-out to the document
// retrieval pipeline plus the shared registry rankers (medications, services, forms,
// differentials, tools). Chosen over client-side federation (N round-trips per keystroke,
// duplicated auth/demo handling) and over ingesting registry rows into the eval-gated
// pgvector corpus (couples registry edits to reindexing; kept as a documented follow-up so
// Answer mode can eventually cite registry entities).

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

// Domain type + canonical order live in the universal-search-domains leaf module (client
// code value-imports the list from there); re-exported here for server consumers.
export { universalSearchDomains };
export type { UniversalSearchDomain };

export type UniversalSearchItem = {
  id: string;
  kind: UniversalSearchDomain;
  title: string;
  subtitle?: string;
  href: string;
  // Comparable within a group only: registry scores are integer term-weights while document
  // scores live in [0,1]. Cross-domain ordering is by fixed group order, never by score.
  score: number;
  badge?: string;
  meta?: string;
  // Set server-side: the item's title is a whole-phrase match of the (typo-corrected) query,
  // i.e. a near-exact hit. Drives best-bet (topHit) selection; comparable across domains
  // because it is a boolean about the query text, not a cross-domain score.
  confident?: boolean;
};

export type UniversalSearchGroup = {
  kind: UniversalSearchDomain;
  total: number;
  items: UniversalSearchItem[];
  latencyMs: number;
  error?: boolean;
  /**
   * The domain answered, but from the in-bundle catalogue rather than the published one, because
   * the canonical read could not be completed. Results are real and may lag the latest release.
   * Present so the response says so out loud — a silent fallback is how the 2026-09-16 outage
   * would repeat with results on screen to hide it.
   */
  degraded?: boolean;
};

// How the raw query was understood, so the UI can show a "Showing results for… / Did you
// mean" affordance. Derived once from analyzeClinicalQuery (the same layer /api/search uses).
export type UniversalSearchInterpretation = {
  // Present only when typo corrections changed the query (e.g. "clozapin" -> "clozapine").
  correctedQuery?: string;
  typoCorrections?: Array<{ from: string; to: string }>;
  // Synonym/acronym/alias terms actually threaded into the registry rankers.
  appliedExpansions?: string[];
  queryClass?: string;
  intent?: string;
};

// A single highlighted best-bet across all domains: the strongest near-exact match, preferring
// the intent-favoured domain. Absent when no confident match exists (no misleading best-bet).
export type UniversalSearchTopHit = UniversalSearchItem & { reason?: string };

// A jump into Answer mode for question-like queries.
export type UniversalSearchAnswerAction = { href: string; label: string };

export type UniversalSearchResponse = {
  query: string;
  groups: UniversalSearchGroup[];
  tookMs: number;
  interpretation?: UniversalSearchInterpretation;
  // Intent-aware order the client should render groups in (a permutation of the requested
  // domains). Only the group order changes — within-group scores are untouched.
  domainOrder?: UniversalSearchDomain[];
  topHit?: UniversalSearchTopHit;
  answerAction?: UniversalSearchAnswerAction;
  contextMode?: AppModeId;
  preferredDomains?: UniversalSearchDomain[];
  // demoMode / publicAccess are attached by the route to its JSON response, not by runUniversalSearch.
};

export type RunUniversalSearchArgs = {
  query: string;
  limitPerDomain: number;
  domains?: UniversalSearchDomain[];
  contextMode?: AppModeId;
  // Live mode: both present. Demo/public mode: demo=true and the registry adapters serve
  // fixtures without touching Supabase.
  supabase?: AdminClient;
  ownerId?: string;
  demo: boolean;
  signal?: AbortSignal;
  // Optional progressive delivery hook. Domain work remains parallel; each completed group is
  // reported immediately while the final response preserves canonical group order.
  onGroup?: (group: UniversalSearchGroup) => void | Promise<void>;
};

// Args after query understanding: registry adapters rank against baseQuery (typo-corrected)
// with expansions in the low-weight lane; the documents adapter keeps the ORIGINAL query
// because searchChunksWithTelemetry runs its own analyzeClinicalQuery (double-expanding would
// double-count).
type ResolvedSearchArgs = RunUniversalSearchArgs & {
  baseQuery: string;
  expansions: string[];
  /**
   * Domains that answered THIS request from the in-bundle catalogue. Created per call and written
   * by the adapter that actually fell back.
   *
   * It has to be per-request. The first version read the fallback's process-wide cooldown after
   * the adapter returned, which is shared state and races both ways: a concurrent request that
   * recovered could clear the cooldown before this one read it, so a response built from seeds
   * would claim to be canonical — and the live monitor, whose whole job is to catch exactly that,
   * would be told the catalogue was healthy.
   */
  degradedDomains: Set<UniversalSearchDomain>;
};

const registryDomainTimeoutMs = 2500;
// Typeahead documents are lexical-only previews. Keep federated requests well below the full
// retrieval budget so an empty/slow documents domain cannot dominate Promise.all wall time.
// A caller that explicitly requests only documents is doing focused search and can use the
// prior full budget without delaying any sibling domains.
const documentsFederatedDomainTimeoutMs = 750;
const documentsFocusedDomainTimeoutMs = 6000;
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
  callerSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timeout = setTimeout(() => {
    controller.abort(new DOMException(`${label} search timed out after ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);
  let rejectOnAbort: ((reason: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = () => rejectOnAbort?.(abortReason(controller.signal));
  controller.signal.addEventListener("abort", onAbort, { once: true });
  if (controller.signal.aborted) onAbort();

  try {
    return await Promise.race([run(controller.signal), aborted]);
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

function medicationItem(record: MedicationRecord, score: number): UniversalSearchItem {
  return {
    id: record.slug,
    kind: "medications",
    title: record.name,
    subtitle: medicationIndication(record),
    href: `/medications/${record.slug}`,
    score,
    badge: record.schedule || undefined,
    meta: [record.class, record.subclass].filter(Boolean).join(" · ") || undefined,
  };
}

function serviceItem(record: ServiceRecord, score: number): UniversalSearchItem {
  return {
    id: record.slug,
    kind: "services",
    title: record.title,
    subtitle: record.subtitle ?? undefined,
    href: `/services/${record.slug}`,
    score,
    badge: record.statusChips?.[0]?.label ?? undefined,
    meta: record.primaryContact?.value ?? undefined,
  };
}

function formItem(record: FormRecord, score: number): UniversalSearchItem {
  return {
    id: record.slug,
    kind: "forms",
    title: record.title,
    subtitle: record.subtitle ?? undefined,
    href: `/forms/${record.slug}`,
    score,
    badge: record.catalogueLabel ?? undefined,
  };
}

/**
 * Record that this domain answered from seeds, and hand the outcome straight back.
 *
 * Written where the fallback actually happened, for this request only. Reading the fallback's
 * shared cooldown afterwards instead was wrong in both directions: a concurrent recovery could
 * clear it before this request looked, marking a seed-built response canonical, and a concurrent
 * failure could mark a genuinely canonical response degraded.
 */
function recordDegraded<T>(
  args: ResolvedSearchArgs,
  domain: UniversalSearchDomain,
  outcome: { records: T[]; degraded: boolean },
): { records: T[] } {
  if (outcome.degraded) args.degradedDomains.add(domain);
  return outcome;
}

async function searchMedicationsDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  const records =
    !args.demo && args.supabase
      ? recordDegraded(
          args,
          "medications",
          await readCatalogueWithSeedFallback({
            kind: "medication",
            scope: catalogueSearchScope,
            seeds: defaultMedicationRecords(),
            signal: args.signal,
            read: async (signal) =>
              (
                await readCanonicalSiteContentRecords({
                  supabase: args.supabase,
                  kind: "medication",
                  slug: null,
                  cache: true,
                  renderOnly: true,
                  seeds: defaultMedicationRecords(),
                  signal,
                })
              ).records,
          }),
        ).records
      : defaultMedicationRecords();
  // Catalog-local typo/brand understanding (not clinical-search / RAG analysis).
  // Prefer catalog corrections when they change the query; otherwise keep the
  // shared clinical-search correction (e.g. monitring → monitoring) and its
  // expansions so the medications domain does not ignore the federated base.
  const catalogAnalysis = analyzeMedicationCatalogQuery(args.query, records);
  const catalogCorrected =
    catalogAnalysis.corrections.length > 0 &&
    catalogAnalysis.correctedQuery.trim().toLowerCase() !== catalogAnalysis.originalQuery.trim().toLowerCase()
      ? catalogAnalysis.correctedQuery
      : "";
  const rankingQuery = catalogCorrected || args.baseQuery;
  const rankingExpansions = Array.from(new Set([...catalogAnalysis.expansions, ...args.expansions]));
  return rankMedicationRecords(records, rankingQuery, args.limitPerDomain, rankingExpansions).map((match) =>
    medicationItem(match.medication, match.score),
  );
}

async function searchServicesDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  const records =
    !args.demo && args.supabase
      ? recordDegraded(
          args,
          "services",
          await readCatalogueWithSeedFallback({
            kind: "service",
            scope: catalogueSearchScope,
            seeds: serviceRecords,
            signal: args.signal,
            read: async (signal) => {
              const result = await readCanonicalSiteContentRecords({
                supabase: args.supabase,
                kind: "service",
                slug: null,
                cache: true,
                // Search ranks and renders `render_payload` only, so it skips the `record` column:
                // about half of the 2.6 MB service read (measured live 2026-10-06).
                renderOnly: true,
                seeds: serviceRecords,
                signal,
              });
              // Until the catalogue is published, the served release is the 2026-08-24 freeze and
              // does not contain the 17 services added by #2814 -- SARC, 1800RESPECT, StandBy and
              // the other crisis and postvention entries. Refresh what it does have, then top up
              // what it does not. Both are no-ops once a real release is active.
              const activeReleaseId = siteContentSnapshotReleaseId(result.snapshot);
              const refreshed = result.records.map(
                (record) => preferBundledServiceRecord({ record }, { activeReleaseId }).record,
              );
              return [...refreshed, ...bundledServicesMissingFrom(refreshed, { activeReleaseId })];
            },
          }),
        ).records
      : serviceRecords;
  return rankServiceRecords(records, args.baseQuery, args.limitPerDomain, args.expansions).map((match) =>
    serviceItem(match.service, match.score),
  );
}

async function searchFormsDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  const records =
    !args.demo && args.supabase
      ? recordDegraded(
          args,
          "forms",
          await readCatalogueWithSeedFallback({
            kind: "form",
            scope: catalogueSearchScope,
            seeds: formRecords,
            signal: args.signal,
            read: async (signal) => {
              const result = await readCanonicalSiteContentRecords({
                supabase: args.supabase,
                kind: "form",
                slug: null,
                cache: true,
                // As services: `render_payload` only, about 40% smaller than the full read.
                renderOnly: true,
                seeds: formRecords,
                signal,
              });
              const activeReleaseId = siteContentSnapshotReleaseId(result.snapshot);
              return result.records.map(
                (record) => preferBundledFormRecord("form", { record }, { activeReleaseId }).record,
              );
            },
          }),
        ).records
      : formRecords;
  return rankFormRecords(records, args.baseQuery, args.limitPerDomain, args.expansions).map((match) =>
    formItem(match.service, match.score),
  );
}

async function searchDifferentialsDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  // Differentials are a static snapshot for list/search purposes (owner edits surface only on
  // detail pages today), so demo and live share the in-bundle catalogue.
  return rankDifferentialRecords(differentialRecords, args.baseQuery, args.limitPerDomain, args.expansions).map(
    (match) => ({
      id: match.record.slug,
      kind: "differentials",
      title: match.record.title,
      subtitle: diagnosisOwnSummary(match.record) || undefined,
      href: `/differentials/diagnoses/${match.record.slug}`,
      score: match.score,
    }),
  );
}

async function searchPresentationsDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  // Presentations share the differentials snapshot (owner edits surface only on detail pages
  // today), so demo and live share the in-bundle catalogue. The ranker's cross-entity lane
  // also matches candidate differential titles, so a diagnosis-shaped query surfaces the
  // umbrella work-up alongside the diagnosis itself.
  return rankPresentationWorkflows(
    differentialPresentations(),
    args.baseQuery,
    args.limitPerDomain,
    args.expansions,
  ).map((match) => ({
    id: match.workflow.id,
    kind: "presentations",
    title: match.workflow.title,
    subtitle: match.workflow.subtitle || undefined,
    href: `/differentials/presentations/${match.workflow.id}`,
    score: match.score,
    badge:
      match.workflow.status === "emergent" ? "Emergent" : match.workflow.status === "urgent" ? "Urgent" : undefined,
    meta: match.workflow.totalCount ? `${match.workflow.totalCount} differentials` : undefined,
  }));
}

async function searchDsmDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  return rankDsmDiagnoses(args.baseQuery, args.limitPerDomain, args.expansions).map((match) => {
    const summary = dsmDiagnosisSummary(match.diagnosis);
    return {
      id: match.diagnosis.slug,
      kind: "dsm" as const,
      title: match.diagnosis.title,
      subtitle: summary.summary,
      href: `/dsm/diagnoses/${match.diagnosis.slug}`,
      score: match.score,
      badge: match.diagnosis.icd_code,
      meta: match.diagnosis.category.label,
    };
  });
}

async function searchToolsDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  return rankToolRecords(args.baseQuery, args.limitPerDomain, args.expansions, {
    authenticated: Boolean(args.ownerId),
    demoMode: args.demo,
  }).map((match) => ({
    id: match.tool.id,
    kind: "tools",
    title: match.tool.title,
    subtitle: match.tool.bestFor,
    href: match.tool.href,
    score: match.score,
    badge: match.tool.sourceBacked ? "Source-backed" : undefined,
  }));
}

async function searchDictionaryDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  return searchDictionary({
    q: args.baseQuery,
    view: "all",
    topics: [],
    kinds: [],
    sources: [],
    sort: "relevance",
  })
    .slice(0, args.limitPerDomain)
    .map((hit): UniversalSearchItem => {
      if (hit.type === "entry") {
        return {
          id: hit.entry.slug,
          kind: "dictionary",
          title: hit.entry.term,
          subtitle: hit.entry.definition,
          href: `/dictionary/${hit.entry.slug}`,
          score: hit.score,
          badge: dictionaryKindLabel(hit.entry.kind),
          meta: hit.reason,
        };
      }
      if (hit.type === "abbreviation") {
        return {
          id: `abbreviation:${hit.abbreviation}`,
          kind: "dictionary",
          title: hit.abbreviation,
          subtitle: hit.senses.map((entry) => entry.term).join(" · "),
          href: `/dictionary/search?q=${encodeURIComponent(hit.abbreviation)}&view=abbreviations`,
          score: hit.score,
          badge: hit.senses.length > 1 ? `${hit.senses.length} meanings` : "Abbreviation",
          meta: hit.reason,
        };
      }
      return {
        id: `topic:${hit.topic.slug}`,
        kind: "dictionary",
        title: hit.topic.title,
        subtitle: hit.topic.description,
        href: `/dictionary/topics/${hit.topic.slug}`,
        score: hit.score,
        badge: "Topic",
        meta: hit.reason,
      };
    });
}

async function searchFormulationDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  return searchFormulationMechanisms(args.baseQuery, { expansions: args.expansions })
    .slice(0, args.limitPerDomain)
    .map(({ mechanism, score }) => ({
      id: mechanism.id,
      kind: "formulation" as const,
      title: mechanism.name,
      subtitle: mechanism.summary,
      href: `/formulation/${mechanism.id}`,
      score,
      badge: mechanism.domains[0],
      meta: mechanism.diagnosticContexts.slice(0, 2).join(" · ") || undefined,
    }));
}

async function searchSpecifiersDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  return searchPsychiatricSpecifiers(args.baseQuery, { expansions: args.expansions })
    .slice(0, args.limitPerDomain)
    .map(({ record, score }) => ({
      id: record.slug,
      kind: "specifiers" as const,
      title: record.name,
      subtitle: record.summary,
      href: `/specifiers/${record.slug}`,
      score,
      badge: record.familyLabel,
      meta: record.appliesTo.slice(0, 2).join(" · ") || undefined,
    }));
}

async function searchTherapiesDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  return searchTherapyRecords(args.baseQuery, args.expansions)
    .slice(0, args.limitPerDomain)
    .map(({ record, score }) => ({
      id: record.slug,
      kind: "therapies" as const,
      title: record.name,
      subtitle: record.clinicalSummary ?? record.bestUsedFor ?? undefined,
      href: `/therapy-compass/${record.slug}`,
      score,
      // Surface review status inline (205/211 records still await sign-off) so an
      // unreviewed therapy is flagged in discovery, not just on its detail page.
      badge: therapyNeedsReview(record) ? "Needs source review" : (record.category ?? undefined),
      meta: record.targetSymptoms ?? record.category ?? undefined,
    }));
}

function searchResultDocumentHref(result: SearchResult) {
  const metadata =
    result.source_metadata && typeof result.source_metadata === "object"
      ? (result.source_metadata as Record<string, unknown>)
      : {};
  const registryHref = registryCorpusDetailHref({
    kind: metadata.registry_record_kind as string | undefined,
    slug: metadata.registry_record_slug as string | undefined,
    subkind: metadata.registry_record_subkind as string | undefined,
    recordId: metadata.registry_record_id as string | undefined,
  });
  if (registryHref) return registryHref;
  return `/documents/${result.document_id}`;
}

function documentItemsFromChunks(results: SearchResult[], limit: number): UniversalSearchItem[] {
  const byDocument = new Map<string, UniversalSearchItem>();
  for (const result of results) {
    const score = result.hybrid_score ?? result.similarity ?? 0;
    const existing = byDocument.get(result.document_id);
    if (existing) {
      existing.score = Math.max(existing.score, score);
      continue;
    }
    byDocument.set(result.document_id, {
      id: result.document_id,
      kind: "documents",
      title: result.title,
      subtitle: result.section_heading ?? undefined,
      href: searchResultDocumentHref(result),
      score,
      meta: result.file_name,
    });
  }
  return Array.from(byDocument.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

async function searchDocumentsDomain(args: ResolvedSearchArgs): Promise<UniversalSearchItem[]> {
  // Original query on purpose: the live retrieval path runs its own analyzeClinicalQuery.
  if (args.demo || !args.supabase) {
    return documentItemsFromChunks(
      demoSearch(args.query, args.limitPerDomain * 3) as SearchResult[],
      args.limitPerDomain,
    );
  }
  const { results } = await searchChunksWithTelemetry({
    query: args.query,
    ownerId: args.ownerId,
    topK: Math.max(6, args.limitPerDomain),
    allowGlobalSearch: !args.ownerId,
    // Typeahead preview only: lexical/trigram retrieval is enough for a short document list, so
    // skip the per-keystroke OpenAI embedding round-trip. The Answer/Documents full-search paths
    // still embed. Owner scoping and public-corpus behavior are unchanged (handled downstream).
    lexicalOnly: true,
    signal: args.signal,
  });
  // Typeahead needs the already-ranked preview, not a second sequential metadata
  // query. Full document search still performs its richer enrichment downstream.
  return documentItemsFromChunks(results, args.limitPerDomain);
}

const domainAdapters: Record<
  UniversalSearchDomain,
  { run: (args: ResolvedSearchArgs) => Promise<UniversalSearchItem[]>; timeoutMs: number }
> = {
  documents: { run: searchDocumentsDomain, timeoutMs: documentsFederatedDomainTimeoutMs },
  medications: { run: searchMedicationsDomain, timeoutMs: registryDomainTimeoutMs },
  services: { run: searchServicesDomain, timeoutMs: registryDomainTimeoutMs },
  forms: { run: searchFormsDomain, timeoutMs: registryDomainTimeoutMs },
  differentials: { run: searchDifferentialsDomain, timeoutMs: registryDomainTimeoutMs },
  presentations: { run: searchPresentationsDomain, timeoutMs: registryDomainTimeoutMs },
  dsm: { run: searchDsmDomain, timeoutMs: registryDomainTimeoutMs },
  specifiers: { run: searchSpecifiersDomain, timeoutMs: registryDomainTimeoutMs },
  formulation: { run: searchFormulationDomain, timeoutMs: registryDomainTimeoutMs },
  therapies: { run: searchTherapiesDomain, timeoutMs: registryDomainTimeoutMs },
  dictionary: { run: searchDictionaryDomain, timeoutMs: registryDomainTimeoutMs },
  tools: { run: searchToolsDomain, timeoutMs: registryDomainTimeoutMs },
};

const maxExpansions = 16;

// Question-like leads that warrant an "Ask this question" bridge into Answer mode.
const questionLeadPattern = /^\s*(what|how|when|why|which|who|where|should|can|could|would|is|are|do|does|did)\b/i;

function applyTypoCorrections(query: string, corrections: Array<{ from: string; to: string }>): string {
  if (!corrections.length) return query;
  const map = new Map(corrections.map((correction) => [correction.from, correction.to] as const));
  return query
    .split(/\s+/)
    .map((token) => map.get(token.toLowerCase()) ?? token)
    .join(" ");
}

// Synonym/acronym/alias terms for the rankers' low-weight expanded lane. Dropped: the base
// query's own tokens (already scored in the high-weight field lane), generic facet words, and anything past the cap
// (analyzeClinicalQuery can emit up to ~48 vocabulary terms; too many would dilute precision).
function deriveExpansions(analysis: ClinicalQueryAnalysis, baseQuery: string): string[] {
  const baseTokens = new Set(normalizeSearchText(baseQuery).split(/\s+/).filter(Boolean));
  const seen = new Set<string>();
  const expansions: string[] = [];
  for (const term of analysis.expandedTerms) {
    const normalized = term.toLowerCase().trim();
    if (normalized.length < 2 || baseTokens.has(normalized) || seen.has(normalized)) continue;
    // Generic facet words ("dosage", "route", "IM", "review", "range") match records in every
    // catalogue, so they would pad each domain with results unrelated to the subject.
    if (clinicalFacetSynonymTerms.has(normalized)) continue;
    seen.add(normalized);
    expansions.push(normalized);
    if (expansions.length >= maxExpansions) break;
  }
  return expansions;
}

// A whole-phrase (word-boundary) occurrence of the query inside a title — the "near-exact hit"
// signal for best-bet selection. Padding both sides prevents partial-word matches.
function titleMatchesQuery(title: string, query: string): boolean {
  const needle = normalizeSearchText(query);
  if (!needle) return false;
  return ` ${normalizeSearchText(title)} `.includes(` ${needle} `);
}

// Domains whose group should lead, from query intent. Reorders groups only; scores untouched.
function preferredLeadDomains(analysis: ClinicalQueryAnalysis): UniversalSearchDomain[] {
  switch (analysis.queryClass) {
    case "medication_dose_risk":
      return ["medications"];
    case "document_lookup":
      return ["documents"];
    case "comparison":
      return ["differentials", "presentations"];
    case "table_threshold":
      return ["documents", "medications"];
    default:
      break;
  }
  if (analysis.medications.length) return ["medications"];
  if (analysis.documentTitleIntent) return ["documents"];
  return [];
}

function buildDomainOrder(
  analysis: ClinicalQueryAnalysis,
  groups: UniversalSearchGroup[],
  preferredDomains: UniversalSearchDomain[],
): UniversalSearchDomain[] {
  const present = new Set(groups.map((group) => group.kind));
  const confidentDomains = groups
    .filter((group) => group.items.some((item) => item.confident))
    .map((group) => group.kind);
  const order: UniversalSearchDomain[] = [];
  for (const domain of [
    ...preferredDomains,
    ...preferredLeadDomains(analysis),
    ...confidentDomains,
    ...universalSearchDomains,
  ]) {
    if (present.has(domain) && !order.includes(domain)) order.push(domain);
  }
  return order;
}

function buildTopHit(
  groups: UniversalSearchGroup[],
  domainOrder: UniversalSearchDomain[],
): UniversalSearchTopHit | undefined {
  const groupByKind = new Map(groups.map((group) => [group.kind, group]));
  for (const domain of domainOrder) {
    const hit = groupByKind.get(domain)?.items.find((item) => item.confident);
    if (hit) return { ...hit, reason: `Best match in ${domain}` };
  }
  return undefined;
}

function buildAnswerAction(analysis: ClinicalQueryAnalysis, query: string): UniversalSearchAnswerAction | undefined {
  const trimmed = query.trim();
  if (trimmed.length < 3) return undefined;
  const looksLikeQuestion = trimmed.endsWith("?") || questionLeadPattern.test(trimmed) || analysis.needsSynthesis;
  // A bare document lookup ("clozapine guideline") wants the document, not a generated answer.
  const bareLookup = analysis.queryClass === "document_lookup" && !analysis.needsSynthesis;
  if (!looksLikeQuestion || bareLookup) return undefined;
  return { href: `/?mode=answer&q=${encodeURIComponent(trimmed)}&run=1`, label: "Ask this question" };
}

function buildInterpretation(
  analysis: ClinicalQueryAnalysis,
  baseQuery: string,
  expansions: string[],
): UniversalSearchInterpretation {
  return {
    correctedQuery: analysis.typoCorrections.length ? baseQuery : undefined,
    typoCorrections: analysis.typoCorrections.length ? analysis.typoCorrections : undefined,
    appliedExpansions: expansions.length ? expansions : undefined,
    queryClass: analysis.queryClass,
    intent: analysis.intent,
  };
}

/**
 * A search where EVERY requested domain failed is an outage, not graceful degradation.
 *
 * Per-domain tolerance (one broken adapter must never blank the response) is right, but on
 * 2026-09-16 it was measured turning a total catalogue failure into an HTTP 200 carrying
 * `{"total":0,"items":[],"error":true}` for every domain — indistinguishable from "no matches",
 * and so quiet that it ran for seven days before an operator reported it. Nothing was logged and
 * no exception was captured, so there was no error rate to alert on.
 *
 * Deliberately not throttled: a blackout should be as loud as it is rare. A caller abort never
 * reaches here (it propagates above), and the catalogue domains now fall back to in-bundle seeds
 * rather than erroring, so this fires only when the whole fan-out is genuinely broken.
 *
 * Carries domain names and latencies only. The query never enters a log line.
 */
function reportUniversalSearchBlackout(
  groups: readonly UniversalSearchGroup[],
  requested: readonly UniversalSearchDomain[],
) {
  const errored = groups.filter((group) => group.error);
  if (errored.length === 0 || errored.length < requested.length) return;
  logger.error("Universal search returned nothing: every requested domain failed", {
    domains: errored.map((group) => group.kind),
    domain_count: requested.length,
    latency_ms: errored.map((group) => group.latencyMs),
  });
}

export async function runUniversalSearch(args: RunUniversalSearchArgs): Promise<UniversalSearchResponse> {
  const startedAt = Date.now();
  throwIfAborted(args.signal);
  const requested = args.domains?.length
    ? universalSearchDomains.filter((domain) => args.domains!.includes(domain))
    : universalSearchDomains;

  // Understand the query once (analyzeClinicalQuery memoizes): typo-correct the base query the
  // registry rankers score against, and collect synonym/acronym/alias terms for their low-weight
  // expanded lane. The documents adapter still receives the ORIGINAL query (it self-analyses).
  const analysis = analyzeClinicalQuery(args.query);
  const baseQuery = applyTypoCorrections(args.query, analysis.typoCorrections);
  // Keep the command surface aligned with the selected mode's local search: both
  // routes score its deterministic vocabulary in the same low-weight expansion
  // lane. The original query remains untouched for document retrieval.
  const expansions = Array.from(
    new Set([
      ...(args.contextMode ? smartSearchExpansions(args.contextMode, args.query) : []),
      ...deriveExpansions(analysis, baseQuery),
    ]),
  ).slice(0, maxExpansions);
  const resolved: ResolvedSearchArgs = { ...args, baseQuery, expansions, degradedDomains: new Set() };

  const groups = await Promise.all(
    requested.map(async (domain): Promise<UniversalSearchGroup> => {
      const domainStartedAt = Date.now();
      const adapter = domainAdapters[domain];
      const timeoutMs =
        domain === "documents" && requested.length === 1 ? documentsFocusedDomainTimeoutMs : adapter.timeoutMs;
      let group: UniversalSearchGroup;
      try {
        const items = await withTimeout(
          (signal) => adapter.run({ ...resolved, signal }),
          timeoutMs,
          domain,
          args.signal,
        );
        // Tag near-exact title matches so best-bet + ordering can compare across domains without
        // leaning on the per-domain scores (which are not comparable across domains).
        const tagged = items
          .slice(0, args.limitPerDomain)
          .map((item) => ({ ...item, confident: titleMatchesQuery(item.title, baseQuery) }));
        group = {
          kind: domain,
          total: tagged.length,
          items: tagged,
          latencyMs: Date.now() - domainStartedAt,
          // Read after the adapter has run, from the set that adapter wrote for THIS request, so
          // the streamed NDJSON group and the final response agree and neither depends on what a
          // concurrent request did to the shared cooldown.
          ...(resolved.degradedDomains.has(domain) ? { degraded: true } : {}),
        };
      } catch {
        // A failed/timed-out domain yields an empty errored group — one slow or broken adapter
        // must never blank the whole response. Caller cancellation is different: propagate it
        // so all downstream work and the NDJSON stream terminate instead of caching/returning.
        throwIfAborted(args.signal);
        group = { kind: domain, total: 0, items: [], latencyMs: Date.now() - domainStartedAt, error: true };
      }
      throwIfAborted(args.signal);
      await args.onGroup?.(group);
      return group;
    }),
  );
  throwIfAborted(args.signal);
  reportUniversalSearchBlackout(groups, requested);

  const preferredDomains = universalSearchPreferredDomains(args.contextMode).filter((domain) =>
    requested.includes(domain),
  );
  const domainOrder = buildDomainOrder(analysis, groups, preferredDomains);
  return {
    query: args.query,
    groups,
    tookMs: Date.now() - startedAt,
    interpretation: buildInterpretation(analysis, baseQuery, expansions),
    domainOrder,
    topHit: buildTopHit(groups, domainOrder),
    answerAction: buildAnswerAction(analysis, args.query),
    contextMode: args.contextMode,
    preferredDomains,
  };
}

/**
 * Where a domain's "See all" goes.
 *
 * The consolidated domains name `<mode>/search` directly rather than the bare mode
 * path. The bare path is not a page any more — the proxy 307s a submitted link from
 * it to exactly this route (`consolidatedModeHomeTarget`) — so pointing at it cost a
 * server round-trip, and on phones a frame of the previous route shell before the
 * second navigation settled (tools-catalog.ts documents that transition; 2026-09-02
 * audit, L112). `consolidatedModeSearchPath` is the same map the proxy redirects
 * through, so the href and the redirect cannot disagree.
 *
 * `/tools`, `/favourites` and `/medications` are deliberately absent from that map:
 * their bare paths are real surfaces, not redirects, so they stay as written.
 */
export function universalSearchViewAllHref(domain: UniversalSearchDomain, query: string): string {
  switch (domain) {
    case "documents":
      return documentsSearchHref({ query, run: true });
    case "medications":
      return `/?mode=prescribing&q=${encodeURIComponent(query)}&run=1`;
    case "services":
      return `${consolidatedModeSearchPath("services")}?q=${encodeURIComponent(query)}&run=1`;
    case "forms":
      return `${consolidatedModeSearchPath("forms")}?q=${encodeURIComponent(query)}&run=1`;
    case "differentials":
    // The differentials mode home search composes both kinds, so presentations share it.
    case "presentations":
      return `${consolidatedModeSearchPath("differentials")}?q=${encodeURIComponent(query)}&run=1`;
    case "dsm":
      return `${consolidatedModeSearchPath("dsm")}?q=${encodeURIComponent(query)}&run=1`;
    case "specifiers":
      return `${consolidatedModeSearchPath("specifiers")}?q=${encodeURIComponent(query)}&run=1`;
    case "formulation":
      return `${consolidatedModeSearchPath("formulation")}?q=${encodeURIComponent(query)}&run=1`;
    case "therapies":
      return `${consolidatedModeSearchPath("therapy-compass")}?q=${encodeURIComponent(query)}&run=1`;
    case "dictionary":
      return `${consolidatedModeSearchPath("dictionary")}?q=${encodeURIComponent(query)}`;
    case "tools":
      return `/tools?q=${encodeURIComponent(query)}&run=1`;
  }
}
