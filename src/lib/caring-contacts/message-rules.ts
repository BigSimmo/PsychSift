// PROVISIONAL — NOT CLINICALLY APPROVED.
// Seeded 2026-08-19 from the decision lock's prohibited concepts, the existing prototype message
// constants, and the two-segment GSM-7 limit. Replace this file wholesale when the clinical programme
// lead and lived-experience representative approve the real content style guide. Do not edit
// message-policy.ts to accommodate a rule change — the mechanism is stable, the rules are data.

export type ProvisionalMessageRules = {
  /** Above this many GSM-7 segments, a message fails exceeds-two-segments. */
  maxSegments: number;
  /** Case-insensitive terms that must never appear in an outgoing message. */
  prohibitedTerms: readonly string[];
  /** Identifies the programme; required in first and closing messages. */
  programmeLine: string;
  /** The staffed line's operating hours; required in first messages. */
  operatingHours: string;
  /** Tells the recipient what to do in an emergency; required in first messages. */
  emergencyDirection: string;
  /** The one crisis-support contact; required in first and closing messages. */
  crisisSupportContact: string;
  /** States that the message is the last one the recipient will receive. */
  closingStatement: string;
};

export const PROVISIONAL_MESSAGE_RULES: ProvisionalMessageRules = Object.freeze({
  maxSegments: 2,
  prohibitedTerms: Object.freeze([
    "high risk",
    "safe",
    "engagement score",
    "campaign",
    "lead",
    "conversion",
    "best match",
    "inbox",
    "conversation",
  ]),
  programmeLine: "Example Aftercare Team is thinking of you",
  operatingHours: "9 am-6 pm",
  emergencyDirection: "In an emergency call 000",
  crisisSupportContact: "Fictional Support Line: +61 491 570 158",
  closingStatement: "This is the final message in this programme",
});
