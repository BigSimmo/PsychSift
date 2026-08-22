// src/components/ward-management/ward-priority.ts
import { clockState, minutesUntil, splitDuration, type Instant } from "@/components/ward-management/ward-clock";
import { isOpen } from "@/components/ward-management/ward-derivations";
import type { Movement } from "@/components/ward-management/ward-model";

export type ScoreFactor = { label: string; points: number; detail: string };

/**
 * The fixture carries exactly two "nothing to see here" shapes for `movement.blocker`: the
 * literal `"No blocker"` on generated movements, and `"None — …"` (an em dash separator) on
 * three hand-authored ones. Matching any value that merely starts with "None" is too wide — it
 * would also swallow a real blocker like "None of the secure units can take him" — so this only
 * recognises the exact sentinel, or "None" followed by end-of-string or a dash/colon separator.
 */
function hasActiveBlocker(blocker: string): boolean {
  const trimmed = blocker.trim();
  if (trimmed === "No blocker") return false;
  if (/^None(?:$|\s*[-–—:])/.test(trimmed)) return false;
  return trimmed.length > 0;
}

/**
 * How badly this movement is going — an operations question, not a clinical one.
 *
 * Deliberately blind to `movement.urgency`. Urgency is the clinician's judgement and orders the
 * queue on its own; folding it in here produced a number labelled "not clinical severity" that
 * partly was, which is why the previous score was deleted rather than migrated.
 */
export function operationalScore(movement: Movement, now: Instant): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];

  const waitedMinutes = Math.max(0, now - movement.openedAt);
  const waitPoints = Math.min(40, Math.floor(waitedMinutes / 15));
  if (waitPoints > 0) {
    factors.push({
      label: "Time waiting",
      points: waitPoints,
      detail: `${splitDuration(waitedMinutes)} since the placement request`,
    });
  }

  // A form with no `dueAt` (Task 6A: a Form 3B honestly carries none — the Mental Health Act
  // imposes no post-examination deadline, clinician-confirmed) awards no "Statutory timing"
  // points at all. Such a patient's priority rides on "Time waiting" above instead, which is
  // exactly the clinician's own rule; this deliberately adds no compensating bonus for being
  // detained, which would be an unsupported clinical claim of the same kind this task removes.
  const legalForm = movement.legalForm;
  if (legalForm?.dueAt !== undefined) {
    const dueAt = legalForm.dueAt;
    const state = clockState(dueAt, now);
    const points = state === "breached" ? 30 : state === "critical" ? 20 : state === "due" ? 10 : 0;
    if (points > 0) {
      const remaining = minutesUntil(dueAt, now);
      factors.push({
        label: "Statutory timing",
        points,
        detail:
          remaining < 0
            ? `Form ${legalForm.code} passed its deadline ${Math.abs(remaining)} min ago`
            : `Form ${legalForm.code} due in ${remaining} min`,
      });
    }
  }

  // The clinician's own words, put to him directly: a patient "needs review before they are
  // referred for a bed as they may not need a bed." An examination whose outcome is recorded as
  // `inpatient_order` is the model's only operational evidence that a bed is genuinely needed,
  // as opposed to referred on before anyone has looked. This deliberately does not gate
  // REFER_TO_UNITS on that evidence — measured against the fixture, only 2 of 17 open movements
  // at a referable stage carry an examination with this outcome, and 23 further open movements
  // already past that stage carry no examination at all, so gating would make most of the
  // fixture unreachable. That larger question belongs to the product owner. This factor instead
  // rewards the evidence inside the existing tier-relative score, same as every other factor
  // here.
  //
  // This is an operational fact about this movement — "this department has recorded evidence a
  // bed is needed" — not a clinical judgement, so it is named and worded accordingly (see this
  // function's own doc comment on why a prior score was deleted rather than migrated for
  // exactly this ambiguity). 25 points sits between the "critical" (20) and "breached" (30)
  // statutory-timing tiers above: stronger signal than an as-yet-unbreached legal timer, but
  // this is not a deadline and must not be inflated to read like one.
  //
  // KNOWN GAP, surfaced rather than papered over: 21 of the fixture's 41 open movements are
  // voluntary and carry no `legalForm` at all, so they never receive a Mental Health Act
  // examination and can never earn this factor — even though in reality a voluntary patient is
  // just as much reviewed before a bed is sought. The model has no way to evidence that review.
  // This factor therefore only rewards detained-and-examined patients; it is not a general
  // "has been reviewed" signal, and no proxy has been invented to cover voluntary patients.
  if (movement.examination?.outcome === "inpatient_order") {
    factors.push({
      label: "Bed need confirmed",
      points: 25,
      detail: "Examination outcome: inpatient order — bed confirmed as needed",
    });
  }

  if (movement.declines.length > 0) {
    const points = Math.min(15, movement.declines.length * 5);
    // `declines.length` is a cumulative historical count and `PARALLEL_REFERRAL_CAP` limits
    // simultaneous *live* referrals — they do not share a denominator (see the comment on
    // `buildActionInbox` in ward-derivations.ts), so state only the count, not a fraction.
    factors.push({
      label: "Destinations declined",
      points,
      detail: `${movement.declines.length} destination${movement.declines.length === 1 ? " has" : "s have"} declined`,
    });
  }

  if (hasActiveBlocker(movement.blocker)) {
    factors.push({ label: "Active blocker", points: 10, detail: movement.blocker });
  }

  if (
    movement.transport &&
    movement.transport.acceptedAt !== undefined &&
    movement.transport.enRouteAt === undefined &&
    movement.transport.collectedAt === undefined &&
    movement.transport.cancelledAt === undefined
  ) {
    factors.push({ label: "Transport delay", points: 5, detail: "Accepted but not yet collected" });
  }

  const score = Math.min(
    100,
    factors.reduce((sum, factor) => sum + factor.points, 0),
  );
  return { score, factors };
}

/** Urgency tier leads; the operational score only orders movements inside a tier. */
export function queueOrder(movements: Movement[], now: Instant): Movement[] {
  return movements
    .filter(isOpen)
    .sort((a, b) => a.urgency - b.urgency || operationalScore(b, now).score - operationalScore(a, now).score);
}
