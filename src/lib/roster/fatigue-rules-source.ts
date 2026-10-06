import { TODAY_RULE_SIGN_OFFS, type RuleSignOff } from "@/lib/admin/rule-sign-off";

/**
 * The roster limits the fatigue warnings check against, each quoted verbatim from the WA public
 * health system doctors' industrial agreement. THIS FILE IS THE ONLY PLACE THESE NUMBERS LIVE.
 *
 * Source checked 3 October 2026: WA Health System – Medical Practitioners – AMA Industrial
 * Agreement 2024, registered 28 November 2024 as 2024 WAIRC 00992, clause 15 (Hours of duty).
 * The PDF read had the SHA-256 below, so a signer can confirm they read the same document.
 * Clause 6(1)–(3): it expires on 2 September 2027 but continues in force until a new agreement
 * is made, so `reviewBy` asks for a re-check at expiry.
 *
 * Quotes are whitespace-normalised and otherwise exact. Each states its own figure, which
 * `tests/roster-fatigue-rules.test.ts` checks. The earlier (2022) agreement had an 8 hour break;
 * the 2024 agreement says 10, which is why the source and its date are pinned here.
 *
 * Shipped unsigned and off. A named clinician compares every quote with the agreement, then fills
 * in `FATIGUE_RULES_SIGN_OFF` (stored in `src/lib/admin/today-rule-sign-offs.json`, written by `npm run rules:sign`) with `ruleContentSha256(FATIGUE_RULE_SET)`.
 */

export type FatigueRuleId =
  | "minBreakHours"
  | "maxHours7d"
  | "maxHours14d"
  | "maxShiftHours"
  | "maxShiftHoursAfterNoon"
  | "maxNightsInRow"
  | "restAfterNights"
  | "maxDaysBeforeTwoDaysOff";

export type FatigueRuleCitation = { readonly clause: string; readonly quote: string };

export const FATIGUE_RULE_SET = {
  /**
   * Bump whenever `fatigue-rules.ts` changes how a rule is applied (what counts as duty, how a
   * window or a run is measured). It is inside the sign-off pin, so a logic change needs re-signing.
   */
  interpretation: "fatigue-rules v1",
  source: {
    title: "WA Health System – Medical Practitioners – AMA Industrial Agreement 2024",
    citation: "2024 WAIRC 00992",
    registeredOn: "2024-11-28",
    expiresOn: "2027-09-02",
    url: "https://www.health.wa.gov.au/~/media/Corp/Documents/Health-for/Industrial-relations/Awards-and-agreements/Doctors/Medical-practitioners-AMA-industrial-agreement-2024.pdf",
    pdfSha256: "1328d12a620336fbe609e67873b80779fc248a4af7c3ed7073b221f7f3649a25",
    checkedOn: "2026-10-03",
    reviewBy: "2027-09-02",
  },
  rules: {
    minBreakHours: {
      hours: 10,
      clause: "15(4)(a)",
      quote: "Rosters will provide for at least a 10 hour break between periods of rostered duty.",
    },
    maxHours7d: {
      hours: 75,
      clause: "15(6)(b)",
      quote:
        "The rostered hours of work of a practitioner will not exceed 75 hours in any period of seven consecutive days",
    },
    maxHours14d: {
      hours: 140,
      clause: "15(6)(b)",
      quote: "and not more than 140 hours in any period of 14 consecutive days.",
    },
    maxShiftHours: {
      hours: 14,
      clause: "15(6)(c)",
      quote:
        "Subject to subclauses (6)(d) and (6)(e), practitioners will not be rostered for duty for more than 14 consecutive hours, inclusive of rest breaks.",
    },
    maxShiftHoursAfterNoon: {
      hours: 12,
      clause: "15(6)(d)",
      quote:
        "Practitioners commencing duty after 12 noon will not be rostered for more than 12 consecutive hours inclusive of rest breaks.",
      // Not modelled: a written agreement with the Association can allow up to 13 hours, which the
      // roster cannot see. Shown with the warning so the reader can discount it.
      exception: {
        clause: "15(6)(e)",
        quote:
          "By written agreement with the Association, practitioners may, having regard for other shifts applying to the practitioners concerned, be rostered for up to 13 consecutive hours for a shift commencing after 12 noon.",
      },
    },
    maxNightsInRow: {
      nights: 4,
      clause: "15(6)(f)",
      quote: "Practitioners will not normally be rostered to work more than four consecutive nights.",
      exception: {
        nights: 5,
        maxTotalHours: 50,
        quote:
          "Provided that a practitioner may be rostered to work a maximum of five consecutive nights if the total number of rostered hours do not exceed fifty.",
      },
    },
    restAfterNights: {
      clause: "15(6)(g)",
      leadIn:
        "Practitioners will be given the following hours free from all duty (including on call) following nights rostered:",
      bands: [
        { upToNights: 3, hours: 24, quote: "24 hours following a single night, two or three consecutive nights; and" },
        { upToNights: 5, hours: 48, quote: "48 hours following four or five consecutive nights," },
      ],
      caveat: "unless the practitioner agrees to a lesser period.",
    },
    maxDaysBeforeTwoDaysOff: {
      days: 12,
      hoursOff: 48,
      clause: "15(3)(c)",
      quote: "Forty eight consecutive hours free from all duty (including on call) after not more than 12 days’ work.",
    },
  },
} as const;

/** Shipped unsigned and off. Only the owner, with `npm run rules:sign`, fills this in; agents never do. */
export const FATIGUE_RULES_SIGN_OFF: RuleSignOff = TODAY_RULE_SIGN_OFFS.fatigue;
