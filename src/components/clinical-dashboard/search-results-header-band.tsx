"use client";

import { Bookmark, CircleAlert, CircleMinus, Funnel, LayoutList, LoaderCircle, Search, Table2, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { searchCommandSurfaceConfig } from "@/lib/search-command-surface";
import { AsyncButton, cn } from "@/components/ui-primitives";
import { appModeSearchConfig, type AppModeId } from "@/lib/app-modes";
import { readResultSort, type ResultSortValue } from "@/lib/result-sort";
import { catalogueDegradedNotice } from "@/lib/site-content/catalogue-degraded-notice";

/**
 * How far the count can be trusted. This is a union rather than a pair of
 * booleans because `loading && error` is otherwise representable and undefined,
 * and because the clinical invariant — a faulted search must never assert a
 * number — is then one guard instead of a boolean-precedence puzzle repeated at
 * every call site. It mirrors `RegistryRequestStatus` so most callers can pass a
 * near-identity map of the status they already hold.
 */
export type SearchResultsBandStatus =
  /** The count is trustworthy. `0` is a real answer. */
  | "ready"
  /** First load. There is no trustworthy prior count to show. */
  | "loading"
  /** Background refresh. The prior count is still trustworthy. */
  | "refetching"
  /** Available sources returned an honest count, but at least one source failed. */
  | "partial"
  /** The search failed. The count is NOT trustworthy and must not be rendered. */
  | "error"
  /** Sign-in required. The count is NOT trustworthy and must not be rendered. */
  | "unauthorized";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/**
 * "Documents" -> "documents", but "DSM diagnoses" keeps its acronym. Lower-casing
 * blindly is what the fault-title copy was phrased around to avoid; inline in a
 * sentence the noun has to be lower-case unless it starts with an acronym.
 */
function inlineNoun(noun: string) {
  return /^[A-Z]{2,}/.test(noun) ? noun : noun.charAt(0).toLowerCase() + noun.slice(1);
}

/**
 * Singular for the one-result case. Three rules cover every `resultHeading` the
 * mode registry actually carries: therapies -> therapy, DSM diagnoses -> DSM
 * diagnosis, everything else drops a trailing "s".
 */
function singularNoun(plural: string) {
  if (/ies$/.test(plural)) return `${plural.slice(0, -3)}y`;
  if (/ses$/.test(plural)) return `${plural.slice(0, -2)}is`;
  return plural.replace(/s$/, "");
}

/** Sort is a two-state choice, so it reads as a segmented control rather than a
    select: a dropdown over two values makes you open a menu to learn nothing.
    It is a `sm`-and-up control — see `ResultSortControl` for why the phone line
    drops it. */
const sortOptions: ReadonlyArray<{ value: ResultSortValue; label: string }> = [
  { value: "relevance", label: "Relevance" },
  { value: "alpha", label: "A–Z" },
];

/** Below `lg` the utility group is a swipe rail rather than a wrapping block, so a
    sixth control lands off the right edge instead of growing the band. Fade that
    edge only while it actually overflows — a permanent mask would dim the last
    control on the common case where everything fits. */
function useRailOverflow<Element extends HTMLElement>() {
  // The rail is conditional in several modes. A stable object ref leaves the
  // effect with null on the render before the node appears and no dependency
  // ever changes to attach the observers. Tracking the node itself makes mount
  // and replacement observable.
  const [node, setNode] = useState<Element | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useCallback((next: Element | null) => {
    setNode(next);
    if (!next) setOverflowing(false);
  }, []);

  const measure = useCallback(() => {
    if (!node) {
      setOverflowing(false);
      return;
    }
    setOverflowing(node.scrollWidth - node.clientWidth > 1);
  }, [node]);

  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(node);
    for (const child of Array.from(node.children)) resizeObserver.observe(child);
    // Child add/remove (scope chips, utility controls) can change scrollWidth without
    // resizing the rail box; keep the fade mask honest when the child list mutates.
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            measure();
            for (const child of Array.from(node.children)) resizeObserver.observe(child);
          });
    mutationObserver?.observe(node, { childList: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
    };
  }, [measure, node]);

  return { ref, overflowing } as const;
}

export type AppliedFilterChip = {
  id: string;
  /** Compact value shown on phones, for example `High`. */
  valueLabel: string;
  /** Context restored on larger screens, for example `Risk: High`. */
  groupLabel?: string;
  /** Complete label announced by assistive technology. */
  accessibleLabel?: string;
  onRemove: () => void;
};

const EMPTY_APPLIED_FILTERS: AppliedFilterChip[] = [];

export function SearchResultsHeaderBand({
  modeId,
  query,
  matchCount,
  status,
  loading = false,
  faultTitle,
  faultBody,
  onRetry,
  faultAction,
  view = "table",
  onViewChange,
  sortValue = "relevance",
  onSortChange,
  onSaveSearch,
  utilityControls,
  mobileControls,
  mobileControlsPlacement,
  filterControls,
  appliedFilters = EMPTY_APPLIED_FILTERS,
  onClearFilters,
  filterLabel = "Filter search results",
  headingLevel = 2,
  resultNoun: resultNounOverride,
  hideEmptyQuery = false,
  emptyQueryLabel,
  emptyQuerySubject,
  catalogueDegraded = false,
  className,
}: {
  modeId: AppModeId;
  query: string;
  matchCount: number;
  /** Result trustworthiness. Defaults to `ready`, or `loading` when the legacy
      `loading` prop is set. A faulted status never renders a number. */
  status?: SearchResultsBandStatus;
  /** @deprecated Pass `status="loading"`. Retained so the pages with no async
      source need no edit; ignored whenever `status` is supplied. */
  loading?: boolean;
  /** Fault panel heading. Defaults to mode-specific copy. */
  faultTitle?: string;
  /** Fault panel body. Defaults to mode-specific copy. */
  faultBody?: string;
  /** Renders an in-panel Retry through the shared busy contract. */
  onRetry?: () => void | Promise<void>;
  /** Replaces Retry when recovery is not a re-request (e.g. a sign-in link). */
  faultAction?: ReactNode;
  /**
   * The catalogue behind this count was served from the in-bundle seed list because the
   * published one could not be read. Distinct from `status="partial"`, which says a source
   * failed and the count is short: here the count is complete for the list that was searched,
   * and what the reader cannot otherwise tell is that the list itself may lag what was
   * published. The wording is `catalogueDegradedNotice`, shared with every other surface that
   * says this, so it can never drift into a second phrasing.
   */
  catalogueDegraded?: boolean;
  view?: "table" | "list";
  onViewChange?: (view: "table" | "list") => void;
  sortValue?: ResultSortValue;
  onSortChange?: (value: ResultSortValue) => void;
  onSaveSearch?: () => void;
  /** Page-specific actions that belong beside sort/view controls. */
  utilityControls?: ReactNode;
  /** Compact page-specific controls shown in the utility row below `sm`. */
  mobileControls?: ReactNode;
  /**
   * Whether `mobileControls` can share the count line on a phone.
   *
   * The one-line bar only works when the phone control is a compact trigger — a
   * badged icon button fits beside the count with room to spare, while a
   * `w-full` native select pinned into a 58px line at 320px is unreadable. Every
   * mode now passes a trigger (`ResultFilterTrigger`, opening a sheet) and so
   * every mode passes `inline`; the six band modes that shipped a select — the
   * last two a two-column grid of them — were converted together. (A seventh
   * surface, the tools launcher, carried the same select outside this band.)
   *
   * The default nonetheless stays `row`, and reads the shape of what was passed
   * rather than asking every caller: no phone control at all means nothing wide
   * can be there, so the line collapses; a phone control is assumed wide until
   * its page says otherwise. Nothing relies on that fallback today — it exists
   * so a new mode that forgets this prop, or one that has a genuine reason to
   * hand over something full-width, degrades to a second row rather than to an
   * unusable line. Do not flip it to `inline`.
   */
  mobileControlsPlacement?: "inline" | "row";
  /** Page-specific filters rendered as a full-width row within the shared ribbon. */
  filterControls?: ReactNode;
  /** Applied filters, shown on a labelled shelf under the bar. Each removes in
      one tap. Supplied by the page rather than read from context: the previous
      shelf pulled from a context value nothing could populate, so it rendered
      for nobody. */
  appliedFilters?: AppliedFilterChip[];
  /** Clears every applied filter at once. Omit to hide the trailing Clear. */
  onClearFilters?: () => void;
  filterLabel?: string;
  /** Use level 1 when the ribbon is the route's primary page heading. */
  headingLevel?: 1 | 2;
  /**
   * Hide the query subject when `query` is empty instead of falling back to
   * "All". Dictionary browse keeps this band as count + Filter with no
   * invented query chip.
   */
  hideEmptyQuery?: boolean;
  /** Accessible region name used when `hideEmptyQuery` omits the subject. */
  emptyQueryLabel?: string;
  /**
   * The section name shown as the heading when nothing has been typed, in place
   * of "All". A browse list is the whole section in A to Z order, not a search
   * that picked something, so it is titled by what it is ("DSM diagnoses").
   */
  emptyQuerySubject?: string;
  /**
   * What this count counted, when the mode registry's noun is not specific
   * enough to be true.
   *
   * The default is `resultHeading` and it is right for the eleven modes whose
   * result list is one kind of thing. Dictionary's is not: the same list is
   * terms or abbreviations depending on which scope segment is pressed, so
   * "1 dictionary result" would name a category the reader did not choose while
   * "1 abbreviation" names what is actually on screen. Pass it already
   * singularised for the count you passed — the band cannot know that the plural
   * of this mode's noun is not the word plus "s".
   */
  resultNoun?: string;
  className?: string;
}) {
  const trimmedQuery = query.trim();
  const browseSubject = trimmedQuery ? undefined : emptyQuerySubject?.trim() || undefined;
  const displayQuery = trimmedQuery || browseSubject || "All";
  const showQuerySubject = Boolean(trimmedQuery) || Boolean(browseSubject) || !hideEmptyQuery;
  // Only a typed query is drawn after the count (owner design review, 12 Oct
  // 2026: "146 DSM diagnoses", not "146 DSM diagnoses | DSM diagnoses"). A browse
  // subject or "All" says nothing the count's own noun does not, so it stays in
  // the DOM as the region's heading for assistive technology and is not drawn.
  const querySubjectDrawn = Boolean(trimmedQuery);
  const regionLabel = browseSubject
    ? `Browse ${browseSubject}`
    : showQuerySubject
      ? `Search results for ${displayQuery}`
      : (emptyQueryLabel ?? "Catalogue");
  // `status` wins when both are passed; `loading` is the deprecated shim.
  const resolvedStatus: SearchResultsBandStatus = status ?? (loading ? "loading" : "ready");
  // The clinical invariant, expressed once: a search that failed has no count to
  // report, so no number may reach the DOM. "0 matches" on a failed services
  // search reads as "there are no crisis services" rather than "we could not check".
  const faulted = resolvedStatus === "error" || resolvedStatus === "unauthorized";
  const partial = resolvedStatus === "partial";
  const busy = resolvedStatus === "loading" || resolvedStatus === "refetching";
  // "Service matches" -> "Services", leaving already-plural headings ("Favourites",
  // "DSM diagnoses") untouched. Phrasing the title as "<noun> could not be loaded"
  // rather than "Could not load <noun>" avoids having to lower-case the leading
  // word, which would mangle the acronym in "DSM diagnoses".
  const searchConfig = appModeSearchConfig(modeId);
  const resultNoun = resultNounOverride ?? searchConfig?.resultHeading?.replace(/ matches$/i, "s") ?? "Results";
  const resolvedFaultTitle =
    faultTitle ?? (resolvedStatus === "unauthorized" ? "Sign in to continue" : `${resultNoun} could not be loaded`);
  const resolvedFaultBody =
    faultBody ??
    (resolvedStatus === "unauthorized"
      ? "Your session has expired. Sign in again to run this search."
      : "The search could not be completed. Try again shortly.");
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry();
    } catch {
      // The existing fault/partial state remains the failure surface; a
      // rejected retry must not escape as an unhandled promise.
    } finally {
      setRetrying(false);
    }
  };
  // Page-supplied filter/mobile controls carry their own result counts ("Forms 0",
  // "All (0)"). Suppressing the number in the spine while those still render it
  // defeats the whole invariant — the reader still sees a zero asserted about a
  // search that never ran. A filter over a result set that failed to load is
  // meaningless anyway, so the faulted band drops them entirely.
  // `loading` means no trustworthy count exists yet, exactly like a fault: forms
  // forces `displayedMatches` to [] until the registry is ready, so a count-
  // bearing page control would assert "0" beneath a "Searching…" spine.
  // `refetching` is deliberately excluded — there the prior count is still correct.
  const countUntrusted = faulted || resolvedStatus === "loading";
  const pageControls = countUntrusted ? null : filterControls;
  const pageMobileControls = countUntrusted ? null : mobileControls;
  const hasUtilities = Boolean(
    onSortChange || onViewChange || onSaveSearch || utilityControls || pageMobileControls || (partial && onRetry),
  );
  // Sort is the one utility that does not render below `sm`. A page whose only
  // utility is sort would otherwise keep this group mounted on a phone as an
  // empty flex child — and in `inline` placement below 414px that child is
  // `w-full basis-full`, so it would take a whole empty second line under the
  // count. Hide the group itself there instead of leaving a ghost row.
  const hasPhoneUtilities = Boolean(
    onViewChange || onSaveSearch || utilityControls || pageMobileControls || (partial && onRetry),
  );
  // See `mobileControlsPlacement`: absent a declaration, a page control is
  // assumed to be a full-width select and keeps its own row, and a band with no
  // page control collapses to one line.
  // Derive from the raw `mobileControls` prop, not the count-gated
  // `pageMobileControls`: during `loading`/`faulted` the page control is forced
  // to null, and keying placement off that flipped six modes between `inline`
  // (nowrap, 58px) and `row` (wrapping) geometry every search.
  const inlineControls = (mobileControlsPlacement ?? (mobileControls ? "row" : "inline")) === "inline";
  const QueryHeading = headingLevel === 1 ? "h1" : "h2";
  const { ref: railRef, overflowing: railOverflowing } = useRailOverflow<HTMLDivElement>();
  // The shelf gets its own instance rather than sharing the rail's. They overflow
  // independently — a mode can have five chips and one utility control, or the
  // reverse — and a shared flag would fade an edge that is not actually clipped.
  const { ref: shelfTrackRef, overflowing: shelfOverflowing } = useRailOverflow<HTMLDivElement>();

  return (
    <section
      aria-label={regionLabel}
      aria-busy={busy}
      data-status={resolvedStatus}
      data-testid="search-query-ribbon"
      className={cn(
        // One plain line, not a boxed strip (owner design review, 12 Oct 2026):
        // the count reads like a Work section header, with Filter beside it. The
        // border stays, transparent, so forced colours still draw the band's
        // edge and its doubled top edge when a search faults. The class stays
        // because the forced-colors fault signal hangs off it, and because the
        // style-contract registry names it.
        "search-band relative overflow-hidden rounded-xl border border-transparent",
        className,
      )}
    >
      {/* One line. The band was 123px on a phone to say "12 documents", because
          the utility rail dropped to its own row and that row was ~85% empty.
          It wraps only where a page supplies a full-width phone control — see
          `mobileControlsPlacement`. Inline phone controls fit beside the
          truncating query now that Sort and full-width selects are wide-only. */}
      <div
        className={cn(
          "flex min-w-0 items-center gap-x-2 px-1 sm:min-h-[3.75rem] sm:flex-nowrap sm:gap-x-2.5",
          inlineControls ? "min-h-[3.625rem] flex-nowrap" : "flex-wrap py-2 sm:py-0",
        )}
      >
        {/* `mr-auto` pins the control group to the right edge below `lg`. At `lg`
            the rail's own `flex-1` consumes the free space first — auto margins
            only absorb what is left after flexible lengths resolve — so the wide
            layout is unchanged and no breakpoint had to move. */}
        <div className={cn("mr-auto flex min-w-0 items-center gap-2 sm:gap-2.5", inlineControls ? null : "py-1")}>
          {/* The fault mark. A healthy search draws no mark at all: the plain
              line carries no accent (owner design review, 12 Oct 2026). A failed
              or partial one keeps a double stroke before the count, so state is
              never carried by colour alone. Rendered in flow rather than
              absolutely positioned, so the band's corner can never clip it. */}
          {faulted || partial ? <span className="search-band-lead shrink-0" data-tone="warning" aria-hidden /> : null}
          {/* Count first, query second. The count is the answer to the search; the
              query is what you already typed, and the composer above still shows it.
              Leading with the query spent the band's only heading slot on
              information the reader supplied seconds ago, and left the count with
              nothing to anchor it once the composer scroll-hides on a phone.
              The heading element and its accessible name are unchanged — only its
              position and weight — so anything resolving the query by role still
              finds it. */}
          {/* Neutral, not a success pill: a count is not a state that was achieved,
              and green has to keep meaning something where it does appear. */}
          {/* One unconditional `role="status"` in every state. Playwright asserts it
              is visible on every search route, so it must never be swapped out or
              wrapped in a state branch. While faulted the live region is silenced
              (`aria-live="off"`) and the freshly-mounted fault `role="alert"` below
              makes the single announcement, rather than both speaking. */}
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap",
              faulted ? "search-band-fault" : "search-band-count-word",
              busy && "text-[color:var(--clinical-accent)]",
              (faulted || partial) && "text-[color:var(--warning)]",
              !busy && !faulted && !partial && "text-[color:var(--text-muted)]",
            )}
            role="status"
            aria-live={faulted ? "off" : "polite"}
            aria-atomic="true"
          >
            {/* The state tile is gone, but state must not fall back to hue alone:
                the tile carried it as shape, and a failed search that is merely a
                different colour is invisible to a reader who cannot separate the
                two. The glyph renders only for the states that are not `ready`,
                so the resting bar stays clean, and it is an SVG stroke — which
                survives forced colors, where a tinted tile background does not.
                Shape, glyph presence and the absence of a number are three
                independent non-chromatic channels. */}
            {resolvedStatus === "loading" ? (
              <LoaderCircle className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden />
            ) : faulted || partial ? (
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
            ) : null}
            {resolvedStatus === "loading" ? (
              "Searching…"
            ) : resolvedStatus === "error" ? (
              "Couldn’t search"
            ) : resolvedStatus === "unauthorized" ? (
              "Sign in to search"
            ) : (
              // `refetching` keeps text content identical to `ready` so the atomic
              // live region does not re-announce an unchanged count. The pulsing
              // dot is the whole signal and it is decorative.
              //
              // This comment used to add "and the dimming is CSS via
              // `data-status`". There is no `[data-status="refetching"]` rule in
              // globals.css and there is no evidence there ever was, so the
              // sentence described an intention rather than the code. Adding the
              // rule is a visual change across twelve modes and belongs to
              // whoever decides a background refresh should look different;
              // asserting it here while it does not exist is what let it go
              // unnoticed.
              <>
                {resolvedStatus === "refetching" ? (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--clinical-accent)] motion-safe:animate-pulse"
                    aria-hidden
                  />
                ) : null}
                <span>
                  <span
                    className="search-band-count text-[color:var(--text-heading)]"
                    data-zero={matchCount === 0 ? "true" : undefined}
                  >
                    {matchCount}
                  </span>{" "}
                  {/* The count names what it counted. "12 matches" matched what?
                      Once the query stops being the heading, an unlabelled number
                      is unanchored on a deep link or below the fold — and the mode
                      registry already carries the noun. */}
                  {/* An override is already correct for the count it was given —
                      a caller that knows "abbreviation" is the singular of
                      "abbreviations" also knows which one this count needs, and
                      `singularNoun` would turn a supplied "abbreviation" into
                      itself only by luck of the suffix rules. */}
                  {resultNounOverride ??
                    (matchCount === 1 ? singularNoun(inlineNoun(resultNoun)) : inlineNoun(resultNoun))}
                  {/* Nested in the count phrase, not a sibling flex item: the
                      status row is `flex … gap-1.5`, so a separate span with a
                      leading space doubled the gap before the middot and still
                      left the live-region textContent missing that space. */}
                  {partial ? (
                    <span className="text-[color:var(--warning)]" title="Some result sources could not be loaded">
                      {" · some sources unavailable"}
                    </span>
                  ) : null}
                  {/* Same nesting rule as `partial` above: inside the count phrase, not a
                      sibling flex item, so the live region's textContent keeps the space
                      before the middot. */}
                  {catalogueDegraded ? (
                    <span
                      className="text-[color:var(--warning)]"
                      title="This list was served from the built-in catalogue because the published one could not be read"
                    >
                      {` · ${catalogueDegradedNotice}`}
                    </span>
                  ) : null}
                </span>
              </>
            )}
          </span>
          {/* The query, stated quietly after the count. The composer holds it too,
              but phone chrome scroll-hides and this band pins, so while you read
              results nothing on screen would otherwise say what was asked. It is
              always rendered rather than appearing on scroll — conditional chrome
              is what this band spent its last redesign removing — and it is the
              part that truncates when the line runs out, never the number. */}
          {querySubjectDrawn ? (
            <>
              <span className="search-band-rule mx-0.5 h-[1.125rem] w-px shrink-0" aria-hidden />
              <QueryHeading
                // `min-w-[2rem]` keeps a non-empty box at 320px, so the heading stays
                // findable and visible when a wide page control squeezes the line.
                className="search-band-subject min-w-[2rem] truncate text-[color:var(--text-muted)] lg:max-w-[24rem]"
                title={displayQuery}
              >
                {displayQuery}
              </QueryHeading>
            </>
          ) : (
            <>
              {showQuerySubject ? <QueryHeading className="sr-only">{displayQuery}</QueryHeading> : null}
              <span className="min-w-0 flex-1" aria-hidden="true" />
            </>
          )}
        </div>

        {hasUtilities ? (
          <div
            data-testid="search-query-ribbon-utilities"
            className={cn(
              hasPhoneUtilities ? "flex" : "hidden sm:flex",
              "min-w-0 items-center gap-1.5 lg:flex-1",
              // Row placement: wrap so a `w-full` phone select gets its own line
              // instead of sharing a shrinkable flex line with Sort. At `sm+` the
              // phone control is hidden and the track returns to a single row.
              //
              // Inline placement is `shrink-0`, not `shrink`. It was `shrink`, and
              // that is the whole regression: on an over-subscribed line the query
              // group and this group both yielded, so the shortfall was paid by the
              // *controls* — the sort group was clipped mid-glyph by the track's
              // `overflow-x-auto` and its last option was then washed out by the
              // 28px overflow mask. A 41.9px clip reproduced at 540px with a
              // four-word query, so this was never a small-phone problem; the
              // narrow widths just hit it first. The band's stated priority is that
              // the query "is the part that truncates when the line runs out, never
              // the number" — the controls are not negotiable either. `shrink-0`
              // makes the truncating query absorb the shortfall, which is what
              // `truncate` + `min-w-[2rem]` on the heading already exist to do.
              //
              inlineControls ? "shrink-0" : "w-full flex-wrap pb-1 sm:w-auto sm:flex-nowrap sm:pb-0",
            )}
          >
            {/* Applied scopes have moved to their own labelled shelf below. They are
                state, not tools: sharing the utilities rail with sort and view mixed
                the two, and let a chip be pushed off the right edge of a scrolling
                rail — losing the only affordance for removing it. */}
            <span className="hidden lg:block lg:flex-1" aria-hidden />
            {/* Only the optional controls scroll. Filter and Retry are pinned
                siblings after this track, so neither can be scrolled away — the
                rail's last child used to be the page filter, which made the one
                control carrying filter state the first to fall off the right edge
                once a mode added a Retry or a longer sort label. The overflow,
                mask and their `lg:` release all stay exactly where they were:
                moving them down to `sm:` would let a mode with sort + view + save
                + a page control exceed the width between 640 and 1023px, and
                `expectNoPageHorizontalOverflow` runs immediately after several
                ribbon assertions. */}
            <div
              ref={railRef}
              data-testid="search-query-ribbon-utility-track"
              data-overflowing={railOverflowing ? "true" : undefined}
              className={cn(
                "flex min-w-0 shrink items-center gap-1.5 overflow-x-auto lg:overflow-x-visible",
                "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                "data-[overflowing=true]:[mask-image:linear-gradient(to_right,#000_calc(100%-1.75rem),transparent)] lg:data-[overflowing=true]:[mask-image:none]",
              )}
            >
              {/* Sort inboard: it is set about once a session, so it does not need
                  to be the easiest thing to hit. Filter is rendered last instead —
                  it is the only control carrying state, the one you return to
                  repeatedly, and on a phone the right edge is where the thumb
                  already is. */}
              {onSortChange ? <ResultSortControl value={sortValue} onChange={onSortChange} /> : null}
              {utilityControls}
              {onViewChange ? (
                <div
                  className="inline-flex min-h-tap shrink-0 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] sm:min-h-compact-meta"
                  role="group"
                  aria-label="Results view"
                >
                  <button
                    type="button"
                    aria-pressed={view === "table"}
                    onClick={() => onViewChange("table")}
                    className={cn(
                      "grid min-h-tap min-w-tap place-items-center sm:min-h-compact-meta sm:min-w-compact-meta",
                      focusRing,
                      view === "table"
                        ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                        : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
                    )}
                  >
                    <Table2 className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Table view</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={view === "list"}
                    onClick={() => onViewChange("list")}
                    className={cn(
                      "grid min-h-tap min-w-tap place-items-center border-l border-[color:var(--border)] sm:min-h-compact-meta sm:min-w-compact-meta",
                      focusRing,
                      view === "list"
                        ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                        : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
                    )}
                  >
                    <LayoutList className="h-4 w-4" aria-hidden />
                    <span className="sr-only">List view</span>
                  </button>
                </div>
              ) : null}
              {onSaveSearch ? (
                <button
                  type="button"
                  onClick={onSaveSearch}
                  className={cn(
                    "inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-[color:var(--text-muted)] search-band-ghost hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)] sm:min-h-compact-meta",
                    focusRing,
                  )}
                >
                  <Bookmark className="h-3.5 w-3.5" aria-hidden />
                  <span className="max-[389px]:sr-only">Save search</span>
                </button>
              ) : null}
            </div>
            {/* Pinned. Retry is the recovery action in a degraded state — the one
                control that must never require a horizontal swipe to reach. */}
            {partial && onRetry ? (
              <AsyncButton
                type="button"
                busy={retrying}
                busyLabel="Retrying…"
                onClick={retry}
                className={cn(
                  "inline-flex min-h-tap shrink-0 items-center justify-center rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 text-[color:var(--warning)] search-band-ghost hover:border-[color:var(--warning)] sm:min-h-compact-meta",
                  focusRing,
                )}
              >
                Retry
              </AsyncButton>
            ) : null}
            {/* Must remain the last element child of the utilities group: the page
                filter is the control a thumb reaches for, and `ui-tools` asserts
                that placement. Pinned outside the scroll track above, so it is now
                also the control that cannot be scrolled away. */}
            {pageMobileControls ? (
              <div
                data-testid="search-query-ribbon-mobile-controls"
                role="group"
                aria-label={filterLabel}
                className={cn(
                  "min-w-0 sm:hidden",
                  // `basis-full shrink-0` forces a full-width second line in row
                  // mode so the select keeps its intrinsic width and Sort stays
                  // on the scroll track above it, rather than both compressing
                  // at 320–390px.
                  inlineControls ? "flex shrink items-center" : "w-full basis-full shrink-0",
                )}
              >
                {pageMobileControls}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {pageControls ? (
        <div
          data-testid="search-query-ribbon-filters"
          role="group"
          aria-label={filterLabel}
          className={cn("min-w-0 px-1 pb-1", Boolean(pageMobileControls) && "hidden sm:block")}
        >
          {pageControls}
        </div>
      ) : null}
      {/* The shelf. `Filtered by` labels it as state rather than a second bank
          of buttons — without the label a row of accent pills reads as a
          toolbar. It deliberately survives `loading` and a zero result: nothing
          matching is exactly when you need to relax a filter, and dropping it
          mid-search would flicker the chips out and back on every keystroke.
          A fault still keeps it: retrieval and result constraints are user
          state, not a claim that the faulted result count is trustworthy, and
          the controls remain the shortest recovery path. */}
      {appliedFilters.length > 0 ? (
        <div
          data-testid="search-query-ribbon-shelf"
          role="group"
          aria-label="Applied filters"
          className="flex min-w-0 items-center gap-1.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2.5 py-2 sm:gap-2 sm:px-3"
        >
          {/* A funnel on a phone, the wordmark from `sm`. A prefixed chip costs
              roughly 215px of a 350px bar, so every character the label spends is
              a chip the reader cannot see; the glyph says the same thing in 16px.
              The group's accessible name is "Applied filters" either way, so both
              forms are decorative and neither is the label of record. */}
          <Funnel className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] sm:hidden" aria-hidden />
          <span className="search-band-shelf-label hidden shrink-0 uppercase text-[color:var(--text-muted)] sm:block">
            Filtered by
          </span>
          {/* The chips get their own scroll track so `Clear` can sit outside it.
              Previously the whole row scrolled and `Clear` trailed a `flex-1`
              spacer, so four or five chips collapsed the spacer and pushed the
              row's only global action past the right edge — reachable only by
              swiping a row whose scrollbar is hidden. That is the same defect
              this shelf was built to avoid for the chips themselves. */}
          <div
            ref={shelfTrackRef}
            data-testid="search-query-ribbon-shelf-track"
            data-overflowing={shelfOverflowing ? "true" : undefined}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto",
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              // The rail's mask, on the same overflow condition, so a clipped
              // chip row signals more content the way the rail already does.
              // Held at `lg:` to match the rail: below it the row can genuinely
              // clip, above it there is width to spare.
              "data-[overflowing=true]:[mask-image:linear-gradient(to_right,#000_calc(100%-1.75rem),transparent)] lg:data-[overflowing=true]:[mask-image:none]",
            )}
          >
            {appliedFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={filter.onRemove}
                aria-label={`Remove ${filter.accessibleLabel ?? `${filter.groupLabel ? `${filter.groupLabel}: ` : ""}${filter.valueLabel}`} filter`}
                title={`${filter.groupLabel ? `${filter.groupLabel}: ` : ""}${filter.valueLabel}`}
                data-selected="true"
                className={cn(
                  // Hover deepens the chip's own accent rather than swapping to the
                  // neutral border the surface controls use — an accent-soft chip
                  // going grey on hover reads as losing its active state.
                  "inline-flex min-h-tap shrink-0 max-w-[12rem] items-center gap-1 rounded-[7px] border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 text-[color:var(--clinical-accent)] search-band-chip hover:border-[color:var(--clinical-accent)] hover:text-[color:var(--clinical-accent-hover)] sm:min-h-compact-meta",
                  focusRing,
                )}
              >
                {filter.groupLabel ? (
                  <span className="hidden truncate sm:inline">
                    <span className="text-[color:var(--text-muted)]">{filter.groupLabel}: </span>
                    {filter.valueLabel}
                  </span>
                ) : null}
                <span className={cn("truncate", filter.groupLabel && "sm:hidden")}>{filter.valueLabel}</span>
                <X className="h-3 w-3 shrink-0" aria-hidden />
              </button>
            ))}
          </div>
          {onClearFilters && appliedFilters.length > 1 ? (
            <button
              type="button"
              onClick={onClearFilters}
              data-testid="search-query-ribbon-shelf-clear"
              className={cn(
                // Matched to the chips rather than kept small. It was `px-2 py-1`
                // — about 26px beside 48px chips — which made the row's only
                // global action its hardest target. It stays quiet through weight
                // and an underline instead. 48px, not the 44px a generic tap rule
                // would suggest: `min-h-11` reintroduces a fixed `ui-smoke`
                // sub-pixel flake, and `--spacing-tap` is this repo's floor.
                "search-band-ghost inline-flex min-h-tap shrink-0 items-center rounded-md px-2 text-[color:var(--text-muted)] underline decoration-[color:var(--border-strong)] underline-offset-2 hover:text-[color:var(--text)] hover:decoration-current sm:min-h-compact-meta",
                focusRing,
              )}
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
      {/* The fault panel carries the announcement and the recovery affordance.
          `role="alert"` is a distinct role from the spine's `role="status"`, so
          singular role queries in jsdom and Playwright still resolve to exactly
          one node each. */}
      {faulted ? (
        <div
          role="alert"
          data-testid="search-query-ribbon-fault"
          className="search-band-fault-panel rounded-xl border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-3 text-center sm:px-4"
        >
          <p className="search-band-fault text-[color:var(--warning)]">{resolvedFaultTitle}</p>
          <p className="search-band-count-word mt-0.5 text-[color:var(--warning)]">{resolvedFaultBody}</p>
          {/* Wrapping is load-bearing: differentials passes Retry plus two
              "Browse …" links, and the band root is `overflow-hidden`, so on a
              narrow phone a non-wrapping row clips the trailing action away
              rather than pushing it to a second line. */}
          {onRetry || faultAction ? (
            <div className="mt-2.5 flex flex-wrap justify-center gap-2">
              {onRetry ? (
                <AsyncButton
                  type="button"
                  busy={retrying}
                  busyLabel="Retrying…"
                  onClick={retry}
                  className={cn(
                    "inline-flex min-h-tap shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-[color:var(--text-muted)] search-band-ghost hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)] sm:min-h-compact-meta",
                    focusRing,
                  )}
                >
                  Retry
                </AsyncButton>
              ) : null}
              {faultAction}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Sort, from `sm` up only. On a phone the two segments — "Relevance" and "A–Z" —
 * cost roughly half the band's one line, which is the state the phone bar was
 * reported in: count, query, sort and Filter competing for ~350px, with the
 * query truncating to pay for a control that is set about once a session. The
 * default order is relevance, which is what a phone reader wants anyway, so the
 * phone drops the control rather than squeezing every neighbour around it.
 *
 * Only the affordance is `sm`-and-up. `?sort=` still carries an alpha order onto
 * a phone from a link or a wider session, and the results honour it.
 *
 * The display class lives in this base string rather than in a caller's
 * `className`: `cn` is a plain join with no Tailwind conflict resolution, so a
 * base `inline-flex` plus a caller's `hidden` would resolve by stylesheet order
 * rather than by intent.
 */
export function ResultSortControl({
  value,
  onChange,
  className,
}: {
  value: ResultSortValue;
  onChange: (value: ResultSortValue) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Sort results"
      className={cn(
        "hidden min-h-tap shrink-0 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)] sm:inline-flex sm:min-h-compact-meta",
        className,
      )}
    >
      {sortOptions.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(readResultSort(option.value))}
            className={cn(
              // `px-2.5`, not `px-3`. Sort is the widest thing on the phone line
              // and the one-line band has no slack: at 12px padding the group is
              // 135.7px against a 131.8px track at 430px, so the rail declared
              // overflow and the mask faded out its own last option. The 8px this
              // returns is what clears 393/402/430/440. Height is untouched —
              // `min-h-tap` is the tap floor, and it is the floor that matters.
              "search-band-sort-option min-h-tap whitespace-nowrap px-2.5 sm:min-h-compact-meta sm:px-3",
              index > 0 && "border-l border-[color:var(--border)]",
              focusRing,
              selected
                ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The recovery actions on the no-results panel.
 *
 * `min-h-tap`, not the 36px this carried before. The height is pre-existing, but
 * it stopped being incidental once these became the *designated* way out: on the
 * documents zero-result and filtered-to-zero paths they are the only offered
 * escape, and on therapy-compass `Clear search` is the only one for a query-only
 * zero result. Shipping the escape hatch below the floor the same change raised
 * the facets, the find field and the disclosure headings to would contradict the
 * rule this component's own redesign argues for. It keeps `min-h-compact-meta`
 * (40px) from `sm`, exactly like the filter controls. Not a primary CTA.
 */
const emptyStateAction =
  "inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-[color:var(--border)] px-3 text-xs font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text)] sm:min-h-compact-meta";

export function SearchResultsEmptyState({
  modeId,
  query,
  headingLevel,
  onTryExample,
  onCrossMode,
  canAccessFavourites = false,
  appliedFilters = EMPTY_APPLIED_FILTERS,
  onClearFilters,
  onClearSearch,
  onBrowseAll,
  browseAllLabel = "Browse all sources",
  degraded = false,
}: {
  modeId: AppModeId;
  query: string;
  /**
   * Render the title as a heading at this level instead of a paragraph.
   *
   * Opt-in and un-defaulted, for the same reason `EmptyState` is (#1612): most
   * of the twelve modes rendering this state sit inside a region whose heading
   * the band already owns, so promoting every title would insert a level the
   * surrounding outline never declared. The states that own their region — the
   * main document-search zero-result state — pass the level their outline
   * requires, and their heading is pinned by `ui-smoke`. Dropping it back to a
   * paragraph when this shared state replaced `EmptyState` is what turned that
   * assertion red.
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  onTryExample?: (example: string) => void;
  onCrossMode?: (modeId: AppModeId) => void;
  canAccessFavourites?: boolean;
  /** The same chips the shelf is rendering. When the set is empty *because of
      these*, the way out is to relax one — not to run a different search. The
      release that made filters real (#1555) deleted the only copy pointing at
      them, so a reader filtered to zero was offered an unrelated example and a
      different mode, never the chips directly above that caused it. */
  appliedFilters?: AppliedFilterChip[];
  /** Clears every filter and keeps the query. Omit to hide that route. */
  onClearFilters?: () => void;
  /** Clears the query when a mode has no example or cross-mode recovery. */
  onClearSearch?: () => void;
  /** Reach rather than refinement: the whole corpus, for when narrowing this
      result set is not the answer. */
  onBrowseAll?: () => void;
  browseAllLabel?: string;
  /**
   * The result set is empty because retrieval failed, not because nothing
   * matched. Replaces the copy rather than annotating it: in a clinical corpus
   * "no results" is read as "no guidance exists", and that inference must not
   * be available when the search never actually ran.
   */
  degraded?: boolean;
}) {
  const config = searchCommandSurfaceConfig(modeId);
  const crossModes = (config?.crossModes ?? []).filter((target) => canAccessFavourites || target !== "favourites");
  const searchConfig = appModeSearchConfig(modeId);
  const resultNoun = inlineNoun(searchConfig?.resultHeading?.replace(/ matches$/i, "s") ?? "Results");
  // The last chip, named. Deliberately not described as "the one you just
  // added": `appliedFilters` arrives in group order, not application order, so
  // calling it the most recent would be a claim the data cannot support.
  const lastFilter = appliedFilters.at(-1);
  const filtered = appliedFilters.length > 0;
  const Title = headingLevel ? (`h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6") : "p";
  // What the panel can actually offer, decided before the copy describes it.
  // Both halves need a handler as well as data: most hosts render this panel
  // without `onTryExample`/`onCrossMode` (only Services, Calculators and Forms
  // wire the first), so a mode with a full `searchCommandSurfaceByMode` entry can
  // still have no example and no cross-mode route to offer — yet the body said
  // "Try an example, or jump to another mode", naming two controls the reader
  // could not see. Copy that promises absent affordances is the same defect class
  // as a label that does not match its handler.
  const hasExample = Boolean(config?.examples[0] && onTryExample);
  const hasCrossMode = crossModes.length > 0 && Boolean(onCrossMode);
  // Degraded outranks filtered, which outranks a plain miss. A search whose
  // retrieval layer errored has not established that anything is absent, so it
  // must not borrow either of the copies below: both assert a real zero and
  // send the reader off to fix a query or a filter that was never the problem.
  const emptyTitle = degraded
    ? "Search could not complete"
    : filtered
      ? appliedFilters.length === 1
        ? `No ${resultNoun} match the selected filter`
        : `No ${resultNoun} match all ${appliedFilters.length} filters`
      : `No matches for “${query.trim() || "your search"}”`;
  const emptyBody = degraded
    ? "Part of the search index did not respond, so this is not a reliable “nothing found”. Retry shortly, and do not read it as an absence of guidance."
    : filtered
      ? "The search itself ran fine — the filters above excluded everything. Remove one to widen it."
      : hasExample && hasCrossMode
        ? "Try an example, or jump to another mode."
        : hasExample
          ? "Try one of the examples below."
          : hasCrossMode
            ? "Try another mode."
            : "Check the spelling, or try a broader term.";
  // Live regions that mount already populated are silent in most screen readers.
  // Deferred population makes the query-only path announce. Filtered-to-zero
  // suppresses the region entirely: the band's `role="status"` already
  // re-announced the zero count for that interaction, and a second polite
  // region would double-speak.
  const [liveMessage, setLiveMessage] = useState("");
  useEffect(() => {
    // The population happens in the frame callback, never in the effect body.
    // `react-hooks/set-state-in-effect` blocks the synchronous form and is right
    // to: the deferred render is the entire mechanism here, so doing it
    // synchronously would both trip the rule and defeat the purpose.
    //
    // Neither clearing call this replaced was doing anything. The region is
    // rendered only when `!filtered`, so the filtered branch had nothing mounted
    // to clear; and a re-populating region is already unmounted-then-mounted by
    // that same gate, so it starts empty on its own.
    if (filtered) return;
    const frame = requestAnimationFrame(() => setLiveMessage(`${emptyTitle}. ${emptyBody}`));
    return () => cancelAnimationFrame(frame);
  }, [filtered, emptyTitle, emptyBody]);
  const secondary = [
    config?.examples[0] && onTryExample ? (
      <button
        key="example"
        type="button"
        onClick={() => onTryExample(config.examples[0])}
        className={cn(emptyStateAction, focusRing)}
      >
        Try: {config.examples[0]}
      </button>
    ) : null,
    ...crossModes.slice(0, 2).map((target) =>
      onCrossMode ? (
        <button
          key={target}
          type="button"
          onClick={() => onCrossMode(target)}
          className={cn(emptyStateAction, focusRing)}
        >
          Search in {target}
        </button>
      ) : null,
    ),
    onClearSearch ? (
      <button
        key="clear-search"
        type="button"
        onClick={onClearSearch}
        data-testid="search-results-empty-clear-search"
        className={cn(emptyStateAction, focusRing)}
      >
        <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Clear search
      </button>
    ) : null,
    onBrowseAll ? (
      <button key="browse" type="button" onClick={onBrowseAll} className={cn(emptyStateAction, focusRing)}>
        <LayoutList className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {browseAllLabel}
      </button>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="relative overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-5 text-left shadow-[var(--shadow-inset)]">
      {/* The state mark, carrying the same vocabulary as the band's own lead:
          the stroke *count* — not the hue — is what separates a degraded search
          from a healthy one, because `--clinical-accent` resolves to LinkText
          under forced colors while `--warning` resolves to CanvasText, and hue
          alone would render "filtered" and "could not complete" identically.
          Utilities rather than an unlayered class: `.search-band-lead` is
          unlayered precisely so it can beat Tailwind's utilities layer, and this
          mark has no utility to beat — adding a class here would enlarge the
          inventory `style-contract-registry` polices for nothing. `box-content`
          + `w-0` makes the border the entire width. Exactly one width class per
          branch: two would both emit `border-left-width` and the winner would be
          stylesheet order rather than the branch. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 box-content w-0",
          degraded
            ? "border-l-[6px] border-double border-l-[color:var(--warning)]"
            : filtered
              ? "border-l-[3px] border-solid border-l-[color:var(--clinical-accent)]"
              : "border-l-[3px] border-solid border-l-[color:var(--border-strong)]",
          "forced-colors:border-l-[color:CanvasText]",
        )}
      />
      {/* Visible copy is never inside the live region: a region that mounts
          already populated is silent in most screen readers, and wrapping the
          visible tree would flash empty for a frame. The sr-only live region
          below is populated after mount (query-only) or omitted (filtered).
          NOT `role="status"`: the band already owns that role on every search
          route and a second one makes singular `getByRole("status")` ambiguous. */}
      {/* The glyph sits beside the heading rather than inside it: a 48px tinted
          disc above centred copy is a container the icon vocabulary does not
          have, and putting the SVG inside `Title` would put a node inside the
          accessible name that every heading assertion resolves. */}
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-px shrink-0",
            degraded
              ? "text-[color:var(--warning)]"
              : filtered
                ? "text-[color:var(--clinical-accent)]"
                : "text-[color:var(--text-muted)]",
          )}
        >
          {degraded ? (
            <CircleAlert className="h-4 w-4" aria-hidden />
          ) : filtered ? (
            <Funnel className="h-4 w-4" aria-hidden />
          ) : (
            <Search className="h-4 w-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0">
          <Title className="text-sm font-semibold text-[color:var(--text-heading)]">{emptyTitle}</Title>
          <p className="mt-1 text-xs font-medium text-[color:var(--text-muted)]">{emptyBody}</p>
        </div>
      </div>
      {!filtered ? (
        <div aria-live="polite" className="sr-only">
          {liveMessage}
        </div>
      ) : null}
      {/* Relaxing comes first and is the only accented pair. Naming the filter in
          the label is what makes it a one-tap undo rather than a second thing to
          go and find; `Clear all filters` is separate so each label matches its
          own action, which is also the fix for the single button that said
          "Clear filters" and called `clearSearch`. */}
      {filtered ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          {lastFilter ? (
            <button
              key={lastFilter.id}
              type="button"
              onClick={lastFilter.onRemove}
              data-testid="search-results-empty-remove-filter"
              className={cn(
                // `sm:min-h-compact-meta`, not `sm:min-h-9`: the desktop floor in
                // this file is 40px compact-meta — `emptyStateAction` and every
                // shelf control use it. Never min-h-11. The phone floor stays tap.
                "inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 text-xs font-semibold text-[color:var(--clinical-accent)] hover:border-[color:var(--clinical-accent)] sm:min-h-compact-meta",
                focusRing,
              )}
            >
              <CircleMinus className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Remove “{lastFilter.accessibleLabel ?? lastFilter.valueLabel}”
            </button>
          ) : null}
          {onClearFilters && appliedFilters.length > 1 ? (
            <button
              type="button"
              onClick={onClearFilters}
              data-testid="search-results-empty-clear-filters"
              className={cn(emptyStateAction, focusRing)}
            >
              Clear all filters
            </button>
          ) : null}
        </div>
      ) : null}
      {secondary.length > 0 ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-1.5",
            // Demoted below a rule once relaxing is on offer: an example query is
            // a different search, and the reader has not finished this one.
            filtered ? "mt-3.5 border-t border-[color:var(--border)] pt-3.5" : "mt-3.5",
          )}
        >
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

export function SearchResultsSkeleton() {
  return (
    <div
      className="divide-y divide-[color:var(--border)] overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
      role="status"
      aria-label="Loading results"
    >
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3" aria-hidden>
          <span className="h-9 w-9 rounded-lg bg-[color:var(--surface-subtle)]" />
          <span className="space-y-1.5">
            <span className="block h-3.5 w-2/3 rounded-md bg-[color:var(--surface-subtle)]" />
            <span className="block h-3 w-1/3 rounded-md bg-[color:var(--surface-subtle)]" />
          </span>
          <span className="h-6 w-14 rounded-md bg-[color:var(--surface-subtle)]" />
        </div>
      ))}
      <span className="sr-only">Loading results</span>
    </div>
  );
}
