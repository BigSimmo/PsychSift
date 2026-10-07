"use client";

import { Heart, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import type { SidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import { rememberedWorkAreaPage, useWorkSideCounts } from "@/components/work-frame/work-frame-store";
import { useNewWorkMode, useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { appModeIcons } from "@/lib/app-mode-icons";
import type { AppModeId } from "@/lib/app-modes";
import { modeSideOf } from "@/lib/phone-mode-groups";
import { WORK_AREAS, workAreaFor, type WorkAreaId } from "@/lib/work-frame/areas";
import { WORK_SIDE_AREAS, workSideAreaId, workSideBadgeText, workSideCountLabel } from "@/lib/work-frame/side-nav";

/**
 * Whether this page gets the work side menu and rail rather than the clinical
 * sidebar: a work mode, for a reader the launch switch has given the new work
 * mode. Classic readers keep the clinical sidebar everywhere.
 */
export function useWorkSideNav(modeId: AppModeId): boolean {
  return useNewWorkMode() && modeSideOf(modeId) === "work";
}

/** The row the side menu and rail light for this page, inner areas rolled up. */
export function workSideCurrentArea(modeId: AppModeId, pathname: string): WorkAreaId | null {
  const area = workAreaFor(modeId, pathname);
  return area ? workSideAreaId(area.id) : null;
}

/* The rail replaces the menu button from Tailwind's md (768 px), where the clinical rail also starts. */
const railQuery = "(min-width: 768px)";

function subscribeRail(callback: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(railQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

/** Whether the rail is on screen. False on the server, so phones never hydrate a rail read. */
export function useWorkRailShown(): boolean {
  return useSyncExternalStore(
    subscribeRail,
    () => typeof window.matchMedia === "function" && window.matchMedia(railQuery).matches,
    () => false,
  );
}

/**
 * The tablet rail (owner pick "Burger and rail", 7 Oct 2026): from 768 px a
 * narrow column down the left edge with your initial, the seven work areas
 * with what is waiting in each, then Favourites and Settings. The menu button
 * is hidden there, and the header's left slot stays free for the back arrow
 * on inner areas and form steps.
 */
export function WorkRail({
  identity,
  currentArea,
  onOpenSettings,
}: {
  readonly identity: SidebarIdentity;
  readonly currentArea: WorkAreaId | null;
  readonly onOpenSettings: () => void;
}) {
  const counts = useWorkSideCounts();
  const routeVisible = useWorkModeRouteVisible();
  return (
    <nav aria-label="Work areas" className="work-rail" data-testid="work-rail">
      <Link
        href="/my-day/profile"
        className="work-rail__avatar"
        aria-label={identity.signedIn ? `Work profile, ${identity.displayName}` : "Work profile and sign-in"}
        data-testid="work-rail-profile"
      >
        <span aria-hidden="true">{identity.signedIn ? identity.initials : "?"}</span>
      </Link>
      <ul className="work-rail__list">
        {WORK_SIDE_AREAS.filter((entry) => routeVisible(entry.href)).map((entry) => {
          const current = entry.id === currentArea;
          const Icon = appModeIcons[entry.modeId];
          const count = counts?.areas[entry.id];
          const href = current ? entry.href : (rememberedWorkAreaPage(entry.id) ?? entry.href);
          return (
            <li key={entry.id}>
              <Link
                href={href}
                aria-current={current ? "true" : undefined}
                data-mode-identity={WORK_AREAS[entry.id].identity}
                data-testid={`work-rail-area-${entry.id}`}
                className="work-rail__item"
              >
                <span className="work-rail__pill" aria-hidden="true">
                  <Icon aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
                  {count && count.total > 0 ? (
                    <em className="work-rail__count" data-overdue={count.overdue > 0 ? "true" : undefined}>
                      {workSideBadgeText(count.total)}
                    </em>
                  ) : null}
                </span>
                <span className="work-rail__label">
                  {entry.short}
                  {entry.short !== entry.label ? <span className="sr-only"> ({entry.label})</span> : null}
                  {count && count.total > 0 ? <span className="sr-only">, {workSideCountLabel(count)}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <span className="work-rail__spacer" />
      <ul className="work-rail__list">
        <li>
          <Link href="/my-day/favourites" className="work-rail__item" data-testid="work-rail-favourites">
            <span className="work-rail__pill" aria-hidden="true">
              <Heart aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
            </span>
            <span className="work-rail__label">Favourites</span>
          </Link>
        </li>
        <li>
          <button type="button" onClick={onOpenSettings} className="work-rail__item" data-testid="work-rail-settings">
            <span className="work-rail__pill" aria-hidden="true">
              <SlidersHorizontal aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
            </span>
            <span className="work-rail__label">Settings</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
