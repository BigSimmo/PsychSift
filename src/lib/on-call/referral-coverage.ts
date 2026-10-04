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
};

const AGE_PLUS = /(\d{1,3})\s*\+/;
const AGE_UNDER = /\b(?:under|below|<)\s*(\d{1,3})\b/;
const AGE_RANGE = /(\d{1,3})\s*[–\-]\s*(\d{1,3})/;
const HOURS_WINDOW = /(\d{1,2}):(\d{2})\s*[–\-]\s*(\d{1,2}):(\d{2})/;

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

function windowOpen(hours: string, minutesNow: number): "open" | "closed" | "unparsed" {
  const match = hours.match(HOURS_WINDOW);
  if (!match) return "unparsed";
  const open = Number(match[1]) * 60 + Number(match[2]);
  const close = Number(match[3]) * 60 + Number(match[4]);
  if (close <= open) return minutesNow >= open || minutesNow < close ? "open" : "closed";
  return minutesNow >= open && minutesNow < close ? "open" : "closed";
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
    if (!catchment.includes(suburb) && !suburb.split(/\s+/).every((word) => word && catchment.includes(word)))
      return { verdict: "excludes", why: `Catchment recorded as “${facts.catchment}”.` };
  }

  if (query.minutesNow !== null && facts.hours) {
    const open = windowOpen(facts.hours, query.minutesNow);
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
