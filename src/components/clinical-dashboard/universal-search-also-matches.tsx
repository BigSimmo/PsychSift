"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronRight, Layers } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { CategoryIconTile } from "@/components/category-icon-tile";
import { useFavouritesAccess } from "@/components/clinical-dashboard/use-favourites-access";
import { shouldRunUniversalAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches-state";
import { groupIsWorthShowing, useUniversalSearch } from "@/components/clinical-dashboard/use-universal-search";
import { focusRing } from "@/components/card-recipes";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { catalogueDegradedNotice, withCatalogueDegradedNotice } from "@/lib/site-content/catalogue-degraded-notice";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import { APP_MODE_ACCENT, APP_MODE_ICON } from "@/lib/category-identity";
import { isLocalNoAuthMode, resolveClientDemoMode } from "@/lib/client-env";
import { useAuthSession } from "@/lib/supabase/client";
import { universalSearchModeForDomain, universalSearchPreferredDomains } from "@/lib/universal-search-mode-context";

function isFavouritesHref(href: string) {
  return href === "/favourites" || href.startsWith("/favourites?");
}

function matchCountLabel(count: number) {
  return count === 1 ? "1 related mode" : `${count} related modes`;
}

export function UniversalSearchAlsoMatches({
  modeId,
  query,
  className,
}: {
  modeId: AppModeId;
  query: string;
  className?: string;
}) {
  const auth = useAuthSession();
  const clientDemoMode = resolveClientDemoMode({
    explicitDemoMode: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
    authUnavailableFallback: !auth.isConfigured,
    localNoAuthMode: isLocalNoAuthMode(),
  });
  const { favouritesAccessible } = useFavouritesAccess(auth.status === "authenticated", clientDemoMode);
  const trimmedQuery = query.trim();
  const panelId = useId();
  // Answer threads can be restored on an unsubmitted shared home. Keep their
  // prior cross-mode panel tied to a submitted URL rather than the mere
  // presence of a persisted answer object.
  const submissionActive = shouldRunUniversalAlsoMatches(
    modeId,
    typeof window === "undefined" ? null : window.location.search,
    trimmedQuery,
  );
  // Collapsed by default at EVERY width, so this cross-mode panel never sits
  // between the composer and the results the search actually asked for. It used
  // to open itself from sm up.
  const [expanded, setExpanded] = useState(false);
  // The sm breakpoint (640px) no longer decides whether the panel is open, nor
  // whether the lookup runs — the disclosure owns the first and the lookup is
  // eager at every width. All it still decides is how many mode cards an opened
  // tray may show, four on a wide viewport against three on a phone.
  const [isWide, setIsWide] = useState(false);
  const [viewportReady, setViewportReady] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const sync = () => {
      setIsWide(query.matches);
      setViewportReady(true);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  // ClinicalDashboard mounts Answer-mode also-matches only after generation
  // completes (`answer && !loading`), so this fetch never races the answer
  // stream. Once mounted, keep the panel eager and invisible until real matches
  // arrive; a speculative phone disclosure would add dead space to short
  // answers that have no cross-mode matches.
  //
  // The lookup runs on submit at every width, including phones, even while the
  // tray is shut. That is what lets a closed header say "3 related modes" and
  // lets the whole tray disappear when nothing matched. A closed control that
  // cannot say what is behind it is a blind door, and the phone was the width
  // where that bit: it showed "Tap to open" and could open onto nothing. The
  // cost is one extra cross-mode lookup per phone search, accepted so that the
  // closed row states a real count and an empty tray is never rendered at all.
  const searchActive = submissionActive;
  const universal = useUniversalSearch({
    query: trimmedQuery,
    enabled: trimmedQuery.length >= 2 && searchActive,
    contextMode: modeId,
    excludeDomains: universalSearchPreferredDomains(modeId),
    limitPerDomain: 2,
  });
  const preferred = new Set(universal.preferredDomains ?? []);
  const { modeGroups, anyDegraded } = (() => {
    const groupByDomain = new Map(universal.groups.map((group) => [group.kind, group]));
    // `groupIsWorthShowing` rather than `items.length > 0`, which is the predicate this strip
    // used to re-implement inline. The difference is the whole point: a degraded group that
    // matched nothing is not an absence, it is an unanswered question, and dropping it here
    // showed a confident "No additional matches" for a catalogue that was never read.
    const orderedGroups = (universal.domainOrder ?? universal.groups.map((group) => group.kind))
      .map((domain) => groupByDomain.get(domain))
      .filter((group): group is NonNullable<typeof group> =>
        Boolean(group && !preferred.has(group.kind) && groupIsWorthShowing(group)),
      );
    const byMode = new Map<
      AppModeId,
      { modeId: AppModeId; degraded: boolean; items: Array<(typeof universal.groups)[number]["items"][number]> }
    >();

    for (const group of orderedGroups) {
      const targetModeId = universalSearchModeForDomain(group.kind);
      if (targetModeId === modeId) continue;
      if (targetModeId === "favourites" && !favouritesAccessible) continue;
      const modeGroup = byMode.get(targetModeId) ?? { modeId: targetModeId, degraded: false, items: [] };
      modeGroup.degraded = modeGroup.degraded || group.degraded === true;
      for (const item of group.items) {
        if (!favouritesAccessible && isFavouritesHref(item.href)) continue;
        if (modeGroup.items.length >= 2) break;
        if (!modeGroup.items.some((existing) => existing.href === item.href)) modeGroup.items.push(item);
      }
      byMode.set(targetModeId, modeGroup);
    }

    const visible = [...byMode.values()].filter((group) => group.items.length > 0 || group.degraded);
    return {
      // Four mode cards is 4 x 155px plus the header — about 670px, four fifths of
      // an 844px phone. Three keeps the opened tray near half the screen and still
      // leaves the results the search asked for in view. Measured on a 390px
      // viewport, so the cap is a phone cap, not a taste call.
      modeGroups: visible.slice(0, isWide ? 4 : 3),
      // Read from the whole set, not the capped slice: a degraded catalogue that the phone cap
      // pushed off the tray still makes this cross-mode answer incomplete, and the header is
      // where a reader who never opens the tray would learn that.
      anyDegraded: visible.some((group) => group.degraded),
    };
  })();

  const currentGroups = universal.query === trimmedQuery ? modeGroups : [];
  const catalogueDegraded = universal.query === trimmedQuery && anyDegraded;
  const searchPending = searchActive && (universal.loading || universal.query !== trimmedQuery);
  // Only modes that actually produced something are counted. A degraded mode with nothing in it
  // earns a card, so the reader can see the question was not answered, but it is not a match.
  const matchCount = currentGroups.filter((group) => group.items.length > 0).length;
  const emptyMessage = catalogueDegraded
    ? withCatalogueDegradedNotice("No additional matches in other modes", true)
    : "No additional matches in other modes.";
  // What the announcer says must be what the panel is showing. Rendering one
  // fixed "searching / nothing found" string unconditionally would announce
  // "No additional matches" over a grid of four populated mode cards.
  const panelStatus = searchPending
    ? "Searching other modes"
    : matchCount > 0
      ? `${withCatalogueDegradedNotice(`${matchCountLabel(matchCount)} also match this search`, catalogueDegraded)}.`
      : emptyMessage;
  // No pending arm. The strip is not drawn at all while this query's lookup is running (see
  // the gate below), so a "Searching…" here could never show. Below 360px the 12px type floor
  // leaves no room for "related", so the closed header reads "3 modes"; the full count is
  // still announced by the status node above.
  const headerMeta =
    matchCount > 0 ? (
      <>
        {matchCount} <span className="max-[359px]:hidden">related </span>
        {matchCount === 1 ? "mode" : "modes"}
      </>
    ) : (
      "No other matches"
    );

  if (!submissionActive) return null;
  if (!viewportReady || trimmedQuery.length < 2) return null;
  if (modeId === "answer" && currentGroups.length === 0) return null;
  // At every width now, not just from sm up: the phone lookup is eager, so a
  // header that would open onto nothing is dropped instead of offered.
  //
  // And not while the lookup is still running either. This strip used to mount as soon as
  // the search was submitted and sit there saying "Searching…" — over an otherwise empty
  // page before the main results arrived, and still saying it after they had. It is
  // secondary to the results the search asked for, so it now fills in quietly underneath
  // them once it has something to show, and never holds or competes with the main list.
  // Streamed groups arrive one mode at a time, so a partial count is never shown either.
  if (currentGroups.length === 0 || searchPending) return null;

  return (
    <section
      className={cn(
        // A recessed tray, not a third peer card. The results above sit on
        // `--surface-raised`; sinking this panel to `--surface-subtle` and
        // raising its mode cards back out of it puts the cross-mode suggestions
        // visibly one layer behind the answer to the question actually asked,
        // instead of competing with it at the same elevation.
        //
        // Border only, no `--shadow-inset`: card-recipes.ts records that pairing
        // a bevel with a border puts two edge treatments on one surface, which
        // is what made this panel read flat beside the cards above it.
        "basis-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-1.5 sm:p-2",
        "motion-safe:animate-fade-up forced-colors:border",
        // Content spacing below the last interactive section on phones — not a
        // chrome/dock reserve restore (those stay 0rem when scroll-hidden).
        "max-sm:mb-4",
        className,
      )}
      aria-label="Matches in other modes"
      data-testid="universal-also-matches"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          // A real disclosure at every width, matching the sibling cross-surface
          // tray in `cross-mode-links.tsx` ("Also in your library", PR #2661).
          // This header used to go inert from sm up because the panel was always
          // open there, which put a grid of cross-mode suggestions between the
          // composer and the results the search actually asked for.
          "flex min-h-tap w-full items-center gap-1.5 rounded-xl px-2 text-left transition-colors min-[360px]:gap-2.5",
          "hover:bg-[color:var(--surface)]",
          focusRing,
        )}
      >
        {/* Quiet mark, not a second brand block. The glyph carries the accent and
            the tile is a hairline on the tray's own ground, so the eye lands on
            the label rather than on a saturated square competing with the mode
            tiles below it. */}
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--clinical-accent)] forced-colors:border"
          aria-hidden
        >
          <Layers className="size-icon-md" aria-hidden />
        </span>
        <span className={cn(eyebrowText, "shrink-0 text-[color:var(--text-heading)]")}>
          Also matches
          <span className="sr-only"> in other modes</span>
        </span>
        {/* On the closed header, not only inside the tray. This disclosure is shut by default at
            every width, so a notice that lived only in the panel would be invisible to the reader
            who never opens it — the same silent staleness one layer down. `min-w-0 truncate` keeps
            it from pushing the count off the line at 320px. */}
        {catalogueDegraded ? (
          <span
            className="min-w-0 truncate text-2xs font-medium text-[color:var(--warning)]"
            title="Some of these lists were served from the built-in catalogue because the published one could not be read"
          >
            {catalogueDegradedNotice}
          </span>
        ) : null}
        {/* Label, rule, count — the editorial section-header device. The rule is
            what lets the count sit at the far edge at every width without a
            second line, and it replaces the phone's old stacked subtitle plus a
            tinted count badge that said the same number twice. */}
        <span
          className="h-px min-w-0 flex-1 bg-[color:var(--border)] min-[360px]:min-w-3 forced-colors:bg-[CanvasText]"
          aria-hidden
        />
        {/* Visual cue only — the button's name stays the title, so a screen
            reader is not read a count that the sr-only status node already
            announces properly. */}
        <span className="shrink-0 text-2xs font-medium tabular-nums text-[color:var(--text-muted)]" aria-hidden>
          {headerMeta}
        </span>
        <span
          className={cn(
            "-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-[color:var(--text-muted)] transition-transform motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
          aria-hidden
        >
          <ChevronDown className="size-icon-md" aria-hidden="true" />
        </span>
      </button>
      {/* The live region sits OUTSIDE the collapsible panel. SPEC §9.2 makes this
          node the announcer and keeps the visible count `aria-hidden`; inside the
          panel it would be `display: none` whenever the tray is closed, so from
          the moment this became a real disclosure at every width the count would
          have reached no screen reader at all — the closed control would be a
          blind door for exactly the users who cannot see the number beside it. */}
      <span className="sr-only" role="status">
        {panelStatus}
      </span>
      <div
        id={panelId}
        className={cn(
          // 1 → 2 → 4 across phone, tablet and wide desktop. The tablet band
          // keeps two columns all the way to xl: four columns inside a
          // 1024px content well leaves each mode card too narrow for a
          // two-line clinical title, which is what forced the old single-line
          // truncation ("Mental Health Hospital in th…").
          //
          // EVERY display utility lives in the open branch, and that is
          // load-bearing. A `sm:grid` sitting in the base list beside `hidden`
          // does NOT collapse this panel from 640px up: both are display
          // utilities of equal specificity and Tailwind emits the `sm:` rule
          // later, inside a media query, so `display: grid` wins. The panel
          // would sit open on every desktop while its own trigger reported
          // `aria-expanded="false"`. `cross-mode-links.tsx` carries the same
          // warning after hitting it.
          "grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4",
          expanded ? "mt-1.5 grid" : "hidden",
        )}
      >
        {currentGroups.map((group) => {
          const targetModeId = group.modeId;
          const targetMode = appModeDefinition(targetModeId);
          const accent = APP_MODE_ACCENT[targetModeId];
          return (
            <div
              key={targetModeId}
              data-category-accent={accent}
              // Two rows, not three. The identity row IS the "view all" control —
              // tapping a mode's name is the obvious way to ask for more of it, and
              // folding the two together removes a whole 48px row per card, which on
              // a phone is four rows of pure chrome across the panel.
              //
              // Vertical rather than the old `tile | titles | View all` row: that
              // squeezed the titles into the middle third and truncated them at every
              // width. Giving the titles the full card width is what makes a two-line
              // clinical name readable on a phone and in a 4-up.
              className="group/card flex min-w-0 flex-col rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--e1)] transition-colors hover:border-[color:var(--cat-border)] forced-colors:border"
            >
              <Link
                href={appModeHomeHref(targetModeId, { query: trimmedQuery, run: true })}
                className={cn(
                  "flex min-h-tap min-w-0 items-center gap-2 rounded-t-xl px-2 text-left transition-colors hover:bg-[color:var(--cat-soft)] sm:min-h-compact-meta sm:py-1",
                  focusRing,
                )}
              >
                <CategoryIconTile icon={APP_MODE_ICON[targetModeId]} accent={accent} size="sm" />
                <span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-label text-[color:var(--text-heading)]">
                  <span className="sr-only">View all in </span>
                  {withCatalogueDegradedNotice(targetMode.label, group.degraded)}
                </span>
                {/* Short code beside the full mode name it abbreviates — decorative
                    in the accessible name, which already says the name in full. */}
                {/* Hidden on phones: the row already names the mode in full one
                    span to the left, so "Meds" beside "MEDICATION" is the same
                    word twice, and it puts a second block of colour in a header
                    whose icon tile already carries the accent. Kept from sm up,
                    where the row has room and the short code helps scanning a
                    2-up or 4-up. Same call as the sibling tray in
                    cross-mode-links.tsx (PR #2661). */}
                <span
                  aria-hidden
                  className="hidden shrink-0 items-center rounded-md border border-[color:var(--cat-border)] bg-[color:var(--cat-soft)] px-1.5 py-px text-2xs font-semibold text-[color:var(--cat-accent)] forced-colors:border sm:inline-flex"
                >
                  {targetMode.search.statusLabel}
                </span>
                <ArrowRight
                  className="size-icon-sm shrink-0 text-[color:var(--decoration-soft)] transition-colors group-hover/card:text-[color:var(--cat-accent)]"
                  aria-hidden
                />
              </Link>
              {/* A degraded mode with nothing in it still gets its card, and the card has to say
                  what it found rather than showing an empty box: the built-in list held no match,
                  and the published list was never read. */}
              {group.items.length === 0 ? (
                <p className="border-t border-[color:var(--border)] px-2 py-2 text-xs font-medium text-[color:var(--text-muted)]">
                  No matches in the retained copy.
                </p>
              ) : (
                <ul className="flex min-w-0 flex-col border-t border-[color:var(--border)] px-1 py-1">
                  {group.items.map((item) => (
                    <li key={item.href} className="min-w-0">
                      <Link
                        href={item.href}
                        className={cn(
                          "flex min-h-tap min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-xs font-medium leading-snug text-[color:var(--text)] transition-colors hover:bg-[color:var(--cat-soft)] hover:text-[color:var(--cat-accent)] sm:min-h-0 sm:py-1",
                          focusRing,
                        )}
                      >
                        <span className="line-clamp-2 min-w-0 flex-1">{item.title}</span>
                        <ChevronRight
                          className="size-icon-sm shrink-0 text-[color:var(--decoration-soft)] transition-opacity sm:opacity-0 sm:group-hover/card:opacity-100"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
