/**
 * "Who covers this?" — match Age / Suburb / Time against the referral facts the
 * owner already typed (`accepts`, `exclusions`, `catchment`, `hours`). Pure
 * string matching only. Not triage, no clinical judgement, and every service
 * stays on screen with the stored phrase that produced its verdict.
 */

export type ReferralCoverageFacts = {
  readonly accepts: readonly string[];
  readonly exclusions: readonly string[];
  readonly catchment?: string;
  readonly hours?: string;
  readonly phone?: string;
};

export type CoverageVerdict = "takes" | "excludes" | "closed" | "unclear";

export type CoverageMatch = {
  readonly verdict: CoverageVerdict;
  /** The stored phrase that produced the verdict — always checkable. */
  readonly why: string;
};

export type CoverageQuery = {
  readonly age: number | null;
  readonly suburb: string;
  /** Perth wall clock minutes since midnight; null means "do not judge hours". */
  readonly minutesNow: number | null;
  /** Perth weekday, 0 Sunday to 6 Saturday. Without it, hours that name days stay "check". */
  readonly weekday?: number | null;
  /** Today is a WA public holiday: hours that name days stay "check", never "takes". */
  readonly publicHoliday?: boolean;
};

const AGE_PLUS = /(\d{1,3})\s*\+/;
// "<" has no word character before it, so it sits outside the \b that guards the words.
const AGE_UNDER = /(?:\b(?:under|below)|<)\s*(\d{1,3})\b/;
const AGE_RANGE = /(\d{1,3})\s*[–\-]\s*(\d{1,3})/;
const HOURS_WINDOW = /(\d{1,2}):(\d{2})\s*[–\-]\s*(\d{1,2}):(\d{2})/;
const WEEKDAY =
  /^(?:(sun)(?:day)?|(mon)(?:day)?|(tue)(?:s|sday)?|(wed)(?:nesday)?|(thu)(?:r|rs|rsday)?|(fri)(?:day)?|(sat)(?:urday)?)$/;
const EVERY_DAY = /\b(?:daily|every ?day|(?:7|seven) days(?: a week)?)\b/g;
// Catchment wording that covers everywhere, so no typed suburb is excluded by it.
const WHOLE_AREA_CATCHMENT =
  /\b(?:state-?wide|wa-?wide|whole (?:service|state|of wa|of western australia)|all of (?:wa|western australia|the state)|any (?:suburb|address|location))\b/;

function ageInPhrase(phrase: string, age: number): "match" | "miss" | "none" {
  const text = phrase.toLowerCase();
  const plus = text.match(AGE_PLUS);
  if (plus) return age >= Number(plus[1]) ? "match" : "miss";
  const under = text.match(AGE_UNDER);
  if (under) return age < Number(under[1]) ? "match" : "miss";
  const range = text.match(AGE_RANGE);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    return age >= Math.min(low, high) && age <= Math.max(low, high) ? "match" : "miss";
  }
  return "none";
}

function weekdayOf(word: string): number | null {
  const match = WEEKDAY.exec(word);
  if (!match) return null;
  const index = match.slice(1).findIndex((group) => group !== undefined);
  return index < 0 ? null : index;
}

/**
 * The days written beside a clock window: "all" when none are (or "daily"),
 * the weekdays for "Mon-Fri", "weekdays", "Sat, Sun" and the like, or null
 * when the text says anything else, so it is never guessed.
 */
function daysInHours(rest: string): "all" | ReadonlySet<number> | null {
  const text = rest
    .toLowerCase()
    .replace(EVERY_DAY, " daily ")
    .replace(/\s*(?:[–\-]|\bto\b)\s*/g, "-");
  const words = text.split(/[\s,;&/.()]+|\band\b/).filter((word) => word && word !== "only");
  if (words.every((word) => word === "daily")) return "all";
  const days = new Set<number>();
  for (const word of words) {
    if (word === "weekdays" || word === "weekday") [1, 2, 3, 4, 5].forEach((day) => days.add(day));
    else if (word === "weekends" || word === "weekend") [0, 6].forEach((day) => days.add(day));
    else if (word.includes("-")) {
      const [from, to, ...extra] = word.split("-");
      const start = weekdayOf(from);
      const end = weekdayOf(to ?? "");
      if (start === null || end === null || extra.length > 0) return null;
      for (let day = start; ; day = (day + 1) % 7) {
        days.add(day);
        if (day === end) break;
      }
    } else {
      const day = weekdayOf(word);
      if (day === null) return null;
      days.add(day);
    }
  }
  return days;
}

function windowOpen(
  hours: string,
  minutesNow: number,
  weekday: number | null,
  publicHoliday: boolean,
): "open" | "closed" | "unparsed" {
  const match = hours.match(HOURS_WINDOW);
  if (!match) return "unparsed";
  const days = daysInHours(hours.replace(match[0], " "));
  if (days === null) return "unparsed";
  const open = Number(match[1]) * 60 + Number(match[2]);
  const close = Number(match[3]) * 60 + Number(match[4]);
  const overnight = close <= open;
  const inWindow = overnight ? minutesNow >= open || minutesNow < close : minutesNow >= open && minutesNow < close;
  if (!inWindow) return "closed";
  if (days === "all") return "open";
  // Named days need today's weekday, and a public holiday may close a weekday service.
  if (weekday === null || publicHoliday) return "unparsed";
  // The small hours of an overnight window belong to the day it opened.
  const day = overnight && minutesNow < close ? (weekday + 6) % 7 : weekday;
  return days.has(day) ? "open" : "closed";
}

/**
 * Rank one service against the query. Excluded services stay visible with an
 * `excludes` verdict — never filtered away.
 */
export function matchReferralCoverage(facts: ReferralCoverageFacts, query: CoverageQuery): CoverageMatch {
  if (query.age !== null) {
    for (const phrase of facts.exclusions) {
      if (ageInPhrase(phrase, query.age) === "match")
        return { verdict: "excludes", why: `Excluded by recorded fact: “${phrase}”.` };
    }
    let ageMatched = false;
    let ageMissPhrase: string | null = null;
    for (const phrase of facts.accepts) {
      const result = ageInPhrase(phrase, query.age);
      if (result === "match") ageMatched = true;
      if (result === "miss" && !ageMissPhrase) ageMissPhrase = phrase;
    }
    if (ageMissPhrase && !ageMatched)
      return { verdict: "excludes", why: `Does not match recorded age range: “${ageMissPhrase}”.` };
    if (ageMatched) {
      /* continue to catchment / hours below */
    } else if (facts.accepts.length > 0) {
      /* accepts exist but none are age-shaped — do not invent a miss */
    }
  }

  const suburb = query.suburb.trim().toLowerCase();
  if (suburb && facts.catchment) {
    const catchment = facts.catchment.toLowerCase();
    if (
      !WHOLE_AREA_CATCHMENT.test(catchment) &&
      !catchment.includes(suburb) &&
      !suburb.split(/\s+/).every((word) => word && catchment.includes(word))
    )
      return { verdict: "excludes", why: `Catchment recorded as “${facts.catchment}”.` };
  }

  if (query.minutesNow !== null && facts.hours) {
    const open = windowOpen(facts.hours, query.minutesNow, query.weekday ?? null, query.publicHoliday ?? false);
    if (open === "closed")
      return { verdict: "closed", why: `Hours recorded as “${facts.hours}” — closed at this time.` };
    if (open === "unparsed")
      return {
        verdict: "unclear",
        why: `Hours recorded as “${facts.hours}” — check those hours before referring.`,
      };
  }

  if (query.age !== null) {
    for (const phrase of facts.accepts) {
      if (ageInPhrase(phrase, query.age) === "match")
        return { verdict: "takes", why: `Matches recorded fact: “${phrase}”.` };
    }
  }
  if (suburb && facts.catchment?.toLowerCase().includes(suburb))
    return { verdict: "takes", why: `Catchment recorded as “${facts.catchment}”.` };

  if (!query.age && !suburb)
    return { verdict: "unclear", why: "Enter an age or suburb to match against the facts you recorded." };

  return {
    verdict: "unclear",
    why: "No clear age range or catchment match in the facts you recorded — confirm with the service.",
  };
}

export function coverageRank(verdict: CoverageVerdict): number {
  if (verdict === "takes") return 0;
  if (verdict === "unclear") return 1;
  if (verdict === "closed") return 2;
  return 3;
}
