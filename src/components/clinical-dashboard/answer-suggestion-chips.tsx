"use client";

import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/components/ui-primitives";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/**
 * Which way a one-line chip rail can still be scrolled.
 *
 * The mode-home Prompts rail is pinned to a single line at every width from
 * 640px up — `ui-overlap` measures one chip row and a 160px composer, and
 * `search-route-ownership` reads `flex-wrap: nowrap` and `overflow-x: auto` out
 * of `globals.css` — so chips past the right edge are reachable only by a
 * horizontal gesture, and the trailing fade mask is too quiet to announce one
 * (#2M4PX1). This drives a real control instead.
 *
 * Shaped after `useRailOverflow` in `search-results-header-band.tsx`, and kept
 * separate rather than shared because that one answers a yes/no question about a
 * fade and this one has to know which END is reachable. Same two reasons for the
 * node-in-state ref: the rail is conditional, so a stable object ref leaves the
 * effect holding null on the render before the node exists, and nothing changes
 * afterwards to attach the observers. Measurement happens in the observers, not
 * in the effect body, so no state is set synchronously during an effect.
 */
function useRailScrollEdges() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ back: false, forward: false });
  const ref = useCallback((next: HTMLDivElement | null) => {
    setNode(next);
    if (!next) setEdges({ back: false, forward: false });
  }, []);

  const measure = useCallback(() => {
    if (!node) {
      setEdges({ back: false, forward: false });
      return;
    }
    // `scrollLeft` is negative in a right-to-left rail; the distance from the
    // start is what both edges are asked about, so take it as a magnitude.
    const travelled = Math.abs(node.scrollLeft);
    const back = travelled > 1;
    const forward = node.scrollWidth - node.clientWidth - travelled > 1;
    // Fractional layout widths make a rail that fits report a sub-pixel
    // remainder, hence the 1px slack — and the identity check keeps an observer
    // tick that changed nothing from re-rendering eight mode homes.
    setEdges((current) => (current.back === back && current.forward === forward ? current : { back, forward }));
  }, [node]);

  useEffect(() => {
    if (!node) return;
    node.addEventListener("scroll", measure, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(node);
    for (const child of Array.from(node.children)) resizeObserver?.observe(child);
    // Chips are added and removed as the query changes, which moves scrollWidth
    // without resizing the rail box.
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            measure();
            for (const child of Array.from(node.children)) resizeObserver?.observe(child);
          });
    mutationObserver?.observe(node, { childList: true });
    return () => {
      node.removeEventListener("scroll", measure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [measure, node]);

  return { ref, node, edges } as const;
}

function RailScrollControl({
  direction,
  railNoun,
  onScroll,
}: {
  direction: "back" | "forward";
  railNoun: string;
  onScroll: () => void;
}) {
  const Icon = direction === "back" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onScroll}
      data-testid={`answer-suggestion-scroll-${direction}`}
      aria-label={direction === "back" ? `Show previous ${railNoun}` : `Show more ${railNoun}`}
      className={cn("answer-suggestion-scroll-control", `answer-suggestion-scroll-control-${direction}`, focusRing)}
    >
      {/* The button is the 48px tap target; this is the part that is painted.
          Separating them is what lets the control meet the floor without
          growing the 32px rail — the button is absolutely positioned, so the
          composer height the reserve tokens are sized for is untouched. */}
      <span className="answer-suggestion-scroll-control-face" aria-hidden="true">
        <Icon className="size-icon-sm" aria-hidden="true" />
      </span>
    </button>
  );
}

export function AnswerSuggestionChips({
  suggestions,
  onPick,
  disabled = false,
  label,
  labelPlacement = "inline",
  testId,
  layout = "wrap",
  className,
  icon: Icon,
  chipShape = "pill",
}: {
  suggestions: string[];
  onPick: (suggestion: string) => void;
  disabled?: boolean;
  label?: string;
  // "above" stacks the label as an eyebrow over the chips (answer-thread
  // follow-ups); "inline" keeps it beside them (composer rows, empty state).
  labelPlacement?: "inline" | "above";
  testId?: string;
  layout?: "wrap" | "scroll";
  className?: string;
  // Optional leading glyph rendered inside every chip — used to signal a chip's
  // kind (e.g. a history icon on recent-search chips) without changing the label.
  icon?: LucideIcon;
  // "control" squares the chip to the Clinical control rung (`rounded-lg`, as
  // `controlBase`): rounded pills are a Work-mode shape only (owner decision,
  // 15 Oct 2026). The chip's base rule in globals.css is unlayered, so the
  // utility needs the important modifier to win. Default stays "pill" so the
  // answer-thread follow-ups and any Work caller keep their shape.
  chipShape?: "pill" | "control";
}) {
  const scrolls = layout === "scroll";
  const { ref: railRef, node: railNode, edges } = useRailScrollEdges();

  const scrollRail = useCallback(
    (direction: -1 | 1) => {
      if (!railNode || typeof railNode.scrollBy !== "function") return;
      // Three quarters of the visible rail: a full page would step straight past
      // the chip at the boundary, which is the one the reader was mid-way
      // through reading.
      const step = railNode.clientWidth * 0.75;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      railNode.scrollBy({ left: direction * step, behavior: reduceMotion ? "auto" : "smooth" });
    },
    [railNode],
  );

  if (!suggestions.length) return null;
  const stacked = Boolean(label) && labelPlacement === "above";
  const railNoun = (label ?? "suggestions").toLowerCase();

  const chips = (
    <div
      ref={scrolls ? railRef : undefined}
      className={cn(
        "answer-suggestion-chips",
        scrolls ? "answer-suggestion-chips-scroll" : "answer-suggestion-chips-wrap",
      )}
      role={label ? undefined : "group"}
      aria-label={label ? undefined : "Suggested questions"}
    >
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          disabled={disabled}
          onClick={() => onPick(suggestion)}
          className={cn("answer-suggestion-chip", chipShape === "control" && "!rounded-lg", focusRing)}
        >
          {Icon ? (
            <>
              <Icon className="answer-suggestion-chip-icon" aria-hidden="true" />
              <span className="answer-suggestion-chip-label">{suggestion}</span>
            </>
          ) : (
            suggestion
          )}
        </button>
      ))}
    </div>
  );

  return (
    <div
      data-testid={testId}
      className={cn(
        "answer-suggestion-row",
        scrolls && "answer-suggestion-row-scroll",
        stacked && "answer-suggestion-row-stacked",
        className,
      )}
    >
      {label ? (
        <span className={cn("answer-suggestion-label shrink-0", stacked && "answer-suggestion-label-eyebrow")}>
          {label}
        </span>
      ) : null}
      {scrolls ? (
        // The viewport exists only so the edge controls have something to anchor
        // to that is the RAIL's box rather than the row's — the row starts at the
        // label, and a control pinned to its left edge would sit on top of it.
        // Scroll layout only: the wrapping layout keeps the markup it had.
        <div className="answer-suggestion-chips-viewport">
          {chips}
          {edges.back ? (
            <RailScrollControl direction="back" railNoun={railNoun} onScroll={() => scrollRail(-1)} />
          ) : null}
          {edges.forward ? (
            <RailScrollControl direction="forward" railNoun={railNoun} onScroll={() => scrollRail(1)} />
          ) : null}
        </div>
      ) : (
        chips
      )}
    </div>
  );
}
