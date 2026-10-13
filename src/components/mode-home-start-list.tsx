"use client";

import { ChevronRight, LayoutList } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";

import { useOptionalAccountData } from "@/components/account-data-provider";
import { useRecentPages } from "@/components/recent-pages/use-recent-pages";
import { ModeHomeStartGroup, ModeHomeStartRow } from "@/components/mode-home-start-parts";
import { appModeIcons } from "@/lib/app-mode-icons";
import type { AppModeId } from "@/lib/app-modes";
import { RECENT_PAGES_CONTINUE_SHOWN, type RecentPageSection } from "@/lib/recent-pages";

/**
 * Something to start from on a Clinical mode home (site recommendations 12 Oct
 * 2026, item 3): under the unchanged composer, "Continue" (the last three
 * records of this mode opened on this device), this mode's Favourites, and a
 * link to the mode's whole catalogue. Each group hides when it has nothing, so
 * a first visit shows today's page plus at most the Browse link.
 *
 * Look and navigation only: the rows are the records' own titles, read from
 * the device's Recent pages list and the account's favourites, never ranked
 * or reworded here.
 */

type StartListMode = Extract<AppModeId, "dsm" | "prescribing" | "therapy-compass" | "documents" | "differentials">;

type StartListConfig = {
  /** The Recent pages section whose records Continue lists. */
  readonly section: RecentPageSection;
  /** The favourites registry type saved for this mode, when the account can save one. */
  readonly favouriteType?: "differentials" | "therapies";
  /** The mode's own whole-catalogue page, when it has one. */
  readonly browse?: { readonly href: string; readonly label: string };
};

const START_LIST_CONFIG: Readonly<Record<StartListMode, StartListConfig>> = {
  dsm: { section: "dsm", browse: { href: "/dsm/search", label: "Browse all diagnoses" } },
  differentials: {
    section: "differentials",
    favouriteType: "differentials",
    browse: { href: "/differentials/diagnoses", label: "Browse all differentials" },
  },
  "therapy-compass": {
    section: "therapy-compass",
    favouriteType: "therapies",
    browse: { href: "/therapy-compass/search", label: "Browse all therapies" },
  },
  // Medication and Documents have no catalogue page of their own (the medicine list is a
  // search filter and the document library a drawer), so they offer no Browse link.
  prescribing: { section: "prescribing" },
  documents: { section: "documents" },
};

export function modeHomeStartListConfig(modeId: AppModeId): StartListConfig | null {
  return (START_LIST_CONFIG as Partial<Record<AppModeId, StartListConfig>>)[modeId] ?? null;
}

/** The favourites group reads the account's saved records, so it loads in the browser only, after the page. */
const ModeHomeFavouritesGroup = dynamic(
  () => import("@/components/mode-home-favourites-group").then((module) => module.ModeHomeFavouritesGroup),
  { ssr: false },
);

function ContinueGroup({ modeId, section }: { modeId: StartListMode; section: RecentPageSection }) {
  const pages = useRecentPages({ limit: RECENT_PAGES_CONTINUE_SHOWN, section });
  if (pages.length === 0) return null;
  return (
    <ModeHomeStartGroup id={`${modeId}-home-continue`} title="Continue" testId="mode-home-continue">
      {pages.map((page) => (
        <ModeHomeStartRow key={page.path} href={page.path} icon={appModeIcons[page.section]} title={page.title} />
      ))}
    </ModeHomeStartGroup>
  );
}

function FavouritesGroupWhenAccount({
  modeId,
  favouriteType,
}: {
  modeId: StartListMode;
  favouriteType: NonNullable<StartListConfig["favouriteType"]>;
}) {
  // Optional: the home renders in tests and shells without the account provider.
  return useOptionalAccountData() ? <ModeHomeFavouritesGroup modeId={modeId} favouriteType={favouriteType} /> : null;
}

/**
 * The start list for a Clinical mode home, or nothing for a mode without one
 * (Answer and every other mode keep their home exactly as it was).
 */
export function ModeHomeStartList({ modeId }: { modeId: AppModeId }) {
  const config = modeHomeStartListConfig(modeId);
  if (!config) return null;
  const mode = modeId as StartListMode;
  return (
    <div
      data-testid="mode-home-start-list"
      className="mx-auto grid w-full max-w-xl grid-cols-[minmax(0,1fr)] gap-5 text-left sm:max-w-3xl sm:grid-cols-2 sm:gap-x-4 sm:[&:has(>section:only-of-type)]:max-w-xl sm:[&:has(>section:only-of-type)]:grid-cols-1"
    >
      <ContinueGroup modeId={mode} section={config.section} />
      {config.favouriteType ? <FavouritesGroupWhenAccount modeId={mode} favouriteType={config.favouriteType} /> : null}
      {config.browse ? (
        <Link
          href={config.browse.href}
          data-testid="mode-home-browse"
          className="mx-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:col-span-full"
        >
          <LayoutList aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
          {config.browse.label}
          <ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
        </Link>
      ) : null}
    </div>
  );
}
