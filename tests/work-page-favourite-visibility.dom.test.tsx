/** @vitest-environment jsdom */
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: "loading", session: null, authEpoch: 1 }),
}));
vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({ items: [], status: "ready", registryStatus: "ready", refetch: vi.fn() }),
}));

import { AddWorkPageSheet } from "@/components/favourites/add-work-page-sheet";
import { useFavouritesShelf } from "@/components/favourites/use-favourites-shelf";
import { ModeBand } from "@/components/mode-band/mode-band";
import { WorkModeLaunchProvider } from "@/components/work-mode-launch/work-mode-launch-provider";
import { WORK_PAGE_FAVOURITES_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import {
  loadWorkPageStars,
  resetWorkPageStarsForTesting,
  resolveWorkPageStars,
  type WorkPageStar,
} from "@/lib/favourites/work-page-stars";
import { WORK_AREAS, workFrameItemById, workFrameItemOwnsAddress } from "@/lib/work-frame/areas";
import type { WorkModeLaunch } from "@/lib/work-mode-launch/launch";
import { workModeRouteHidden } from "@/lib/work-mode-launch/routes";

const classic: WorkModeLaunch = {
  newWorkMode: false,
  previewAudience: false,
  classicPreferred: true,
  choiceAvailable: true,
};
const fresh: WorkModeLaunch = { ...classic, newWorkMode: true, previewAudience: true, classicPreferred: false };

function inLaunch(launch: WorkModeLaunch) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <WorkModeLaunchProvider launch={launch}>{children}</WorkModeLaunchProvider>;
  };
}

// CPD's Export is a new-only screen; its Log is on both work modes.
const exportStar: WorkPageStar = { areaId: "cpd", itemId: "cpd-export", starredAt: 2, pinnedAt: null, openedAt: null };
const logStar: WorkPageStar = { areaId: "cpd", itemId: "log", starredAt: 1, pinnedAt: null, openedAt: null };

function seed(stars: readonly WorkPageStar[]) {
  localStorage.setItem(WORK_PAGE_FAVOURITES_STORAGE_KEY, JSON.stringify(stars));
  resetWorkPageStarsForTesting();
}

beforeEach(() => {
  localStorage.clear();
  resetWorkPageStarsForTesting();
  nav.pathname = "/";
  nav.search = "";
});

afterEach(() => {
  cleanup();
});

describe("saved work pages on the classic work mode", () => {
  it("hides a new-only page that would 404, and keeps every other", () => {
    const routeVisible = (href: string) => !workModeRouteHidden(href, classic);
    expect(resolveWorkPageStars([exportStar, logStar], routeVisible).map((star) => star.key)).toEqual(["cpd:log"]);
    expect(resolveWorkPageStars([exportStar, logStar]).map((star) => star.key)).toEqual(["cpd:cpd-export", "cpd:log"]);
  });

  it("leaves the new-only page off the My Day shelf, still saved on the phone", () => {
    seed([exportStar, logStar]);
    const { result } = renderHook(() => useFavouritesShelf(), { wrapper: inLaunch(classic) });
    expect(result.current.items.map((item) => item.workKey)).toEqual(["cpd:log"]);
    expect(loadWorkPageStars().map((star) => star.itemId)).toEqual(["cpd-export", "log"]);
  });

  it("shows it again on the new work mode", () => {
    seed([exportStar, logStar]);
    const { result } = renderHook(() => useFavouritesShelf(), { wrapper: inLaunch(fresh) });
    expect(result.current.items.map((item) => item.workKey)).toEqual(["cpd:cpd-export", "cpd:log"]);
  });
});

describe("the Add a work page sheet", () => {
  function rowSubs(launch: WorkModeLaunch): string[] {
    render(<AddWorkPageSheet open onClose={() => {}} />, { wrapper: inLaunch(launch) });
    return screen.getAllByTestId("add-work-page-row").map((row) => row.textContent ?? "");
  }

  it("offers no new-only page on the classic work mode", () => {
    const rows = rowSubs(classic);
    expect(rows.some((row) => row.includes("CSV and printable"))).toBe(false);
    // Needs you is the classic work mode's own page.
    expect(rows.some((row) => row.startsWith("Needs you"))).toBe(true);
  });

  it("offers no page behind a closed gate on the new work mode", () => {
    const rows = rowSubs(fresh);
    expect(rows.some((row) => row.includes("CSV and printable"))).toBe(true);
    // Classic only, and organisers only (no teaching role is known here).
    expect(rows.some((row) => row.startsWith("Needs you"))).toBe(false);
    expect(rows.some((row) => row.includes("Run the program"))).toBe(false);
  });
});

describe("the page heart saves only the page it is on", () => {
  const cpd = WORK_AREAS.cpd;
  const log = workFrameItemById(cpd, "log")!;

  it("owns its own address, not the pages it covers through paths", () => {
    expect(workFrameItemOwnsAddress(log, "/cme/log", "")).toBe(true);
    expect(workFrameItemOwnsAddress(log, "/cme/routines", "")).toBe(false);
    expect(workFrameItemOwnsAddress(log, "/cme/new", "")).toBe(false);
    expect(workFrameItemOwnsAddress(log, "/cme/log/entry-1", "")).toBe(false);
  });

  it("needs the query an item's link carries", () => {
    const onShift = workFrameItemById(WORK_AREAS.day, "my-day-work")!;
    expect(workFrameItemOwnsAddress(onShift, "/my-day", "?page=work")).toBe(true);
    expect(workFrameItemOwnsAddress(onShift, "/my-day", "")).toBe(false);
  });

  it.each(["/cme/routines", "/cme/new", "/cme/log/entry-1"])("draws no heart for Log on %s", (pathname) => {
    nav.pathname = pathname;
    render(<ModeBand modeId="cme">page</ModeBand>);
    expect(screen.getByTestId("mode-band")).toBeTruthy();
    expect(screen.queryByTestId("work-page-favourite-button")).toBeNull();
  });

  it("draws the heart on Log itself", () => {
    nav.pathname = "/cme/log";
    render(<ModeBand modeId="cme">page</ModeBand>);
    expect(screen.getByRole("button", { name: "Add Log to Favourites" })).toBeTruthy();
  });
});
