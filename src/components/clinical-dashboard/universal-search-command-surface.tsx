"use client";

import { TriangleAlert, Clock, CornerDownLeft, Heart, Loader2, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import {
  modeActionItemsFor,
  type ModeActionId,
  type ModeActionSetId,
} from "@/components/clinical-dashboard/mode-action-popup";
import { AnswerSuggestionChips } from "@/components/clinical-dashboard/answer-suggestion-chips";
import {
  universalSearchMaxQueryLength,
  useUniversalSearch,
} from "@/components/clinical-dashboard/use-universal-search";
import {
  favouriteItems,
  favouriteSets,
  type FavouriteItem,
} from "@/components/clinical-dashboard/favourites-prototype-data";
import { useSavedRegistryFavourites } from "@/components/clinical-dashboard/use-saved-registry-favourites";
import { cn } from "@/components/ui-primitives";
import { appModeDefinition, filterCrossModesForSession, type AppModeId } from "@/lib/app-modes";
import { appModeIcons } from "@/lib/app-mode-icons";
import {
  commandDropdownCanDisplay,
  commandDropdownMinimumWidthMediaQuery,
  commandDropdownPointerMediaQuery,
  commandSurfaceRemoteSearchEnabled,
  differentialRedFlagTerms,
  filterCommandSurfaceCrossModesForSmartSearch,
  filteredSuggestions,
  isFormCodeQuery,
  searchCommandSurfaceConfig,
  type CommandSurfacePlacement,
} from "@/lib/search-command-surface";
import { useCommandDropdownDisplayable } from "@/components/clinical-dashboard/use-command-dropdown-displayable";
import { useEventCallback } from "@/components/clinical-dashboard/use-event-callback";
import type { UniversalSearchDomain } from "@/lib/universal-search";
import { withCatalogueDegradedNotice } from "@/lib/site-content/catalogue-degraded-notice";
import { universalSearchModeForDomain } from "@/lib/universal-search-mode-context";
import { interpretSmartSearch, isSmartLocalOnlyMode } from "@/lib/smart-search-intent";

// Domains whose live result totals a cross-mode chip should sum. Answer/favourites
// chips have no countable domain; the
// differentials chip counts both of its domains because the mode home search composes
// presentations and diagnoses into one result list.
const domainsByTargetMode: Partial<Record<AppModeId, UniversalSearchDomain[]>> = {
  documents: ["documents"],
  // Prescribing prefers both medication records and source documents, but its
  // destination workspace lists medication rows; the shortcut count must match
  // those visible rows rather than summing source-document hits.
  prescribing: ["medications"],
  services: ["services"],
  forms: ["forms"],
  differentials: ["differentials", "presentations"],
  dsm: ["dsm"],
  specifiers: ["specifiers"],
  formulation: ["formulation"],
  "therapy-compass": ["therapies"],
  dictionary: ["dictionary"],
  tools: ["tools"],
};

const domainHeadings: Record<UniversalSearchDomain, string> = {
  documents: "Documents",
  medications: "Medications",
  services: "Services",
  forms: "Forms",
  differentials: "Differentials",
  presentations: "Presentations",
  dsm: "DSM-5 Diagnoses",
  specifiers: "Specifiers",
  formulation: "Formulation",
  therapies: "Therapies",
  dictionary: "Dictionary",
  tools: "Tools",
};

type LocalFavouriteMatch = {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  standalone: boolean;
  /** A demo-mode fixture, labelled "Example" rather than "Saved" (#358YM0). */
  example: boolean;
  score: number;
};

function rankLocalFavourites(
  items: Array<FavouriteItem & { example?: boolean }>,
  query: string,
  includePrototypeSets: boolean,
): LocalFavouriteMatch[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const byKey = new Map<string, LocalFavouriteMatch>();

  for (const item of items) {
    const title = item.title.toLowerCase();
    const text = [item.title, item.meta, item.sourceMeta, item.set, item.keywords].join(" ").toLowerCase();
    if (!tokens.every((token) => text.includes(token))) continue;
    const score = title.includes(normalized)
      ? 100
      : tokens.reduce((sum, token) => sum + (title.includes(token) ? 10 : 2), 0);
    const key = item.href || item.id;
    const match: LocalFavouriteMatch = {
      id: item.id,
      title: item.title,
      subtitle: item.meta,
      href: item.href,
      // Saved searches are standalone Favourites artifacts; saved canonical entities
      // already surface through their owning universal domain outside Favourites mode.
      standalone: item.primaryAction === "Run",
      example: item.example === true,
      score,
    };
    const existing = byKey.get(key);
    // A saved item sharing a fixture's link must read "Saved", never "Example": the
    // clinician's own favourite always wins its link, whatever the fixture scores.
    const ownBeatsFixture = existing?.example === true && !match.example;
    const fixtureLosesToOwn = existing !== undefined && !existing.example && match.example;
    if (!existing || ownBeatsFixture || (!fixtureLosesToOwn && existing.score < score)) {
      byKey.set(key, match);
    }
  }

  if (includePrototypeSets) {
    for (const set of favouriteSets) {
      const text = [set.title, set.meta, set.keywords].join(" ").toLowerCase();
      if (!tokens.every((token) => text.includes(token))) continue;
      const score = set.title.toLowerCase().includes(normalized) ? 100 : 8;
      byKey.set(`set:${set.id}`, {
        id: `set:${set.id}`,
        title: set.title,
        subtitle: `${set.count} saved ${set.count === 1 ? "item" : "items"} · ${set.meta}`,
        href: `/favourites?q=${encodeURIComponent(set.title)}&run=1`,
        standalone: true,
        // Preset sets are only offered in demo mode, and are fixtures.
        example: true,
        score,
      });
    }
  }

  return [...byKey.values()].sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

const SMART_HINT_ROTATION_MS = 3200;

type DropdownItem = {
  id: string;
  label: string;
  onSelect: () => void;
  render: (active: boolean) => ReactNode;
  /**
   * An explicit accessible name, for an option whose rendered content does not
   * carry the whole meaning. The cross-mode chips are the case this exists for:
   * their visible lead ("Search "<query>" in") sits outside every `role="option"`,
   * so a screen reader announced the destination alone — "Forms", with no
   * indication of what activating it would do. Sighted readers get the lead from
   * the row; this gives everyone else the same sentence.
   */
  ariaLabel?: string;
};

function OptionShell({ active, children, hint }: { active: boolean; children: ReactNode; hint: string }) {
  return (
    <div
      className={cn(
        "grid min-h-tap grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2.5 py-1.5 transition",
        active ? "bg-[color:var(--clinical-accent-soft)]" : "hover:bg-[color:var(--surface-subtle)]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">{children}</div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 text-2xs font-bold text-[color:var(--clinical-accent)]",
          active ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      >
        {hint}
        <CornerDownLeft aria-hidden="true" className="h-3 w-3" />
      </span>
    </div>
  );
}

function ExampleTicker({
  examples,
  modeLabel,
  showLine,
  showPhoneTicker,
  onPickExample,
}: {
  examples: string[];
  modeLabel: string;
  /** Tablet/desktop rotating "Try …" line above the pill. Mode-home hero only. */
  showLine: boolean;
  /** Compact tappable ticker below an in-flow phone home composer. */
  showPhoneTicker: boolean;
  onPickExample: (example: string) => void;
}) {
  const [activeExampleIndex, setActiveExampleIndex] = useState(0);
  const [heldTickerExample, setHeldTickerExample] = useState<string | null>(null);
  const [isTickerHeld, setIsTickerHeld] = useState(false);
  const activeExample = examples[activeExampleIndex % examples.length];

  const visible = showLine || showPhoneTicker;

  useEffect(() => {
    if (!visible) return;
    if (isTickerHeld) return;
    if (examples.length <= 1) return;
    const intervalId = window.setInterval(() => {
      setActiveExampleIndex((current) => (current + 1) % examples.length);
    }, SMART_HINT_ROTATION_MS);
    return () => window.clearInterval(intervalId);
  }, [examples, isTickerHeld, visible]);

  const freezeTicker = useCallback(() => {
    setHeldTickerExample(activeExample);
    setIsTickerHeld(true);
  }, [activeExample]);
  const releaseTicker = useCallback(() => setIsTickerHeld(false), []);
  // A mode change can replace the examples while a pointer/focus hold is
  // active. Never keep displaying or submit a held value that is no longer in
  // the current mode's suggestion set.
  const currentHeldTickerExample =
    heldTickerExample && examples.includes(heldTickerExample) ? heldTickerExample : activeExample;
  const resolvedTickerExample = isTickerHeld ? currentHeldTickerExample : activeExample;

  if (!activeExample || !visible) return null;

  return (
    <>
      {showLine ? (
        // One wording for every mode. It carries no "Smart" promise, so the
        // dormant modes (Documents, Answer, Favourites) can share the exact
        // same home composer as the catalogue modes.
        <div data-testid="search-example-ticker" className="search-example-ticker">
          <span>
            Try <span className="search-example-ticker-query">&ldquo;{activeExample}&rdquo;</span> in {modeLabel}.
          </span>
        </div>
      ) : null}
      {showPhoneTicker ? (
        <button
          type="button"
          data-testid="smart-search-phone-ticker"
          className="smart-search-phone-ticker"
          onClick={() => onPickExample(resolvedTickerExample)}
          onFocus={freezeTicker}
          onBlur={releaseTicker}
          onMouseEnter={freezeTicker}
          onMouseLeave={releaseTicker}
          onPointerDown={freezeTicker}
          onPointerUp={releaseTicker}
          onPointerLeave={releaseTicker}
          onPointerCancel={releaseTicker}
          onTouchStart={freezeTicker}
          onTouchEnd={releaseTicker}
          onTouchCancel={releaseTicker}
          aria-label={`Try this ${resolvedTickerExample}. Tap to search`}
        >
          <span className="smart-search-phone-ticker-kicker">
            <Sparkles aria-hidden="true" className="size-icon-sm" />
            Try this
          </span>
          <span className="smart-search-phone-ticker-query">{resolvedTickerExample}</span>
          <span className="smart-search-phone-ticker-action" aria-hidden="true">
            Tap to search
          </span>
        </button>
      ) : null}
    </>
  );
}

function SmartIntentCue({ active, modeLabel }: { active: boolean; modeLabel: string }) {
  const previouslyActiveRef = useRef(false);
  const announcementRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const announcement = announcementRef.current;
    if (active && !previouslyActiveRef.current) {
      if (announcement) announcement.textContent = `Smart search selected for ${modeLabel}.`;
    } else if (!active) {
      if (announcement) announcement.textContent = "";
    }
    previouslyActiveRef.current = active;
  }, [active, modeLabel]);

  return (
    <>
      {active ? (
        <div className="smart-search-intent-cue" data-testid="smart-search-intent-cue" aria-hidden="true">
          <Sparkles aria-hidden="true" className="size-icon-sm" />
          Smart search · catalogue results
        </div>
      ) : null}
      <span ref={announcementRef} className="sr-only" aria-live="polite" aria-atomic="true" />
    </>
  );
}

function SmartPromptRow({ examples, onPickExample }: { examples: string[]; onPickExample: (example: string) => void }) {
  return (
    <AnswerSuggestionChips
      suggestions={examples}
      onPick={onPickExample}
      label="Prompts"
      testId="smart-search-prompt-row"
      layout="scroll"
      className="smart-search-prompt-row"
    />
  );
}

function CommandDropdown({
  modeId,
  query,
  listboxId,
  activeItemId,
  sections,
  showSafetyBanner,
  interpretationLabel,
  universalNotice,
  universalPending,
  onHoverItem,
  placement,
}: {
  modeId: AppModeId;
  query: string;
  listboxId: string;
  activeItemId: string | null;
  sections: Array<{ key: string; heading?: string; layout?: "list" | "chips"; items: DropdownItem[] }>;
  showSafetyBanner: boolean;
  interpretationLabel: string | null;
  /** Why cross-entity matches are missing (query too long, request failed); null when they are not. */
  universalNotice: string | null;
  universalPending: boolean;
  onHoverItem: (id: string) => void;
  placement: CommandSurfacePlacement;
}) {
  const mode = appModeDefinition(modeId);
  const hasItems = sections.some((section) => section.items.length > 0);
  const opensUpward = placement === "bottom-dock";

  return (
    <div
      className={cn(
        // text-left: the hero composer slot sits inside the centred mode-home
        // template, so without it the section headings inherit text-center.
        "universal-command-dropdown absolute left-0 right-0 z-30 overflow-hidden rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--surface)] text-left shadow-[var(--shadow-elevated)]",
        opensUpward ? "bottom-[calc(100%+0.5rem)] top-auto" : "top-[calc(100%+0.5rem)]",
        placement === "bottom-dock" ? "hidden sm:block" : "hidden lg:block",
      )}
      role="presentation"
    >
      {showSafetyBanner ? (
        <div className="flex items-start gap-2.5 border-b border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--danger)]" aria-hidden />
          <div className="min-w-0 text-xs font-semibold leading-5 text-[color:var(--text)]">
            <span className="font-extrabold uppercase tracking-wide text-[color:var(--danger)]">Safety first · </span>
            Stabilise ABCs, check BGL, sats, attention test, collateral, review meds/substances.
          </div>
        </div>
      ) : null}

      {interpretationLabel ? (
        <div className="flex items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-2 text-xs font-semibold text-[color:var(--text-muted)]">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
          <span className="min-w-0 truncate">{interpretationLabel}</span>
        </div>
      ) : null}

      {universalNotice ? (
        <div
          role="status"
          className="flex items-start gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-2 text-xs font-semibold leading-5 text-[color:var(--text-muted)]"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--warning)]" aria-hidden />
          <span className="min-w-0">{universalNotice}</span>
        </div>
      ) : null}

      <div
        id={listboxId}
        role="listbox"
        aria-label={`${mode.label} search suggestions`}
        className={cn(
          "max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain p-2",
          opensUpward ? "sm:max-h-[min(38dvh,20rem)]" : "sm:max-h-[min(42dvh,24rem)]",
        )}
      >
        {sections.map((section) =>
          section.items.length ? (
            <div key={section.key} className="pb-1 last:pb-0">
              {section.heading ? (
                <div
                  role="presentation"
                  className="px-2.5 pb-1 pt-2 text-2xs font-extrabold uppercase tracking-label text-[color:var(--text-muted)]"
                >
                  {section.heading}
                </div>
              ) : null}
              {section.layout === "chips" ? (
                <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5">
                  {query ? (
                    // Presentational: this lead is what makes the chips beside it mean
                    // "search elsewhere" rather than "Forms". It is not inside any
                    // `role="option"`, so instead of leaving a screen reader to infer the
                    // connection from a loose text node, each chip carries the whole
                    // sentence in its own `aria-label` and this copy is hidden from them.
                    <span aria-hidden="true" className="text-xs font-semibold text-[color:var(--text-muted)]">
                      Search &ldquo;{query}&rdquo; in
                    </span>
                  ) : null}
                  {section.items.map((item) => (
                    <div
                      key={item.id}
                      id={item.id}
                      role="option"
                      aria-selected={activeItemId === item.id}
                      aria-label={item.ariaLabel}
                      onMouseEnter={() => onHoverItem(item.id)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={item.onSelect}
                      className="cursor-pointer"
                    >
                      {item.render(activeItemId === item.id)}
                    </div>
                  ))}
                </div>
              ) : (
                section.items.map((item) => (
                  <div
                    key={item.id}
                    id={item.id}
                    role="option"
                    aria-selected={activeItemId === item.id}
                    onMouseEnter={() => onHoverItem(item.id)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={item.onSelect}
                    className="cursor-pointer"
                  >
                    {item.render(activeItemId === item.id)}
                  </div>
                ))
              )}
            </div>
          ) : null,
        )}
        {universalPending ? (
          <div
            role="presentation"
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[color:var(--text-muted)]"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--decoration-soft)]" aria-hidden />
            Searching across PsychSift…
          </div>
        ) : null}
        {!hasItems && !universalPending ? (
          <div className="px-3 py-4 text-sm font-semibold text-[color:var(--text-muted)]">
            Press Enter or tap search to run the full {mode.label.toLowerCase()} search.
          </div>
        ) : null}
      </div>

      <div className="hidden items-center justify-between border-t border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-2 text-2xs font-bold text-[color:var(--text-muted)] sm:flex">
        <span className="inline-flex items-center gap-2">
          <kbd className="rounded border border-[color:var(--border)] bg-[color:var(--surface)] px-1 font-mono">↑↓</kbd>
          navigate
          <kbd className="rounded border border-[color:var(--border)] bg-[color:var(--surface)] px-1 font-mono">↵</kbd>
          open / search
        </span>
        <span>Enter with nothing highlighted runs the full search</span>
      </div>
    </div>
  );
}

export function UniversalSearchCommandSurface({
  demoMode,
  canAccessFavourites = false,
  modeId,
  query,
  recentQueries,
  dropdownOpen,
  onDropdownOpenChange,
  onQueryChange,
  onSearch,
  onPickRecent,
  onCrossMode,
  onRunModeAction,
  onInputKeyDown,
  onFocusSearchInput,
  onListboxIdReady,
  onActiveItemIdChange,
  showPhoneSuggestionTicker = false,
  showHomeSuggestions = false,
  placement = "inline",
  children,
}: {
  demoMode: boolean;
  /** When false, omit Favourites cross-mode chips and local Favourites matches. */
  canAccessFavourites?: boolean;
  modeId: AppModeId;
  query: string;
  recentQueries: string[];
  dropdownOpen: boolean;
  onDropdownOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSearch: (query?: string) => void;
  onPickRecent: (query: string) => void;
  onCrossMode: (modeId: AppModeId, query: string) => void;
  onRunModeAction?: (actionId: ModeActionId) => void;
  onInputKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onFocusSearchInput?: () => void;
  onListboxIdReady?: (listboxId: string) => void;
  onActiveItemIdChange?: (activeItemId: string | null) => void;
  /** Show the compact, tappable suggestion ticker below an in-flow phone home composer. */
  showPhoneSuggestionTicker?: boolean;
  /**
   * Show the tablet/desktop home helpers: the rotating "Try …" line above the
   * pill and the "Prompts" chip rail below it. Only the mode-home hero composer
   * opts in; submitted result views, page slots, and the answer dock render the
   * pill alone so every mode's results page carries one compact search bar.
   */
  showHomeSuggestions?: boolean;
  placement?: CommandSurfacePlacement;
  children: ReactNode;
}) {
  const config = searchCommandSurfaceConfig(modeId);
  const trimmedQuery = query.trim();
  const mode = appModeDefinition(modeId);
  const smartInterpretation = interpretSmartSearch(modeId, trimmedQuery);
  const smartNaturalSearch = smartInterpretation.naturalLanguage;
  const suppressLocalOnlySmartActions = smartNaturalSearch && isSmartLocalOnlyMode(modeId);
  const listboxId = useId();
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(-1);
  // The dropdown is a fine-pointer desktop enhancement. Width-only checks let
  // wide, zoomed, or desktop-mode phones open it over the page.
  const dropdownMinimumWidthQuery = commandDropdownMinimumWidthMediaQuery(placement);
  const [eagerDropdownDisplayable, setEagerDropdownDisplayable] = useState<boolean | null>(null);
  const closeDropdownWhenUndisplayable = useEventCallback(() => {
    setEagerDropdownDisplayable(null);
    onDropdownOpenChange(false);
    setActiveIndex(-1);
  });
  const mediaDropdownDisplayable = useCommandDropdownDisplayable(placement, closeDropdownWhenUndisplayable);
  // Focus can arrive before the shared hook's post-hydration effect has
  // synchronized the conservative false initial state. Keep only an event-driven
  // eager override instead of mirroring hook state from an effect.
  const dropdownDisplayable = eagerDropdownDisplayable ?? mediaDropdownDisplayable;
  // A true "everything" view: the active mode's own domain is included (no excludeDomain) so
  // the palette surfaces every entity type, ordered by the server's intent-aware domainOrder.
  const universal = useUniversalSearch({
    query: trimmedQuery,
    enabled: dropdownOpen && dropdownDisplayable && commandSurfaceRemoteSearchEnabled(modeId, smartNaturalSearch),
    contextMode: modeId,
  });
  const savedRegistryFavourites = useSavedRegistryFavourites().items;
  const allFavouriteItems = useMemo(
    () => [
      // Tagged by where they came from, so a saved item never inherits "Example".
      ...(demoMode ? favouriteItems : []).map((item) => ({ ...item, example: true })),
      ...savedRegistryFavourites,
    ],
    [demoMode, savedRegistryFavourites],
  );
  const favouriteMatches = useMemo(
    () => rankLocalFavourites(allFavouriteItems, trimmedQuery, demoMode),
    [allFavouriteItems, demoMode, trimmedQuery],
  );
  const savedHrefs = useMemo(() => new Set(allFavouriteItems.map((item) => item.href)), [allFavouriteItems]);
  // `savedHrefs` still includes demo fixtures for de-duplication; only these are
  // the clinician's own, and only these earn the "Saved" label.
  const ownSavedHrefs = useMemo(
    () => new Set(savedRegistryFavourites.map((item) => item.href)),
    [savedRegistryFavourites],
  );

  const showSafetyBanner =
    modeId === "differentials" && differentialRedFlagTerms.some((term) => trimmedQuery.toLowerCase().includes(term));
  const showFormCodeHint = modeId === "forms" && isFormCodeQuery(trimmedQuery);
  const {
    groups: universalGroups,
    query: universalQuery,
    interpretation: universalInterpretation,
    domainOrder: universalDomainOrder,
    topHit: universalTopHit,
    answerAction: universalAnswerAction,
    preferredDomains: universalPreferredDomains = [],
  } = universal;

  // Render the cross-entity groups in the server's intent-aware order (drug query → medications
  // first, etc.); fall back to fetched order. Only ordering changes, never the items/scores.
  const orderedUniversalGroups = useMemo(() => {
    if (!universalDomainOrder?.length) return universalGroups;
    const rank = new Map(universalDomainOrder.map((domain, index) => [domain, index] as const));
    return [...universalGroups].sort(
      (left, right) =>
        (rank.get(left.kind) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.kind) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [universalGroups, universalDomainOrder]);

  // Build the interpretation affordance ("Showing results for… / Including related terms").
  const interpretationLabel = useMemo(() => {
    if (!universalInterpretation) return null;
    const corrected = universalInterpretation.correctedQuery?.trim();
    if (corrected && corrected.toLowerCase() !== trimmedQuery.toLowerCase()) {
      return `Showing results for “${corrected}”`;
    }
    const expansions = universalInterpretation.appliedExpansions ?? [];
    if (expansions.length) {
      return `Including related terms: ${expansions.slice(0, 4).join(", ")}`;
    }
    return null;
  }, [universalInterpretation, trimmedQuery]);

  const sections = useMemo(() => {
    if (!config) return [];
    const crossModes = filterCommandSurfaceCrossModesForSmartSearch(
      modeId,
      trimmedQuery,
      filterCrossModesForSession(config.crossModes, {
        // Hosts pass the precomputed session decision; do not OR demoMode again.
        authenticated: canAccessFavourites,
        demoMode: false,
      }),
    );
    const built: Array<{ key: string; heading?: string; layout?: "list" | "chips"; items: DropdownItem[] }> = [];
    let counter = 0;
    const nextId = () => `${listboxId}-item-${counter++}`;

    // Best-bet: a single near-exact match pinned to the top so the strongest hit is one keystroke
    // away regardless of which domain it lives in.
    const topHitIsSavedFavourite =
      modeId === "favourites" && Boolean(universalTopHit && savedHrefs.has(universalTopHit.href));
    if (trimmedQuery && universalQuery === trimmedQuery && universalTopHit && !topHitIsSavedFavourite) {
      const HitIcon = appModeIcons[universalSearchModeForDomain(universalTopHit.kind)];
      const hit = universalTopHit;
      built.push({
        key: "top-hit",
        heading: "Best match",
        items: [
          {
            id: nextId(),
            label: hit.title,
            onSelect: () => {
              onDropdownOpenChange(false);
              router.push(hit.href);
            },
            render: (active) => (
              <OptionShell active={active} hint="Open">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                  <HitIcon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-extrabold text-[color:var(--text-heading)]">
                    {hit.title}
                  </span>
                  {hit.subtitle ? (
                    <span className="block truncate text-xs font-medium text-[color:var(--text-muted)]">
                      {hit.subtitle}
                    </span>
                  ) : null}
                  <span className="block truncate text-2xs font-bold uppercase tracking-wide text-[color:var(--clinical-accent)]">
                    {universalPreferredDomains.includes(hit.kind)
                      ? "Current mode"
                      : `Also in ${appModeDefinition(universalSearchModeForDomain(hit.kind)).label}`}
                  </span>
                </span>
                {hit.badge ? (
                  <span className="inline-flex min-h-6 shrink-0 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-1.5 text-2xs font-bold text-[color:var(--text-muted)]">
                    {hit.badge}
                  </span>
                ) : null}
              </OptionShell>
            ),
          },
        ],
      });
    }

    const visibleFavouriteMatches =
      modeId === "favourites" ? favouriteMatches : favouriteMatches.filter((match) => match.standalone);
    if (!suppressLocalOnlySmartActions && canAccessFavourites && trimmedQuery && visibleFavouriteMatches.length) {
      built.push({
        key: "local-favourites",
        heading: `${modeId === "favourites" ? "Current mode" : "Also in Favourites"} · ${visibleFavouriteMatches.length}`,
        items: visibleFavouriteMatches.slice(0, 4).map((match) => ({
          id: nextId(),
          label: match.title,
          onSelect: () => {
            onDropdownOpenChange(false);
            router.push(match.href);
          },
          render: (active) => (
            <OptionShell active={active} hint="Open">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                <Heart className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-[color:var(--text)]">{match.title}</span>
                {match.subtitle ? (
                  <span className="block truncate text-xs font-medium text-[color:var(--text-muted)]">
                    {match.subtitle}
                  </span>
                ) : null}
              </span>
              {match.example ? (
                <span className="inline-flex min-h-6 shrink-0 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-1.5 text-2xs font-bold text-[color:var(--text-muted)]">
                  Example
                </span>
              ) : (
                <span className="inline-flex min-h-6 shrink-0 items-center rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-1.5 text-2xs font-bold text-[color:var(--clinical-accent)]">
                  Saved
                </span>
              )}
            </OptionShell>
          ),
        })),
      });
    }

    if (showFormCodeHint) {
      built.push({
        key: "form-code",
        heading: "Form code match",
        items: [
          {
            id: nextId(),
            label: `Form ${trimmedQuery.replace(/^form\s+/i, "")}`,
            onSelect: onSearch,
            render: (active) => (
              <OptionShell active={active} hint="Search">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-sm font-black text-[color:var(--clinical-accent)]">
                  {trimmedQuery.replace(/^form\s+/i, "").toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-extrabold text-[color:var(--text-heading)]">
                    Form {trimmedQuery.replace(/^form\s+/i, "").toUpperCase()}
                  </span>
                  <span className="block truncate text-xs font-medium text-[color:var(--text-muted)]">
                    Press Enter to search forms
                  </span>
                </span>
              </OptionShell>
            ),
          },
        ],
      });
    }

    if (!trimmedQuery) {
      const recents = recentQueries.slice(0, 5);
      if (recents.length) {
        built.push({
          key: "recents",
          heading: `Recent in ${mode.label}`,
          items: recents.map((recent) => ({
            id: nextId(),
            label: recent,
            onSelect: () => {
              onDropdownOpenChange(false);
              onPickRecent(recent);
            },
            render: (active) => (
              <OptionShell active={active} hint="Search">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
                  <Clock aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="truncate text-sm font-semibold text-[color:var(--text)]">{recent}</span>
              </OptionShell>
            ),
          })),
        });
      }
    } else {
      const suggestions = filteredSuggestions(config, trimmedQuery);
      if (suggestions.length) {
        built.push({
          key: "suggestions",
          heading: "Suggestions",
          items: suggestions.map((suggestion) => ({
            id: nextId(),
            label: suggestion.text,
            onSelect: () => {
              onDropdownOpenChange(false);
              onQueryChange(suggestion.text);
              onSearch(suggestion.text);
            },
            render: (active) => (
              <OptionShell active={active} hint="Search">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
                  <Search aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="min-w-0 truncate text-sm font-semibold text-[color:var(--text)]">
                  {suggestion.text}
                </span>
                <span className="inline-flex min-h-6 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-1.5 text-2xs font-bold text-[color:var(--text-muted)]">
                  {suggestion.meta}
                </span>
              </OptionShell>
            ),
          })),
        });
      }
    }

    // Ask-this bridge: for question-like queries, offer a jump into Answer mode for a cited
    // answer. Suppressed in Answer mode (Enter there already runs the answer).
    if (trimmedQuery && modeId !== "answer" && universalQuery === trimmedQuery && universalAnswerAction) {
      const action = universalAnswerAction;
      built.push({
        key: "answer-action",
        items: [
          {
            id: nextId(),
            label: action.label,
            onSelect: () => {
              onDropdownOpenChange(false);
              onCrossMode("answer", trimmedQuery);
            },
            render: (active) => (
              <OptionShell active={active} hint="Answer">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                  <Sparkles aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[color:var(--text)]">{action.label}</span>
                  <span className="block truncate text-xs font-medium text-[color:var(--text-muted)]">
                    Get a cited answer in Answer mode
                  </span>
                </span>
              </OptionShell>
            ),
          },
        ],
      });
    }

    // Cross-entity typeahead ("Across PsychSift"): live grouped matches from the universal
    // search endpoint across every domain (including the active mode's own), rendered in the
    // server's intent-aware order. Selecting an item navigates straight to the record; each group
    // ends with a cross-mode "view all" that re-runs the query in the owning mode. Enter with
    // nothing highlighted still runs the mode-scoped search.
    if (trimmedQuery && universalQuery === trimmedQuery && orderedUniversalGroups.length) {
      for (const group of orderedUniversalGroups) {
        const targetModeId = universalSearchModeForDomain(group.kind);
        const targetMode = appModeDefinition(targetModeId);
        const GroupIcon = appModeIcons[targetModeId];
        const visibleItems =
          modeId === "favourites" ? group.items.filter((item) => !savedHrefs.has(item.href)) : group.items;
        // A degraded group with nothing in it still renders, heading and notice only. Skipping it
        // would show a plain "no matches" for a catalogue that was never successfully read.
        if (!visibleItems.length && !group.degraded) continue;
        const isCurrentModeGroup = universalPreferredDomains.includes(group.kind);
        built.push({
          key: `universal-${group.kind}`,
          // A degraded group answered from the in-bundle catalogue because the published one could
          // not be read. The results are real, so they are still shown, but the reader is told the
          // list may lag what was published rather than being left to assume it is current. The
          // 2026-09-16 outage is the reason this is said out loud at all.
          heading: withCatalogueDegradedNotice(
            isCurrentModeGroup
              ? `Current mode · ${domainHeadings[group.kind]} · ${visibleItems.length}`
              : `Also in ${targetMode.label} · ${domainHeadings[group.kind]} · ${visibleItems.length}`,
            group.degraded,
          ),
          items: [
            ...visibleItems.map((item) => ({
              id: nextId(),
              label: item.title,
              onSelect: () => {
                onDropdownOpenChange(false);
                router.push(item.href);
              },
              render: (active: boolean) => (
                <OptionShell active={active} hint="Open">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                    <GroupIcon aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[color:var(--text)]">{item.title}</span>
                    {item.subtitle ? (
                      <span className="block truncate text-xs font-medium text-[color:var(--text-muted)]">
                        {item.subtitle}
                      </span>
                    ) : null}
                  </span>
                  {item.badge ? (
                    <span className="inline-flex min-h-6 shrink-0 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-1.5 text-2xs font-bold text-[color:var(--text-muted)]">
                      {item.badge}
                    </span>
                  ) : null}
                  {ownSavedHrefs.has(item.href) ? (
                    <span className="inline-flex min-h-6 shrink-0 items-center rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-1.5 text-2xs font-bold text-[color:var(--clinical-accent)]">
                      Saved
                    </span>
                  ) : savedHrefs.has(item.href) ? (
                    <span className="inline-flex min-h-6 shrink-0 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-1.5 text-2xs font-bold text-[color:var(--text-muted)]">
                      Example
                    </span>
                  ) : null}
                </OptionShell>
              ),
            })),
            {
              id: nextId(),
              label: `View all in ${targetMode.label}`,
              onSelect: () => {
                onDropdownOpenChange(false);
                onCrossMode(targetModeId, trimmedQuery);
              },
              render: (active: boolean) => (
                <OptionShell active={active} hint="Search">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
                    <Search aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <span className="truncate text-sm font-semibold text-[color:var(--text-muted)]">
                    View all in {targetMode.label}
                  </span>
                </OptionShell>
              ),
            },
          ],
        });
      }
    }

    const actionSetId: ModeActionSetId | null =
      modeId === "documents" || modeId === "forms" || modeId === "prescribing"
        ? "documents"
        : modeId === "services"
          ? "services"
          : modeId === "favourites"
            ? "favourites"
            : modeId === "differentials"
              ? "differentials"
              : modeId === "specifiers"
                ? "specifiers"
                : modeId === "formulation"
                  ? "formulation"
                  : modeId === "dsm"
                    ? "dsm"
                    : modeId === "answer"
                      ? "answer"
                      : modeId === "tools"
                        ? "tools"
                        : modeId === "dictionary"
                          ? "dictionary"
                          : null;

    if (actionSetId && !suppressLocalOnlySmartActions) {
      const actions = modeActionItemsFor(actionSetId).slice(0, 3);
      if (actions.length) {
        built.push({
          key: "actions",
          heading: `${mode.label} actions`,
          items: actions.map((action) => ({
            id: nextId(),
            label: action.label,
            onSelect: () => {
              onDropdownOpenChange(false);
              onRunModeAction?.(action.id);
            },
            render: (active) => (
              <OptionShell active={active} hint="Run">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                  <action.icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="truncate text-sm font-semibold text-[color:var(--text)]">{action.label}</span>
                <span className="inline-flex min-h-6 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-1.5 text-2xs font-bold text-[color:var(--text-muted)]">
                  {action.shortLabel ?? action.description}
                </span>
              </OptionShell>
            ),
          })),
        });
      }
    }

    if (trimmedQuery && crossModes.length) {
      built.push({
        key: "cross-mode",
        layout: "chips",
        items: crossModes.map((target) => {
          const targetMode = appModeDefinition(target);
          const TargetIcon = appModeIcons[target];
          // Live count from the universal typeahead response ("Forms (2)") — only shown when
          // fresh results for this exact query exist, so the chip never shows a stale number.
          // A mode spanning several domains (differentials) sums its present groups' totals.
          const targetDomains = domainsByTargetMode[target];
          const countableGroups =
            targetDomains && universalQuery === trimmedQuery
              ? universalGroups.filter((group) => targetDomains.includes(group.kind))
              : [];
          const targetCount = countableGroups.length
            ? countableGroups.reduce((sum, group) => sum + group.total, 0)
            : undefined;
          return {
            id: nextId(),
            label: targetMode.label,
            // The count rides the name rather than being left as a bare "(2)" for a
            // screen reader to read as punctuation.
            ariaLabel: `Search "${trimmedQuery}" in ${targetMode.label}${
              typeof targetCount === "number" ? `, ${targetCount} ${targetCount === 1 ? "match" : "matches"}` : ""
            }`,
            onSelect: () => {
              onDropdownOpenChange(false);
              onCrossMode(target, trimmedQuery);
            },
            render: (active) => (
              <span
                className={cn(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold transition",
                  active
                    ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)]",
                )}
              >
                <TargetIcon className="h-3.5 w-3.5 text-[color:var(--clinical-accent)]" aria-hidden />
                {targetMode.label}
                {typeof targetCount === "number" ? ` (${targetCount})` : ""}
              </span>
            ),
          };
        }),
      });
    }

    if (modeId === "answer") {
      const actionsIndex = built.findIndex((section) => section.key === "actions");
      if (actionsIndex >= 0) {
        const [actionsSection] = built.splice(actionsIndex, 1);
        const insertionIndex = built[0]?.key === "top-hit" ? 1 : 0;
        built.splice(insertionIndex, 0, actionsSection);
      }
    }

    return built;
  }, [
    canAccessFavourites,
    config,
    favouriteMatches,
    listboxId,
    mode,
    modeId,
    onCrossMode,
    onDropdownOpenChange,
    onPickRecent,
    onQueryChange,
    onRunModeAction,
    onSearch,
    recentQueries,
    ownSavedHrefs,
    router,
    savedHrefs,
    showFormCodeHint,
    suppressLocalOnlySmartActions,
    trimmedQuery,
    universalGroups,
    orderedUniversalGroups,
    universalQuery,
    universalTopHit,
    universalAnswerAction,
    universalPreferredDomains,
  ]);

  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const activeItemId = activeIndex >= 0 && activeIndex < flatItems.length ? flatItems[activeIndex].id : null;

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!dropdownDisplayable) {
      if (event.key === "Escape") {
        onDropdownOpenChange(false);
        setActiveIndex(-1);
      }
      onInputKeyDown?.(event);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onDropdownOpenChange(true);
      setActiveIndex((current) => (current + 1) % Math.max(flatItems.length, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onDropdownOpenChange(true);
      setActiveIndex((current) => (current <= 0 ? flatItems.length - 1 : current - 1));
      return;
    }
    if (event.key === "Home" && dropdownOpen && flatItems.length) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End" && dropdownOpen && flatItems.length) {
      event.preventDefault();
      setActiveIndex(flatItems.length - 1);
      return;
    }
    if (event.key === "Escape") {
      // The composer input is `type="search"`, so Chromium treats Escape as the
      // native "clear the search field" gesture and wipes the query (dispatching
      // an input event) on the way out. Escape here means "dismiss the dropdown"
      // and nothing else, so suppress the native behaviour and keep the query.
      event.preventDefault();
      onDropdownOpenChange(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "Enter" && dropdownOpen && activeIndex >= 0 && flatItems[activeIndex]) {
      event.preventDefault();
      flatItems[activeIndex].onSelect();
      return;
    }
    onInputKeyDown?.(event);
  }

  useEffect(() => {
    onListboxIdReady?.(listboxId);
  }, [listboxId, onListboxIdReady]);

  useEffect(() => {
    onActiveItemIdChange?.(dropdownOpen ? activeItemId : null);
  }, [activeItemId, dropdownOpen, onActiveItemIdChange]);

  useEffect(() => {
    if (!dropdownOpen) return;

    function handleScroll(event: Event) {
      const target = event.target;
      if (target instanceof Element && target.closest(".universal-command-dropdown")) return;
      onDropdownOpenChange(false);
      setActiveIndex(-1);
    }

    // Page movement means the user has left the composer context. Closing the
    // floating sheet also prevents it covering result-page controls that the
    // browser scrolls into view, while preserving scrolling inside the listbox.
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [dropdownOpen, onDropdownOpenChange]);

  useEffect(() => {
    function handleSearchFocusShortcut(event: KeyboardEvent) {
      const slashShortcut = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const commandShortcut = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey;
      if (!slashShortcut && !commandShortcut) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      onFocusSearchInput?.();
    }
    window.addEventListener("keydown", handleSearchFocusShortcut);
    return () => window.removeEventListener("keydown", handleSearchFocusShortcut);
  }, [onFocusSearchInput]);

  if (!config) {
    return <>{children}</>;
  }

  return (
    <div
      className={cn(
        "universal-command-surface relative z-10 flex w-full flex-col",
        placement === "bottom-dock" ? "gap-1" : "gap-2",
      )}
    >
      <SmartIntentCue active={smartNaturalSearch} modeLabel={mode.label} />
      {smartNaturalSearch ? null : (
        // The phone ticker and the tablet/desktop line both demonstrate an
        // ordinary example search. Neither depends on Clinical Ask or a
        // provider flag, and both are home-only.
        <ExampleTicker
          examples={config.examples}
          modeLabel={mode.label}
          showLine={showHomeSuggestions}
          showPhoneTicker={showPhoneSuggestionTicker}
          onPickExample={(example) => {
            onQueryChange(example);
            onFocusSearchInput?.();
          }}
        />
      )}
      <div
        className="relative w-full"
        onKeyDownCapture={(event) => {
          if (event.target instanceof HTMLInputElement && event.target.dataset.testid === "global-search-input") {
            handleComposerKeyDown(event as unknown as ReactKeyboardEvent<HTMLInputElement>);
          }
        }}
        onFocusCapture={(event) => {
          // Only the search input opens the command panel. Focus restore onto the
          // integrated + / pins trigger (e.g. after Escape closes Scope) must not
          // reopen the listbox — that overlay covers mode-home actions such as
          // Browse library and breaks the deferred-request critical journey.
          const target = event.target;
          if (!(target instanceof HTMLElement) || target.dataset.testid !== "global-search-input") {
            return;
          }
          // Focus can arrive before the post-hydration effect has synchronized
          // the conservative false initial state. Re-evaluate synchronously so
          // desktop input never loses its first command-panel interaction.
          if (typeof window.matchMedia !== "function") return;
          const displayable = commandDropdownCanDisplay({
            minimumWidthMatches: window.matchMedia(dropdownMinimumWidthQuery).matches,
            pointerMatches: window.matchMedia(commandDropdownPointerMediaQuery).matches,
            maxTouchPoints: navigator.maxTouchPoints,
          });
          setEagerDropdownDisplayable(displayable ? true : null);
          if (displayable) onDropdownOpenChange(true);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setEagerDropdownDisplayable(null);
            onDropdownOpenChange(false);
            setActiveIndex(-1);
          }
        }}
      >
        {children}
        {dropdownOpen && dropdownDisplayable ? (
          <CommandDropdown
            modeId={modeId}
            query={trimmedQuery}
            listboxId={listboxId}
            activeItemId={activeItemId}
            sections={sections}
            showSafetyBanner={showSafetyBanner}
            interpretationLabel={interpretationLabel}
            universalNotice={
              universal.tooLong
                ? `This search is longer than ${universalSearchMaxQueryLength} characters, so it can’t be matched across PsychSift. Shorten it to see matches.`
                : (universal.error ?? null)
            }
            universalPending={universal.loading && Boolean(trimmedQuery)}
            placement={placement}
            onHoverItem={(id) => {
              const index = flatItems.findIndex((item) => item.id === id);
              if (index >= 0) setActiveIndex(index);
            }}
          />
        ) : null}
      </div>
      {showHomeSuggestions ? (
        <SmartPromptRow
          examples={config.examples}
          onPickExample={(example) => {
            onQueryChange(example);
            if (dropdownDisplayable) onDropdownOpenChange(true);
            onFocusSearchInput?.();
          }}
        />
      ) : null}
    </div>
  );
}
