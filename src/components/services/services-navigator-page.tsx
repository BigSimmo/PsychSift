"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronDown,
  ExternalLink,
  GitCompareArrows,
  ListChecks,
  Phone,
  X,
} from "lucide-react";
import { useCallback, useDeferredValue, useId, useMemo, useRef, useState } from "react";

import { cardSelected, cardSurface, stretchedRowLinkClass } from "@/components/card-recipes";
import { useAccountData } from "@/components/account-data-provider";
import { DesktopComposerPortalSlot } from "@/components/desktop-composer-portal-slot";
import { SearchResultsLayout } from "@/components/clinical-dashboard/search-results-layout";
import {
  SearchResultsEmptyState,
  SearchResultsHeaderBand,
  SearchResultsSkeleton,
  type AppliedFilterChip,
} from "@/components/clinical-dashboard/search-results-header-band";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
  resultFilterGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import { AlphabetStrip, alphabetStripEntries, alphabetStripTargetClass } from "@/components/mode-kit/alphabet-strip";
import { StatusTag, type StatusTagShape } from "@/components/mode-kit/status-tag";
import { cn } from "@/components/ui-primitives";
import { useResultSort } from "@/components/use-result-sort";
import { compactBestUseTitle } from "@/lib/compact-best-use-title";
import { modeHomeComposerReservePendingValue, modeHomeDesktopComposerSlotId } from "@/lib/mode-home-composer";
import {
  readServiceCoreGroupSelection,
  serviceCoreGroupLabel,
  serviceCoreGroups,
  serviceMatchesCoreGroupSelection,
  writeServiceCoreGroupSelectionToParams,
  type ServiceCoreGroupId,
} from "@/lib/service-core-groups";
import {
  deriveServiceFacetOptions,
  deriveSubstanceLensOptions,
  filterServicesByFacets,
  serviceFacetDimensionLabels,
  serviceFacetDimensions,
  serviceFacetOptionCount,
  serviceFacetSelectionFromParams,
  serviceFacetSelectionSize,
  serviceFacetValueLabel,
  serviceSubstanceLensOptionCount,
  serviceSubstanceLensValueLabel,
  writeServiceFacetSelectionToParams,
  type ServiceFacetDimension,
} from "@/lib/service-facets";
import { serviceMatchesEveryQueryToken } from "@/lib/service-best-fit";
import { serviceCallTarget } from "@/lib/service-call";
import { rankServiceRecords, type ServiceRecord, type ServiceStatusChip } from "@/lib/service-ranker";
import { replaceResultFilterUrl } from "@/lib/result-filter-url";
import { sortResultItems } from "@/lib/result-sort";
import { useRegistryRecords } from "@/lib/use-registry-records";

type ServiceResultScope = "results" | "all";

function displayText(value: string | null | undefined, fallback = "Confirm locally") {
  return value?.trim() ? value.trim() : fallback;
}

function compactText(value: string | null | undefined, maxLength: number, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? compactBestUseTitle(trimmed, maxLength) : fallback;
}

/**
 * One status shape per chip, only where a shape means something (Clinical audit,
 * 13 Oct 2026, item 8): crisis or urgent is a red triangle, an unverified
 * availability is a dashed ring, an active service is a tick. Every other chip
 * (acuity, setting, region) is a plain grey word. The chip words themselves are
 * unchanged.
 */
function serviceChipShape(chip: ServiceStatusChip): StatusTagShape {
  const label = chip.label?.toLowerCase() ?? "";
  if (/\b(crisis|urgent|emergency)\b/.test(label)) return "urgent";
  if (/unverified|not verified|unconfirmed/.test(label)) return "unrecorded";
  if (/^active$/.test(label.trim())) return "done";
  return "none";
}

function serviceChipLabel(chip: ServiceStatusChip) {
  const label = displayText(chip.label, "Status");
  return label.toLowerCase().includes("aboriginal and torres strait islander")
    ? "Aboriginal and Torres Strait Islander-specific"
    : label;
}

function serviceRowId(slug: string) {
  return `service-row-${slug}`;
}

function ServiceCard({
  service,
  index,
  relevanceRank,
  query,
  selected,
  onToggleSelected,
  saved,
  savedStateReady,
  savedStateLoadFailed,
  savePending,
  onToggleSaved,
}: {
  service: ServiceRecord;
  index: number;
  relevanceRank: number | null;
  // The active search text, used only to keep the "Best fit" badge honest: rank alone
  // says "this came out on top", which can happen through a loose/fuzzy match, so the
  // badge additionally requires every word the psychiatrist typed to actually be in the
  // record. See src/lib/service-best-fit.ts (#CNCAFV).
  query: string;
  selected: boolean;
  onToggleSelected: (slug: string) => void;
  saved: boolean;
  // False until the account favourites read settles. Until then `saved` is
  // `false` for EVERY service — not because nothing is saved, but because
  // nothing has been read yet — so the control must not assert a state.
  savedStateReady: boolean;
  savedStateLoadFailed: boolean;
  savePending: boolean;
  onToggleSaved: (slug: string) => void;
}) {
  const showBestFit = relevanceRank !== null && relevanceRank <= 2 && serviceMatchesEveryQueryToken(service, query);
  // The number, one tap away: in a crisis the call is the job, so it is the
  // card's one visible action. No dialable phone on the record, no button —
  // never a guessed number.
  const call = serviceCallTarget(service);
  const [moreOpen, setMoreOpen] = useState(false);
  const morePanelId = useId();

  return (
    <article
      id={serviceRowId(service.slug)}
      data-testid={`service-search-result-${service.slug}`}
      className={cn(
        cardSurface,
        "relative p-3 sm:p-4",
        alphabetStripTargetClass,
        // One selected encoding, shared with every other card. The old
        // `ring-1 …/35` was a fourth way of saying "this one" and put an alpha
        // on a token colour, so what it actually contrasted against depended on
        // whatever surface sat behind it in each theme.
        //
        // The leading tile stays a RANK, not a category glyph: this is a ranked
        // referral list, the number is what the "Best fit" pill refers to, and
        // it doubles as the shortlist checkmark. Services also has no single
        // category axis — records carry facets — so there is nothing honest to
        // put there instead.
        // Only the shortlist tints a card. "Best fit" is a grey word beside the
        // title, so colour keeps meaning "you picked this" (item 8).
        selected && cardSelected,
      )}
    >
      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto]">
        <span
          className={cn(
            "grid h-9 w-9 place-items-center rounded-lg border text-sm font-extrabold",
            selected
              ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
              : "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-heading)]",
          )}
          aria-label={`Result ${index + 1}${selected ? ", shortlisted" : ""}`}
        >
          {selected ? <Check className="h-4 w-4" aria-hidden /> : index + 1}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="text-base font-bold leading-5 text-[color:var(--text-heading)] sm:text-lg">
              {/* The whole card opens the record, where the referral decision
                  is made. Call, save and "More" stay their own controls. */}
              <Link
                href={`/services/${service.slug}`}
                className={cn(
                  "rounded-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                  stretchedRowLinkClass,
                )}
              >
                {service.title}
              </Link>
            </h2>
            {showBestFit ? <StatusTag>Best fit</StatusTag> : null}
          </div>
          {/* A fixed 150-character cut clipped short records mid-word at every
              width ("Immedia…" on 13YARN, ledger #8RWKA0). Clamp by lines on a
              phone instead and show the whole line where there is room. */}
          <p className="mt-1 line-clamp-2 text-sm font-medium leading-5 text-[color:var(--text-muted)] sm:line-clamp-3">
            {compactText(
              service.bestUse ?? service.subtitle,
              400,
              "Open the record to review service fit and referral details.",
            )}
          </p>
        </div>
        {/* Favourite, not shortlist: the bookmark persists to the account
            across sessions, while the shortlist below is this search's
            working set and is deliberately not persisted. Two different
            jobs, so they stay two different controls. */}
        {/* Native `disabled`, not aria-disabled: this is transient inertness
            while a request settles, which is exactly the case
            docs/wiring-conventions.md reserves `disabled` for. Without it the
            control asserts "not saved" for every service during the account
            read and a tap issues a redundant write against a service that is
            already saved. */}
        <button
          type="button"
          onClick={() => onToggleSaved(service.slug)}
          disabled={!savedStateReady || savedStateLoadFailed || savePending}
          aria-pressed={savedStateReady && !savedStateLoadFailed ? saved : undefined}
          title={
            savedStateLoadFailed
              ? "Saved services are unavailable. Retry from your favourites."
              : !savedStateReady
                ? "Loading your saved services…"
                : savePending
                  ? "Saving…"
                  : undefined
          }
          aria-label={
            savedStateLoadFailed
              ? `Saved state unavailable for ${service.title}`
              : savedStateReady
                ? saved
                  ? `Remove ${service.title} from favourites`
                  : `Save ${service.title} to favourites`
                : `Loading saved state for ${service.title}`
          }
          className={cn(
            "relative z-10 grid min-h-12 min-w-12 place-items-center rounded-lg border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-50",
            savedStateReady && !savedStateLoadFailed && saved
              ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
              : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] enabled:hover:bg-[color:var(--surface-subtle)]",
          )}
        >
          {savedStateReady && !savedStateLoadFailed && saved ? (
            <BookmarkCheck className="h-4 w-4" aria-hidden />
          ) : (
            <Bookmark className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>

      {/* The Catchment/Eligibility/Cost strip that used to sit here is gone
          (direction B, ledger #163), and so is the always-open two-button
          row: 85 crisis results at ~270px each was ~23,000px on a phone with
          no number anywhere. The card now leads with the phone number and a
          call button; "Review referral" and "Add to shortlist" sit behind
          "More" (the whole card still opens the record). */}
      {/* Tags, then the call and "More" on the same row (item 8): the call is
          a compact 48px phone button rather than a full-width blue bar, so
          252 cards no longer read as a wall of colour. Same tel: action. */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5 pl-12 sm:pl-13">
          {(service.statusChips ?? []).slice(0, 3).map((chip) => (
            <StatusTag key={`${service.slug}-${chip.label}`} shape={serviceChipShape(chip)}>
              {serviceChipLabel(chip)}
            </StatusTag>
          ))}
        </div>
        {call ? (
          <a
            href={call.href}
            aria-label={`Call ${service.title}`}
            title={`Call ${call.display}`}
            data-testid={`service-call-${service.slug}`}
            className="relative z-10 inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--clinical-accent)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            <Phone className="h-4 w-4 shrink-0" aria-hidden />
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls={morePanelId}
          aria-label={`More actions for ${service.title}`}
          className="relative z-10 inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          <span className="hidden sm:inline">More</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", moreOpen && "rotate-180")} aria-hidden />
        </button>
      </div>
      <div id={morePanelId} hidden={!moreOpen} className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <Link
          href={`/services/${service.slug}`}
          aria-label={`Review referral for ${service.title}`}
          className="relative z-10 inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Review referral
        </Link>
        <button
          type="button"
          onClick={() => onToggleSelected(service.slug)}
          aria-pressed={selected}
          aria-label={selected ? `Remove ${service.title} from shortlist` : `Add ${service.title} to shortlist`}
          className={cn(
            "relative z-10 inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
            selected
              ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
              : "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] hover:bg-[color:var(--clinical-accent-hover)]",
          )}
        >
          {selected ? <Check className="h-4 w-4" aria-hidden /> : <ListChecks className="h-4 w-4" aria-hidden />}
          {selected ? "Shortlisted" : "Add to shortlist"}
        </button>
      </div>
    </article>
  );
}

const referralStages = [
  { id: "search", label: "Search" },
  { id: "shortlist", label: "Shortlist" },
  { id: "compare", label: "Compare" },
  { id: "refer", label: "Refer" },
] as const;

type ReferralStageId = (typeof referralStages)[number]["id"];

/**
 * The progressive replacement for the old four-card numbered walkthrough
 * (direction B, ledger #163): one ~20px line of dots that says where you are
 * without spending a third of the fold saying it.
 *
 * The accessible name is deliberately NOT "Referral workflow" — that name
 * belongs to `ServiceReferralFlow` on the service record, and
 * `tests/ui-tools.spec.ts` asserts it is absent from the results route so the
 * removed walkthrough cannot creep back in. Reusing it here would satisfy that
 * assertion's letter and defeat its purpose.
 *
 * "Refer" is never the active stage here; it is reached on the record itself.
 * It stays in the rail because the point is showing the whole path, not just
 * the part this page owns.
 */
function ServiceReferralProgress({ active }: { active: ReferralStageId }) {
  const activeIndex = referralStages.findIndex((stage) => stage.id === active);

  return (
    <nav aria-label="Referral progress" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start">
        {referralStages.map((stage, index) => {
          const isActive = index === activeIndex;
          const isComplete = index < activeIndex;
          return (
            <li key={stage.id} className="flex min-w-0 items-center gap-2">
              {index > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-px w-4 shrink-0 sm:w-6",
                    isComplete || isActive ? "bg-[color:var(--clinical-accent-border)]" : "bg-[color:var(--border)]",
                  )}
                />
              ) : null}
              <span
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "inline-flex min-w-0 items-center gap-1.5 text-2xs font-bold",
                  isActive
                    ? "text-[color:var(--clinical-accent)]"
                    : isComplete
                      ? "text-[color:var(--text)]"
                      : "text-[color:var(--text-muted)]",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full border",
                    isActive
                      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)]"
                      : isComplete
                        ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]"
                        : "border-[color:var(--border-strong)] bg-[color:var(--surface)]",
                  )}
                />
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ComparisonPanel({
  services,
  onRemove,
  onClose,
}: {
  services: ServiceRecord[];
  onRemove: (slug: string) => void;
  onClose: () => void;
}) {
  return (
    <section
      data-testid="services-comparison"
      aria-labelledby="services-comparison-title"
      className="rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] p-3 sm:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xs font-extrabold uppercase tracking-kicker text-[color:var(--clinical-accent)]">
            Step 3
          </p>
          <h2 id="services-comparison-title" className="mt-0.5 text-xl font-bold text-[color:var(--text-heading)]">
            Compare shortlisted services
          </h2>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            Check service fit and local details before choosing a referral route.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close service comparison"
          className="grid size-12 shrink-0 place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:size-10"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {services.map((service) => (
          <article
            key={service.slug}
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold leading-5 text-[color:var(--text-heading)]">{service.title}</h3>
              <button
                type="button"
                onClick={() => onRemove(service.slug)}
                aria-label={`Remove ${service.title} from comparison`}
                className="grid size-12 shrink-0 place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:size-10"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <dl className="mt-2 grid gap-2 text-xs">
              {[
                ["Best use", compactText(service.bestUse, 105, "Assess service fit")],
                ["Eligibility", compactText(service.eligibility, 105, "Confirm locally")],
                ["Referral", compactText(service.referral ?? service.route, 105, "Confirm route")],
                ["Cost", compactText(service.cost, 80, "Confirm fees")],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-2">
                  <dt className="font-semibold text-[color:var(--text-muted)]">{label}</dt>
                  <dd className="font-medium text-[color:var(--text-heading)]">{value}</dd>
                </div>
              ))}
            </dl>
            <Link
              href={`/services/${service.slug}`}
              className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-lg border border-[color:var(--clinical-accent)] bg-[color:var(--surface)] px-3 text-xs font-bold text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              Review referral
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ServicesNavigatorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sortValue, setSortValue] = useResultSort();
  const urlQuery = searchParams.get("q")?.trim() || searchParams.get("query")?.trim() || "";
  const activeGroupSelection = useMemo(() => readServiceCoreGroupSelection(searchParams.get("group")), [searchParams]);
  const [localQuery, setLocalQuery] = useState(() => ({ urlQuery, value: urlQuery }));
  const query = localQuery.urlQuery === urlQuery ? localQuery.value : urlQuery;
  const deferredQuery = useDeferredValue(query);
  const registry = useRegistryRecords("service");
  const registryLoading = registry.status === "loading";
  const registryReady = registry.status === "ready" || registry.status === "refetching";
  const registryBlocked = registry.status === "unauthorized" || registry.status === "error";
  const searchableRecords = useMemo(() => (registryReady ? registry.records : []), [registry.records, registryReady]);
  const rankedMatches = useMemo(() => {
    if (!query.trim()) return searchableRecords;
    const ranked = rankServiceRecords(searchableRecords, deferredQuery, searchableRecords.length, [], true);
    if (ranked.length) return ranked.map((match) => match.service);
    return [];
  }, [deferredQuery, query, searchableRecords]);
  const groupedMatches = useMemo(
    () => rankedMatches.filter((service) => serviceMatchesCoreGroupSelection(service, activeGroupSelection)),
    [activeGroupSelection, rankedMatches],
  );

  // Facet selection lives in the URL, alongside `q`/`group`, so a filtered
  // services search stays shareable and survives navigating away and back —
  // see docs/filter-contract.md.
  const facetSelection = useMemo(() => serviceFacetSelectionFromParams(searchParams), [searchParams]);
  const substanceLens = searchParams.get("substance") ?? "all";
  const resultScope: ServiceResultScope = searchParams.get("scope") === "all" ? "all" : "results";
  // The scope segment (section 4) lets a reader who has narrowed to zero
  // widen from the query/group-scoped set to the whole 219-item catalogue
  // without discarding the query. Gated on the UNFACETED result set so the
  // segment does not flicker away as facets are applied — narrowing with
  // facets only ever makes "catalogue > results" more true, never less.
  // Apply the group selection to the full catalogue so that scope=all also
  // honours the group facet — without this, switching to "All services" while
  // a group is selected would show unfiltered results and an inconsistent count.
  const groupedAllRecords = useMemo(
    () => searchableRecords.filter((service) => serviceMatchesCoreGroupSelection(service, activeGroupSelection)),
    [activeGroupSelection, searchableRecords],
  );
  const showResultScope = searchableRecords.length > groupedMatches.length;
  const facetBaseMatches = resultScope === "all" ? groupedAllRecords : groupedMatches;
  const facetedMatches = useMemo(
    () => filterServicesByFacets(facetBaseMatches, facetSelection, substanceLens),
    [facetBaseMatches, facetSelection, substanceLens],
  );
  const displayedMatches = useMemo(
    () => sortResultItems(facetedMatches, sortValue, (service) => service.title),
    [facetedMatches, sortValue],
  );
  const alphabetEntries = useMemo(
    () =>
      alphabetStripEntries(
        displayedMatches,
        (service) => service.title,
        (service) => serviceRowId(service.slug),
      ),
    [displayedMatches],
  );
  // Both scope segments show the current facet selection applied — "counts
  // on both" — differing only in whether the query/group scoping applies.
  const resultsScopedCount = useMemo(
    () => filterServicesByFacets(groupedMatches, facetSelection, substanceLens).length,
    [groupedMatches, facetSelection, substanceLens],
  );
  const allScopedCount = useMemo(
    () => filterServicesByFacets(groupedAllRecords, facetSelection, substanceLens).length,
    [groupedAllRecords, facetSelection, substanceLens],
  );
  const activeFilterCount =
    serviceFacetSelectionSize(facetSelection) +
    (substanceLens === "all" ? 0 : 1) +
    (resultScope === "all" ? 1 : 0) +
    activeGroupSelection.size;
  const relevanceRankMap = useMemo(() => {
    const map = new Map<string, number>();
    rankedMatches.forEach((service, index) => map.set(service.slug, index + 1));
    return map;
  }, [rankedMatches]);
  // Group-agnostic base for the group facet's own "how many if I also ticked
  // this" counts — `facetBaseMatches` cannot be reused here because it is
  // already narrowed by `activeGroupSelection`, which would make every
  // unselected group option read as a near-empty intersection with the
  // group(s) already active rather than a true widening count.
  const coreGroupBaseMatches = resultScope === "all" ? searchableRecords : rankedMatches;
  const coreGroupFacetedBase = useMemo(
    () => filterServicesByFacets(coreGroupBaseMatches, facetSelection, substanceLens),
    [coreGroupBaseMatches, facetSelection, substanceLens],
  );
  const groupCounts = useMemo(
    () =>
      Object.fromEntries(
        serviceCoreGroups.map((group) => {
          const candidate = activeGroupSelection.has(group.id)
            ? activeGroupSelection
            : new Set([...activeGroupSelection, group.id]);
          return [
            group.id,
            coreGroupFacetedBase.filter((service) => serviceMatchesCoreGroupSelection(service, candidate)).length,
          ];
        }),
      ) as Record<ServiceCoreGroupId, number>,
    [activeGroupSelection, coreGroupFacetedBase],
  );
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const selected = searchableRecords.filter((service) => selectedSlugs.includes(service.slug));
  const [showComparison, setShowComparison] = useState(false);
  const filterPanelId = useId();
  const [filterOpen, setFilterOpen] = useState(false);
  const activeGroupLabel = activeGroupSelection.size === 1 ? serviceCoreGroupLabel([...activeGroupSelection][0]) : null;
  const heading = query || (activeGroupLabel ?? "Browse services");
  const accountData = useAccountData();
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  // The provider rolls back a failed mutation from its pre-request snapshot.
  // Serialize writes from this multi-row surface so one row's rollback cannot
  // erase another row's successful optimistic update.
  const savingSlugsRef = useRef(new Set<string>());
  const [savingSlugs, setSavingSlugs] = useState<ReadonlySet<string>>(() => new Set());
  // Derived during render rather than tracked in an effect: the stage is a
  // pure function of the shortlist state that already exists, and
  // tests/audit-content-services-regressions.test.ts pins this file as
  // effect-free.
  const referralStage: ReferralStageId = showComparison ? "compare" : selectedSlugs.length ? "shortlist" : "search";

  async function toggleSaved(slug: string) {
    // Belt as well as braces: the control is disabled until the read settles,
    // but a toggle computed from an unread library would invert the wrong
    // state, so refuse it here too rather than trusting the caller.
    if (!accountData.ready || accountData.loadError || savingSlugsRef.current.size > 0) return;
    const service = searchableRecords.find((record) => record.slug === slug);
    if (!service) return;
    savingSlugsRef.current.add(slug);
    setSavingSlugs(new Set(savingSlugsRef.current));
    const nowSaved = !accountData.isSaved("service", slug);
    try {
      if (!(await accountData.setFavourite("service", slug, nowSaved))) {
        setSaveNotice(
          accountData.isAuthenticated ? "Save failed. Try again." : "Sign in or create an account to save services.",
        );
        return;
      }
      setSaveNotice(nowSaved ? `${service.title} saved to favourites.` : `${service.title} removed from favourites.`);
    } catch {
      setSaveNotice("Save failed. Try again.");
    } finally {
      savingSlugsRef.current.delete(slug);
      setSavingSlugs(new Set(savingSlugsRef.current));
    }
  }

  function toggleSelected(slug: string) {
    setSelectedSlugs((current) => {
      const next = current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug].slice(0, 5);
      if (next.length < 2) setShowComparison(false);
      return next;
    });
  }

  const updateNavigationParams = useCallback(
    (mutator: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutator(params);
      params.set("run", "1");
      const href = `/services?${params.toString()}`;
      router.push(href, { scroll: false });
    },
    [router, searchParams],
  );

  const updateFilterParams = useCallback((mutator: (params: URLSearchParams) => void) => {
    replaceResultFilterUrl((params) => {
      mutator(params);
      params.set("run", "1");
    });
  }, []);

  // Facet/lens/scope toggles replace (not push) — a reader ticking several
  // chips should not spam the back-button history the way submitting a new
  // search does.
  const toggleFacetValue = useCallback(
    (dimension: ServiceFacetDimension, value: string) => {
      updateFilterParams((params) => {
        const current = serviceFacetSelectionFromParams(params);
        const next = new Set(current[dimension]);
        if (!next.delete(value)) next.add(value);
        writeServiceFacetSelectionToParams(params, { ...current, [dimension]: next });
      });
    },
    [updateFilterParams],
  );

  const setSubstanceLensValue = useCallback(
    (value: string) => {
      updateFilterParams((params) => {
        if (value === "all") params.delete("substance");
        else params.set("substance", value);
      });
    },
    [updateFilterParams],
  );

  const setResultScopeValue = useCallback(
    (value: ServiceResultScope) => {
      updateFilterParams((params) => {
        if (value === "all") params.set("scope", "all");
        else params.delete("scope");
      });
    },
    [updateFilterParams],
  );

  // Never touches `q`/`query` — docs/filter-contract.md section 6: clearing
  // filters and clearing a search are different intentions. The old
  // query-replacing suggestion rail conflated the two (clearing its choices
  // also replaced the search). `group` is now a facet like the rest (folded
  // out of the standalone browse nav), so it clears here too.
  const clearAllFilters = useCallback(() => {
    updateFilterParams((params) => {
      for (const dimension of serviceFacetDimensions) params.delete(dimension);
      params.delete("substance");
      params.delete("scope");
      params.delete("group");
    });
  }, [updateFilterParams]);

  function applyServiceQuery(nextQuery: string) {
    const trimmedQuery = nextQuery.trim();
    setLocalQuery({ urlQuery, value: trimmedQuery });
    updateNavigationParams((params) => {
      params.delete("query");
      if (trimmedQuery) params.set("q", trimmedQuery);
      else params.delete("q");
    });
  }

  // Only ever called with an empty escape from the zero-results state below —
  // individual group values toggle through `toggleCoreGroupValue` instead.
  function hrefWithGroupCleared() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("run", "1");
    params.delete("group");
    return `/services?${params.toString()}`;
  }

  const toggleCoreGroupValue = useCallback(
    (value: ServiceCoreGroupId) => {
      updateFilterParams((params) => {
        const current = readServiceCoreGroupSelection(params.get("group"));
        const next = new Set(current);
        if (!next.delete(value)) next.add(value);
        writeServiceCoreGroupSelectionToParams(params, next);
      });
    },
    [updateFilterParams],
  );

  // `substance_flags` is an exact partition (measured 2026-08-12: all 219
  // services carry exactly one of general/aod) — a lens, not a facet. See
  // src/lib/service-facets.ts for the full measurement note.
  const substanceOptionValues = useMemo(() => deriveSubstanceLensOptions(searchableRecords), [searchableRecords]);
  const substanceGroup = useMemo(
    () =>
      resultFilterGroup({
        id: "substance",
        label: "Program type",
        value: substanceLens,
        options: [
          {
            value: "all",
            label: "All programs",
            hint: String(serviceSubstanceLensOptionCount(facetBaseMatches, facetSelection, "all")),
          },
          ...substanceOptionValues.map((value) => {
            const count = serviceSubstanceLensOptionCount(facetBaseMatches, facetSelection, value);
            return {
              value,
              label: serviceSubstanceLensValueLabel(value),
              hint: String(count),
              // Keep an active zero-count lens selectable so the reader can
              // recover, but do not offer a different lens that would empty
              // the current facet-constrained result set.
              disabled: count === 0 && substanceLens !== value,
            };
          }),
        ],
        onChange: setSubstanceLensValue,
      }),
    [facetBaseMatches, facetSelection, setSubstanceLensValue, substanceLens, substanceOptionValues],
  );

  // Service categories overlap (see service-core-groups.ts), so this is a
  // facet — many-of-N, OR within the group — rather than the one-of-N lens
  // the standalone browse nav it replaces used to be.
  const coreGroupFacetGroup = useMemo(
    () =>
      resultFilterFacetGroup({
        id: "core-group",
        label: "Service group",
        selected: activeGroupSelection,
        options: serviceCoreGroups.map((group) => ({
          value: group.id,
          label: group.label,
          hint: String(groupCounts[group.id]),
          disabled: groupCounts[group.id] === 0 && !activeGroupSelection.has(group.id),
        })),
        onToggle: toggleCoreGroupValue,
      }),
    [activeGroupSelection, groupCounts, toggleCoreGroupValue],
  );

  // Keep the option lists and handlers stable while unrelated page state
  // changes (for example opening the sheet or updating the shortlist).
  const facetGroups = useMemo(
    () =>
      serviceFacetDimensions.map((dimension) =>
        resultFilterFacetGroup({
          id: dimension,
          label: serviceFacetDimensionLabels[dimension],
          selected: facetSelection[dimension],
          options: deriveServiceFacetOptions(searchableRecords, dimension).map((value) => {
            const withCandidate = serviceFacetOptionCount(
              facetBaseMatches,
              facetSelection,
              substanceLens,
              dimension,
              value,
            );
            return {
              value,
              label: serviceFacetValueLabel(dimension, value),
              hint: String(withCandidate),
              disabled: withCandidate === 0 && !facetSelection[dimension].has(value),
            };
          }),
          onToggle: (value) => toggleFacetValue(dimension, value),
        }),
      ),
    [facetBaseMatches, facetSelection, searchableRecords, substanceLens, toggleFacetValue],
  );

  const appliedFilters = useMemo<AppliedFilterChip[]>(() => {
    const chips: AppliedFilterChip[] = [];
    if (resultScope === "all") {
      chips.push({
        id: "scope-all",
        groupLabel: "Search in",
        valueLabel: "All services",
        onRemove: () => setResultScopeValue("results"),
      });
    }
    if (substanceLens !== "all") {
      chips.push({
        id: `substance-${substanceLens}`,
        groupLabel: "Program type",
        valueLabel: serviceSubstanceLensValueLabel(substanceLens),
        onRemove: () => setSubstanceLensValue("all"),
      });
    }
    for (const dimension of serviceFacetDimensions) {
      for (const value of facetSelection[dimension]) {
        chips.push({
          id: `${dimension}-${value}`,
          groupLabel: serviceFacetDimensionLabels[dimension],
          valueLabel: serviceFacetValueLabel(dimension, value),
          onRemove: () => toggleFacetValue(dimension, value),
        });
      }
    }
    for (const value of activeGroupSelection) {
      chips.push({
        id: `core-group-${value}`,
        groupLabel: "Service group",
        valueLabel: serviceCoreGroupLabel(value),
        onRemove: () => toggleCoreGroupValue(value),
      });
    }
    return chips;
  }, [
    activeGroupSelection,
    facetSelection,
    resultScope,
    setResultScopeValue,
    setSubstanceLensValue,
    substanceLens,
    toggleCoreGroupValue,
    toggleFacetValue,
  ]);

  return (
    <SearchResultsLayout
      testId="services-navigator"
      canvasClassName="bg-[color:var(--background)] text-[color:var(--text)]"
      resultsLabel="Referral services"
      header={
        <>
          <DesktopComposerPortalSlot
            id={modeHomeDesktopComposerSlotId}
            data-composer-reserve={modeHomeComposerReservePendingValue}
            className="mode-home-composer-slot hidden w-full min-w-0 sm:block sm:min-h-0 sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)] sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)]"
          />

          <SearchResultsHeaderBand
            modeId="services"
            query={heading}
            matchCount={displayedMatches.length}
            headingLevel={1}
            status={
              registryBlocked
                ? registry.status === "unauthorized"
                  ? "unauthorized"
                  : "error"
                : registryLoading
                  ? "loading"
                  : registry.status === "refetching"
                    ? "refetching"
                    : "ready"
            }
            faultTitle={registry.status === "unauthorized" ? "Session expired" : "Could not load services"}
            faultBody={
              registry.status === "unauthorized"
                ? "Your session expired. Sign in again to search private service records and referral pathways."
                : "The services registry could not be loaded. Try again shortly."
            }
            onRetry={registry.status === "unauthorized" ? undefined : registry.refetch}
            // The registry answered from the in-bundle catalogue because the published one could
            // not be read. The rows are real, so they stay; what the band has to add is that the
            // list itself may lag a recent publication.
            catalogueDegraded={registry.degraded}
            faultAction={
              registry.status === "unauthorized" ? (
                <Link
                  href="/"
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-extrabold text-[color:var(--text-muted)]"
                >
                  Open account setup
                </Link>
              ) : undefined
            }
            sortValue={sortValue}
            onSortChange={setSortValue}
            appliedFilters={appliedFilters}
            onClearFilters={activeFilterCount > 0 ? clearAllFilters : undefined}
            mobileControlsPlacement="inline"
            mobileControls={
              <ResultFilterTrigger
                panelId={filterPanelId}
                testId="service-filter-trigger-phone"
                title="Filter services"
                open={filterOpen}
                activeCount={activeFilterCount}
                onToggle={() => setFilterOpen((current) => !current)}
              />
            }
            utilityControls={
              <span className="hidden sm:inline-flex">
                <ResultFilterTrigger
                  panelId={filterPanelId}
                  testId="service-filter-trigger-desktop"
                  title="Filter services"
                  open={filterOpen}
                  activeCount={activeFilterCount}
                  onToggle={() => setFilterOpen((current) => !current)}
                />
              </span>
            }
          />

          {/* Progress, then the shortlist banner, then browse — the banner
              sits under the heading it qualifies rather than above it, and
              appears only once something is shortlisted. */}
          <ServiceReferralProgress active={referralStage} />

          {selected.length ? (
            <section
              data-testid="services-shortlist-bar"
              aria-label="Service shortlist"
              className="flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 py-2 sm:px-4"
            >
              <span className="inline-flex items-center gap-2 text-sm font-bold text-[color:var(--clinical-accent)]">
                <ListChecks className="h-4 w-4" aria-hidden />
                {selected.length} shortlisted
              </span>
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowComparison(true)}
                  disabled={selected.length < 2}
                  title={
                    selected.length < 2 ? "Shortlist at least two services to compare" : "Compare shortlisted services"
                  }
                  className="inline-flex min-h-12 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-[color:var(--clinical-accent)] hover:bg-[color:var(--surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <GitCompareArrows className="h-4 w-4" aria-hidden />
                  Compare
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSlugs([]);
                    setShowComparison(false);
                  }}
                  className="inline-flex min-h-12 items-center rounded-lg px-3 text-xs font-bold text-[color:var(--text-muted)] hover:bg-[color:var(--surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                >
                  Clear
                </button>
              </span>
            </section>
          ) : null}

          {/* The bookmark control is otherwise silent, and a failed save must
              not read as a success. Visible rather than hidden: "Sign in to
              save services" is the common outcome for a guest, and hiding it
              from sighted readers leaves the bookmark looking simply broken.
              SPEC.md §9.2 still forbids aria-live on this visible node, so the
              announcement itself lives in the always-mounted sr-only span
              below rather than here. */}
          {saveNotice ? (
            <p className="min-h-5 text-xs font-semibold text-[color:var(--text-muted)]">{saveNotice}</p>
          ) : null}
          {facetSelection.specialist_groups.has("aboriginal_torres_strait_islander") ? (
            // With the Aboriginal and Torres Strait Islander pathway filter on, point to
            // the First Nations mode's contacts page (liaison and community-controlled services).
            <Link
              href="/first-nations/contacts"
              className="inline-flex min-h-12 items-center gap-1.5 self-start text-sm font-medium text-[color:var(--clinical-accent)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              Open First Nations contacts
              <ArrowRight className="size-icon-sm" aria-hidden="true" />
            </Link>
          ) : null}
          <span role="status" aria-live="polite" className="sr-only">
            {saveNotice ?? ""}
          </span>

          <ResultFilterSheet
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
            panelId={filterPanelId}
            testId="service-filter-panel"
            title="Filter services"
            groups={[substanceGroup, coreGroupFacetGroup, ...facetGroups]}
            onClearAll={activeFilterCount > 0 ? clearAllFilters : undefined}
            summary={{ count: displayedMatches.length, noun: displayedMatches.length === 1 ? "service" : "services" }}
            chromeResetKey={`${deferredQuery}|${[...activeGroupSelection].sort().join(",")}|${resultScope}`}
            scope={
              showResultScope
                ? {
                    label: "Search in",
                    value: resultScope,
                    onChange: (value) => setResultScopeValue(value as ServiceResultScope),
                    options: [
                      {
                        value: "results",
                        label: "Current results",
                        count: resultsScopedCount,
                        description: "Keep the current search and service group.",
                      },
                      {
                        value: "all",
                        label: "All services",
                        count: allScopedCount,
                        description: "Apply filters across the full catalogue.",
                      },
                    ],
                  }
                : undefined
            }
          />
        </>
      }
    >
      {registryLoading ? (
        <SearchResultsSkeleton />
      ) : registryBlocked ? null : query.trim() && deferredQuery !== query ? (
        <SearchResultsSkeleton />
      ) : resultScope === "results" && query.trim() && deferredQuery === query && rankedMatches.length === 0 ? (
        // `rankedMatches` is query-only (see its definition above) and never
        // reflects the "All items" scope, which exists precisely to bypass a
        // query match of zero — see docs/filter-contract.md section 4. Gating
        // this branch on `resultScope === "results"` lets that scope fall
        // through to the facet-driven branches below instead of reporting a
        // dead end the reader already escaped via the scope segment.
        <SearchResultsEmptyState
          modeId="services"
          query={query}
          onTryExample={(example) => applyServiceQuery(example)}
        />
      ) : deferredQuery === query && displayedMatches.length === 0 ? (
        // `displayedMatches` is now group- AND facet/lens-narrowed, so a zero
        // here can come from either. Offer both escapes, and only the one that
        // applies, without reintroducing the removed query-suggestion rail.
        <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 text-center">
          <h2 className="text-lg font-bold text-[color:var(--text-heading)]">No services match</h2>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            {activeFilterCount > 0 ? "Try All services, or clear your filters." : "Try All services instead."}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Link
              href={hrefWithGroupCleared()}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[color:var(--clinical-accent)] px-4 text-sm font-bold text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              Show all services
            </Link>
            {activeFilterCount > 0 ? (
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 text-sm font-bold text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          {showComparison && selected.length >= 2 ? (
            <ComparisonPanel services={selected} onRemove={toggleSelected} onClose={() => setShowComparison(false)} />
          ) : null}
          <div id="service-search-results" data-testid="service-search-results" className="grid gap-3">
            {displayedMatches.map((service, index) => (
              <ServiceCard
                key={service.slug}
                service={service}
                index={index}
                relevanceRank={sortValue === "alpha" ? null : (relevanceRankMap.get(service.slug) ?? null)}
                query={query}
                selected={selectedSlugs.includes(service.slug)}
                onToggleSelected={toggleSelected}
                saved={accountData.isSaved("service", service.slug)}
                savedStateReady={accountData.ready}
                savedStateLoadFailed={Boolean(accountData.loadError)}
                savePending={savingSlugs.size > 0}
                onToggleSaved={toggleSaved}
              />
            ))}
          </div>
          {/* Phone A to Z strip (audit item 13): drawn only when the list is
              in A to Z order, never over a ranked list. */}
          <AlphabetStrip listId="service-search-results" testId="services-alphabet-strip" entries={alphabetEntries} />
          {query ? <UniversalSearchAlsoMatches modeId="services" query={query} /> : null}
        </>
      )}
    </SearchResultsLayout>
  );
}
