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
 *
 * A home with nothing to continue and no favourites (signed out, a new device)
 * shows two Browse links instead of one (Clinical audit, 13 Oct 2026, item 17),
 * each an existing page of that mode, so the screen under the box is not empty.
 * Two is the most that keeps the idle phone home on one screen at 390 x 844. Once Continue or Favourites has something, only the first Browse
 * link stays, as before.
 */

type StartListMode = Extract<
  AppModeId,
  | "dsm"
  | "prescribing"
  | "therapy-compass"
  | "documents"
  | "differentials"
  | "formulation"
  | "specifiers"
  | "forms"
  | "factsheets"
  | "dictionary"
  | "services"
>;

type BrowseLink = { readonly href: string; readonly label: string };

/** Browse links an empty home shows; more pushes the idle phone home past one screen. */
const EMPTY_HOME_BROWSE_SHOWN = 2;

type StartListConfig = {
  /** The Recent pages section whose records Continue lists. */
  readonly section: RecentPageSection;
  /** The favourites registry type saved for this mode, when the account can save one. */
  readonly favouriteType?: "differentials" | "therapies";
  /**
   * Existing pages to browse from, most useful first. The first is the mode's
   * own whole catalogue when it has one; the rest show only on an empty home.
   */
  readonly browse: readonly BrowseLink[];
};

const START_LIST_CONFIG: Readonly<Record<StartListMode, StartListConfig>> = {
  dsm: {
    section: "dsm",
    browse: [
      { href: "/dsm/search", label: "Browse all diagnoses" },
      { href: "/dsm/compare", label: "Compare diagnoses" },
      { href: "/specifiers/search", label: "Browse all specifiers" },
    ],
  },
  differentials: {
    section: "differentials",
    favouriteType: "differentials",
    browse: [
      { href: "/differentials/diagnoses", label: "Browse all differentials" },
      { href: "/differentials/presentations", label: "Start from a presentation" },
      { href: "/differentials/compare", label: "Compare differentials" },
    ],
  },
  "therapy-compass": {
    section: "therapy-compass",
    favouriteType: "therapies",
    browse: [
      { href: "/therapy-compass/search", label: "Browse all therapies" },
      { href: "/therapy-compass/recommend", label: "Recommend a therapy" },
      { href: "/therapy-compass/pathways", label: "Problem pathways" },
      { href: "/therapy-compass/compare", label: "Compare therapies" },
    ],
  },
  formulation: {
    section: "formulation",
    browse: [
      { href: "/formulation/search", label: "Browse all mechanisms" },
      { href: "/formulation/builder", label: "Formulation builder" },
      { href: "/formulation/map", label: "Mechanism map" },
    ],
  },
  specifiers: {
    section: "specifiers",
    browse: [
      { href: "/specifiers/search", label: "Browse all specifiers" },
      { href: "/specifiers/builder", label: "Specifier builder" },
      { href: "/specifiers/map", label: "Specifier map" },
      { href: "/specifiers/compare", label: "Compare specifiers" },
    ],
  },
  forms: {
    section: "forms",
    browse: [
      { href: "/forms/search", label: "Browse all forms" },
      { href: "/forms/act", label: "The Act and Standards" },
      { href: "/psychiatry/mha-clock", label: "MHA clock" },
    ],
  },
  factsheets: {
    section: "factsheets",
    browse: [
      { href: "/factsheets/search", label: "Browse all factsheets" },
      { href: "/factsheets/topics", label: "Browse by topic" },
    ],
  },
  dictionary: {
    section: "dictionary",
    browse: [
      { href: "/dictionary/search", label: "Browse all terms" },
      { href: "/dictionary/topics", label: "Browse by topic" },
      { href: "/dictionary/compare", label: "Compare terms" },
    ],
  },
  services: {
    section: "services",
    browse: [{ href: "/services/search", label: "Browse all services" }],
  },
  // Medication has no medicine catalogue page of its own (the medicine list is a search
  // filter), so its Browse links go to the existing Medicines pages around it; they show
  // only on an empty home. Documents' library is a drawer, so it links the source catalogue.
  prescribing: {
    section: "prescribing",
    browse: [
      { href: "/factsheets/search", label: "Browse medicine factsheets" },
      { href: "/medicines", label: "Medicines home" },
    ],
  },
  documents: {
    section: "documents",
    browse: [{ href: "/sources/search", label: "Browse the source catalogue" }],
  },
};

export function modeHomeStartListConfig(modeId: AppModeId): StartListConfig | null {
  return (START_LIST_CONFIG as Partial<Record<AppModeId, StartListConfig>>)[modeId] ?? null;
}

/** The favourites group reads the account's saved records, so it loads in the browser only, after the page. */
const ModeHomeFavouritesGroup = dynamic(
  () => import("@/components/mode-home-favourites-group").then((module) => module.ModeHomeFavouritesGroup),
  { ssr: false },
);

function ContinueGroup({ modeId, pages }: { modeId: StartListMode; pages: ReturnType<typeof useRecentPages> }) {
  if (pages.length === 0) return null;
  return (
    <ModeHomeStartGroup id={`${modeId}-home-continue`} title="Continue" testId="mode-home-continue">
      {pages.map((page) => (
        <ModeHomeStartRow key={page.path} href={page.path} icon={appModeIcons[page.section]} title={page.title} />
      ))}
    </ModeHomeStartGroup>
  );
}

/** True once the account's favourites for this mode are loaded and hold something. */
function useHasModeFavourites(favouriteType: StartListConfig["favouriteType"]): boolean {
  const account = useOptionalAccountData();
  if (!favouriteType || !account?.ready) return false;
  return (favouriteType === "therapies" ? account.favourites.therapy : account.favourites.differential).length > 0;
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
  return <ModeHomeStartListBody modeId={modeId as StartListMode} config={config} />;
}

function ModeHomeStartListBody({ modeId, config }: { modeId: StartListMode; config: StartListConfig }) {
  const pages = useRecentPages({ limit: RECENT_PAGES_CONTINUE_SHOWN, section: config.section });
  const hasFavourites = useHasModeFavourites(config.favouriteType);
  const emptyHome = pages.length === 0 && !hasFavourites;
  const [firstBrowse] = config.browse;
  return (
    <div
      data-testid="mode-home-start-list"
      className="mx-auto grid w-full max-w-xl grid-cols-[minmax(0,1fr)] gap-5 text-left sm:max-w-3xl sm:grid-cols-2 sm:gap-x-4 sm:[&:has(>section:only-of-type)]:max-w-xl sm:[&:has(>section:only-of-type)]:grid-cols-1"
    >
      <ContinueGroup modeId={modeId} pages={pages} />
      {config.favouriteType ? (
        <FavouritesGroupWhenAccount modeId={modeId} favouriteType={config.favouriteType} />
      ) : null}
      {emptyHome && config.browse.length > 1 ? (
        <ModeHomeStartGroup id={`${modeId}-home-browse`} title="Browse" testId="mode-home-browse-list">
          {config.browse.slice(0, EMPTY_HOME_BROWSE_SHOWN).map((link) => (
            <ModeHomeStartRow key={link.href} href={link.href} icon={LayoutList} title={link.label} />
          ))}
        </ModeHomeStartGroup>
      ) : firstBrowse ? (
        <Link
          href={firstBrowse.href}
          data-testid="mode-home-browse"
          className="mx-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:col-span-full"
        >
          <LayoutList aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
          {firstBrowse.label}
          <ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
        </Link>
      ) : null}
    </div>
  );
}
