// PROVISIONAL — SERVICE OPERATING RULES, NOT CLINICAL CONTENT.
//
// Governed configuration for how the service behaves, as distinct from what it says (that is
// ./message-rules.ts) and from how long records are kept, which is a separate policy module that
// owns its own period and is deliberately not named from any sibling.
//
// Why this file exists: the twelve-month simulation (Task 10) needed a retry policy and no module
// owned one, so it was made a required caller input and the values lived in test fixtures. The
// decision lock states retries as a SERVICE rule, not a per-caller choice, and a rule that lives
// only in a test fixture is a rule nobody can find or change deliberately. It now has a home,
// a default, and an explicit override path.
//
// Replace the values here when the service owner changes the policy; do not restate them at a
// call site.

/**
 * How many times one caring contact may be attempted, and how far apart.
 *
 * `maxAttempts` counts the FIRST attempt, so 3 means one send and two retries.
 *
 * Retries never extend the send window. Whether an attempt is still allowed is decided by
 * `isWithinApprovedSendWindow` in ./schedule and by the contact's own AWST calendar day — a retry
 * that would roll past 18:00, or into the next day, does not happen. This policy therefore sets
 * how often and how many, never how late.
 */
export type ContactRetryPolicy = {
  /** Total attempts including the first. */
  maxAttempts: number;
  /** Minutes between attempts. */
  retryIntervalMinutes: number;
};

/**
 * Two retries, three attempts in total, 45 minutes apart.
 *
 * 45 minutes keeps all three attempts inside the approved window for every approved send hour:
 * the latest is 17:00 AWST, and 17:00 + 2 × 45 minutes is 18:30 — outside it — so the third
 * attempt of an early-evening contact is correctly refused rather than sent late. That is the
 * intended interaction, not an oversight: the window wins over the retry count.
 */
export const DEFAULT_CONTACT_RETRY_POLICY: ContactRetryPolicy = Object.freeze({
  maxAttempts: 3,
  retryIntervalMinutes: 45,
});
