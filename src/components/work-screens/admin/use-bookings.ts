"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useSignedIn } from "@/components/mode-kit/use-signed-out-sample";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { isAdministratorUser } from "@/lib/authorization";
import { useExampleData } from "@/lib/example-data/store";
import { useAuthSession } from "@/lib/supabase/client";
import { useOpenShiftsIsPoster } from "@/lib/teaching/page-visibility";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { BookingsState } from "@/lib/work-screens/admin/bookings";
import {
  readBookingsSnapshot,
  resetBookings,
  seedBookings,
  serverBookingsSnapshot,
  setBookings,
  subscribeBookings,
} from "@/lib/work-screens/admin/bookings-store";
import { zonedToday } from "@/lib/work-time/format";

export type BookingsPageState =
  /** Example data is on and still loading. */
  | { readonly status: "loading" }
  /** The example did not load (a file not downloaded offline). */
  | { readonly status: "error"; readonly retry: () => void }
  /** Examples are off: the saved version is not set up yet, so there is nothing to book. */
  | { readonly status: "not-set-up" }
  | { readonly status: "ready"; readonly state: BookingsState };

export interface UseBookings {
  readonly page: BookingsPageState;
  /** True while the shown courses are invented examples. */
  readonly examples: boolean;
  readonly online: boolean;
  readonly today: string;
  readonly zone: string;
  readonly update: (next: BookingsState) => void;
}

/**
 * The bookings this tab shows. With Admin's example data on, the example is
 * seeded into page memory once and every change stays while the reader moves
 * between Bookings, a course and Courses. With it off, the saved version is
 * not set up yet, which the pages say plainly rather than showing an empty list
 * as if nothing was posted.
 */
export function useBookings(): UseBookings {
  const { active } = useExampleData("admin");
  const { zone } = useWorkTimeZone();
  const online = useOnlineStatus();
  const read = useRegistryDataset("admin.bookings", active);
  const snapshot = useSyncExternalStore(subscribeBookings, readBookingsSnapshot, serverBookingsSnapshot);
  const today = zonedToday(zone);
  const source = `example:${zone}:${today}`;

  useEffect(() => {
    if (!active) resetBookings();
    else if (read.status === "ready") seedBookings(source, read.data);
  }, [active, read, source]);

  const update = useCallback((next: BookingsState) => setBookings(next), []);

  let page: BookingsPageState;
  if (!active) page = { status: "not-set-up" };
  else if (read.status === "error") page = { status: "error", retry: read.retry };
  else if (snapshot.source !== source) page = { status: "loading" };
  else page = { status: "ready", state: snapshot.state };

  return { page, examples: active, online, today, zone, update };
}

/** Who may post and manage courses: the site administrator, or a roster team manager for their team. */
export function canManageCourses(input: { readonly administrator: boolean; readonly teamManager: boolean }): boolean {
  return input.administrator || input.teamManager;
}

/**
 * Whether this reader sees the organiser's Courses page. Organisers do; with
 * Admin's example data on, everyone does, as the organiser's side of the
 * example, labelled as such. The server checks the real permission when the
 * saved version lands; this only decides what the menu shows.
 */
export function useCourseOrganiser(): { readonly organiser: boolean; readonly sample: boolean } {
  const signedIn = useSignedIn();
  const session = useSessionIfAvailable();
  const poster = useOpenShiftsIsPoster();
  const { active } = useExampleData("admin");
  const organiser =
    signedIn && canManageCourses({ administrator: isAdministratorUser(session), teamManager: poster === true });
  return { organiser, sample: !organiser && active };
}

function useSessionIfAvailable() {
  try {
    return useAuthSession().session?.user ?? null;
  } catch (error) {
    if (error instanceof Error && error.message === "useAuthSession must be used within AuthProvider.") return null;
    throw error;
  }
}
