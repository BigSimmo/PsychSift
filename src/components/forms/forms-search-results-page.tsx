"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpenText, Check, ChevronRight, ExternalLink, ShieldCheck, Workflow } from "lucide-react";
import { useCallback, useDeferredValue, useId, useMemo, useState } from "react";

import { appModeHomeHref } from "@/lib/app-modes";
import { consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";
import { formCatalogDetails, rankFormRecords, type FormSearchMatch } from "@/lib/form-ranker";
import {
  deriveFormCategories,
  filterFormMatches,
  formAvailabilityFilterLabels,
  formAvailabilityFilterValues,
  formFilterCandidateCount,
  formFilterSelectionFromParams,
  formFilterSelectionSize,
  formMatchRisk,
  formRiskFilterLabels,
  formRiskFilterValues,
  writeFormFilterSelection,
  type FormFilterSelection,
  type FormRiskFilter,
} from "@/lib/form-filters";
import { useRegistryRecords } from "@/lib/use-registry-records";
import {
  cn,
  codeText,
  eyebrowText,
  ignoreUnavailableActivation,
  pageContainer,
  searchFocusRing,
  searchPageCanvas,
  searchResultsSection,
} from "@/components/ui-primitives";
import {
  SearchResultsEmptyState,
  SearchResultsHeaderBand,
  SearchResultsSkeleton,
  type AppliedFilterChip,
} from "@/components/clinical-dashboard/search-results-header-band";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import { stretchedRowLinkClass } from "@/components/card-recipes";
import { FormCodeBadge } from "@/components/forms/form-code-badge";
import { sortResultItems, type ResultSortValue } from "@/lib/result-sort";
import { replaceResultFilterUrl } from "@/lib/result-filter-url";
import { useResultSort } from "@/components/use-result-sort";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";

type FormsSearchResultsPageProps = {
  query: string;
};

const supportsPathwayClaims = false;

function resultCode(match: FormSearchMatch, index: number) {
  return formCatalogDetails(match.service)?.form ?? String(index + 1);
}

// Category chips are labels, not alerts, so they all wear the same quiet
// neutral tag. Red is kept for overdue, lapsed or urgent states only (design
// pass, October 2026); a red "crisis" chip on a register row competed with
// real warnings elsewhere on screen.
const categoryTagClass =
  "border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]";

/**
 * With no query the page is the register itself, not a search. Every form is
 * listed in form-code order ("1A" before "10") so the count a clinician reads is
 * what the register holds. Until #SZA102 an empty query produced "0 forms" over
 * 54 records, which reads as "no such form exists".
 */
const registerListingReason = "register";
const formCodeCollator = new Intl.Collator("en-AU", { numeric: true, sensitivity: "base" });

export function listFormRegister(records: readonly FormSearchMatch["service"][]): FormSearchMatch[] {
  return records
    .map((service) => ({ service, score: 0, reasons: [registerListingReason] }))
    .sort((left, right) => {
      const leftCode = formCatalogDetails(left.service)?.form ?? "";
      const rightCode = formCatalogDetails(right.service)?.form ?? "";
      // Coded forms first, in code order; anything uncoded follows by title.
      if (Boolean(leftCode) !== Boolean(rightCode)) return leftCode ? -1 : 1;
      return (
        formCodeCollator.compare(leftCode, rightCode) ||
        formCodeCollator.compare(left.service.title, right.service.title)
      );
    });
}

// The register view is the forms search route with no query: a browse surface,
// not a redirect (see modeSearchRoutesWithoutBrowseView).
const allFormsHref = consolidatedModeSearchPath("forms");

/**
 * The route into the "Act and Standards" reference page. It depends on nothing the
 * registry loads, so it renders in every registry state — including a failed load,
 * when the statutory reference is still the thing a reader can use.
 */
function ActAndStandardsLink() {
  return (
    <Link
      href="/forms/act"
      data-testid="forms-act-and-standards-link"
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--clinical-accent-soft)]",
        searchFocusRing,
      )}
    >
      <BookOpenText aria-hidden className="h-5 w-5 shrink-0 text-[color:var(--clinical-accent)]" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">Act and Standards</span>
        <span className="block text-xs leading-5 text-[color:var(--text-muted)]">
          Mental Health Act 2014 sections and the Chief Psychiatrist&apos;s Standards, in plain English
        </span>
      </span>
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />
    </Link>
  );
}

function compactMatchReason(match: FormSearchMatch, query: string) {
  if (match.reasons.includes(registerListingReason)) return "Listed in the forms register";
  const trimmedQuery = query.trim();
  if (match.reasons.includes("title")) {
    return trimmedQuery ? `Title or content match for "${trimmedQuery}"` : "Title or content match";
  }
  if (match.reasons.includes("record fields")) return "Content match in record details";
  return "Content match in the forms catalogue";
}

// Risk is the only badge a phone result card carries. It is a recorded
// priority, not an alert, so it is a neutral tag whose weight carries the
// level: high is body-coloured on a faint wash with a hairline, medium is muted
// text, low is muted and lighter. Red on most of the register trained the eye
// to ignore it; red now means overdue, lapsed or urgent only.
const riskBadgeToneClass: Record<FormRiskFilter, string> = {
  high: "border border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] text-[color:var(--text)]",
  medium: "text-[color:var(--text-muted)]",
  low: "font-semibold text-[color:var(--text-muted)]",
};

// The catalogue generates a `purpose` for every form, but most are boilerplate
// that only restates the title ("Official form source: Transfer Order. Review
// the source snippets and approved form before use."). Rendering one of those
// under every card is the same non-information as the old "Content match in
// record details" line, just longer — so only show a purpose that says
// something the title does not. See fallbackDetails() in form-catalog.ts.
const generatedPurposePatterns = [
  /^official form source:/i,
  /^the official register lists this form/i,
  /^use the current approved form .+ to record /i,
];

function editorialPurpose(record: FormSearchMatch["service"]): string {
  const purpose = record.subtitle?.trim() ?? "";
  if (!purpose) return "";
  return generatedPurposePatterns.some((pattern) => pattern.test(purpose)) ? "" : purpose;
}

const uncategorisedFormsLabel = "Other forms";

type CodedFormMatch = { match: FormSearchMatch; code: string };
type FormResultGroup = { category: string; items: CodedFormMatch[] };

/**
 * Group phone results under their statutory category so the category is stated
 * once per group instead of repeated as a chip on every card.
 *
 * Items arrive already sorted (relevance or A–Z), and groups are emitted in
 * order of first appearance — so the active sort still decides which group leads
 * and the top-ranked form stays in the top group.
 */
function groupMatchesByCategory(items: CodedFormMatch[]): FormResultGroup[] {
  const groups: FormResultGroup[] = [];
  const byCategory = new Map<string, FormResultGroup>();
  for (const item of items) {
    const category = formCatalogDetails(item.match.service)?.category?.trim() || uncategorisedFormsLabel;
    let group = byCategory.get(category);
    if (!group) {
      group = { category, items: [] };
      byCategory.set(category, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/**
 * "1A", "form 1a", "1A attachment" — a clinician who types a form code is naming
 * one specific form, not running a text search. Normalise the same way
 * form-catalog's own normalizeCode does (lowercase, collapse whitespace) and
 * additionally drop a leading "form " so the typed prefix still resolves.
 */
function normalizeFormCodeQuery(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^form /, "");
}

function findExactFormCodeMatch(items: CodedFormMatch[], query: string): CodedFormMatch | null {
  const normalizedQuery = normalizeFormCodeQuery(query);
  if (!normalizedQuery) return null;
  return (
    items.find((item) => {
      const code = formCatalogDetails(item.match.service)?.form;
      return code ? normalizeFormCodeQuery(code) === normalizedQuery : false;
    }) ?? null
  );
}

const resultsGridColumns = "md:grid-cols-[72px_minmax(0,1.35fr)_minmax(0,0.85fr)_minmax(0,1.35fr)_minmax(88px,auto)]";

function ResultsTable({
  matches,
  query,
  sortValue,
  registerTotal,
}: {
  matches: FormSearchMatch[];
  query: string;
  sortValue: ResultSortValue;
  registerTotal: number;
}) {
  const listingRegister = !query.trim();
  return (
    <section
      data-testid="form-search-results"
      aria-label="Form record matches"
      className={cn("overflow-hidden", searchResultsSection)}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-5 pb-3">
        <h2 className="text-lg font-extrabold text-[color:var(--text-heading)]">
          {listingRegister ? "All forms" : "Best matches"}
        </h2>
        {/* The count is stated once, in the band above; this line only says how
            the list is ordered. */}
        <span className="text-sm font-semibold text-[color:var(--text-muted)]">
          {sortValue === "alpha" ? "Sorted A–Z" : listingRegister ? "By form code" : "Ranked by relevance"}
        </span>
      </div>
      <div
        className={cn(
          "grid gap-4 border-b border-[color:var(--border)] px-5 py-3 text-2xs font-bold uppercase tracking-wide text-[color:var(--text-muted)]",
          resultsGridColumns,
        )}
      >
        <span>Form</span>
        <span>Title</span>
        <span>Tags</span>
        <span>{listingRegister ? "Source" : "Matched because"}</span>
        <span className="text-right">Open</span>
      </div>
      <div>
        {matches.map((match, index) => {
          const form = match.service;
          return (
            <article
              key={form.slug}
              data-testid={`form-search-result-${form.slug}`}
              className={cn(
                "group relative grid gap-4 border-b border-[color:var(--border)] px-5 py-4 transition-colors last:border-b-0 hover:bg-[color:var(--surface-subtle)]/60 md:items-center",
                resultsGridColumns,
              )}
            >
              <FormCodeBadge code={resultCode(match, index)} />
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold leading-snug text-[color:var(--text-heading)]">{form.title}</h3>
              </div>
              <div className="flex min-w-0 flex-wrap gap-2">
                {(form.statusChips ?? []).slice(0, 2).map((chip, chipIndex) => {
                  const chipLabel = chip.label?.trim() || "Form";
                  return (
                    <span
                      key={`${chipLabel}-${chipIndex}`}
                      className={cn("rounded-md px-2 py-1 text-2xs font-bold", categoryTagClass)}
                    >
                      {chipLabel}
                    </span>
                  );
                })}
              </div>
              <p className="min-w-0 text-sm font-medium leading-relaxed text-[color:var(--text-muted)]">
                {compactMatchReason(match, query)}
              </p>
              <Link
                href={`/forms/${form.slug}`}
                aria-label={`Open ${form.title}`}
                className={cn(
                  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] px-4 text-sm font-extrabold text-[color:var(--clinical-accent)] transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--clinical-accent-soft)] group-hover:border-[color:var(--clinical-accent-border)] group-hover:bg-[color:var(--clinical-accent-soft)] md:justify-self-end",
                  // The whole row opens the form, matching the phone card above
                  // and the Open button's own `aria-label`, which already names
                  // the form rather than the button.
                  stretchedRowLinkClass,
                  searchFocusRing,
                )}
              >
                Open
                <ExternalLink className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </article>
          );
        })}
      </div>
      {listingRegister ? null : (
        <div className="flex justify-center border-t border-[color:var(--border)] p-4">
          <Link
            href={allFormsHref}
            data-testid="form-search-view-all"
            className={cn(
              "inline-flex min-h-tap items-center gap-2 rounded-md px-2 text-sm font-extrabold text-[color:var(--clinical-accent)] transition hover:bg-[color:var(--clinical-accent-soft)]",
              searchFocusRing,
            )}
          >
            View all forms ({registerTotal})
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      )}
    </section>
  );
}

function PathwayPanel() {
  return (
    <section className={cn(searchResultsSection, "p-5")}>
      <h2 className="text-lg font-extrabold text-[color:var(--text-heading)]">
        Related pathway{" "}
        <span className="ml-2 text-sm font-medium text-[color:var(--text-muted)]">( PSOLIS Transport Pathway )</span>
      </h2>
      <div className="mt-5 grid grid-cols-[1fr_24px_1fr_24px_1.4fr_24px_1fr] items-center gap-3">
        <PathwayNode label="Before" code="1A" title="Referral for examination" />
        <ChevronRight aria-hidden="true" className="h-5 w-5 text-[color:var(--text-muted)]" />
        <PathwayNode label="Current" code="4A" title="Transport order" active />
        <ChevronRight aria-hidden="true" className="h-5 w-5 text-[color:var(--text-muted)]" />
        <PathwayNode
          label="Parallel"
          code="3A"
          title="Detention to enable examination"
          secondaryCode="4B"
          secondaryTitle="Extension of Transport Order"
        />
        <ChevronRight aria-hidden="true" className="h-5 w-5 text-[color:var(--text-muted)]" />
        <PathwayNode label="After" code="" title="Examination at destination" />
      </div>
      <div className="mt-5 flex justify-center">
        <button
          type="button"
          aria-disabled="true"
          onClick={ignoreUnavailableActivation}
          title="Coming soon"
          className={cn(
            "inline-flex min-h-tap cursor-not-allowed items-center gap-3 rounded-md px-2 text-sm font-extrabold text-[color:var(--clinical-accent)] opacity-70",
            searchFocusRing,
          )}
        >
          <Workflow aria-hidden="true" className="h-5 w-5" />
          View full pathway
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}

function PathwayNode({
  label,
  code,
  title,
  active,
  secondaryCode,
  secondaryTitle,
}: {
  label: string;
  code: string;
  title: string;
  active?: boolean;
  secondaryCode?: string;
  secondaryTitle?: string;
}) {
  return (
    <div>
      <p className="mb-3 text-2xs font-bold uppercase text-[color:var(--text-muted)]">{label}</p>
      <div
        className={cn(
          "min-h-[112px] rounded-lg border p-4",
          active
            ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]"
            : "border-[color:var(--border)] bg-[color:var(--surface)]",
        )}
      >
        {code ? (
          <p className={cn("text-2xl font-extrabold text-[color:var(--clinical-accent)]", codeText)}>{code}</p>
        ) : null}
        <p className="mt-2 text-sm font-extrabold leading-snug text-[color:var(--text-heading)]">{title}</p>
        {active ? (
          <span className="mt-3 inline-flex rounded-full bg-[color:var(--clinical-accent-soft)] px-3 py-1 text-2xs font-extrabold text-[color:var(--clinical-accent)]">
            You are here
          </span>
        ) : null}
        {secondaryCode && secondaryTitle ? (
          <div className="mt-3 grid gap-2 text-sm">
            <p>
              <span className="mr-2 text-xl font-extrabold text-[color:var(--clinical-accent)]">{secondaryCode}</span>
              <span className="text-xs font-medium text-[color:var(--text-muted)]">{secondaryTitle}</span>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VerifiedFooter() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 py-5 text-xs text-[color:var(--text-muted)] lg:py-6 lg:text-sm">
      <span className="inline-flex items-center gap-2 font-extrabold text-[color:var(--clinical-accent)]">
        <ShieldCheck aria-hidden="true" className="h-5 w-5" />
        Source verified
      </span>
      <span>·</span>
      <span>Official source</span>
      <span>·</span>
      <span>Aligned to MHA 2014</span>
    </div>
  );
}

const metaChipClass = "rounded-md px-2 py-1 text-2xs font-bold capitalize leading-none";

/**
 * When the query IS a form code there is one answer, not N ranked candidates.
 * Lead with that form, its purpose and its open action; everything else drops
 * to "Also references <code>" below.
 */
function MobileExactMatchHero({ match, code }: CodedFormMatch) {
  const form = match.service;
  const details = formCatalogDetails(form);
  const risk = formMatchRisk(match);
  const purpose = editorialPurpose(form);
  // Derive availability label from the actual availability field rather than
  // positional statusChips indexing to avoid fragility.
  const availabilityLabel = details?.availability
    ? details.availability === "downloadable"
      ? "Official PDF"
      : details.availability === "unavailable"
        ? "Currently unavailable"
        : "Contact OCP"
    : undefined;
  return (
    <section
      aria-label="Exact form code match"
      data-testid="form-search-mobile-exact-match"
      className="overflow-hidden rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface-raised)] shadow-[var(--e1)] forced-colors:border"
    >
      <p
        className={cn(
          "flex items-center gap-1.5 border-b border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 py-2",
          "text-2xs font-extrabold uppercase tracking-eyebrow text-[color:var(--clinical-accent)]",
        )}
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        Exact form code match
      </p>
      <div className="flex gap-3 p-3">
        <FormCodeBadge code={code} variant="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base-minus font-extrabold leading-snug text-[color:var(--text-heading)]">{form.title}</h3>
          {purpose ? (
            <p className="mt-1 text-xs font-medium leading-5 text-[color:var(--text-muted)]">{purpose}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {risk ? (
              <span className={cn(metaChipClass, riskBadgeToneClass[risk])}>
                {risk}
                <span className="sr-only"> risk</span>
              </span>
            ) : null}
            {details?.category ? (
              <span className={cn(metaChipClass, "bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]")}>
                {details.category}
              </span>
            ) : null}
            {availabilityLabel ? (
              <span className={cn(metaChipClass, "bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]")}>
                {availabilityLabel}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="px-3 pb-3">
        <Link
          href={`/forms/${form.slug}`}
          className={cn(
            "flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--clinical-accent)] px-4",
            "text-sm font-extrabold text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)] transition",
            "hover:bg-[color:var(--clinical-accent-hover)] forced-colors:border",
            searchFocusRing,
          )}
        >
          Open Form {code}
          <ExternalLink className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function MobileResultCard({ match, code }: CodedFormMatch) {
  const form = match.service;
  const risk = formMatchRisk(match);
  // `subtitle` is the catalogue's `purpose` — what the form is actually for.
  // It replaces the old "Content match in record details" line, which said the
  // same thing on every card. Boilerplate purposes are dropped entirely rather
  // than swapped for different filler.
  const purpose = editorialPurpose(form);
  return (
    <Link
      href={`/forms/${form.slug}`}
      data-testid={`form-search-mobile-result-${form.slug}`}
      className={cn(
        // The whole row is the target, so no per-row Open button. Rows are
        // divided lines inside their group's one hairline card, not cards of
        // their own (one card per group, never cards inside cards).
        "flex min-h-tap items-center gap-3 px-3 py-2.5 transition hover:bg-[color:var(--clinical-accent-soft)]",
        // Inset ring: the group card clips its corners, so an outset ring
        // would be cut off.
        "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)]",
      )}
    >
      <FormCodeBadge code={code} variant="sm" />
      <span className="min-w-0 flex-1">
        <h4 className="text-sm-minus font-extrabold leading-snug text-[color:var(--text-heading)]">{form.title}</h4>
        {/* No `block` on the clamp below: it would override the
            `display: -webkit-box` that line-clamp needs, and the purpose would
            then render at full length. */}
        {purpose ? (
          <span className="mt-0.5 line-clamp-2 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
            {purpose}
          </span>
        ) : null}
      </span>
      {risk ? (
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-2xs font-bold capitalize leading-none",
            riskBadgeToneClass[risk],
          )}
        >
          {risk}
          {/* Visually the level alone is enough beside the risk colour; assistive
              tech still gets the full "high risk" phrasing. */}
          <span className="sr-only"> risk</span>
        </span>
      ) : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)]" aria-hidden />
    </Link>
  );
}

function MobileCards({
  matches,
  query,
  registerTotal,
}: {
  matches: FormSearchMatch[];
  query: string;
  registerTotal: number;
}) {
  const listingRegister = !query.trim();
  const coded = matches.map((match, index) => ({ match, code: resultCode(match, index) }));
  const exactMatch = findExactFormCodeMatch(coded, query);
  const remaining = exactMatch ? coded.filter((item) => item !== exactMatch) : coded;
  const groups = groupMatchesByCategory(remaining);
  return (
    // Cards sit directly on the page canvas: no enclosing results panel, so a
    // bordered card is never nested inside another bordered surface.
    <section data-testid="form-search-mobile-results" aria-label="Form record matches" className="grid gap-3">
      {exactMatch ? <MobileExactMatchHero match={exactMatch.match} code={exactMatch.code} /> : null}
      {remaining.length > 0 ? (
        <>
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h2 className="text-base font-extrabold text-[color:var(--text-heading)]">
              {exactMatch ? `Also references ${exactMatch.code}` : listingRegister ? "All forms" : "Best matches"}
            </h2>
            {/* The band above already states the total. A count is shown here
                only beside an exact code match, where the remainder differs. */}
            {exactMatch ? (
              <span className="text-xs font-bold text-[color:var(--text-muted)]">
                {remaining.length} {remaining.length === 1 ? "form" : "forms"}
              </span>
            ) : null}
          </div>
          {groups.map((group) => (
            <section key={group.category} aria-label={group.category} className="grid gap-2">
              <div className="flex items-center gap-2 px-1">
                <h3 className={eyebrowText}>{group.category}</h3>
                <span aria-hidden className="h-px flex-1 bg-[color:var(--border)]" />
                <span className="text-2xs font-bold text-[color:var(--text-muted)]">{group.items.length}</span>
              </div>
              <div className="divide-y divide-[color:var(--border)] overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)]">
                {group.items.map((item) => (
                  <MobileResultCard key={item.match.service.slug} match={item.match} code={item.code} />
                ))}
              </div>
            </section>
          ))}
        </>
      ) : null}
      {listingRegister ? null : (
        <Link
          href={allFormsHref}
          data-testid="form-search-mobile-view-all"
          className={cn(
            "mx-auto flex min-h-tap w-fit items-center gap-2 rounded-md px-2 text-sm font-extrabold text-[color:var(--clinical-accent)] transition hover:bg-[color:var(--clinical-accent-soft)]",
            searchFocusRing,
          )}
        >
          View all forms ({registerTotal})
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </section>
  );
}

function MobilePathway() {
  return (
    <section className={cn(searchResultsSection, "p-3")}>
      <h2 className="text-sm-minus font-extrabold text-[color:var(--text-heading)]">
        Related pathway <span className="font-medium text-[color:var(--text-muted)]">( PSOLIS Transport )</span>
      </h2>
      <div className="mt-2 flex items-center gap-1 overflow-x-auto pb-0.5">
        {[
          ["1A", "Referral"],
          ["4A", "Transport order"],
          ["3A/4B", "Parallel"],
          ["", "Destination Examination"],
        ].map(([code, label], index) => (
          <div key={`${code}-${label}`} className="flex items-center gap-1">
            <div
              className={cn(
                "min-w-[64px] rounded-md border p-1.5 text-center",
                index === 1
                  ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface)]",
              )}
            >
              {code ? (
                <p className={cn("text-sm font-extrabold leading-none text-[color:var(--clinical-accent)]", codeText)}>
                  {code}
                </p>
              ) : null}
              <p className="mt-0.5 text-2xs font-bold leading-4 text-[color:var(--text-muted)]">{label}</p>
              {index === 1 ? (
                <p className="mt-0.5 rounded-full bg-[color:var(--clinical-accent-soft)] px-1 py-0.5 text-2xs font-extrabold leading-4 text-[color:var(--clinical-accent)]">
                  You are here
                </p>
              ) : null}
            </div>
            {index < 3 ? (
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-muted)]" />
            ) : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        aria-disabled="true"
        onClick={ignoreUnavailableActivation}
        title="Coming soon"
        className={cn(
          "mx-auto mt-1 flex min-h-tap cursor-not-allowed items-center gap-2 rounded-md px-2 text-sm-minus font-extrabold text-[color:var(--clinical-accent)] opacity-70",
          searchFocusRing,
        )}
      >
        <Workflow aria-hidden="true" className="h-4 w-4" />
        View full pathway
      </button>
    </section>
  );
}

export function FormsSearchResultsPage(props: FormsSearchResultsPageProps) {
  // No key={query} remount: query is a pure prop (favourites already documents this).
  return <FormsSearchResultsPageContent {...props} />;
}

function FormsSearchResultsPageContent({ query }: FormsSearchResultsPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sortValue, setSortValue] = useResultSort();
  const registry = useRegistryRecords("form");
  const registryReady = registry.status === "ready" || registry.status === "refetching";
  const [filterOpen, setFilterOpen] = useState(false);
  const filterPanelId = useId();
  const deferredQuery = useDeferredValue(query);
  const matches = useMemo(() => {
    if (!registryReady) return [];
    // No query: list the whole register rather than reporting "0 forms" (#SZA102).
    if (!query.trim()) return listFormRegister(registry.records);
    // Deferred empty while live has text: wait — do not rank as empty-query "all forms".
    if (!deferredQuery.trim()) return [];
    return rankFormRecords(registry.records, deferredQuery, registry.records.length, [], true);
  }, [registryReady, registry.records, deferredQuery, query]);
  const categoryOptions = useMemo(() => deriveFormCategories(matches), [matches]);
  const filterSelection = useMemo(
    () => formFilterSelectionFromParams(searchParams, categoryOptions),
    [categoryOptions, searchParams],
  );
  const filteredMatches = useMemo(() => filterFormMatches(matches, filterSelection), [filterSelection, matches]);
  const displayedMatches = useMemo(
    () => sortResultItems(filteredMatches, sortValue, (match) => match.service.title),
    [filteredMatches, sortValue],
  );
  const activeFilterCount = formFilterSelectionSize(filterSelection);

  const updateFilterSelection = useCallback((next: FormFilterSelection) => {
    replaceResultFilterUrl((params) => writeFormFilterSelection(params, next));
  }, []);

  const toggleFilter = useCallback(
    (dimension: keyof FormFilterSelection, value: string) => {
      replaceResultFilterUrl((params) => {
        const current = formFilterSelectionFromParams(params, categoryOptions);
        const nextValues = new Set(current[dimension] as ReadonlySet<string>);
        if (!nextValues.delete(value)) nextValues.add(value);
        writeFormFilterSelection(params, { ...current, [dimension]: nextValues });
      });
    },
    [categoryOptions],
  );

  const clearFilters = useCallback(() => {
    updateFilterSelection({ categories: new Set(), risks: new Set(), availability: new Set() });
  }, [updateFilterSelection]);

  const filterGroups = useMemo(
    () => [
      resultFilterFacetGroup({
        id: "category",
        label: "Category",
        description: "Statutory and clinical form families.",
        selected: filterSelection.categories,
        options: categoryOptions.map((category) => {
          const count = formFilterCandidateCount(matches, filterSelection, "categories", category);
          return {
            value: category,
            label: category,
            hint: String(count),
            disabled: count === 0 && !filterSelection.categories.has(category),
          };
        }),
        onToggle: (value) => toggleFilter("categories", value),
      }),
      resultFilterFacetGroup({
        id: "risk",
        label: "Clinical risk",
        description: "Risk classification recorded in the form catalogue.",
        selected: filterSelection.risks,
        options: formRiskFilterValues.map((risk) => {
          const count = formFilterCandidateCount(matches, filterSelection, "risks", risk);
          return {
            value: risk,
            label: formRiskFilterLabels[risk],
            hint: String(count),
            disabled: count === 0 && !filterSelection.risks.has(risk),
          };
        }),
        onToggle: (value) => toggleFilter("risks", value),
      }),
      resultFilterFacetGroup({
        id: "availability",
        label: "Availability",
        description: "How the catalogue record can be obtained.",
        selected: filterSelection.availability,
        options: formAvailabilityFilterValues.map((availability) => {
          const count = formFilterCandidateCount(matches, filterSelection, "availability", availability);
          return {
            value: availability,
            label: formAvailabilityFilterLabels[availability],
            hint: String(count),
            disabled: count === 0 && !filterSelection.availability.has(availability),
          };
        }),
        onToggle: (value) => toggleFilter("availability", value),
      }),
    ],
    [categoryOptions, filterSelection, matches, toggleFilter],
  );

  const appliedFilters = useMemo<AppliedFilterChip[]>(
    () => [
      ...[...filterSelection.categories].map((category) => ({
        id: `category-${category}`,
        groupLabel: "Category",
        valueLabel: category,
        onRemove: () => toggleFilter("categories", category),
      })),
      ...[...filterSelection.risks].map((risk) => ({
        id: `risk-${risk}`,
        groupLabel: "Risk",
        valueLabel: formRiskFilterLabels[risk],
        onRemove: () => toggleFilter("risks", risk),
      })),
      ...[...filterSelection.availability].map((availability) => ({
        id: `availability-${availability}`,
        groupLabel: "Availability",
        valueLabel: formAvailabilityFilterLabels[availability],
        onRemove: () => toggleFilter("availability", availability),
      })),
    ],
    [filterSelection, toggleFilter],
  );

  const renderFilterTrigger = (testId: string) => (
    <ResultFilterTrigger
      panelId={filterPanelId}
      testId={testId}
      title="Filter form results"
      open={filterOpen}
      activeCount={activeFilterCount}
      onToggle={() => setFilterOpen((current) => !current)}
    />
  );

  return (
    <div className={cn("overflow-x-hidden", searchPageCanvas)}>
      <main className={cn(pageContainer, "grid gap-3 px-4 pt-3 sm:px-6 lg:gap-5 lg:px-8 lg:pb-8 lg:pt-6")}>
        {/* The band is mounted in every registry state, not only when ready. It
            previously unmounted on failure, which left the page with no header at
            all and pushed the whole burden of reporting onto a separate notice. */}
        <SearchResultsHeaderBand
          modeId="forms"
          headingLevel={1}
          query={query}
          matchCount={displayedMatches.length}
          status={
            registry.status === "unauthorized"
              ? "unauthorized"
              : registry.status === "ready"
                ? "ready"
                : registry.status === "refetching"
                  ? "refetching"
                  : registry.status === "loading"
                    ? "loading"
                    : "error"
          }
          faultTitle={registry.status === "unauthorized" ? "Session expired" : "Could not load forms"}
          faultBody={
            registry.status === "unauthorized"
              ? "Your session expired. Sign in again to search your private forms registry."
              : "Couldn’t load the forms registry. Try again shortly."
          }
          onRetry={registry.status === "unauthorized" ? undefined : registry.refetch}
          // Same contract as the services navigator: a seed-served forms registry is still
          // shown, and the count line says the list may lag what was published.
          catalogueDegraded={registry.degraded}
          faultAction={
            registry.status === "unauthorized" ? (
              <Link
                href="/"
                className="inline-flex min-h-tap items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-extrabold text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]"
              >
                Open account setup
              </Link>
            ) : undefined
          }
          sortValue={sortValue}
          onSortChange={setSortValue}
          appliedFilters={appliedFilters}
          onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
          filterLabel="Filter form results"
          mobileControlsPlacement="inline"
          mobileControls={renderFilterTrigger("form-filter-trigger-phone")}
          filterControls={renderFilterTrigger("form-filter-trigger-wide")}
        />
        <ResultFilterSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          panelId={filterPanelId}
          testId="form-filter-panel"
          title="Filter form results"
          description="Narrow by form family, recorded clinical risk, and access route."
          groups={filterGroups}
          onClearAll={activeFilterCount > 0 ? clearFilters : undefined}
          summary={{ count: displayedMatches.length, noun: displayedMatches.length === 1 ? "form" : "forms" }}
          chromeResetKey={query}
        />
        {/* Every registry state renders SOMETHING here. Until #6GR6B8 the body
            was `null` whenever the records were not ready, so a search that was
            still loading, one refused for an expired session, and one whose
            request failed all produced the same thing: an empty page under a
            band. "transport" is indexed six ways in the register and named as a
            broad term in the ranker, so a blank list was never the catalogue
            saying no — it was the page not saying which of the three had
            happened. In a clinical corpus a silent zero is read as "no such
            form exists", which is the one meaning none of these states carry. */}
        {registryReady ? (
          <>
            {query.trim() && deferredQuery === query && displayedMatches.length === 0 ? (
              <SearchResultsEmptyState
                modeId="forms"
                query={query}
                appliedFilters={appliedFilters}
                onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
                onTryExample={(example) =>
                  router.push(appModeHomeHref("forms", { query: example, focus: true, run: true }))
                }
              />
            ) : (
              <>
                <div className="hidden md:block">
                  <ResultsTable
                    matches={displayedMatches}
                    query={query}
                    sortValue={sortValue}
                    registerTotal={registry.records.length}
                  />
                </div>
                <div className="md:hidden">
                  <MobileCards matches={displayedMatches} query={query} registerTotal={registry.records.length} />
                </div>
              </>
            )}
            <UniversalSearchAlsoMatches modeId="forms" query={query} />
          </>
        ) : registry.status === "loading" ? (
          <SearchResultsSkeleton />
        ) : (
          /* Unauthorised and failed are both `degraded`: the search never ran,
             so the copy must not send the reader off to fix a query or a filter
             that was not the problem. The band above names which one it is and
             owns the retry / sign-in action; this states plainly that the result
             set is not a finding. The filter routes ride along because a filter
             carried in the URL outlives the request that failed, and clearing it
             is the one recovery the reader can make from here. */
          <SearchResultsEmptyState
            modeId="forms"
            query={query}
            degraded
            appliedFilters={appliedFilters}
            onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
          />
        )}
        <ActAndStandardsLink />
        <div className="hidden lg:block">{supportsPathwayClaims ? <PathwayPanel /> : null}</div>
        <div className="lg:hidden">{supportsPathwayClaims ? <MobilePathway /> : null}</div>
        {registryReady && supportsPathwayClaims ? <VerifiedFooter /> : null}
      </main>
    </div>
  );
}
