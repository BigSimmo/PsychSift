"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";

import type { Instant } from "@/components/ward-management/ward-clock";
import { elapsedMinutesSinceMount, wallClockNow } from "@/components/ward-management/ward-clock";
import type { WardFlowEvent } from "@/components/ward-management/ward-flow-events";
import { seedWardFlowState, wardFlowReducer } from "@/components/ward-management/ward-flow-reducer";
import type { Movement, Rejection, Unit } from "@/components/ward-management/ward-model";
import { NOW_ANCHOR } from "@/components/ward-management/ward-sites";

/**
 * The screens never see the raw reducer state or the clock's internal offsets — they see the
 * three collections plus a single resolved `now`, and the one way to raise an event.
 *
 * Task 12: `focusMovementId` is the one piece of UI-only state this context carries alongside
 * the reducer's own — "which patient is currently in view", set only by the coordinator
 * screen's own movement selection (`coordinator-screen.tsx`'s `selectMovement`). It exists here,
 * shared, rather than as `CoordinatorScreen`'s own local state, because `WardRoleSwitcher`
 * renders on every ward-management route (inside `ClinicalRail`) and needs to answer "where
 * does this patient's Ward/ED role live" regardless of which screen it is currently rendered
 * on — a route change swaps out the page under this shared layout, which would otherwise reset
 * a screen-local selection back to nothing on every hop. It is never read by the reducer and
 * never dispatched as an event: it is display/navigation state only, the same category as
 * `selectedUnitId`/`selectedEdId` already are on the coordinator screen, just lifted one level
 * because it now has more than one reader.
 */
type WardFlowContextValue = {
  movements: Movement[];
  units: Unit[];
  rejections: Rejection[];
  now: Instant;
  dispatch: Dispatch<WardFlowEvent>;
  focusMovementId: string | undefined;
  setFocusMovementId: Dispatch<SetStateAction<string | undefined>>;
};

const WardFlowContext = createContext<WardFlowContextValue | null>(null);

type WardFlowProviderProps = {
  children: ReactNode;
  /**
   * Pins the clock at this instant and stops it from ticking. Tests and any deterministic
   * render (screenshots, contract walks) pass this; the live app omits it so the clock reads
   * the wall clock once at mount and then advances only via the 30s tick interval, never by
   * re-reading the wall clock on every render.
   */
  initialNow?: Instant;
};

export function WardFlowProvider({ children, initialNow }: WardFlowProviderProps) {
  const [state, dispatch] = useReducer(wardFlowReducer, undefined, seedWardFlowState);

  // `wallClockNow()` — the only wall-clock read this component is allowed to make (see
  // ward-clock.ts) — only ever returns a minute-of-day (0–1439), so two readings on their own
  // can never carry more than one day's worth of information: `elapsedMinutesSinceMount` can
  // correctly unwrap a SINGLE midnight rollover between two readings, but a dashboard left
  // mounted for exactly 24h (or any multiple of it) reads the same minute-of-day again, so a
  // plain two-reading comparison against the ORIGINAL mount instant goes back to `raw === 0`
  // and silently resets elapsed time to zero instead of continuing to grow — moving every
  // deadline, wait and expired hold on every screen backward by up to a day. Fixed by never
  // comparing against the original mount instant again: each 30s tick folds its own delta
  // (never more than 30s + scheduling jitter, so always safely inside one midnight rollover)
  // into `elapsedBefore`, an accumulator that only ever grows — so the total is correct no
  // matter how many midnights the session spans, not just the first one.
  const [clockCheckpoint, setClockCheckpoint] = useState<{ reading: Instant; elapsedBefore: number }>(() => ({
    reading: initialNow ?? wallClockNow(),
    elapsedBefore: 0,
  }));

  useEffect(() => {
    if (initialNow !== undefined) return; // pinned: never tick in a test
    const id = setInterval(() => {
      setClockCheckpoint((previous) => {
        const reading = wallClockNow();
        return { reading, elapsedBefore: previous.elapsedBefore + elapsedMinutesSinceMount(previous.reading, reading) };
      });
    }, 30_000);
    return () => clearInterval(id);
  }, [initialNow]);

  // Recomputed from the live wall clock on every unpinned render (not only on a tick, so a
  // missed/delayed timer tick still reports the true elapsed minutes rather than a fixed
  // 30s-per-tick approximation) — but layered on top of the last checkpoint's accumulated
  // total rather than the original mount instant, which is what keeps this correct beyond one
  // day. A pinned `initialNow` (tests, deterministic renders) never touches the wall clock.
  const elapsed =
    initialNow !== undefined
      ? 0
      : clockCheckpoint.elapsedBefore + elapsedMinutesSinceMount(clockCheckpoint.reading, wallClockNow());
  const now = NOW_ANCHOR + elapsed + state.clockOffsetMinutes;

  const [focusMovementId, setFocusMovementId] = useState<string | undefined>(undefined);

  const value = useMemo<WardFlowContextValue>(
    () => ({
      movements: state.movements,
      units: state.units,
      rejections: state.rejections,
      now,
      dispatch,
      focusMovementId,
      setFocusMovementId,
    }),
    [state.movements, state.units, state.rejections, now, dispatch, focusMovementId],
  );

  return <WardFlowContext.Provider value={value}>{children}</WardFlowContext.Provider>;
}

/** Conservative failure: a screen rendered outside the provider must fail loudly, never fall
 * back to a default empty world that would silently read as "no patients tonight". */
export function useWardFlow(): WardFlowContextValue {
  const context = useContext(WardFlowContext);
  if (!context) throw new Error("useWardFlow must be used within WardFlowProvider.");
  return context;
}
