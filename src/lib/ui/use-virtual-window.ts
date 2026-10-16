"use client";

import { useCallback, useEffect, useState } from "react";

export type UseVirtualWindowOptions = {
  readonly totalCount: number;
  readonly initialCount?: number;
  readonly stepCount?: number;
  readonly resetKey: string;
};

export type VirtualWindowState = {
  readonly visibleCount: number;
  readonly hasMore: boolean;
  readonly showMore: () => void;
  readonly showAll: () => void;
  readonly ensureIndexVisible: (index: number) => void;
  readonly sentinelRef: (node: HTMLElement | null) => void;
};

/**
 * Progressive DOM windowing hook for large result lists (#CFHRJY).
 *
 * Caps initial DOM rendering to `initialCount` items and automatically
 * expands by `stepCount` when the scroll sentinel enters the viewport
 * (or when the accessible "Show more" button / `ensureIndexVisible` is invoked).
 */
export function useVirtualWindow({
  totalCount,
  initialCount = 40,
  stepCount = 40,
  resetKey,
}: UseVirtualWindowOptions): VirtualWindowState {
  const safeInitial = Math.max(1, initialCount);
  const safeStep = Math.max(1, stepCount);

  const [windowState, setWindowState] = useState<{ key: string; count: number }>({
    key: resetKey,
    count: safeInitial,
  });
  const [sentinelNode, setSentinelNode] = useState<HTMLElement | null>(null);

  if (windowState.key !== resetKey) {
    setWindowState({ key: resetKey, count: safeInitial });
  }

  const rawCount = windowState.key === resetKey ? windowState.count : safeInitial;
  const visibleCount = Math.min(rawCount, totalCount);
  const hasMore = visibleCount < totalCount;

  const showMore = useCallback(() => {
    setWindowState((current) => {
      const base = current.key === resetKey ? current.count : safeInitial;
      return {
        key: resetKey,
        count: Math.min(totalCount, base + safeStep),
      };
    });
  }, [resetKey, safeInitial, safeStep, totalCount]);

  const showAll = useCallback(() => {
    setWindowState({
      key: resetKey,
      count: totalCount,
    });
  }, [resetKey, totalCount]);

  const ensureIndexVisible = useCallback(
    (index: number) => {
      if (index < 0) return;
      setWindowState((current) => {
        const base = current.key === resetKey ? current.count : safeInitial;
        if (index < base) return current.key === resetKey ? current : { key: resetKey, count: base };
        const needed = Math.ceil((index + 1) / safeStep) * safeStep;
        return {
          key: resetKey,
          count: Math.min(totalCount, Math.max(base, needed, index + 1)),
        };
      });
    },
    [resetKey, safeInitial, safeStep, totalCount],
  );

  useEffect(() => {
    if (!sentinelNode || !hasMore) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          showMore();
        }
      },
      { rootMargin: "320px 0px" },
    );

    observer.observe(sentinelNode);
    return () => observer.disconnect();
  }, [sentinelNode, hasMore, showMore]);

  return {
    visibleCount,
    hasMore,
    showMore,
    showAll,
    ensureIndexVisible,
    sentinelRef: setSentinelNode,
  };
}
