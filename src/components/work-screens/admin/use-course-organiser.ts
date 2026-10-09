"use client";

import { useSignedIn } from "@/components/mode-kit/use-signed-out-sample";
import { isAdministratorUser } from "@/lib/authorization";
import { useExampleData } from "@/lib/example-data/store";
import { useAuthSession } from "@/lib/supabase/client";
import { useOpenShiftsIsPoster } from "@/lib/teaching/page-visibility";

/*
 * Who sees the organiser's Courses page. Kept apart from `use-bookings.ts` because the work menu's
 * gate check runs on every work page, and it must not pull the bookings rules and example data
 * into every page's bundle.
 */

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
