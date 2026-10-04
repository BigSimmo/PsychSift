"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { useSavedRegistryFavourites } from "@/components/clinical-dashboard/use-saved-registry-favourites";
import { DashCard } from "@/components/dashboard-kit/dash-card";
import { IconChip } from "@/components/dashboard-kit/icon-chip";
import { dashLink, dashMuted } from "@/components/dashboard-kit/recipes";
import { cn } from "@/components/ui-primitives";
import { appModeHomeHref } from "@/lib/app-modes";

/**
 * The Psychiatry hub's Saved page: the reader's own favourites, without
 * services (those belong to Find). Loaded only when the Saved tab is opened,
 * so the favourites registries are never fetched for a reader who stays on Ask.
 */
export function PsychiatrySavedCard() {
  const { items, status, refetch } = useSavedRegistryFavourites();
  const saved = items.filter((item) => item.type !== "services");
  const retry = (
    <button type="button" onClick={refetch} className={cn(focusRing, dashLink, "min-h-12 rounded-full px-1")}>
      Try again
    </button>
  );
  return (
    <DashCard
      title="Saved"
      testId="psychiatry-card-saved"
      aside={
        <Link
          href={appModeHomeHref("favourites")}
          className={cn(focusRing, dashLink, "inline-flex min-h-12 items-center rounded-full px-2")}
        >
          Favourites
        </Link>
      }
    >
      {status === "partial" ? (
        <p className={cn(dashMuted, "mb-2")} data-testid="psychiatry-saved-partial">
          Some of your saved items couldn&apos;t load, so this list may be incomplete. {retry}
        </p>
      ) : null}
      {saved.length > 0 ? (
        <ul
          role="list"
          aria-label="Saved items"
          className="grid min-w-0 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] forced-colors:border"
        >
          {saved.map((item) => {
            const ItemIcon = item.icon;
            return (
              <li key={item.id} className="border-t border-[color:var(--dash-line)] first:border-t-0">
                <Link
                  href={item.href}
                  className={cn(
                    focusRing,
                    "grid min-h-12 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-2xl px-3 py-2 text-[color:var(--dash-ink)] no-underline",
                  )}
                >
                  <IconChip tint="blue" size="sm">
                    <ItemIcon aria-hidden="true" className="size-icon-sm" />
                  </IconChip>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="break-words font-dash-title text-base-minus leading-tight">{item.title}</span>
                    <span className={cn(dashMuted, "break-words")}>{item.set}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-icon-sm text-[color:var(--dash-faint)]" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : status === "loading" ? (
        <p className={dashMuted} role="status">
          Loading your saved items…
        </p>
      ) : status === "error" ? (
        <p className={dashMuted}>Couldn&apos;t load your saved items. {retry}</p>
      ) : status === "unauthorized" ? (
        <p className={dashMuted} data-testid="psychiatry-saved-signed-out">
          Sign in to see what you&apos;ve saved.
        </p>
      ) : status === "partial" ? null : (
        <p className={dashMuted} data-testid="psychiatry-saved-empty">
          Nothing saved yet. Save a form, therapy or differential and it will appear here.
        </p>
      )}
    </DashCard>
  );
}
