"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  decideWorkCapability,
  heldWorkRoles,
  type WorkCapability,
  type WorkRole,
  type WorkRoleGrant,
  type WorkScope,
} from "@/lib/work-roles/model";

/**
 * The signed-in person's hospital-side roles, for choosing what a screen shows.
 *
 * This is never a permission. Every action is checked again on the server with
 * `can()` from `@/lib/work-roles/server`. Kept in memory only (nothing is
 * stored on the device), read once per page load and shared by every caller.
 */

export type WorkRolesStatus = "loading" | "ready" | "signed-out" | "unavailable";

type Snapshot = { readonly status: WorkRolesStatus; readonly grants: readonly WorkRoleGrant[] };

const LOADING: Snapshot = { status: "loading", grants: [] };
let snapshot: Snapshot = LOADING;
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function load(): Promise<void> {
  request ??= fetch("/api/work/roles", { cache: "no-store", credentials: "same-origin" })
    .then(async (response) => {
      if (response.status === 401) return publish({ status: "signed-out", grants: [] });
      if (!response.ok) return publish({ status: "unavailable", grants: [] });
      const body = (await response.json()) as { grants?: unknown };
      publish({ status: "ready", grants: Array.isArray(body.grants) ? (body.grants as WorkRoleGrant[]) : [] });
    })
    .catch(() => publish({ status: "unavailable", grants: [] }));
  return request;
}

/** Forget the roles, for sign-in, sign-out, or after a role is given or removed. */
export function resetWorkRoles(): void {
  request = null;
  publish(LOADING);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const readSnapshot = () => snapshot;
const serverSnapshot = () => LOADING;

export type WorkRolesView = {
  readonly status: WorkRolesStatus;
  readonly grants: readonly WorkRoleGrant[];
  readonly roles: readonly WorkRole[];
  /** False while loading, signed out or unavailable, so nothing shows until the answer is known. */
  readonly can: (capability: WorkCapability, scope: WorkScope) => boolean;
};

export function useWorkRoles(): WorkRolesView {
  const current = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);
  useEffect(() => {
    if (current.status === "loading") void load();
  }, [current.status]);
  const check = useCallback(
    (capability: WorkCapability, scope: WorkScope) =>
      current.status === "ready" && decideWorkCapability(current.grants, capability, scope),
    [current],
  );
  return { status: current.status, grants: current.grants, roles: heldWorkRoles(current.grants), can: check };
}
