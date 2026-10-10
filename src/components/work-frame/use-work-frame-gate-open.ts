"use client";

import { useCallback, useSyncExternalStore } from "react";

import { useLivePreview } from "@/components/live-version/live-version-provider";
import { useHeldWorkRoles } from "@/components/work-frame/use-held-work-roles";
import { useSignedIn } from "@/components/mode-kit/use-signed-out-sample";
import { useCourseOrganiser } from "@/components/work-screens/admin/use-course-organiser";
import { useNewWorkMode, useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useExampleData } from "@/lib/example-data/store";
import { readOnCallEditorFlag, subscribeOnCallEditorFlag } from "@/lib/on-call/device-state-keys";
import { useOpenShiftsIsPoster, useTeachingRoles } from "@/lib/teaching/page-visibility";
import type { WorkFrameGate, WorkFrameItem } from "@/lib/work-frame/areas";

const HOSPITAL_ROLES = new Set(["administrator", "workforce", "dct"]);
/** The Hospital screen also has a section for supervisors and roster managers. */
const HOSPITAL_HUB_ROLES = new Set([...HOSPITAL_ROLES, "supervisor", "manager"]);

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
  const mainCalendar = useLivePreview("main-calendar");
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
      if (gate === "main-calendar") return mainCalendar;
      return editor;
    },
    [
      roles,
      poster,
      editor,
      newWorkMode,
      signedIn,
      hospitalRole,
      hospitalHub,
      bookings,
      courseOrganiser,
      rotations,
      mainCalendar,
    ],
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
