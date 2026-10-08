"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { ROSTER_ROTATIONS_EXAMPLE_STORAGE_KEY, subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { useExampleData } from "@/lib/example-data/store";
import type { ManagedRound, MyRound, PlacementMove, RoundSetup } from "@/lib/roster/rotations/model";
import {
  closeRound,
  createManagedRound,
  editRoundSetup,
  movePlacement,
  myRoundView,
  openRound,
  publishRound,
  RotationRuleError,
  runAllocation,
  savePreference,
  setPlacementLock,
  withdrawPreference,
} from "@/lib/roster/rotations/operations";

/**
 * The one data hook for rotation preferences. Screens never fetch or store
 * rounds themselves.
 *
 * With Roster's example data on, rounds live on this device only, seeded from
 * the example registry, and every action works (the reader is a doctor in the
 * rounds and their administrator). Otherwise the hook reads the team's rounds
 * from `/api/roster/rotations`. Until the shared tables exist the server answers
 * "not available yet", and the screens say so and offer the example.
 */

export type RotationsStatus = "loading" | "ready" | "error" | "signed-out" | "unavailable";

export type RotationActionResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export type RotationActions = {
  savePreference(roundId: string, ranking: readonly string[], submit: boolean): Promise<RotationActionResult>;
  withdrawPreference(roundId: string): Promise<RotationActionResult>;
  createRound(setup: RoundSetup): Promise<RotationActionResult & { readonly roundId?: string }>;
  editRound(roundId: string, setup: RoundSetup): Promise<RotationActionResult>;
  openRound(roundId: string): Promise<RotationActionResult>;
  closeRound(roundId: string): Promise<RotationActionResult>;
  runAllocation(roundId: string): Promise<RotationActionResult>;
  movePlacement(roundId: string, move: PlacementMove): Promise<RotationActionResult>;
  setLock(roundId: string, personId: string, termId: string, lock: boolean): Promise<RotationActionResult>;
  publish(roundId: string): Promise<RotationActionResult>;
  deleteDraft(roundId: string): Promise<RotationActionResult>;
  /** Example only: put the example rounds back as they started. */
  resetExample(): void;
};

export type RotationsRead = {
  readonly status: RotationsStatus;
  readonly source: "example" | "live";
  /** Rounds the reader is in, newest first. */
  readonly mine: readonly MyRound[];
  /** Rounds the reader runs, newest first. Empty unless they can manage. */
  readonly managed: readonly ManagedRound[];
  readonly canManage: boolean;
  /** For the new-round form: the team the reader manages. */
  readonly team: { readonly serviceId: string; readonly name: string } | null;
  readonly actions: RotationActions;
  readonly retry: () => void;
};

// ---------------------------------------------------------------- example store (this device)

type ExampleState = { readonly selfId: string; readonly rounds: readonly ManagedRound[] };

const listeners = new Set<() => void>();
let memory: ExampleState | null = null;
let cachedRaw: string | null | undefined;
let cachedState: ExampleState | null = null;

function notify() {
  for (const listener of listeners) listener();
}

subscribeAccountTransition(() => {
  memory = null;
  cachedRaw = undefined;
  cachedState = null;
  try {
    window.localStorage.removeItem(ROSTER_ROTATIONS_EXAMPLE_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing kept there.
  }
  notify();
});

function readExample(): ExampleState | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(ROSTER_ROTATIONS_EXAMPLE_STORAGE_KEY);
  } catch {
    return memory;
  }
  if (raw === null) return memory;
  if (raw === cachedRaw) return cachedState;
  cachedRaw = raw;
  try {
    const parsed = JSON.parse(raw) as ExampleState;
    cachedState = parsed && Array.isArray(parsed.rounds) && typeof parsed.selfId === "string" ? parsed : null;
  } catch {
    cachedState = null;
  }
  return cachedState;
}

function writeExample(state: ExampleState | null) {
  memory = state;
  try {
    if (state === null) window.localStorage.removeItem(ROSTER_ROTATIONS_EXAMPLE_STORAGE_KEY);
    else window.localStorage.setItem(ROSTER_ROTATIONS_EXAMPLE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked or full: the example lasts for this visit, in memory.
  }
  notify();
}

function subscribeExample(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ROSTER_ROTATIONS_EXAMPLE_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function byNewest(a: ManagedRound, b: ManagedRound) {
  return (b.round.terms[0]?.start ?? "").localeCompare(a.round.terms[0]?.start ?? "");
}

function errorMessage(error: unknown): string {
  if (error instanceof RotationRuleError) return error.message;
  return "That did not work. Try again.";
}

// ---------------------------------------------------------------- live (server)

type LivePayload = {
  readonly mine: MyRound[];
  readonly managed: ManagedRound[];
  readonly canManage: boolean;
  readonly team: { serviceId: string; name: string } | null;
};

type LiveRead =
  | { status: "loading" }
  | { status: "ready"; data: LivePayload }
  | { status: "error" | "signed-out" | "unavailable" };

async function postLive(path: string, body: unknown): Promise<RotationActionResult & { roundId?: string }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const json = (await response.json().catch(() => ({}))) as { error?: string; roundId?: string };
    if (!response.ok) return { ok: false, message: json.error ?? "That did not work. Try again." };
    return { ok: true, roundId: json.roundId };
  } catch {
    return { ok: false, message: "You're offline. Try again when you have a connection." };
  }
}

// ---------------------------------------------------------------- hook

export function useRotations(): RotationsRead {
  const example = useExampleData("rost");
  const dataset = useRegistryDataset("roster.rotations", example.active);
  const stored = useSyncExternalStore(subscribeExample, readExample, () => null);

  // Seed the device copy the first time example data is shown.
  useEffect(() => {
    if (example.active && dataset.status === "ready" && stored === null) {
      writeExample({ selfId: dataset.data.selfId, rounds: [...dataset.data.rounds] });
    }
  }, [example.active, dataset, stored]);

  const [live, setLive] = useState<LiveRead>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (example.active) return;
    let current = true;
    setLive({ status: "loading" });
    fetch("/api/roster/rotations", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!current) return;
        if (response.status === 401) return setLive({ status: "signed-out" });
        if (response.status === 503 || response.status === 404) return setLive({ status: "unavailable" });
        if (!response.ok) return setLive({ status: "error" });
        setLive({ status: "ready", data: (await response.json()) as LivePayload });
      })
      .catch(() => current && setLive({ status: "error" }));
    return () => {
      current = false;
    };
  }, [example.active, attempt]);

  const exampleActions = useMemo<RotationActions>(() => {
    const apply = async (roundId: string, change: (round: ManagedRound, now: Date, selfId: string) => ManagedRound) => {
      const state = readExample();
      if (!state) return { ok: false as const, message: "The example is still loading." };
      const target = state.rounds.find((round) => round.round.id === roundId);
      if (!target) return { ok: false as const, message: "That round is no longer here." };
      try {
        const next = change(target, new Date(), state.selfId);
        writeExample({ ...state, rounds: state.rounds.map((round) => (round.round.id === roundId ? next : round)) });
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, message: errorMessage(error) };
      }
    };
    return {
      savePreference: (roundId, ranking, submit) => apply(roundId, (r, now, me) => savePreference(r, me, ranking, submit, now)),
      withdrawPreference: (roundId) => apply(roundId, (r, now, me) => withdrawPreference(r, me, now)),
      async createRound(setup) {
        const state = readExample();
        if (!state) return { ok: false, message: "The example is still loading." };
        try {
          const now = new Date();
          const roundId = `example:round:${now.getTime().toString(36)}`;
          const first = state.rounds[0]?.round;
          const created = createManagedRound(setup, {
            id: roundId,
            serviceId: first?.serviceId ?? "example:rotations:team",
            teamName: first?.teamName ?? "Example registrars",
            adminName: first?.adminName ?? "You",
            now,
          });
          writeExample({ ...state, rounds: [created, ...state.rounds] });
          return { ok: true, roundId };
        } catch (error) {
          return { ok: false, message: errorMessage(error) };
        }
      },
      editRound: (roundId, setup) => apply(roundId, (r) => editRoundSetup(r, setup)),
      openRound: (roundId) => apply(roundId, (r, now) => openRound(r, now)),
      closeRound: (roundId) => apply(roundId, (r) => closeRound(r)),
      runAllocation: (roundId) => apply(roundId, (r, now) => runAllocation(r, now)),
      movePlacement: (roundId, move) => apply(roundId, (r, now) => movePlacement(r, move, now)),
      setLock: (roundId, personId, termId, lock) => apply(roundId, (r) => setPlacementLock(r, personId, termId, lock)),
      publish: (roundId) => apply(roundId, (r, now) => publishRound(r, now)),
      async deleteDraft(roundId) {
        const state = readExample();
        if (!state) return { ok: false, message: "The example is still loading." };
        const target = state.rounds.find((round) => round.round.id === roundId);
        if (!target || target.round.status !== "draft") return { ok: false, message: "Only a draft round can be deleted." };
        writeExample({ ...state, rounds: state.rounds.filter((round) => round.round.id !== roundId) });
        return { ok: true };
      },
      resetExample: () => writeExample(null),
    };
  }, []);

  const liveActions = useMemo<RotationActions>(() => {
    const act = async (roundId: string, body: Record<string, unknown>) => {
      const result = await postLive(`/api/roster/rotations/${encodeURIComponent(roundId)}`, body);
      if (result.ok) retry();
      return result;
    };
    return {
      savePreference: (roundId, ranking, submit) => act(roundId, { action: "save-preference", ranking, submit }),
      withdrawPreference: (roundId) => act(roundId, { action: "withdraw-preference" }),
      async createRound(setup) {
        const result = await postLive("/api/roster/rotations", { action: "create", setup });
        if (result.ok) retry();
        return result;
      },
      editRound: (roundId, setup) => act(roundId, { action: "edit", setup }),
      openRound: (roundId) => act(roundId, { action: "open" }),
      closeRound: (roundId) => act(roundId, { action: "close" }),
      runAllocation: (roundId) => act(roundId, { action: "allocate" }),
      movePlacement: (roundId, move) => act(roundId, { action: "move", move }),
      setLock: (roundId, personId, termId, lock) => act(roundId, { action: "lock", personId, termId, lock }),
      publish: (roundId) => act(roundId, { action: "publish" }),
      deleteDraft: (roundId) => act(roundId, { action: "delete" }),
      resetExample: () => undefined,
    };
  }, [retry]);

  if (example.active) {
    if (dataset.status === "error") {
      return { ...EMPTY, status: "error", source: "example", actions: exampleActions, retry: dataset.retry };
    }
    if (!stored) return { ...EMPTY, status: "loading", source: "example", actions: exampleActions, retry };
    const rounds = [...stored.rounds].sort(byNewest);
    const first = rounds[0]?.round;
    return {
      status: "ready",
      source: "example",
      mine: rounds
        .filter((round) => round.round.status !== "draft" && round.round.people.some((p) => p.id === stored.selfId))
        .map((round) => myRoundView(round, stored.selfId)),
      managed: rounds,
      canManage: true,
      team: first ? { serviceId: first.serviceId, name: first.teamName } : null,
      actions: exampleActions,
      retry,
    };
  }

  if (live.status !== "ready") return { ...EMPTY, status: live.status, source: "live", actions: liveActions, retry };
  return {
    status: "ready",
    source: "live",
    mine: live.data.mine,
    managed: [...live.data.managed].sort(byNewest),
    canManage: live.data.canManage,
    team: live.data.team,
    actions: liveActions,
    retry,
  };
}

const EMPTY = { mine: [], managed: [], canManage: false, team: null } as const;
