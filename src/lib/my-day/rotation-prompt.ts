import { isExampleRecord } from "@/lib/example-data/guards";
import { roundAcceptsPreferences, type MyRound } from "@/lib/roster/rotations/model";
import { formatZonedDay, zonedDateOf, zonedTimeOf } from "@/lib/work-time/format";

/**
 * My Day Today's rotation card (rotation preferences, owner request
 * 9 Oct 2026). It shows only when it has something to say:
 * - "Rank your 2027 rotations" while a round the reader is in is open and
 *   they have not sent their preferences;
 * - "Your rotations are out" for 14 days after a round is published.
 * Ranking comes first, because it has a closing time.
 */

/** How long "Your rotations are out" stays after publishing. */
export const ROTATIONS_OUT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RotationPrompt = {
  readonly kind: "rank" | "published";
  readonly roundId: string;
  readonly title: string;
  readonly sub: string;
  readonly example: boolean;
};

/** "2027", from the round's first term, else its name. */
function roundYear(mine: MyRound): string {
  const first = [...mine.round.terms].sort((a, b) => a.start.localeCompare(b.start))[0];
  return first ? first.start.slice(0, 4) : mine.round.name;
}

function closesLine(closesAt: string, now: Date, zone: string): string {
  const date = zonedDateOf(closesAt, zone);
  const today = zonedDateOf(now, zone);
  const tomorrow = zonedDateOf(new Date(now.getTime() + DAY_MS), zone);
  const day = date === today ? "today" : date === tomorrow ? "tomorrow" : formatZonedDay(date);
  return `Closes ${day} at ${zonedTimeOf(closesAt, zone)}`;
}

export function rotationTodayPrompt(rounds: readonly MyRound[], now: Date, zone: string): RotationPrompt | null {
  const toRank = rounds
    .filter((mine) => mine.submittedAt === null && roundAcceptsPreferences(mine.round, now))
    .sort((a, b) => Date.parse(a.round.closesAt) - Date.parse(b.round.closesAt))[0];
  if (toRank) {
    return {
      kind: "rank",
      roundId: toRank.round.id,
      title: `Rank your ${roundYear(toRank)} rotations`,
      sub: [closesLine(toRank.round.closesAt, now, zone), toRank.ranking.length ? "Draft saved" : null]
        .filter(Boolean)
        .join(" · "),
      example: isExampleRecord(toRank.round.id),
    };
  }
  const out = rounds
    .filter((mine) => {
      if (mine.round.status !== "published" || !mine.round.publishedAt) return false;
      const age = now.getTime() - Date.parse(mine.round.publishedAt);
      return age >= 0 && age <= ROTATIONS_OUT_DAYS * DAY_MS;
    })
    .sort((a, b) => Date.parse(b.round.publishedAt!) - Date.parse(a.round.publishedAt!))[0];
  if (!out) return null;
  const own = out.placements.filter((placement) => placement.personId === out.personId);
  const placed = own.length;
  const top = own.filter((placement) => placement.rank !== null && placement.rank <= 3).length;
  return {
    kind: "published",
    roundId: out.round.id,
    title: "Your rotations are out",
    sub: placed
      ? `${roundYear(out)} · ${top} of ${placed} from your top three`
      : `${roundYear(out)} · Published by ${out.round.adminName}`,
    example: isExampleRecord(out.round.id),
  };
}
