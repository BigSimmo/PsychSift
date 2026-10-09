import { ordinal, type Placement } from "@/lib/roster/rotations/allocate";
import type { MyRound, RotationRound } from "@/lib/roster/rotations/model";
import { formatZonedDay, zonedDateOf, zonedTimeOf } from "@/lib/work-time/format";

/**
 * Pure helpers for the doctor's rotation screens: words for dates and ranks,
 * and the list moves behind the ranking. No clock and no zone of their own:
 * callers pass both, so the screens and the tests agree.
 */

export const ROTATIONS_HREF = "/roster/rotations";

export function rotationRoundHref(roundId: string): string {
  return `${ROTATIONS_HREF}/${encodeURIComponent(roundId)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "1 Feb" for a `YYYY-MM-DD` calendar date. */
export function formatShortDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month}` : date;
}

/** "1 Feb to 2 May" for a term. */
export function formatTermDates(start: string, end: string): string {
  if (start === end) return formatShortDate(start);
  return `${formatShortDate(start)} to ${formatShortDate(end)}`;
}

/** "Fri 30 Oct at 17:00" for a closing time, on the work zone's wall clock. */
export function formatClosing(closesAt: string, zone: string): string {
  return `${formatZonedDay(zonedDateOf(closesAt, zone))} at ${zonedTimeOf(closesAt, zone)}`;
}

/** "Fri 30 Oct", the closing day alone. */
export function formatClosingDay(closesAt: string, zone: string): string {
  return formatZonedDay(zonedDateOf(closesAt, zone));
}

/** "6 Nov 2025" for a moment, on the work zone's calendar. */
export function formatDayWithYear(instant: string, zone: string): string {
  const date = zonedDateOf(instant, zone);
  return `${formatShortDate(date)} ${date.slice(0, 4)}`;
}

export type RankTagTone = "green" | "mode" | "amber" | "neutral";

/** The word and colour at the end of a placement: "1st" green, "3rd" in the area colour, "Free place" amber. */
export function rankTag(placement: Pick<Placement, "rank" | "locked">): { label: string; tone: RankTagTone } {
  if (placement.rank === null) {
    return placement.locked ? { label: "Set", tone: "neutral" } : { label: "Free place", tone: "amber" };
  }
  return { label: ordinal(placement.rank), tone: placement.rank <= 2 ? "green" : "mode" };
}

/** "Consultation liaison moved to 2nd". */
export function movedAnnouncement(name: string, index: number): string {
  return `${name} moved to ${ordinal(index + 1)}`;
}

/** A copy of `list` with the item at `from` moved to `to` (both clamped). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  if (target === from) return next;
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** Moves one id up (-1) or down (+1). Unknown ids and moves past either end leave the list as it was. */
export function moveById(list: readonly string[], id: string, delta: number): string[] {
  const from = list.indexOf(id);
  if (from < 0) return [...list];
  return moveItem(list, from, from + delta);
}

/** Puts `id` back at `index` (clamped) if it is not already there; for Undo after a remove. */
export function insertAt(list: readonly string[], id: string, index: number): string[] {
  if (list.includes(id)) return [...list];
  const next = [...list];
  next.splice(Math.max(0, Math.min(next.length, index)), 0, id);
  return next;
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Rankings drop rotations the round no longer offers, and repeats. */
export function knownRanking(ranking: readonly string[], round: Pick<RotationRound, "rotations">): string[] {
  const ids = new Set(round.rotations.map((rotation) => rotation.id));
  const seen = new Set<string>();
  return ranking.filter((id) => {
    if (!ids.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** How many a doctor must rank before sending: the round's rule, at least one, never more than are on offer. */
export function rankedNeeded(round: Pick<RotationRound, "minRanked" | "rotations">): number {
  return Math.max(1, Math.min(round.minRanked, round.rotations.length));
}

/** Why Send is not ready yet, or null when it is. */
export function sendBlockedReason(rankedCount: number, round: Pick<RotationRound, "minRanked" | "rotations">) {
  const needed = rankedNeeded(round);
  if (rankedCount >= needed) return null;
  const left = needed - rankedCount;
  return rankedCount === 0
    ? `Rank at least ${needed} to send`
    : `Rank ${left} more to send. You need at least ${needed}`;
}

/** "1 place a term" or "2 places a term". */
export function placesWords(places: number): string {
  return `${places} ${places === 1 ? "place" : "places"} a term`;
}

export type MyRoundProgress = "sent" | "draft" | "not-started";

export function myRoundProgress(mine: Pick<MyRound, "submittedAt" | "ranking">): MyRoundProgress {
  if (mine.submittedAt) return "sent";
  return mine.ranking.length > 0 ? "draft" : "not-started";
}

/** The term holding `today`, if any. */
export function currentTermId(terms: RotationRound["terms"], today: string): string | null {
  return terms.find((term) => term.start <= today && today <= term.end)?.id ?? null;
}

/** How many placements were one of the doctor's top `top` choices. */
export function topChoiceCount(placements: readonly Pick<Placement, "rank">[], top = 3): number {
  return placements.filter((placement) => placement.rank !== null && placement.rank <= top).length;
}

/** "3 of 4 were in your top three", for a published year. */
export function yearSummary(placements: readonly Pick<Placement, "rank">[], termCount: number): string {
  const top = topChoiceCount(placements);
  const firsts = placements.filter((placement) => placement.rank === 1).length;
  if (termCount === 0) return "No terms in this round";
  if (firsts === termCount) return termCount === 1 ? "You got your 1st choice" : "Every term is a 1st choice";
  return `${top} of ${termCount} ${top === 1 ? "was" : "were"} in your top three`;
}

/** The newest round first by its first term, so "latest" means the year it plans. */
export function byYearNewest(a: MyRound, b: MyRound): number {
  return (b.round.terms[0]?.start ?? "").localeCompare(a.round.terms[0]?.start ?? "");
}
