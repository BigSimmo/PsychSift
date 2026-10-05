"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { ModeBandStatusValue } from "@/components/mode-band/mode-band";
import { perthTimeOf } from "@/lib/roster/shifts/perth-time";

import { ListSkeleton } from "./open-shifts-ui";
import type { OpenShiftsState } from "./use-open-shifts";

/**
 * The states every Open shifts page shares, so a failed read never reads as
 * "nothing open" and the band's status line says the same thing on every tab.
 */

export function openShiftsStatus(state: OpenShiftsState): ModeBandStatusValue | null {
  if (state.sample === "signed-out") return { kind: "sample" };
  if (state.sample === "release-held") {
    return { kind: "text", text: "Made-up example records · team rosters aren't open to real staff yet", info: true };
  }
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
    <div className="px-3 py-8">
      <h2 className="text-base font-semibold text-[color:var(--text-heading)]">No teams yet</h2>
      <p className="mt-1 text-sm text-[color:var(--text-muted)]">
        Open shifts come from the Roster teams you belong to. When your team&apos;s roster manager posts a shift, it
        appears here.
      </p>
      <Link
        href="/roster/join"
        className="mt-3 inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--mode-identity)]"
      >
        Join a Roster team
      </Link>
    </div>
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
    <div className="px-3 py-8">
      <h2 className="text-base font-semibold text-[color:var(--text-heading)]">{`${what} couldn't be reached`}</h2>
      <p className="mt-1 text-sm text-[color:var(--text-muted)]">
        {`Nothing is shown because the list didn't load. It doesn't mean there are no shifts.${message ? ` ${message}` : ""}`}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:outline-[color:var(--command)]"
      >
        Try again
      </button>
    </div>
  );
}

/** Renders the no-team, failed and loading states, or the page once its list is ready. */
export function OpenShiftsGate({ state, children }: { state: OpenShiftsState; children: ReactNode }) {
  if (state.status === "no-team") return <NoTeam />;
  if (state.status === "error") return <LoadFailed message={state.message} onRetry={state.reload} />;
  if (state.status === "loading") return <ListSkeleton rows={4} />;
  return <>{children}</>;
}
