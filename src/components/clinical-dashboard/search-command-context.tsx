"use client";

import { createContext, useContext } from "react";

import type { AppModeId } from "@/lib/app-modes";

export type SearchCommandContextValue = {
  query: string;
  modeId: AppModeId;
  /**
   * Clears the shared composer query. Pages call this when a same-URL action
   * (e.g. Show all) must reset the shell query, because the shell only re-syncs
   * its query from the URL after a real navigation.
   */
  clearQuery?: () => void;
};

const SearchCommandContext = createContext<SearchCommandContextValue | null>(null);

export function SearchCommandProvider({
  value,
  children,
}: {
  value: SearchCommandContextValue;
  children: React.ReactNode;
}) {
  return <SearchCommandContext.Provider value={value}>{children}</SearchCommandContext.Provider>;
}

export function useSearchCommand() {
  return useContext(SearchCommandContext);
}
