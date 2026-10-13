"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Image as ImageIcon, Layers, Table2 } from "lucide-react";

import { cn, sourceCapsule, sourceCapsuleCountBadge, sourceCapsuleHit, textMuted } from "@/components/ui-primitives";
import { logSourceOpen } from "@/components/clinical-dashboard/source-actions";
import { cleanDisplayTitle } from "@/components/clinical-dashboard/display-text";
import {
  answerSourceRailRowId,
  type AnswerSourceRow,
  sourceBadgeDisplay,
  sourceCapsuleDisplay,
  sourceSpokenName,
  sourceStatusShortLabel,
  sourceSupportLabel,
} from "@/components/clinical-dashboard/answer-source-rows";

/**
 * The cited documents under an answer: a vertical list on a phone, a horizontally
 * scrolling row of cards from `sm` up.
 *
 * This is the single source-chrome surface: it replaced the "Sources" capsule
 * and its popover/sheet pair, the Evidence sheet's Claims and Quotes tabs, the
 * Clinical notes sheet, and the wide-screen table column. One card per document,
 * and one drawer behind every card.
 *
 * It shipped first as a vertical list, which was the wrong shape twice over: six
 * stacked 48 px rows is ~290 px of phone scroll spent on chrome, and a vertical
 * list of documents reads as the answer's conclusion rather than as its
 * references. Cards in a scroller cost one row whatever the source count.
 * The 13 Oct 2026 audit (D07) reversed that on phones only: a strip at 390px
 * cut the second source off mid-title, so checking the answer meant a hidden
 * sideways swipe. The phone list is short (the drawer still holds the detail),
 * and desktop keeps the scroller.
 *
 * Four behaviours are load-bearing rather than decorative:
 *
 * - Cards are `min-h-12` (48 px). Do **not** reduce them to `min-h-11` to satisfy
 *   generic 44 px tap-target guidance; 44 px reintroduced a sub-pixel rounding
 *   flake in `ui-smoke`.
 * - **Only cited documents are numbered.** A retrieved-but-uncited document takes
 *   a dashed em-dash badge, because the numbers are the same numbers the in-prose
 *   marks use and a number here that no mark can reach would be a false promise.
 * - Only this container scrolls sideways. The page body must never scroll
 *   horizontally.
 * - **The scrollbar is hidden, so a mouse needs the chevrons.** A finger swipes
 *   this rail and a trackpad swipes it, but a plain desktop mouse has no
 *   horizontal gesture, and every card past the right fade was unreachable
 *   without shift + wheel. `RailPagingControl` is that missing gesture: mouse
 *   only, one end at a time, and gone entirely when the cards already fit, and
 *   `useWheelPan` makes an ordinary wheel do the same thing without aiming at a
 *   button. Do not restore a visible scrollbar here instead — the cross-mode
 *   "Also in your library" rail is the surface that carries `polished-scroll`,
 *   and these two deliberately differ.
 * - The `compactCitations` preference collapses the rail to one chip, but the
 *   zero-source case stays worded in every mode — compact must never hide a
 *   missing-source signal.
 */
export function AnswerSourceRail({
  sources,
  query,
  onOpenSource,
  activeIndex = null,
  compact = false,
  isRefusal = false,
}: {
  sources: AnswerSourceRow[];
  query?: string;
  /** Opens the source drawer at this card. Omitted while the drawer is unavailable. */
  onOpenSource?: (index: number) => void;
  /** Card the drawer is currently showing. */
  activeIndex?: number | null;
  compact?: boolean;
  isRefusal?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const rowListId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  // Declared before the zero-source early return below, because hook order has to
  // be identical on every render.
  const edges = useRailEdges(scroller, sources.length);
  useWheelPan(scroller);
  const display = sourceCapsuleDisplay({ sourceCount: sources.length, compact });

  if (!sources.length) {
    return (
      <p
        data-testid="answer-source-rail-empty"
        className={cn(
          "inline-flex min-h-7 items-center gap-1.5 rounded-full border border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)]/40 px-2.5 py-1 text-xs font-semibold",
          textMuted,
        )}
      >
        {display.label}
      </p>
    );
  }

  // Collapsed: one chip carrying the count, expanded on tap. The cards below are
  // the same cards either way, so nothing is unreachable in compact mode.
  const collapsed = compact && !expanded;
  // A refusal's rows were searched, not relied on: every card drops its number for
  // the uncited em-dash badge, so no card claims to support an answer that was not
  // given. Indexes are unchanged, so the drawer still opens the row that was tapped.
  const rows = isRefusal ? sources.map((source) => ({ ...source, cited: false })) : sources;
  const citedCount = rows.filter((source) => source.cited !== false).length;
  const isSearchOnly = isRefusal || citedCount === 0;

  return (
    <section data-testid="answer-source-rail" aria-label="Sources behind this answer" className="min-w-0">
      {compact ? (
        <button
          type="button"
          className={sourceCapsuleHit}
          aria-expanded={expanded}
          aria-controls={expanded ? rowListId : undefined}
          onClick={() => setExpanded((current) => !current)}
          data-testid="answer-source-rail-toggle"
        >
          <span className={sourceCapsule}>
            <Layers className="h-3 w-3 shrink-0" aria-hidden />
            {isSearchOnly ? (
              <span className="min-w-0 truncate">Documents searched</span>
            ) : display.showLabelText ? (
              <span className="min-w-0 truncate">{display.label}</span>
            ) : null}
            {display.showCountBadge ? <span className={sourceCapsuleCountBadge}>{sources.length}</span> : null}
            <ChevronDown
              className={cn("h-3 w-3 shrink-0 transition-transform", expanded && "rotate-180")}
              strokeWidth={2.25}
              aria-hidden
            />
          </span>
        </button>
      ) : (
        <p
          data-testid="answer-source-rail-heading"
          className={cn(
            // No top border. The rule ran the full column width while the
            // Source-only pill above it is `w-fit`, so on a source-only answer it
            // read as a line struck through the pill rather than as a separator.
            "mb-1.5 flex items-baseline justify-between gap-2 text-2xs font-semibold uppercase tracking-wide",
            textMuted,
          )}
        >
          <span>{isSearchOnly ? "Documents searched" : "Cited documents"}</span>
          <span className="nums font-normal normal-case tracking-normal">
            {isSearchOnly
              ? `${sources.length} searched`
              : citedCount === sources.length
                ? `${sources.length} cited`
                : `${citedCount} cited · ${sources.length - citedCount} also found`}
          </span>
        </p>
      )}

      {/* `role="list"` on a div rather than a real <ol>: the rail sits inside
          `plain-answer-response`, where a ui-smoke guard asserts the primary
          answer renders as prose and not as a bullet list. The source-capsule
          preview used the same idiom for the same reason. */}
      {collapsed ? null : (
        <div data-testid="answer-source-rail-scroller" className={cn("group/rail relative min-w-0", compact && "mt-2")}>
          <div
            ref={scroller}
            id={rowListId}
            role="list"
            aria-label={isSearchOnly ? "Documents searched" : "Cited documents"}
            // `snap-proximity`, not `snap-mandatory`. A card left half-scrolled reads as clipped
            // rather than as scrollable — the second card ends mid-word, which looks like a
            // layout fault instead of an invitation. Snapping settles each card to the left edge
            // so a rest position is always a whole card. Proximity rather than mandatory because
            // mandatory fights momentum scrolling on iOS and can strand a reader between cards.
            //
            // Phone: a plain vertical list, every source visible at once (audit D07,
            // 2026-10-13). A sideways strip cut the second source off at the screen edge.
            // From sm up it is the scrolling rail described above, unchanged.
            className="flex flex-col gap-1.5 sm:flex-row sm:snap-x sm:snap-proximity sm:overflow-x-auto sm:overscroll-x-contain sm:pb-1 sm:pr-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {rows.map((source, index) => (
              <div key={`${source.id}:${index}`} role="listitem" className="min-w-0 sm:flex-none sm:snap-start">
                <AnswerSourceCard
                  source={source}
                  index={index}
                  active={activeIndex === index}
                  query={query}
                  onOpenSource={onOpenSource}
                  searchOnly={isRefusal}
                />
              </div>
            ))}
          </div>
          {/* Tells the eye there is more to the right without adding a control.
              Inert so it can never swallow a tap on the last card. Both fades are
              conditional: a rail whose cards already fit shows no edge treatment at
              all, and a fade with nothing behind it is a false promise of more. */}
          {edges.right ? (
            <span
              aria-hidden="true"
              data-testid="answer-source-rail-fade-right"
              className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[color:var(--surface-raised)] to-transparent"
            />
          ) : null}
          {edges.left ? (
            <span
              aria-hidden="true"
              data-testid="answer-source-rail-fade-left"
              className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[color:var(--surface-raised)] to-transparent"
            />
          ) : null}
          <RailPagingControl direction="left" visible={edges.left} scroller={scroller} />
          <RailPagingControl direction="right" visible={edges.right} scroller={scroller} />
        </div>
      )}
    </section>
  );
}

/**
 * Which ends of the rail still have cards behind them.
 *
 * The rail hides its scrollbar, which is right for a finger and for a trackpad
 * and leaves a plain desktop mouse with no gesture at all: before this, every
 * card past the right fade was drawn and then unreachable unless the reader
 * happened to know about shift + wheel. Both ends are measured rather than
 * assumed so the affordance can disappear completely when the cards already fit
 * — an arrow with nothing behind it is the same false promise as a fade with
 * nothing behind it.
 *
 * `ResizeObserver` is feature-detected rather than assumed: jsdom does not
 * implement it, and the rail renders in several DOM tests that must not throw.
 * The scroll listener alone still keeps the state honest there.
 *
 * `cardCount` is a dependency rather than a convenience. A new answer swaps the
 * card list without changing the rail's own width and without any scroll, so the
 * observer never fires and neither does the scroll listener: the edges would
 * still describe the PREVIOUS answer's sources. That is the failure mode worth
 * naming, because it fails silently in the safe-looking direction as often as
 * not — a rail that fits inheriting the last answer's chevron, or an overflowing
 * one inheriting no chevron and going back to being unreachable.
 */
function useRailEdges(ref: RefObject<HTMLDivElement | null>, cardCount: number) {
  const [edges, setEdges] = useState({ left: false, right: false });

  const sync = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const max = element.scrollWidth - element.clientWidth;
    // A 1 px tolerance: sub-pixel layout rounding otherwise leaves a rail scrolled
    // fully right reporting a fraction of a pixel still to go, and the arrow never
    // stands down.
    setEdges((current) => {
      const next = { left: element.scrollLeft > 1, right: element.scrollLeft < max - 1 };
      return current.left === next.left && current.right === next.right ? current : next;
    });
  }, [ref]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    sync();
    element.addEventListener("scroll", sync, { passive: true });
    // The cards arrive asynchronously (titles, status), so the rail's own width and
    // its children's are both worth watching: a rail that starts fitting and then
    // overflows must grow the affordance without a resize event.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
    if (observer) {
      observer.observe(element);
      for (const child of Array.from(element.children)) observer.observe(child);
    }
    return () => {
      element.removeEventListener("scroll", sync);
      observer?.disconnect();
    };
    // cardCount re-runs the whole effect so the new children are observed too,
    // not just re-measured once.
  }, [ref, sync, cardCount]);

  return edges;
}

/**
 * Turn a vertical wheel over the rail into horizontal movement.
 *
 * The chevrons make the far cards reachable; this makes reaching them feel
 * ordinary, because a wheel is what a mouse user already has in their hand.
 *
 * The listener is deliberately timid, and each condition below is the difference
 * between a convenience and a page that fights its reader:
 *
 * - **It stands down at both ends.** Without this, a reader scrolling the answer
 *   with the pointer resting over the sources hits an invisible wall: the page
 *   stops moving and nothing explains why. Handing the gesture back at the end of
 *   the rail caps the interception at one rail-width, once.
 * - **A gesture the device already calls horizontal passes through**, so a
 *   trackpad's sideways swipe keeps its native behaviour rather than being
 *   doubled.
 * - **Ctrl-wheel is pinch-zoom** and belongs to the browser.
 *
 * `passive: false` is required — a passive listener may not call
 * `preventDefault`, and without that the page would scroll vertically at the same
 * time as the rail moved sideways.
 */
function useWheelPan(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = element.scrollWidth - element.clientWidth;
      if (max <= 0) return;
      if (event.deltaY < 0 && element.scrollLeft <= 0) return;
      if (event.deltaY > 0 && element.scrollLeft >= max - 1) return;
      event.preventDefault();
      element.scrollLeft += event.deltaY;
    };
    // Read live from the element on every event rather than closing over a
    // measurement, so this needs no dependency on the card list.
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [ref]);
}

/**
 * One end's paging control: a mouse-only affordance for the scroll a mouse cannot
 * otherwise perform.
 *
 * Three properties are deliberate rather than incidental:
 *
 * - **Mouse only.** `pointer-fine:` keeps it off every touch device, where the
 *   swipe already works and a 32 px control would be an undersized tap target
 *   next to `min-h-12` cards.
 * - **Out of the tab order, but named.** Tab already walks the cards themselves
 *   and the browser scrolls each focused card into view, so a tab stop here would
 *   reach nothing new. It carries an `aria-label` all the same: it was briefly
 *   `aria-hidden` on the reasoning that it duplicates navigation assistive
 *   technology already has, which is true and still not a reason to ship a
 *   control that does something and says nothing.
 * - **Instant under reduced motion.** Smooth scrolling is the animation this
 *   control performs, so it is the animation `prefers-reduced-motion` has to turn
 *   off.
 */
function RailPagingControl({
  direction,
  visible,
  scroller,
}: {
  direction: "left" | "right";
  visible: boolean;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  if (!visible) return null;
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      // Out of the Tab sequence but NOT hidden from assistive technology. Tab
      // already walks the cards and the browser scrolls each focused card into
      // view, so a tab stop here would reach nothing new — but a control that
      // does something must still say what it does, and the design system's rule
      // is that a control never gives up its accessible name.
      tabIndex={-1}
      aria-label={direction === "left" ? "Show earlier cited documents" : "Show more cited documents"}
      data-testid={`answer-source-rail-page-${direction}`}
      onClick={() => {
        const element = scroller.current;
        if (!element || typeof element.scrollBy !== "function") return;
        const reduceMotion =
          typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        element.scrollBy({
          left: (direction === "left" ? -1 : 1) * Math.max(180, element.clientWidth * 0.8),
          behavior: reduceMotion ? "auto" : "smooth",
        });
      }}
      className={cn(
        // Sits ON the fade rather than straddling the card edge: half a button
        // hanging outside the answer column reads as a clipped element.
        "absolute top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full pointer-fine:grid",
        "border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
        "shadow-[var(--e2)] transition-opacity hover:bg-[color:var(--surface-subtle)] motion-reduce:transition-none",
        "opacity-0 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100 forced-colors:border",
        direction === "left" ? "left-1" : "right-1",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function AnswerSourceCard({
  source,
  index,
  active,
  query,
  onOpenSource,
  searchOnly = false,
}: {
  source: AnswerSourceRow;
  index: number;
  active: boolean;
  query?: string;
  onOpenSource?: (index: number) => void;
  /** The card belongs to a refusal, so it must not be announced as Direct/Partial support. */
  searchOnly?: boolean;
}) {
  const stale = source.metadata.document_status === "review_due" || source.metadata.document_status === "outdated";
  const cited = source.cited !== false;
  const body = (
    <>
      <span
        className={cn(
          "nums grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-[var(--radius-sm)] border px-1 text-2xs font-bold",
          !cited
            ? "border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)]"
            : stale
              ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
              : "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
        )}
        aria-hidden="true"
      >
        {sourceBadgeDisplay(source, index)}
      </span>
      <span className="grid min-w-0 gap-0.5 text-left">
        <span
          className={cn(
            "block truncate text-xs font-semibold leading-tight text-[color:var(--text-heading)]",
            cardTextWidth,
          )}
        >
          {cleanDisplayTitle(source.title)}
        </span>
        <span className={cn("flex items-center gap-1.5 truncate text-2xs leading-tight", cardTextWidth, textMuted)}>
          {/* Tabular figures keep page numbers aligned between cards; the mono
              face the old list row used opened a visible gap after "p." at this
              size. */}
          <span className="shrink-0 tabular-nums">p. {source.pageNumber ?? "n/a"}</span>
          <span aria-hidden>·</span>
          <span className={stale ? "font-semibold text-[color:var(--warning)]" : undefined}>
            {sourceStatusShortLabel(source.metadata)}
          </span>
          {source.hasTable ? (
            <Table2 className="h-3 w-3 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
          ) : null}
          {source.hasImage ? (
            <ImageIcon className="h-3 w-3 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
          ) : null}
        </span>
      </span>
    </>
  );

  // A historical thread turn mounts no drawer, so its cards link straight to the
  // document rather than advertising a panel that will not open.
  if (!onOpenSource) {
    return (
      <Link
        href={source.href}
        data-testid="answer-source-rail-row"
        onClick={() => query && logSourceOpen(query, source)}
        className={cn(cardClass, "border-[color:var(--border)]")}
        aria-label={`${cardLabel(source, index, searchOnly)} — open source`}
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      id={answerSourceRailRowId(index)}
      data-testid="answer-source-rail-row"
      data-cited={cited ? "true" : "false"}
      aria-pressed={active}
      onClick={() => onOpenSource(index)}
      className={cn(
        cardClass,
        active
          ? "border-[color:var(--clinical-accent)] shadow-[var(--e1)]"
          : "border-[color:var(--border)] hover:border-[color:var(--border-strong)]",
      )}
      aria-label={`${cardLabel(source, index, searchOnly)} — open source detail`}
    >
      {body}
    </button>
  );
}

/**
 * The card's accessible name. It has to restate the support level and review
 * status, because an `aria-label` replaces the card's own text: without them a
 * screen reader would hear the title and page but never that the document is
 * outdated or that it only partly supports the answer.
 */
function cardLabel(source: AnswerSourceRow, index: number, searchOnly = false) {
  return [
    `${sourceSpokenName(source, index)}: ${cleanDisplayTitle(source.title)}`,
    `page ${source.pageNumber ?? "not available"}`,
    // A refusal's card was searched, not relied on, so it carries no support grade.
    searchOnly ? null : sourceSupportLabel(source),
    sourceStatusShortLabel(source.metadata),
  ]
    .filter(Boolean)
    .join(", ");
}

const cardClass =
  "flex w-full sm:inline-flex sm:w-auto min-h-12 min-w-0 items-center gap-2.5 rounded-[var(--radius-lg)] border bg-[color:var(--surface-raised)] px-3 py-1.5 text-left shadow-[var(--shadow-inset)] transition-[border-color,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";
// Phone rows are full width, so the title may use it; the rail's cards cap at 158px.
const cardTextWidth = "sm:max-w-[158px]";
