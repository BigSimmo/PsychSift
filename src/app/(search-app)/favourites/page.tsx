import type { Metadata } from "next";
import { FavouritesCommandLibraryPage } from "@/components/clinical-dashboard/favourites-command-library-page";
import { resolveClientDemoMode } from "@/lib/client-env";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";

export const metadata: Metadata = {
  title: "Favourites | PsychSift",
  description: "Your saved pages, searches and tools.",
};

type FavouritesPageProps = {
  searchParams?: Promise<{
    q?: string | string[];
  }>;
};

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FavouritesPage({ searchParams }: FavouritesPageProps) {
  const params = searchParams ? await searchParams : {};
  const query = firstSearchParam(params.q)?.trim() ?? "";
  const demoMode = resolveClientDemoMode({
    explicitDemoMode: isDemoMode(),
    authUnavailableFallback: false,
    localNoAuthMode: isLocalNoAuthMode(),
  });

  // No key={query} remount: query is a pure prop, and remounting on query
  // change wiped the set/type/view/sort selections when clearing a search.
  return <FavouritesCommandLibraryPage query={query} demoMode={demoMode} />;
}
