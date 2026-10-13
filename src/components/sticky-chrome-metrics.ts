"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * The measurement shared by every page that owns a sticky navigation header
 * under the universal phone/desktop chrome.
 *
 * `master-search-header` already publishes its hide state as `data-scroll-hidden`
 * on the collapse wrapper, and the wrapper's height is the real anchor offset.
 * Both are observed here so a page can react locally — shared chrome stays
 * exactly as it is.
 *
 * Extracted from `use-document-chrome-metrics.ts`, which is now the document
 * viewer's binding of these options. Nothing here names a document: the selector
 * for the page-owned sticky header, the custom-property names, and where those
 * properties are published are all caller-supplied, because the document viewer
 * publishes onto its own `<main>` while an information page publishes onto
 * `documentElement` (its header is portaled out of the page subtree on phones,
 * so there is no single page root that contains both header and anchors).
 */
export type StickyChromeMetricsOptions = {
  /** The universal collapse row, whose height and hide state drive everything. */
  collapseSelector: string;
  /** The page-owned sticky header that jumps must clear on sm+. */
  stickyHeaderSelector: string;
  phoneMediaQuery: string;
  /** Custom property carrying the scroll-margin an anchored section needs. */
  anchorOffsetProperty: string;
  /** Custom property carrying the page-owned header's measured height. */
  stickyHeaderHeightProperty: string;
  /** Optional custom property carrying the live collapse-row height. */
  collapseHeightProperty?: string;
  /**
   * Where the sticky header is looked up and where the properties are published.
   * A ref scopes both to that page root; `"document"` looks the header up
   * globally and publishes on `documentElement`.
   */
  scope: RefObject<HTMLElement | null> | "document";
};

export function useStickyChromeMetrics({
  collapseSelector,
  stickyHeaderSelector,
  phoneMediaQuery,
  anchorOffsetProperty,
  stickyHeaderHeightProperty,
  collapseHeightProperty,
  scope,
}: StickyChromeMetricsOptions) {
  const [headerHidden, setHeaderHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const collapse = window.document.querySelector<HTMLElement>(collapseSelector);
    const documentScoped = scope === "document";
    const root = documentScoped ? window.document.documentElement : scope.current;
    const isPhone = () => window.matchMedia(phoneMediaQuery).matches;

    const stickyHeader = () =>
      (documentScoped
        ? window.document.querySelector<HTMLElement>(stickyHeaderSelector)
        : root?.querySelector<HTMLElement>(stickyHeaderSelector)) ?? null;

    const measureStickyHeader = () => stickyHeader()?.offsetHeight ?? 0;

    const measurePinnedRail = () => {
      const header = stickyHeader();
      if (!header?.hasAttribute("data-pinned")) return 0;
      const railTop = Number.parseFloat(header.style.getPropertyValue("--work-band-tabs-top")) || 0;
      return Math.max(0, header.offsetHeight - railTop);
    };

    const syncOffset = () => {
      if (!root) return;
      const collapseHidden = collapse?.getAttribute("data-scroll-hidden") === "true";
      const collapseHeight = collapse && !collapseHidden ? collapse.offsetHeight : 0;
      // On phones the page-owned header is portaled into the collapse row, so its
      // height is already folded into `collapseHeight` and must not be added
      // again. On sm+ both sticky bands pin at top:0 and overlap while the
      // universal bar is visible; only when that bar hides must the page-owned
      // sticky header be added so jumps do not land underneath it.
      const stickyHeaderHeight = isPhone() ? 0 : measureStickyHeader();
      // A header that pins its own tab rail (`data-pinned`, set by
      // `useStickyWorkTabs`) stays in the page at every width, and its rail
      // rides under the bar. Jumps must clear that rail while the bar is
      // showing; when the bar hides, the rail hides with it.
      const pinned = stickyHeader()?.hasAttribute("data-pinned") ?? false;
      const anchorClearance = pinned
        ? collapseHeight + (collapseHidden ? 0 : measurePinnedRail())
        : collapseHeight + (collapseHidden ? stickyHeaderHeight : 0);
      root.style.setProperty(anchorOffsetProperty, `${Math.round(anchorClearance) + 16}px`);
      root.style.setProperty(stickyHeaderHeightProperty, `${Math.round(stickyHeaderHeight)}px`);
      // The live height of the universal collapse row, so page-owned sticky
      // chrome can offset from what is actually on screen rather than from a
      // hand-copied pixel value that drifts with type size and chrome changes.
      if (collapseHeightProperty) {
        root.style.setProperty(collapseHeightProperty, `${Math.round(collapseHeight)}px`);
      }
    };

    const syncHidden = () => {
      setHeaderHidden(collapse?.getAttribute("data-scroll-hidden") === "true");
      syncOffset();
    };

    syncHidden();

    const cleanup: Array<() => void> = [];

    if (collapse) {
      const attributes = new MutationObserver(syncHidden);
      attributes.observe(collapse, { attributes: true, attributeFilter: ["data-scroll-hidden"] });
      cleanup.push(() => attributes.disconnect());

      if (typeof ResizeObserver !== "undefined") {
        const resize = new ResizeObserver(() => window.requestAnimationFrame(syncOffset));
        resize.observe(collapse);
        cleanup.push(() => resize.disconnect());
      }
    }

    const headerEl = stickyHeader();
    if (headerEl && typeof ResizeObserver !== "undefined") {
      const headerResize = new ResizeObserver(() => window.requestAnimationFrame(syncOffset));
      headerResize.observe(headerEl);
      cleanup.push(() => headerResize.disconnect());
    }
    if (headerEl) {
      const pinned = new MutationObserver(syncOffset);
      pinned.observe(headerEl, { attributes: true, attributeFilter: ["data-pinned"] });
      cleanup.push(() => pinned.disconnect());
    }

    const phoneMedia = window.matchMedia(phoneMediaQuery);
    const onPhoneChange = () => syncOffset();
    phoneMedia.addEventListener("change", onPhoneChange);
    cleanup.push(() => phoneMedia.removeEventListener("change", onPhoneChange));

    return () => cleanup.forEach((dispose) => dispose());
    // Destructured primitives rather than the options object: an inline object
    // literal would be a new reference every render and re-run the effect.
  }, [
    collapseSelector,
    stickyHeaderSelector,
    phoneMediaQuery,
    anchorOffsetProperty,
    stickyHeaderHeightProperty,
    collapseHeightProperty,
    scope,
  ]);

  return { headerHidden };
}
