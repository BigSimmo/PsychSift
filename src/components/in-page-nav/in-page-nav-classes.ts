import { controlDisabled } from "@/components/ui-primitives";

/**
 * The two class strings every page converted onto `InPageNavHeader` repeats.
 *
 * Both are literals rather than computed strings so Tailwind's source scan still
 * sees them, and both live here rather than in seven page files so the anchor
 * offset and the sheet row cannot drift apart route by route.
 */

/**
 * Scroll margin for a section the in-page navigation can jump to.
 *
 * `--inpage-anchor-offset` is published from the live chrome height by
 * `useInPageChromeMetrics`, so a jump taken while the phone chrome is hidden
 * lands in the same place as one taken while it is showing. The `6rem` fallback
 * only covers first paint, before the hook has measured anything.
 *
 * Information-page sections carried no scroll margin at all before the shared
 * header existed — without this every jump lands underneath it.
 */
export const inPageAnchor = "scroll-mt-[var(--inpage-anchor-offset,6rem)]";

/**
 * Row treatment for one control inside `InPageNavHeader`'s actions sheet.
 *
 * The sheet is a list of equally weighted choices, so the rows are full-width
 * and identically styled whether the control is a `<button>`, a `<Link>` or an
 * `<a>` — the differences that matter to a reader are the label and the icon,
 * not the element. Built by the differentials detail page first; shared here
 * once six more pages started rendering the same sheet.
 */
export const inPageActionRowClass = `${controlDisabled} focus-ring-tab flex min-h-tap w-full items-center gap-2.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2.5 text-left text-sm font-bold text-[color:var(--text-heading)] transition hover:not-aria-disabled:border-[color:var(--border-strong)] hover:not-aria-disabled:bg-[color:var(--surface-raised)] aria-disabled:cursor-not-allowed`;
