"use client";

import { Star, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { useSavedRegistryFavourites } from "@/components/clinical-dashboard/use-saved-registry-favourites";
import { flatButton, FlatCount, flatLink, FlatLabel, FlatList, FlatRow } from "@/components/psychiatry/psychiatry-flat";
import { cn } from "@/components/ui-primitives";
import { appModeHomeHref } from "@/lib/app-modes";

/**
 * The Psychiatry hub's Saved page: the reader's own favourites, without services (those belong to
 * Find), grouped by the kinds the app can star here: forms, differentials and therapies. Loaded only
 * when the Saved tab is opened, so the favourites registries are never fetched for a reader who stays
 * on Ask.
 *
 * Counts are what loaded. When part of the list failed, the totals say "at least" and "N+", so a
 * short list never looks complete.
 */

const AccountSetupDialog = dynamic(
  () => import("@/components/clinical-dashboard/account-setup-dialog").then((module) => module.AccountSetupDialog),
  { ssr: false },
);

const GROUPS = [
  { type: "forms", label: "Forms" },
  { type: "differentials", label: "Differentials" },
  { type: "therapies", label: "Therapies" },
] as const;
type GroupType = (typeof GROUPS)[number]["type"];
type Filter = "all" | GroupType;

type SavedItem = ReturnType<typeof useSavedRegistryFavourites>["items"][number];

function isGroupType(type: string): type is GroupType {
  return GROUPS.some((group) => group.type === type);
}

function SignedOut() {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="grid justify-items-center gap-2 px-2.5 pt-6 pb-2 text-center"
      data-testid="psychiatry-saved-signed-out"
    >
      <Star aria-hidden="true" className="size-7 text-[color:var(--dash-faint)]" />
      <p className="text-base font-semibold text-[color:var(--dash-ink)]">Sign in to see what you’ve saved.</p>
      <p className="max-w-[30ch] text-sm-minus text-[color:var(--dash-muted)]">
        Starred items are kept with your account, so they appear on any phone you sign in on.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(flatButton, "mt-1")}
        data-testid="psychiatry-saved-sign-in"
      >
        Sign in
      </button>
      {open ? <AccountSetupDialog open={open} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

export function PsychiatrySavedCard() {
  const { items, status, refetch } = useSavedRegistryFavourites();
  const [filter, setFilter] = useState<Filter>("all");
  const saved = items.filter((item) => isGroupType(item.type));
  const partial = status === "partial";
  const retry = (
    <button type="button" onClick={refetch} className={cn(flatLink, "shrink-0 px-1")}>
      Try again
    </button>
  );
  const favouritesLink = (
    <Link href={appModeHomeHref("favourites")} className={flatLink}>
      Favourites
    </Link>
  );

  if (status === "unauthorized" && saved.length === 0) {
    return (
      <section aria-label="Saved" data-testid="psychiatry-card-saved" className="grid gap-2">
        <SignedOut />
      </section>
    );
  }

  const byType = new Map<GroupType, SavedItem[]>(GROUPS.map((group) => [group.type, []]));
  for (const item of saved) if (isGroupType(item.type)) byType.get(item.type)?.push(item);
  const allCount = partial ? `${saved.length}+` : String(saved.length);
  const shown = GROUPS.filter(
    (group) => (filter === "all" || filter === group.type) && (byType.get(group.type)?.length ?? 0) > 0,
  );

  return (
    <section aria-label="Saved" data-testid="psychiatry-card-saved" className="grid gap-3">
      <div className="flex justify-end">{favouritesLink}</div>
      {partial ? (
        <div
          data-testid="psychiatry-saved-partial"
          className="flex items-start gap-2.5 rounded-lg bg-[color:var(--dash-card)] px-3 py-1 text-sm-minus text-[color:var(--dash-muted)] forced-colors:border"
        >
          <TriangleAlert aria-hidden="true" className="mt-3 size-icon-sm shrink-0 text-[color:var(--dash-amber)]" />
          <span className="min-w-0 flex-1 py-2.5">
            {`Some saved items could not load, so this list may be incomplete. Showing at least ${saved.length}.`}
          </span>
          {retry}
        </div>
      ) : null}

      {saved.length > 0 ? (
        <>
          <div
            role="group"
            aria-label="Show"
            className="flex gap-3.5 overflow-x-auto border-b border-[color:var(--dash-line)] text-sm-minus font-semibold [scrollbar-width:none]"
          >
            {[
              { type: "all" as const, label: "All", count: allCount },
              ...GROUPS.map((group) => ({
                type: group.type,
                label: group.label,
                count:
                  partial && (byType.get(group.type)?.length ?? 0) === 0
                    ? "–"
                    : String(byType.get(group.type)?.length ?? 0),
              })),
            ].map((chip) => {
              const on = filter === chip.type;
              return (
                <button
                  key={chip.type}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(chip.type)}
                  data-testid={`psychiatry-saved-filter-${chip.type}`}
                  className={cn(
                    focusRing,
                    "focus-ring-contained -mb-px min-h-12 shrink-0 whitespace-nowrap border-b-2",
                    on
                      ? "border-[color:var(--dash-ink)] text-[color:var(--dash-ink)]"
                      : "border-transparent text-[color:var(--dash-muted)]",
                  )}
                >
                  {chip.label}{" "}
                  <span className="nums ml-1 font-medium text-[color:var(--dash-muted)]">{chip.count}</span>
                </button>
              );
            })}
          </div>
          {shown.map((group) => {
            const groupItems = byType.get(group.type) ?? [];
            return (
              <div key={group.type} className="grid gap-2">
                <FlatLabel title={group.label} aside={<FlatCount>{groupItems.length}</FlatCount>} as="h3" />
                <FlatList label={`Saved ${group.label.toLowerCase()}`} testId={`psychiatry-saved-${group.type}`}>
                  {groupItems.map((item) => (
                    <FlatRow key={item.id} href={item.href} icon={item.icon} title={item.title} subtitle={item.meta} />
                  ))}
                </FlatList>
              </div>
            );
          })}
          {shown.length === 0 ? (
            <p className="text-sm text-[color:var(--dash-muted)]" data-testid="psychiatry-saved-filter-empty">
              {partial ? "None of these loaded. They are still saved." : "Nothing saved of this kind yet."}
            </p>
          ) : null}
        </>
      ) : status === "loading" ? (
        <p className="text-sm text-[color:var(--dash-muted)]" role="status">
          Loading your saved items…
        </p>
      ) : status === "error" ? (
        <p className="flex flex-wrap items-center gap-x-1 text-sm text-[color:var(--dash-muted)]">
          Couldn&apos;t load your saved items. {retry}
        </p>
      ) : partial ? null : (
        <p className="text-sm text-[color:var(--dash-muted)]" data-testid="psychiatry-saved-empty">
          Nothing saved yet. Save a form, therapy or differential and it will appear here.
        </p>
      )}

      <FlatList label="All starred">
        <FlatRow
          href={appModeHomeHref("favourites")}
          icon={Star}
          title="All starred"
          subtitle="Everything you star, across the app"
        />
      </FlatList>
    </section>
  );
}
