"use client";

import { useSignedIn } from "@/components/mode-kit/use-signed-out-sample";
import { useHeldWorkRoles } from "@/components/work-frame/use-held-work-roles";
import { isAdministratorUser } from "@/lib/authorization";
import { useExampleData } from "@/lib/example-data/store";
import { useAuthSession } from "@/lib/supabase/client";
import { useOpenShiftsIsPoster } from "@/lib/teaching/page-visibility";

/*
 * Who sees the organiser's Courses page. Kept apart from `use-bookings.ts` because the work menu's
 * gate check runs on every work page, and it must not pull the bookings rules and example data
 * into every page's bundle.
 */

/**
 * Who may post and manage courses: the site administrator, a roster team manager for their team, or
 * Medical Workforce or the DCT for their hospital's linked teams (`courses.manage` in work-roles).
 */
export function canManageCourses(input: {
  readonly administrator: boolean;
  readonly teamManager: boolean;
  readonly heldRoles?: readonly string[];
}): boolean {
  return (
    input.administrator || input.teamManager || (input.heldRoles ?? []).some((role) => COURSE_HOSPITAL_ROLES.has(role))
  );
}

const COURSE_HOSPITAL_ROLES: ReadonlySet<string> = new Set(["workforce", "dct"]);

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
  const heldRoles = useHeldWorkRoles(signedIn);
  const { active } = useExampleData("admin");
  const organiser =
    signedIn &&
    canManageCourses({
      administrator: isAdministratorUser(session),
      teamManager: poster === true,
      heldRoles,
    });
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
