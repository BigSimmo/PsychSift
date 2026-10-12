"use client";

import { ChevronRight, LayoutList, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { type ReactNode } from "react";

import { useOptionalAccountData } from "@/components/account-data-provider";
import { useRecentPages } from "@/components/recent-pages/use-recent-pages";
import { cn, eyebrowText } from "@/components/ui-primitives";
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

const rowClass =
  "group grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left text-[color:var(--text-heading)] transition-colors hover:bg-[color:var(--surface-subtle)] focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none";

/** One row: the record's icon, its own title and a chevron. 48 px tall at least. */
export function ModeHomeStartRow({ href, icon: Icon, title }: { href: string; icon: LucideIcon; title: string }) {
  return (
    <li className="min-w-0 border-t border-[color:var(--border)] first:border-t-0">
      <Link href={href} className={rowClass}>
        <Icon aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" strokeWidth={2} />
        <span className="min-w-0 truncate text-sm font-medium leading-5">{title}</span>
        <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--decoration-soft)]" />
      </Link>
    </li>
  );
}

/** A labelled group: a quiet heading over a flat hairline card. */
export function ModeHomeStartGroup({
  id,
  title,
  testId,
  children,
}: {
  id: string;
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid min-w-0 content-start gap-2" data-testid={testId}>
      <h3 id={id} className={cn(eyebrowText, "px-1 text-left")}>
        {title}
      </h3>
      <ul
        role="list"
        className="grid min-w-0 overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]"
      >
        {children}
      </ul>
    </section>
  );
}

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
