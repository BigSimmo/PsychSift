"use client";

import { useCallback, useSyncExternalStore } from "react";

import { useSignedIn } from "@/components/mode-kit/use-signed-out-sample";
import { useNewWorkMode, useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useExampleData } from "@/lib/example-data/store";
import { readOnCallEditorFlag, subscribeOnCallEditorFlag } from "@/lib/on-call/device-state-keys";
import { useOpenShiftsIsPoster, useTeachingRoles } from "@/lib/teaching/page-visibility";
import type { WorkFrameGate, WorkFrameItem } from "@/lib/work-frame/areas";
import { useWorkRoles } from "@/lib/work-roles/use-work-roles";

const HOSPITAL_ROLES = new Set(["administrator", "workforce", "dct"]);

/** Whether this reader may see an item with this gate, as the work frame's tabs and More sheet decide it. */
export function useWorkFrameGateOpen(): (gate: WorkFrameGate | undefined) => boolean {
  const roles = useTeachingRoles();
  const poster = useOpenShiftsIsPoster();
  const editor = useSyncExternalStore(subscribeOnCallEditorFlag, readOnCallEditorFlag, () => false);
  const newWorkMode = useNewWorkMode();
  const signedIn = useSignedIn();
  const workRoles = useWorkRoles(signedIn);
  const examplesOn = useExampleData().mode === "on";
  const hospitalRole = examplesOn || !signedIn || workRoles.roles.some((role) => HOSPITAL_ROLES.has(role));
  return useCallback(
    (gate) => {
      if (!gate) return true;
      if (gate === "teaching-organiser") return roles.some((role) => role === "organiser" || role === "admin");
      if (gate === "open-shifts-poster") return poster === true;
      if (gate === "new-work-mode") return newWorkMode;
      if (gate === "classic-work-mode") return !newWorkMode;
      if (gate === "signed-out") return !signedIn;
      if (gate === "hospital-role") return hospitalRole;
      return editor;
    },
    [roles, poster, editor, newWorkMode, signedIn, hospitalRole],
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
