"use client";

import type { ReactNode } from "react";

import type { ModeBandStatusValue } from "@/components/mode-band/mode-band";
import { WorkButton } from "@/components/mode-kit/work";
import { WorkStateNotice } from "@/components/mode-kit/work-state";
import { perthTimeOf } from "@/lib/roster/shifts/perth-time";

import { ListSkeleton } from "./open-shifts-ui";
import type { OpenShiftsState } from "./use-open-shifts";

/**
 * The states every Open shifts page shares, so a failed read never reads as
 * "nothing open" and the band's status line says the same thing on every tab.
 */

export function openShiftsStatus(state: OpenShiftsState): ModeBandStatusValue | null {
  // The example data banner carries the "made up" wording; the status line only hides counts.
  if (state.sample === "example") return { kind: "sample" };
  if (state.sample === "release-held") return { kind: "sample" };
  if (state.offline) return { kind: "offline" };
  if (state.refreshFailed && state.readAt) {
    return { kind: "failed", text: `Couldn't refresh · showing the list from ${perthTimeOf(state.readAt)}` };
  }
  if (state.status === "loading") return { kind: "loading" };
  if (state.status === "error") return { kind: "failed", text: "Open shifts couldn't be reached" };
  if (state.failedTeams.length > 0) return { kind: "failed", text: `Couldn't read ${state.failedTeams.join(", ")}` };
  if (state.readAt) return { kind: "text", text: `Shift list updated ${perthTimeOf(state.readAt)}` };
  return null;
}

export function NoTeam() {
  return (
    <WorkStateNotice
      kind="no-team"
      title="No teams yet"
      body="Open shifts come from the Roster teams you belong to. When your team's roster manager posts a shift, it appears here."
      action={<WorkButton href="/roster/join">Join a Roster team</WorkButton>}
    />
  );
}

export function LoadFailed({
  message,
  onRetry,
  what = "Open shifts",
}: {
  message: string | null;
  onRetry: () => void;
  what?: string;
}) {
  return (
    <WorkStateNotice
      kind="error"
      title={`${what} couldn't be reached`}
      body={`Nothing is shown because the list didn't load. It doesn't mean there are no shifts.${message ? ` ${message}` : ""}`}
      onRetry={onRetry}
    />
  );
}

/** Renders the no-team, failed and loading states, or the page once its list is ready. */
export function OpenShiftsGate({ state, children }: { state: OpenShiftsState; children: ReactNode }) {
  if (state.status === "no-team") return <NoTeam />;
  if (state.status === "error") return <LoadFailed message={state.message} onRetry={state.reload} />;
  if (state.status === "loading") return <ListSkeleton rows={4} />;
  return <>{children}</>;
}
