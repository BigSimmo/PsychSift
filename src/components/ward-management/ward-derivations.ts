/**
 * Pure derivations shared by the three Ward Flow view files (console, modes, network). Nothing
 * here depends on React — no hooks, no browser APIs — so this module carries no "use client"
 * directive and cannot itself become a client/server boundary problem. It is the single place
 * these three files can drift out of sync if a formula changes, so a change here changes every
 * consumer at once rather than needing three coordinated edits.
 */
import type { LucideIcon } from "lucide-react";
import { CircleAlert, Truck } from "lucide-react";

import {
  clockState,
  formatElapsed,
  formatInstant,
  formatRemaining,
  minutesUntil,
  type Instant,
} from "@/components/ward-management/ward-clock";
import { eligibility, type EligibilityVerdict } from "@/components/ward-management/ward-eligibility";
import {
  MOVEMENT_STAGES,
  PARALLEL_REFERRAL_CAP,
  type HealthService,
  type Movement,
  type MovementStage,
  type TransportJob,
  type Unit,
} from "@/components/ward-management/ward-model";
import { bedReleases } from "@/components/ward-management/ward-movements";
import { allEmergencyDepartments, allUnits, siteByCode, unitById } from "@/components/ward-management/ward-sites";
import { REFERRABLE_MOVEMENT_STAGES } from "@/components/ward-management/ward-flow-reducer";

/** UI-only role concept; not part of the domain model. */
export type WardRole = "flow" | "ed" | "ward";

export const stageCopy: Record<MovementStage, { label: string; shortLabel: string }> = {
  placement_requested: { label: "Placement requested", shortLabel: "Requested" },
  destination_review: { label: "Destination review", shortLabel: "Review" },
  accepted_awaiting_bed: { label: "Accepted, awaiting bed", shortLabel: "Accepted" },
  bed_held: { label: "Bed held", shortLabel: "Held" },
  handover_ready: { label: "Handover ready", shortLabel: "Ready" },
  moving: { label: "Moving", shortLabel: "Moving" },
  arrived: { label: "Arrived", shortLabel: "Arrived" },
};

/** Counts are derived from whatever `movements` list the caller passes — every screen now
 * passes the live provider state (Task 6), so the pipeline strip can never advertise a count
 * a different surface would compute differently from the same instant. */
export function stageSummaries(movements: Movement[]) {
  return MOVEMENT_STAGES.map((id) => ({
    id,
    ...stageCopy[id],
    count: movements.filter((movement) => movement.stage === id).length,
  }));
}

export const wardServiceOrder: HealthService[] = ["North Metro", "East Metro", "South Metro", "WACHS", "Private"];

export const roleLabels: Record<WardRole, string> = {
  flow: "Flow coordinator",
  ed: "ED mental health",
  ward: "Ward manager",
};

export const roleTaskLabel: Record<WardRole, string> = {
  flow: "Review & confirm",
  ed: "Confirm ED readiness",
  ward: "Accept and hold bed",
};

/**
 * The health service that owns the ED a movement originated in. This is the origin service,
 * not the patient's catchment — catchment is determined by where a patient lives, not where
 * they presented (see the glossary and Accepted ADR 3). `Movement` has no catchment field;
 * adding one is Phase 2 model work, not a derivation this module can safely invent.
 */
export function movementHealthService(movement: Movement): HealthService | undefined {
  const ed = allEmergencyDepartments().find((candidate) => candidate.id === movement.originEdId);
  return ed ? siteByCode(ed.siteCode)?.service : undefined;
}

/**
 * Duration since the movement opened. This is elapsed wait time, not a countdown to a
 * deadline — `formatElapsed` (never `formatRemaining`) is what keeps it from reading as a
 * breach on every row of every queue.
 */
export function elapsedLabel(movement: Movement, now: Instant) {
  return formatElapsed(minutesUntil(now, movement.openedAt));
}

/**
 * A movement is open while it is still travelling through the pathway. Per spec §7, arrival
 * closes the record and the patient leaves the system — so a movement is closed once it
 * carries a `closure` (whatever the outcome) or has reached the `arrived` stage, and open
 * counts/tables must never include it. `closure` is checked independently of `stage` because
 * a movement can close before ever reaching `arrived` (e.g. self-discharge from ED).
 */
export function isOpen(movement: Movement): boolean {
  return !movement.closure && movement.stage !== "arrived";
}

/**
 * Whether `wardFlowReducer`'s `REFER_TO_UNITS` case would actually accept a referral for this
 * movement right now, and if not, why — named from the movement's own real stage via `stageCopy`,
 * never a generic string. Built on the reducer's own exported `REFERRABLE_MOVEMENT_STAGES`
 * (not a second, hand-copied stage list) so a UI surface's pre-check and the reducer's own guard
 * can never silently drift apart.
 *
 * Task 5 fix round 1: `ShortlistPanel` used to dispatch `REFER_TO_UNITS` and unconditionally
 * render "Referred by a human coordinator" regardless of what the reducer actually did with it.
 * Nine of the eighteen hand-authored fixture movements sit in a non-referable stage (e.g.
 * `bed_held`) while still open and still offering eligible candidates — for every one of them the
 * old code showed a successful referral that never happened. This lets the Refer control state
 * the real reason up front instead of advertising an action it cannot perform.
 */
export function referralBlockedReason(movement: Movement): string | undefined {
  if (REFERRABLE_MOVEMENT_STAGES.includes(movement.stage)) return undefined;
  return `${movement.id} cannot be referred while it is ${stageCopy[movement.stage].label.toLowerCase()} — referral is only available while placement is requested or a destination is under review.`;
}

/**
 * The unit a movement is *actually* recorded against — accepted, or else the first live
 * referral. Never falls back to a different unit, and never returns a merely-suggested
 * candidate: callers that want a suggestion when this is `undefined` must ask for one
 * explicitly (see `eligibleCandidates`) and label it as a suggestion, not a destination.
 */
export function destinationUnit(movement: Movement): Unit | undefined {
  const id = movement.acceptedUnitId ?? movement.referredUnitIds[0];
  return id ? unitById(id) : undefined;
}

export function unitSiteCode(unit: Unit) {
  return siteByCode(unit.siteCode)?.code ?? unit.siteCode;
}

export function transportStatusLabel(transport: TransportJob | undefined) {
  if (!transport) return "Not yet requested";
  if (transport.cancelledAt !== undefined) return "Cancelled";
  if (transport.arrivedAt !== undefined) return "Arrived";
  if (transport.collectedAt !== undefined) return "Collected";
  if (transport.enRouteAt !== undefined) return "En route";
  if (transport.acceptedAt !== undefined) return `${transport.provider} accepted, awaiting departure`;
  return `${transport.provider} requested`;
}

/** The five discrete stages a transport job progresses through, in order. */
export type TransportLeg = "Requested" | "Accepted" | "En route" | "Collected" | "Arrived";

/**
 * The discrete transport leg, separated from `transportStatusLabel`'s provider narrative.
 *
 * `transportStatusLabel` mixes two different things into one string: the leg the job has
 * reached, and prose naming the provider once it has accepted. That is deliberate for the
 * views that read it today, but it means the field can never be matched against a fixed leg
 * pattern — two of its seven possible outputs contain provider prose (`"<provider> accepted,
 * awaiting departure"`, `"<provider> requested"`) rather than one of the five capitalised leg
 * names. This function returns only the leg, using the exact same precedence order as
 * `transportStatusLabel` (cancelled beats every stamp; the furthest-progressed stamp wins
 * otherwise) so the two never disagree about what stage a job is in.
 *
 * `undefined` means "no transport job at all" — a movement with no transport has not reached
 * `"Requested"`, it has no leg, so absence is never collapsed into one of the five leg names.
 */
export function transportLeg(transport: TransportJob | undefined): TransportLeg | "Cancelled" | undefined {
  if (!transport) return undefined;
  if (transport.cancelledAt !== undefined) return "Cancelled";
  if (transport.arrivedAt !== undefined) return "Arrived";
  if (transport.collectedAt !== undefined) return "Collected";
  if (transport.enRouteAt !== undefined) return "En route";
  if (transport.acceptedAt !== undefined) return "Accepted";
  return "Requested";
}

/**
 * The five-state bed grid, built entirely from real unit and bed-release fields.
 *
 * The glossary requires every bed to carry exactly one of the five states, so this must
 * partition `unit.beds` exactly: `available + held + blocked + occupied === unit.beds`.
 * `available` and `held` are both drawn from within the physically-empty pool (`unit.empty`)
 * — `available` is the ward-confirmed allocatable subset, and whatever empty capacity is not
 * yet confirmed allocatable is `held` rather than silently uncounted. `blocked` is drawn from
 * within the non-empty remainder, with whatever is left over being `occupied`. Both splits
 * are clamped so authored data that already over- or under-counts (e.g. a stale `unit.held`
 * literal that no longer fits once `available` is subtracted) can never push the total past
 * `unit.beds` or leave a bed unaccounted for.
 */
export function unitCapacity(unit: Unit) {
  const available = Math.min(unit.allocatable.value, unit.empty.value);
  const held = Math.max(unit.empty.value - available, 0);
  const notEmpty = Math.max(unit.beds - unit.empty.value, 0);
  const blocked = Math.min(Math.max(unit.blocked, 0), notEmpty);
  const occupied = Math.max(notEmpty - blocked, 0);
  return {
    available,
    held,
    potential: bedReleases.filter((release) => release.unitId === unit.id).length,
    blocked,
    occupied,
  };
}

/**
 * Whole-branch review Important 5: the security gate passes a Secure ward for an Open movement
 * on purpose — a locked ward can physically hold an open-status patient, so it is not a
 * *failure*. But it is also not a neutral match: placing a voluntary or open-status patient on
 * a locked ward is a real clinical decision, and the gate row reads "Met" with the affirmative
 * detail "Secure ward meets an open requirement", which hides that decision behind a tick.
 *
 * `ward-eligibility.ts` is a protected surface, so the gate's pass/fail semantics are deliberately
 * untouched. This is the separate, surfaced fact the shortlist and the diagram render alongside
 * the passing gate so a coordinator sees it before confirming.
 */
export function isMoreRestrictiveThanRequired(movement: Movement, unit: Unit): boolean {
  return movement.security === "Open" && unit.security === "Secure";
}

/** The wording used wherever `isMoreRestrictiveThanRequired` is surfaced, so it reads identically
 * on the shortlist row, the gate note, the suggestion badge and the diagram node. */
export const MORE_RESTRICTIVE_NOTE = "More restrictive than required — a locked ward for an open-status movement";

export type RestrictionNotice = { level: "voluntary_on_locked" | "more_restrictive"; text: string };

/**
 * A ward tighter than the patient needs raises one of two warnings, and they are different things.
 * A voluntary person who cannot leave a locked ward is detained in fact without an order, which is
 * sharper than merely over-restrictive and gets its own flag. Neither blocks a placement and
 * neither touches an eligibility gate — `ward-eligibility.ts` is a protected surface.
 */
export function restrictionNotice(movement: Movement, unit: Unit): RestrictionNotice | undefined {
  if (unit.security !== "Secure") return undefined;
  if (movement.legalStatus === "Voluntary") {
    return {
      level: "voluntary_on_locked",
      text: "Voluntary patient on a locked ward — review legal status before admission",
    };
  }
  if (movement.security === "Open") {
    return { level: "more_restrictive", text: "More restrictive than this movement requires" };
  }
  return undefined;
}

/**
 * The units whose cohort matches this movement's, ranked eligible-first using the real
 * eligibility gates, then truncated to `limit`.
 *
 * This is NOT a proximity ranking, and must never be described as one. `Unit` carries no
 * distance, geo, locality or catchment field, and `Movement` carries no catchment either
 * (see `movementHealthService`), so no surface in this prototype can honestly claim a
 * "nearest" anything. Whole-branch review Critical 1 found exactly that claim on screen:
 * WF-018, sitting in SCGH's own emergency department, was offered "RPH Older Adult" first and
 * its own SCGH ward second under a heading reading "Nearest candidates". The tie order below is
 * simply `allUnits()` array order.
 *
 * Task 5: within that same top-`limit` set, a candidate matching the movement's own security
 * requirement is ranked ahead of a restricted one — see the two-pass reasoning in the body below.
 *
 * This is a shortlist of candidates, never a destination — a unit appearing here has not been
 * referred or accepted; see `destinationUnit` for the movement's actual recorded destination.
 */
export function eligibleCandidates(movement: Movement, now: Instant, limit = 3, units: readonly Unit[] = allUnits()) {
  // Eligible-first cut FIRST, restrictiveness reorder SECOND, deliberately in two passes rather
  // than one combined sort. A single combined sort could pull in a unit that was previously
  // outside the top `limit` (a candidate ranked 4th purely because it is restrictive would climb
  // into a 3-slot shortlist ahead of one that was already in it) — a real membership change, not
  // just a reorder, and `/ward-management/network` shows this same shortlist. Truncating on
  // eligibility alone first keeps the returned SET identical to before this ordering rule
  // existed; only the ORDER within that set can move.
  const eligibleFirst = units
    .filter((unit) => unit.cohort === movement.cohort)
    .map((unit) => ({ unit, verdict: eligibility(movement, unit, now) }))
    .sort((a, b) => Number(b.verdict.eligible) - Number(a.verdict.eligible))
    .slice(0, limit);
  // Within that fixed set, a candidate matching the movement's own security requirement is
  // ranked ahead of one `restrictionNotice` flags as tighter than required (Task 5) — a locked
  // ward can still genuinely hold an open-status patient, it just should not be the one a
  // coordinator is steered toward first. Eligibility stays the primary key here too, so this
  // pass can never demote an eligible candidate below an ineligible one. `Array.prototype.sort`
  // is stable, so any remaining tie falls back to the eligible-first cut's own order, which is
  // itself `allUnits()` array order.
  return [...eligibleFirst].sort((a, b) => {
    const eligibleDiff = Number(b.verdict.eligible) - Number(a.verdict.eligible);
    if (eligibleDiff !== 0) return eligibleDiff;
    const aRestricted = restrictionNotice(movement, a.unit) ? 1 : 0;
    const bRestricted = restrictionNotice(movement, b.unit) ? 1 : 0;
    return aRestricted - bRestricted;
  });
}

/**
 * A binary, non-ordinal description of a verdict: eligible, or the specific gate that failed.
 * Eligibility gates are not commensurable (failing `authorisation` is a legal hard stop;
 * failing `capacity_freshness` is a staleness warning), so this deliberately never collapses
 * them into a "N of M passed" fraction — that shape reads as a score, and higher/lower
 * comparisons across two verdicts are not meaningful.
 */
export function candidateReason(verdict: EligibilityVerdict) {
  if (verdict.eligible) return "Eligible now";
  const failed = verdict.gates.find((gate) => !gate.pass);
  return failed ? failed.detail : "Not eligible";
}

export type InboxTone = "danger" | "warning";
export type InboxItem = {
  id: string;
  tone: InboxTone;
  icon: LucideIcon;
  title: string;
  detail: string;
  owner: string;
  movementId: string;
};

/**
 * Every item here is computed from real movement fields — nothing is authored.
 *
 * RULING (Task 8): each category uses `.filter()`, never `.find()`. Measured against the real
 * fixture at `NOW_ANCHOR`, five movements carry a breached statutory deadline, one has reached
 * the parallel-referral cap, and two have transport accepted but not departed — a `.find()`-based
 * inbox reported exactly one of each regardless, understating a legal breach count by four. This
 * is the coordinator's work list, not a report: every qualifying movement gets its own row.
 */
export function buildActionInbox(movements: Movement[], now: Instant): InboxItem[] {
  const items: InboxItem[] = [];

  // A form with no `dueAt` (Task 6A: a Form 3B honestly carries none — the Mental Health Act
  // imposes no post-examination deadline) is never breached and contributes nothing here.
  // `undefined` must never reach `clockState`'s arithmetic.
  const breachedLegal = movements.filter(
    (movement) => movement.legalForm?.dueAt !== undefined && clockState(movement.legalForm.dueAt, now) === "breached",
  );
  for (const movement of breachedLegal) {
    const dueAt = movement.legalForm?.dueAt;
    if (dueAt === undefined) continue;
    items.push({
      id: `legal-${movement.id}`,
      tone: "danger",
      icon: CircleAlert,
      title: "Legal timing breached",
      detail: `${movement.id} · ${formatRemaining(minutesUntil(dueAt, now))}`,
      owner: movement.owner,
      movementId: movement.id,
    });
  }

  const expiredBedHolds = movements.filter(
    (movement) => movement.stage === "bed_held" && movement.bedHeldUntil !== undefined && movement.bedHeldUntil < now,
  );
  for (const movement of expiredBedHolds) {
    const bedHeldUntil = movement.bedHeldUntil;
    if (bedHeldUntil === undefined) continue;
    items.push({
      id: `bed-hold-${movement.id}`,
      tone: "danger",
      icon: CircleAlert,
      title: "Bed hold expired",
      detail: `${movement.id} · ${formatRemaining(minutesUntil(bedHeldUntil, now))}`,
      owner: movement.owner,
      movementId: movement.id,
    });
  }

  // Whole-branch review Important 4: this counts DECLINES, and the title used to claim the
  // PARALLEL REFERRAL CAP had been reached — two different denominators (`ward-priority.ts`
  // documents the same distinction for the score). WF-009 carries five declines and zero live
  // referrals, so the drawer announced a referral cap reached for a movement with nothing
  // referred anywhere. The threshold is unchanged; only the claim is, so it now names exactly
  // what it measures. `PARALLEL_REFERRAL_CAP` is still the threshold because three refusals is
  // the point at which a coordinator should widen the search, not because three referrals are
  // outstanding.
  const heavilyDeclined = movements.filter((movement) => movement.declines.length >= PARALLEL_REFERRAL_CAP);
  for (const movement of heavilyDeclined) {
    items.push({
      id: `declines-${movement.id}`,
      tone: "danger",
      icon: CircleAlert,
      title: "Multiple destinations declined",
      detail: `${movement.id} · ${movement.declines.length} destinations have declined`,
      owner: movement.owner,
      movementId: movement.id,
    });
  }

  const stalledTransport = movements.filter(
    (movement) =>
      movement.transport?.acceptedAt !== undefined &&
      movement.transport.enRouteAt === undefined &&
      movement.transport.cancelledAt === undefined,
  );
  for (const movement of stalledTransport) {
    if (!movement.transport) continue;
    items.push({
      id: `transport-${movement.id}`,
      tone: "warning",
      icon: Truck,
      title: "Transport awaiting departure",
      detail: `${movement.id} · accepted ${formatInstant(movement.transport.acceptedAt as Instant)}`,
      owner: movement.owner,
      movementId: movement.id,
    });
  }

  return items;
}

/** A real, per-movement audit trail built from actual fields — never generic flavour text. */
export function movementTimeline(movement: Movement) {
  const events: Array<{ at: Instant; label: string }> = [{ at: movement.openedAt, label: "Movement opened" }];
  for (const change of movement.statusChanges) {
    events.push({ at: change.at, label: `Legal status changed: ${change.from} → ${change.to} (${change.by})` });
  }
  for (const decline of movement.declines) {
    events.push({ at: decline.at, label: `Declined by referral: ${decline.reason.replace(/_/g, " ")}` });
  }
  if (movement.transport?.acceptedAt !== undefined) {
    events.push({ at: movement.transport.acceptedAt, label: `Transport accepted by ${movement.transport.provider}` });
  }
  if (movement.transport?.enRouteAt !== undefined) {
    events.push({ at: movement.transport.enRouteAt, label: "Transport en route" });
  }
  if (movement.transport?.collectedAt !== undefined) {
    events.push({ at: movement.transport.collectedAt, label: "Patient collected" });
  }
  if (movement.transport?.arrivedAt !== undefined) {
    events.push({ at: movement.transport.arrivedAt, label: "Arrived at destination" });
  }
  if (movement.closure) {
    events.push({ at: movement.closure.at, label: movement.closure.reason });
  }
  return events.sort((a, b) => a.at - b.at);
}
