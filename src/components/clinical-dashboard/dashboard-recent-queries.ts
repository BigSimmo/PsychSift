import { useCallback, useEffect, useState } from "react";

import { loadRecentQueries, recentQueriesChangeEvent, saveRecentQueries } from "@/lib/recent-query-storage";

export interface UseDashboardRecentQueriesOptions {
  answerThreadOwnerId: string | null;
  canRecordRecentSearches: boolean;
}

export function useDashboardRecentQueries({
  answerThreadOwnerId,
  canRecordRecentSearches,
}: UseDashboardRecentQueriesOptions) {
  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  useEffect(() => {
    if (!answerThreadOwnerId) {
      queueMicrotask(() => setRecentQueries([]));
      return;
    }
    let cancelled = false;
    const reload = () => {
      if (cancelled) return;
      setRecentQueries(loadRecentQueries(answerThreadOwnerId));
    };
    queueMicrotask(reload);
    window.addEventListener(recentQueriesChangeEvent, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(recentQueriesChangeEvent, reload);
    };
  }, [answerThreadOwnerId]);

  const rememberRecentQuery = useCallback(
    (value: string) => {
      const trimmedValue = value.trim();
      if (!trimmedValue) return;
      if (!canRecordRecentSearches) return;
      setRecentQueries((current) => {
        const next = [
          trimmedValue,
          ...current.filter((item) => item.toLowerCase() !== trimmedValue.toLowerCase()),
        ].slice(0, 5);
        saveRecentQueries(answerThreadOwnerId, next);
        return next;
      });
    },
    [answerThreadOwnerId, canRecordRecentSearches],
  );

  return {
    recentQueries,
    setRecentQueries,
    rememberRecentQuery,
  };
}
