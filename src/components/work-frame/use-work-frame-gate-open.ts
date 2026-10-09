"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useLivePreview } from "@/components/live-version/live-version-provider";
import { useSignedIn } from "@/components/mode-kit/use-signed-out-sample";
import { useCourseOrganiser } from "@/components/work-screens/admin/use-course-organiser";
import { useNewWorkMode, useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useAuthIfAvailable, useExampleData } from "@/lib/example-data/store";
import { readOnCallEditorFlag, subscribeOnCallEditorFlag } from "@/lib/on-call/device-state-keys";
import { useOpenShiftsIsPoster, useTeachingRoles } from "@/lib/teaching/page-visibility";
import type { WorkFrameGate, WorkFrameItem } from "@/lib/work-frame/areas";

const HOSPITAL_ROLES = new Set(["administrator", "workforce", "dct"]);
/** The Hospital screen also has a section for supervisors and roster managers. */
const HOSPITAL_HUB_ROLES = new Set([...HOSPITAL_ROLES, "supervisor", "manager"]);

/**
 * The signed-in reader's hospital-side roles, for the menu only. The roles
 * module loads on demand: imported here directly, it sat in every page's
 * first download and made the shared chunks split worse (about 145 KiB more
 * across the app). Signed out, or until the answer is in, no roles.
 */
function useHeldWorkRoles(signedIn: boolean): readonly string[] {
  const userId = useAuthIfAvailable()?.session?.user?.id ?? null;
  const [held, setHeld] = useState<{ readonly userId: string; readonly roles: readonly string[] } | null>(null);
  useEffect(() => {
    if (!signedIn || !userId) return;
    let stop: (() => void) | null = null;
    let live = true;
    void import("@/lib/work-roles/use-work-roles").then(({ watchHeldWorkRoles }) => {
      if (live) stop = watchHeldWorkRoles(userId, (roles) => setHeld({ userId, roles }));
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [signedIn, userId]);
  return signedIn && held && held.userId === userId ? held.roles : NO_ROLES;
}

const NO_ROLES: readonly string[] = [];

/** Whether this reader may see an item with this gate, as the work frame's tabs and More sheet decide it. */
export function useWorkFrameGateOpen(): (gate: WorkFrameGate | undefined) => boolean {
  const roles = useTeachingRoles();
  const poster = useOpenShiftsIsPoster();
  const editor = useSyncExternalStore(subscribeOnCallEditorFlag, readOnCallEditorFlag, () => false);
  const newWorkMode = useNewWorkMode();
  const signedIn = useSignedIn();
  const heldRoles = useHeldWorkRoles(signedIn);
  const examplesOn = useExampleData().mode === "on";
  const hospitalRole = examplesOn || !signedIn || heldRoles.some((role) => HOSPITAL_ROLES.has(role));
  const hospitalHub = hospitalRole || heldRoles.some((role) => HOSPITAL_HUB_ROLES.has(role));
  const bookings = useLivePreview("course-bookings");
  const courses = useCourseOrganiser();
  const courseOrganiser = bookings && (courses.organiser || courses.sample);
  const rotations = useLivePreview("rotation-preferences");
  return useCallback(
    (gate) => {
      if (!gate) return true;
      if (gate === "course-bookings") return bookings;
      if (gate === "course-organiser") return courseOrganiser;
      if (gate === "teaching-organiser") return roles.some((role) => role === "organiser" || role === "admin");
      if (gate === "open-shifts-poster") return poster === true;
      if (gate === "new-work-mode") return newWorkMode;
      if (gate === "classic-work-mode") return !newWorkMode;
      if (gate === "signed-out") return !signedIn;
      if (gate === "hospital-role") return hospitalRole;
      if (gate === "hospital-hub") return hospitalHub;
      if (gate === "rotation-preferences") return rotations;
      if (gate === "rotation-preferences-manager") return rotations && poster === true;
      return editor;
    },
    [roles, poster, editor, newWorkMode, signedIn, bookings, courseOrganiser, hospitalRole, hospitalHub, rotations],
  );
}

/**
 * Whether this reader can use a work page: its gate is open and, for a link,
 * the launch switch serves the route (a new-only screen 404s on the classic
 * work mode). For lists outside the frame, such as the "Add a work page" sheet.
 */
export function useWorkFrameItemVisible(): (item: WorkFrameItem) => boolean {
  const gateOpen = useWorkFrameGateOpen();
  const routeVisible = useWorkModeRouteVisible();
  return useCallback(
    (item) => gateOpen(item.gate) && (!item.href || routeVisible(item.href)),
    [gateOpen, routeVisible],
  );
}
