"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";

import { landingModeForPreference, readAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { kindOf } from "@/components/roster/roster-format";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import {
  LAST_PLACE_STORAGE_KEY,
  coldLandingTarget,
  isColdHomeOpen,
  lastPlaceToRemember,
  readLastPlace,
} from "@/lib/last-place";
import { summariseToday } from "@/lib/roster/today";

/** How long a cold open waits for the roster before going to the last page instead. */
const SHIFT_CHECK_WAIT_MS = 2_500;

function readStoredLastPlace(): string | null {
  try {
    return readLastPlace(window.localStorage.getItem(LAST_PLACE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storeLastPlace(path: string) {
  try {
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, path);
  } catch {
    // Storage blocked (private window): the app simply opens on Clinical as before.
  }
}

/**
 * Read once per document, at the first mount. Module scope rather than a ref, so
 * a remount (React's development double-run, or a layout change) can neither
 * re-read storage after this page was remembered over it nor decide twice.
 */
let boot: { readonly lastPlace: string | null; done: boolean } | null = null;
const bootListeners = new Set<() => void>();

function bootDecision() {
  boot ??= { lastPlace: readStoredLastPlace(), done: !coldHomeOpen() };
  return boot;
}

/** The decision is over (made, or given up): nothing moves the page after this. */
function endDecision() {
  const state = bootDecision();
  if (state.done) return;
  state.done = true;
  for (const listener of bootListeners) listener();
}

function subscribeBoot(listener: () => void) {
  bootListeners.add(listener);
  return () => bootListeners.delete(listener);
}

function bootChecking(): boolean {
  return !bootDecision().done;
}

/** Test seam: forget the per-document decision. */
export function resetLastPlaceForTests() {
  boot = null;
}

/** Browser facts about how this document was opened. */
function coldHomeOpen(): boolean {
  let entryUrl: URL | null = null;
  let navigationType: string | null = null;
  try {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (entry) {
      entryUrl = new URL(entry.name);
      navigationType = entry.type;
    }
  } catch {
    // An older browser without navigation timing: fall back to the current address.
  }
  const url = entryUrl ?? new URL(window.location.href);
  let cameFromApp = false;
  try {
    cameFromApp = document.referrer !== "" && new URL(document.referrer).origin === window.location.origin;
  } catch {
    cameFromApp = false;
  }
  return isColdHomeOpen({
    entry: { pathname: url.pathname, search: url.search, hash: url.hash },
    navigationType,
    cameFromApp,
    landingPreferenceSet: landingModeForPreference(readAppPreferences().landing) !== null,
    standalone:
      (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    historyLength: window.history.length,
  });
}

/**
 * Reads the doctor's own roster once, and reports whether a real shift (not
 * the example roster) is running right now. The same roster read and the same
 * "on now" rule My Day uses for its hero.
 */
function ShiftNowProbe({ onResult }: { readonly onResult: (onShiftNow: boolean) => void }) {
  const roster = useRosterShifts();
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    if (roster.status === "loading" || (roster.status === "ready" && roster.teamLoading)) return;
    reported.current = true;
    if (roster.status !== "ready" || roster.sample || roster.demoMode) {
      onResult(false);
      return;
    }
    const today = summariseToday(
      roster.shifts.map((shift) => ({
        id: shift.id,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        kind: kindOf(shift),
      })),
      new Date(),
    );
    onResult(today.lead.state === "on_now");
  }, [roster.status, roster.teamLoading, roster.sample, roster.demoMode, roster.shifts, onResult]);
  return null;
}

/**
 * Open where the doctor is (site recommendations, 12 Oct 2026, item 1).
 *
 * Remembers the last page used, on this device only and without its query
 * string, and on a cold open of a bare `/` (the installed app's start address,
 * or a typed visit) goes there instead; while a rostered shift is running it
 * opens My Day. Anything else, including every `/?mode=` or `/?q=` link, a
 * reload, Back and in-app navigation, keeps today's behaviour. The move uses
 * `replace`, so Back never returns to a page the doctor did not choose.
 *
 * It gives up the moment the doctor starts using the page (a tap or a key), so
 * a slow roster read can never pull the screen from under them.
 */
export function LastPlace() {
  const pathname = usePathname();
  const router = useRouter();
  const routeVisible = useWorkModeRouteVisible();
  const firstPathname = useRef(pathname);
  // False on the server and through hydration; then true only while a cold open is being decided.
  const checking = useSyncExternalStore(subscribeBoot, bootChecking, () => false);
  const [shiftNow, setShiftNow] = useState<boolean | null>(null);

  const finish = useEffectEvent((onShiftNow: boolean) => {
    const state = bootDecision();
    if (state.done) return;
    endDecision();
    if (window.location.pathname !== "/") return;
    const target = coldLandingTarget({ onShiftNow, lastPlace: state.lastPlace, routeVisible });
    if (target) router.replace(target, { scroll: false });
  });

  // While deciding: stop waiting for the roster after a short while, and give up
  // the moment the doctor starts using the page.
  useEffect(() => {
    if (!checking) return undefined;
    const timer = window.setTimeout(() => finish(false), SHIFT_CHECK_WAIT_MS);
    window.addEventListener("pointerdown", endDecision, { capture: true, once: true });
    window.addEventListener("keydown", endDecision, { capture: true, once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", endDecision, { capture: true });
      window.removeEventListener("keydown", endDecision, { capture: true });
    };
  }, [checking]);

  // Remember each page. The remembered one is read first (bootDecision is read
  // once per document), so the page on screen never replaces it before the
  // decision. A page change before the decision (a tapped link) also ends it.
  useEffect(() => {
    bootDecision();
    if (pathname !== firstPathname.current) endDecision();
    const remembered = lastPlaceToRemember(pathname);
    if (remembered) storeLastPlace(remembered);
  }, [pathname]);

  useEffect(() => {
    if (shiftNow !== null) finish(shiftNow);
  }, [shiftNow]);

  const reportShift = useCallback((onShiftNow: boolean) => setShiftNow(onShiftNow), []);
  return checking ? <ShiftNowProbe onResult={reportShift} /> : null;
}
