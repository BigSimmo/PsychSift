"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useAuthIfAvailable } from "@/lib/example-data/store";
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

/** `account` is the signed-in account the answer was read for. */
type Snapshot = {
  readonly status: WorkRolesStatus;
  readonly grants: readonly WorkRoleGrant[];
  readonly account?: string | null;
};

const LOADING: Snapshot = { status: "loading", grants: [] };
const SIGNED_OUT: Snapshot = { status: "signed-out", grants: [] };
let snapshot: Snapshot = LOADING;
let request: Promise<void> | null = null;
/** Bumped on every reset, so an answer for the account before a sign-in or sign-out is dropped. */
let generation = 0;
const listeners = new Set<() => void>();
/** The account the roles were read for. Undefined until the first read, null when signed out. */
let readFor: string | null | undefined;

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function load(): Promise<void> {
  if (request) return request;
  const started = generation;
  const account = readFor;
  const settle = (next: Snapshot) => {
    if (started === generation) publish({ ...next, account });
  };
  request = Promise.resolve()
    .then(() => fetch("/api/work/roles", { cache: "no-store", credentials: "same-origin" }))
    .then(async (response) => {
      if (response.status === 401) return settle({ status: "signed-out", grants: [] });
      if (!response.ok) return settle({ status: "unavailable", grants: [] });
      const body = (await response.json()) as { grants?: unknown };
      settle({ status: "ready", grants: Array.isArray(body.grants) ? (body.grants as WorkRoleGrant[]) : [] });
    })
    .catch(() => settle({ status: "unavailable", grants: [] }));
  return request;
}

/** Forget the roles, for sign-in, sign-out, or after a role is given or removed. */
export function resetWorkRoles(): void {
  generation += 1;
  request = null;
  publish(LOADING);
  // A screen already showing "loading" won't re-run its effect, so start the fresh read here.
  if (listeners.size) void load();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const readSnapshot = () => snapshot;
const serverSnapshot = () => LOADING;

/**
 * The roles held, for the work frame's menu, which loads this module only when
 * it is needed so the role rules don't weigh on every page. Calls `listener`
 * now and on every change, and returns the unsubscribe. `userId` is the
 * signed-in account: a different one forgets the last one's roles first.
 */
export function watchHeldWorkRoles(userId: string, listener: (roles: readonly WorkRole[]) => void): () => void {
  if (readFor !== undefined && readFor !== userId) {
    readFor = userId;
    resetWorkRoles();
  }
  readFor = userId;
  const notify = () => listener(snapshot.status === "ready" ? heldWorkRoles(snapshot.grants) : []);
  const unsubscribe = subscribe(notify);
  notify();
  if (snapshot.status === "loading") void load();
  return unsubscribe;
}

/**
 * Signed out: forget the account the roles were read for, so signing back in, even as the same
 * account, reads them again and a role removed in between is not shown.
 */
export function forgetWorkRolesAccount(): void {
  if (!readFor) return;
  readFor = null;
  resetWorkRoles();
}

export type WorkRolesView = {
  readonly status: WorkRolesStatus;
  readonly grants: readonly WorkRoleGrant[];
  readonly roles: readonly WorkRole[];
  /** False while loading, signed out or unavailable, so nothing shows until the answer is known. */
  readonly can: (capability: WorkCapability, scope: WorkScope) => boolean;
};

/** Pass `enabled: false` (for example while signed out) to skip the read. */
export function useWorkRoles(enabled = true): WorkRolesView {
  const auth = useAuthIfAvailable();
  const userId = auth?.session?.user?.id ?? null;
  const current = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);
  useEffect(() => {
    // Another account signed in or out on this page: forget the last one's roles first, even
    // while this caller is switched off, so no screen keeps showing them.
    if (readFor !== undefined && readFor !== userId) {
      readFor = userId;
      resetWorkRoles();
      return;
    }
    if (!enabled) return;
    readFor = userId;
    if (current.status === "loading") void load();
  }, [enabled, userId, current.status]);
  // Switched off (signed out): no roles, whatever an earlier account left behind. An answer read
  // for another account reads as loading until the effect above forgets it.
  const view = !enabled ? SIGNED_OUT : current.status !== "loading" && current.account !== userId ? LOADING : current;
  const check = useCallback(
    (capability: WorkCapability, scope: WorkScope) =>
      view.status === "ready" && decideWorkCapability(view.grants, capability, scope),
    [view],
  );
  return { status: view.status, grants: view.grants, roles: heldWorkRoles(view.grants), can: check };
}
