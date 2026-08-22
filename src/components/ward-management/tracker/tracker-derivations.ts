/**
 * Task 10: the coordinator's live tracker. Small, pure rendering decisions that are this
 * screen's own — never a duplicate of `transportLeg`'s precedence chain (`ward-derivations.ts`),
 * which already carries full unit coverage. Everything here delegates the "which leg" question
 * to `transportLeg` and only decides two things beyond it: which single stamp on `TransportJob`
 * corresponds to that leg, and how to word "how long since" honestly when no stamp exists.
 */
import { splitDuration, type Instant } from "@/components/ward-management/ward-clock";
import { transportLeg, type TransportLeg } from "@/components/ward-management/ward-derivations";
import type { TransportJob } from "@/components/ward-management/ward-model";

/** `transportLeg`'s five-leg union plus its own out-of-band `"Cancelled"` value — this is the
 * full set of non-absent leg values the tracker can ever render. */
export type TrackerLeg = TransportLeg | "Cancelled";

export type TrackerRowState = {
  leg: TrackerLeg | undefined;
  stampAt: Instant | undefined;
};

/**
 * The tracker's reading of one transport job: which leg it has reached, and the one instant
 * the model actually recorded for that leg.
 *
 * `TransportJob` has no `requestedAt` field at all — the reducer's `HANDOVER_READY` case is
 * the only thing that creates a transport job, and it writes only
 * `{ id, provider, escortRequired }`, no timestamp (`ward-flow-reducer.ts`). So a job sitting
 * at the `"Requested"` leg has genuinely nothing to report: `stampAt` comes back `undefined`
 * for it, never a fabricated instant borrowed from the movement or from `now`.
 *
 * `undefined` transport (or `transportLeg` returning `undefined` for it) means "not a vehicle
 * at all" — the caller is expected to have already filtered those out before rendering a row,
 * but this stays a real narrowing rather than a `!` assertion so a future caller that forgets
 * the filter gets an honest absence back instead of a thrown error or a fabricated leg.
 */
export function trackerRowState(transport: TransportJob | undefined): TrackerRowState {
  const leg = transportLeg(transport);
  if (!transport || leg === undefined) return { leg: undefined, stampAt: undefined };
  switch (leg) {
    case "Cancelled":
      return { leg, stampAt: transport.cancelledAt };
    case "Arrived":
      return { leg, stampAt: transport.arrivedAt };
    case "Collected":
      return { leg, stampAt: transport.collectedAt };
    case "En route":
      return { leg, stampAt: transport.enRouteAt };
    case "Accepted":
      return { leg, stampAt: transport.acceptedAt };
    case "Requested":
      return { leg, stampAt: undefined };
  }
}

/**
 * "How long since the last stamp", worded honestly. A `"Requested"` job (see
 * `trackerRowState`) carries no stamp, so this never computes an elapsed time against a
 * fabricated zero or against the movement's own `openedAt` — that would be reporting a
 * different clock as if it were this one. It names the absence in ordinary prose instead,
 * using "since" the same way the elapsed-time branch uses "ago", so a reader (and a test)
 * can tell the two apart without either one silently disappearing.
 */
export function stampAgeText(stampAt: Instant | undefined, now: Instant): string {
  if (stampAt === undefined) return "No timestamp recorded since this job began";
  return `${splitDuration(Math.max(now - stampAt, 0))} ago`;
}
