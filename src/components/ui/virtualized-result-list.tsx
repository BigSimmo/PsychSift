"use client";

import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type FocusEvent as ReactFocusEvent,
  type Key,
  type ReactNode,
  type UIEvent as ReactUIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const DEFAULT_VIRTUALIZATION_THRESHOLD = 30;
export const DEFAULT_ESTIMATED_ITEM_HEIGHT = 180;
export const DEFAULT_VIEWPORT_HEIGHT = 720;
export const DEFAULT_OVERSCAN_ROWS = 4;

export type VirtualizedResultListProps<T> = {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  getItemKey?: (item: T, index: number) => Key;
  className?: string;
  containerClassName?: string;
  testId?: string;
  ariaLabel?: string;
  virtualizationThreshold?: number;
  estimatedItemHeight?: number;
  viewportHeight?: number;
  overscan?: number;
  columns?: number;
  focusedIndex?: number | null;
  disableVirtualization?: boolean;
  fallbackWhenMetricsUnavailable?: boolean;
};

export type VirtualWindowRange = {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  totalRows: number;
  visibleRowCount: number;
};

export function computeVirtualWindowRange({
  totalItems,
  scrollTop,
  viewportHeight,
  estimatedItemHeight,
  overscanRows,
  columns,
  focusedIndex,
}: {
  totalItems: number;
  scrollTop: number;
  viewportHeight: number;
  estimatedItemHeight: number;
  overscanRows: number;
  columns: number;
  focusedIndex?: number | null;
}): VirtualWindowRange {
  const safeTotalItems = Number.isFinite(totalItems) ? Math.max(0, Math.floor(totalItems)) : 0;
  const safeColumns = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  const safeRowHeight = Number.isFinite(estimatedItemHeight)
    ? Math.max(24, Math.floor(estimatedItemHeight))
    : DEFAULT_ESTIMATED_ITEM_HEIGHT;
  const safeViewportHeight = Number.isFinite(viewportHeight)
    ? Math.max(safeRowHeight, Math.floor(viewportHeight))
    : Math.max(safeRowHeight, DEFAULT_VIEWPORT_HEIGHT);
  const safeOverscanRows = Number.isFinite(overscanRows)
    ? Math.max(1, Math.floor(overscanRows))
    : DEFAULT_OVERSCAN_ROWS;
  const safeScrollTop = Number.isFinite(scrollTop) ? scrollTop : 0;
  const totalRows = Math.ceil(safeTotalItems / safeColumns);

  if (safeTotalItems <= 0 || totalRows <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      totalRows: 0,
      visibleRowCount: 0,
    };
  }

  const visibleRowCount = Math.max(1, Math.ceil(safeViewportHeight / safeRowHeight));
  const maxScrollTop = Math.max(0, totalRows * safeRowHeight - safeViewportHeight);
  const clampedScrollTop = Math.max(0, Math.min(safeScrollTop, maxScrollTop));
  const anchorRow = Math.floor(clampedScrollTop / safeRowHeight);

  let startRow = Math.max(0, anchorRow - safeOverscanRows);
  let endRow = Math.min(totalRows, anchorRow + visibleRowCount + safeOverscanRows);

  if (
    typeof focusedIndex === "number" &&
    Number.isInteger(focusedIndex) &&
    focusedIndex >= 0 &&
    focusedIndex < safeTotalItems
  ) {
    const focusedRow = Math.floor(focusedIndex / safeColumns);
    if (focusedRow < startRow + 1) {
      startRow = Math.max(0, focusedRow - safeOverscanRows);
      endRow = Math.min(totalRows, startRow + visibleRowCount + safeOverscanRows * 2);
    } else if (focusedRow >= endRow - 1) {
      endRow = Math.min(totalRows, focusedRow + safeOverscanRows + 1);
      startRow = Math.max(0, endRow - (visibleRowCount + safeOverscanRows * 2));
    }
  }

  const startIndex = Math.min(safeTotalItems, startRow * safeColumns);
  const endIndex = Math.min(safeTotalItems, endRow * safeColumns);
  const topSpacerHeight = startRow * safeRowHeight;
  const bottomSpacerHeight = Math.max(0, (totalRows - endRow) * safeRowHeight);

  return {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    totalRows,
    visibleRowCount,
  };
}

function detectGridColumns(element: HTMLElement | null): number | null {
  if (!element || typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return null;
  }
  const style = window.getComputedStyle(element);
  if (style.display !== "grid" && style.display !== "inline-grid") {
    return null;
  }
  const template = style.gridTemplateColumns?.trim() ?? "";
  if (!template || template === "none") {
    return null;
  }
  const tracks = template.split(/\s+/).filter((token) => /^\d+(\.\d+)?px$/.test(token));
  return tracks.length > 0 ? tracks.length : null;
}

function findFirstFocusableChild(root: HTMLElement): HTMLElement | null {
  const candidate = root.querySelector<HTMLElement>(
    'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
  );
  return candidate ?? root;
}

export function VirtualizedResultList<T>({
  items,
  renderItem,
  getItemKey,
  className,
  containerClassName,
  testId,
  ariaLabel,
  virtualizationThreshold = DEFAULT_VIRTUALIZATION_THRESHOLD,
  estimatedItemHeight = DEFAULT_ESTIMATED_ITEM_HEIGHT,
  viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
  overscan = DEFAULT_OVERSCAN_ROWS,
  columns = 1,
  focusedIndex = null,
  disableVirtualization = false,
  fallbackWhenMetricsUnavailable: _fallbackWhenMetricsUnavailable = false,
}: VirtualizedResultListProps<T>) {
  void _fallbackWhenMetricsUnavailable;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingKeyboardFocusIndexRef = useRef<number | null>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [measuredViewportHeight, setMeasuredViewportHeight] = useState<number>(viewportHeight);
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null);
  const [measuredColumns, setMeasuredColumns] = useState<number | null>(null);
  const [internalFocusedIndex, setInternalFocusedIndex] = useState<number | null>(null);

  // Deterministic across SSR and initial client hydration: never branch on `typeof window`.
  const shouldVirtualize = !disableVirtualization && items.length > virtualizationThreshold;

  const effectiveFocusedIndex =
    typeof focusedIndex === "number" && focusedIndex >= 0 && focusedIndex < items.length
      ? focusedIndex
      : internalFocusedIndex !== null && internalFocusedIndex >= 0 && internalFocusedIndex < items.length
        ? internalFocusedIndex
        : null;

  const effectiveRowHeight = measuredRowHeight ?? estimatedItemHeight;
  const effectiveViewportHeight = measuredViewportHeight > 0 ? measuredViewportHeight : viewportHeight;
  const fallbackColumns = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  const safeColumns = measuredColumns ?? fallbackColumns;

  const readScrollOffset = useCallback((target?: EventTarget | null) => {
    if (target && target instanceof HTMLElement && typeof target.scrollTop === "number" && target.scrollTop >= 0) {
      if (target === containerRef.current || target === listRef.current || target.contains(containerRef.current)) {
        if (target.scrollTop > 0 || (window.scrollY ?? 0) === 0) {
          return target.scrollTop;
        }
      }
    }

    const containerEl = containerRef.current;
    if (containerEl && containerEl.scrollTop > 0) {
      return containerEl.scrollTop;
    }

    const listEl = listRef.current;
    if (listEl && listEl.scrollTop > 0) {
      return listEl.scrollTop;
    }

    if (typeof window !== "undefined") {
      const winScrollY = window.scrollY || document.documentElement?.scrollTop || 0;
      if (containerEl) {
        const rect = containerEl.getBoundingClientRect();
        if (rect.top < 0) {
          return Math.max(0, -rect.top);
        }
      }
      return Math.max(0, winScrollY);
    }

    return 0;
  }, []);

  const handleScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      const nextScrollTop = readScrollOffset(event.currentTarget);
      setScrollTop((prev) => (prev === nextScrollTop ? prev : nextScrollTop));
    },
    [readScrollOffset],
  );

  useEffect(() => {
    if (!shouldVirtualize || typeof window === "undefined") {
      return;
    }

    const updateMetrics = () => {
      const containerEl = containerRef.current;
      const clientHeight = containerEl?.clientHeight ?? 0;
      const winHeight = window.innerHeight || 0;
      const resolvedViewport =
        clientHeight > 0 ? clientHeight : winHeight > 0 ? Math.max(winHeight, viewportHeight) : viewportHeight;
      setMeasuredViewportHeight((prev) => (prev === resolvedViewport ? prev : resolvedViewport));

      const detectedCols = detectGridColumns(listRef.current);
      if (detectedCols !== null) {
        setMeasuredColumns((prev) => (prev === detectedCols ? prev : detectedCols));
      }

      const firstItem = listRef.current?.querySelector<HTMLElement>("[data-virtual-index]");
      if (firstItem) {
        const itemRectHeight = Math.round(firstItem.getBoundingClientRect().height || firstItem.offsetHeight || 0);
        if (itemRectHeight >= 24) {
          setMeasuredRowHeight((prev) => (prev === itemRectHeight ? prev : itemRectHeight));
        }
      }
    };

    const onWindowScroll = (event: Event) => {
      const nextScrollTop = readScrollOffset(event.target);
      setScrollTop((prev) => (prev === nextScrollTop ? prev : nextScrollTop));
    };

    updateMetrics();
    window.addEventListener("scroll", onWindowScroll, { passive: true, capture: true });
    window.addEventListener("resize", updateMetrics, { passive: true });

    return () => {
      window.removeEventListener("scroll", onWindowScroll, { capture: true });
      window.removeEventListener("resize", updateMetrics);
    };
  }, [readScrollOffset, shouldVirtualize, viewportHeight]);

  const windowRange = useMemo(
    () =>
      shouldVirtualize
        ? computeVirtualWindowRange({
            totalItems: items.length,
            scrollTop,
            viewportHeight: effectiveViewportHeight,
            estimatedItemHeight: effectiveRowHeight,
            overscanRows: overscan,
            columns: safeColumns,
            focusedIndex: effectiveFocusedIndex,
          })
        : {
            startIndex: 0,
            endIndex: items.length,
            topSpacerHeight: 0,
            bottomSpacerHeight: 0,
            totalRows: Math.ceil(items.length / safeColumns),
            visibleRowCount: Math.ceil(items.length / safeColumns),
          },
    [
      effectiveFocusedIndex,
      effectiveRowHeight,
      effectiveViewportHeight,
      items.length,
      overscan,
      safeColumns,
      scrollTop,
      shouldVirtualize,
    ],
  );

  const handleFocusCapture = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const itemWrapper = target.closest<HTMLElement>("[data-virtual-index]");
    if (!itemWrapper) return;
    const rawIndex = Number(itemWrapper.getAttribute("data-virtual-index"));
    if (Number.isInteger(rawIndex) && rawIndex >= 0) {
      setInternalFocusedIndex((prev) => (prev === rawIndex ? prev : rawIndex));
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!shouldVirtualize || items.length === 0) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const itemWrapper = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-virtual-index]") : null;
      const currentIndexFromDom = itemWrapper ? Number(itemWrapper.getAttribute("data-virtual-index")) : NaN;
      const currentIndex = Number.isInteger(currentIndexFromDom)
        ? currentIndexFromDom
        : (effectiveFocusedIndex ?? windowRange.startIndex);

      let nextIndex: number | null = null;
      const pageStep = Math.max(1, windowRange.visibleRowCount) * safeColumns;

      switch (event.key) {
        case "ArrowDown":
          nextIndex = Math.min(items.length - 1, currentIndex + 1);
          break;
        case "ArrowUp":
          nextIndex = Math.max(0, currentIndex - 1);
          break;
        case "PageDown":
          nextIndex = Math.min(items.length - 1, currentIndex + pageStep);
          break;
        case "PageUp":
          nextIndex = Math.max(0, currentIndex - pageStep);
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = items.length - 1;
          break;
        default:
          return;
      }

      if (nextIndex === null || nextIndex === currentIndex) {
        return;
      }

      event.preventDefault();
      pendingKeyboardFocusIndexRef.current = nextIndex;
      setInternalFocusedIndex(nextIndex);

      const nextRow = Math.floor(nextIndex / safeColumns);
      const nextScrollTop = Math.max(0, (nextRow - 1) * effectiveRowHeight);
      setScrollTop(nextScrollTop);
    },
    [effectiveFocusedIndex, effectiveRowHeight, items.length, safeColumns, shouldVirtualize, windowRange],
  );

  useEffect(() => {
    const pendingIndex = pendingKeyboardFocusIndexRef.current;
    if (pendingIndex === null || !listRef.current) return;
    const itemWrapper = listRef.current.querySelector<HTMLElement>(`[data-virtual-index="${pendingIndex}"]`);
    if (!itemWrapper) return;
    pendingKeyboardFocusIndexRef.current = null;
    const focusTarget = findFirstFocusableChild(itemWrapper);
    focusTarget?.focus({ preventScroll: true });
  }, [windowRange.startIndex, windowRange.endIndex, effectiveFocusedIndex]);

  if (!shouldVirtualize) {
    return (
      <div className={className} data-testid={testId} data-virtualized="false">
        {items.map((item, index) => (
          <Fragment key={getItemKey ? getItemKey(item, index) : index}>{renderItem(item, index)}</Fragment>
        ))}
      </div>
    );
  }

  const visibleItems = items.slice(windowRange.startIndex, windowRange.endIndex);

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      data-testid={testId ?? "virtualized-result-list"}
      data-virtualized="true"
      data-total-count={items.length}
      data-rendered-count={visibleItems.length}
      data-start-index={windowRange.startIndex}
      data-end-index={windowRange.endIndex}
      onScroll={handleScroll}
      onFocusCapture={handleFocusCapture}
      onKeyDown={handleKeyDown}
    >
      {windowRange.topSpacerHeight > 0 ? (
        <div
          aria-hidden="true"
          data-testid="virtualized-list-top-spacer"
          style={{ height: `${windowRange.topSpacerHeight}px` }}
        />
      ) : null}
      <div
        ref={listRef}
        role="list"
        aria-label={ariaLabel}
        className={className}
        data-testid={testId ? `${testId}-items` : "virtualized-result-list-items"}
        onScroll={handleScroll}
      >
        {visibleItems.map((item, offset) => {
          const index = windowRange.startIndex + offset;
          const itemKey = getItemKey ? getItemKey(item, index) : index;
          return (
            <div
              key={itemKey}
              role="listitem"
              aria-setsize={items.length}
              aria-posinset={index + 1}
              data-virtual-index={index}
              data-testid="virtualized-result-item"
              tabIndex={-1}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
      {windowRange.bottomSpacerHeight > 0 ? (
        <div
          aria-hidden="true"
          data-testid="virtualized-list-bottom-spacer"
          style={{ height: `${windowRange.bottomSpacerHeight}px` }}
        />
      ) : null}
    </div>
  );
}
