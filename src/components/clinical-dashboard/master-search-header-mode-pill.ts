"use client";

import { useWorkFramePill } from "@/components/work-frame/work-frame-store";
import type { AppModeId } from "@/lib/app-modes";
import { activeModeSecondaryNavigationId, type ModeSecondaryNavigationEntry } from "@/lib/mode-secondary-navigation";
import { workAreaFor, workFrameForRoute } from "@/lib/work-frame/areas";

/**
 * What the universal header's mode pill names, and the work frame this address
 * draws. Moved out of `master-search-header.tsx` unchanged; the header still
 * owns the markup.
 */
export function useHeaderModePill({
  modeId,
  modeLabel,
  pathname,
  modeOwnPages,
}: {
  modeId: AppModeId;
  modeLabel: string;
  pathname: string;
  /** This mode's own pages, as the pill's sheet lists them (empty when it lists none). */
  modeOwnPages: readonly ModeSecondaryNavigationEntry[];
}) {
  /**
   * Which of this mode's pages the reader is on, when the pill lists pages.
   *
   * The pill then NAMES THAT PAGE rather than the mode. In a mode whose pages
   * are the whole product — On Call's nine — the mode's name was the one thing
   * on the screen the reader never needed: they know they are on call. Where
   * they are inside it is what the row above the page should say, and the pill
   * is the control that changes it, so the two belong in the same place.
   *
   * `null` on an unmatched path (a record route, a page with no registry entry)
   * and the pill falls back to naming the mode, which is the honest answer when
   * no registered page is current.
   */
  const activeModePageId = modeOwnPages.length > 0 ? activeModeSecondaryNavigationId(modeId, pathname) : null;
  const registryModePage = activeModePageId
    ? (modeOwnPages.find((page) => page.id === activeModePageId) ?? null)
    : null;
  /**
   * A work area's frame names the page and the area itself (work-mode
   * redesign, owner request 6 Oct 2026): "Swaps" over "ROSTER", and Open
   * shifts' pages over Roster, Assessments' over its own name. Published by
   * the band while it is up; null elsewhere, so every other mode is unchanged.
   */
  const workFramePill = useWorkFramePill();
  /**
   * The work area and page this address draws, decided from the mode and
   * address alone so it is in the server HTML. The band publishes the same
   * names once it has mounted; until then (server render, first paint) the
   * pill reads them from here, so it never flashes the registry's page name
   * ("Shifts" over "Roster") before settling on the frame's. Only where the
   * band will actually draw a framed page: a `band: false` page or one with no
   * frame item keeps the registry naming it has after hydration too.
   */
  const routeWorkArea = workAreaFor(modeId, pathname);
  const routeWorkFrame = workFrameForRoute(modeId, pathname);
  const routeWorkFramed = routeWorkFrame !== null;
  const routeWorkPill = routeWorkFrame
    ? // The band publishes the area alone (pill 4b), so the first paint names the area alone too.
      { modeId, area: routeWorkFrame.area.name, page: null }
    : null;
  const workPill = (workFramePill?.modeId === modeId ? workFramePill : null) ?? routeWorkPill;
  // A work band that publishes no page asks for the area alone (Josh, 7 Oct
  // 2026, pill 4b: the underlined tab already names the page), so the
  // registry's page is not used as a fallback there.
  const activeModePage: { id: string; label: string } | null = workPill
    ? workPill.page
      ? { id: "work-frame", label: workPill.page }
      : null
    : registryModePage;
  /** The area-only pill: a work area's name, alone, in its own colour. */
  const pillShowsAreaOnly = Boolean(workPill) && !activeModePage;
  const pillModeLabel = workPill?.area ?? modeLabel;
  return { activeModePage, pillShowsAreaOnly, pillModeLabel, routeWorkArea, routeWorkFrame, routeWorkFramed };
}
