import signOffStore from "@/lib/admin/today-rule-sign-offs.json";
import { sha256Hex } from "@/lib/mha-timeline";

/**
 * The switch every Today rule engine sits behind: Mental Health Act timers, roster fatigue
 * warnings and CPD category coaching. A rule set is ON only when all of these hold:
 *
 * - `enabled` is true;
 * - it is signed by an APPROVED SIGNER: the sign-off carries the signer's Supabase auth user id and
 *   that id is in `APPROVED_RULE_SIGNERS`, a committed record the owner edits (only ids of
 *   administrator users, `isAdministratorUser` in `src/lib/authorization.ts`). The name must equal the
 *   record's name; free text is never trusted. The registry ships EMPTY, so every rule set stays off
 *   until the owner adds a signer; an unknown or unverifiable signer keeps it off. The name heuristic
 *   `isNamedPerson` remains only as a second check on the registry name;
 * - the sign-off carries a real UTC time;
 * - the sign-off pin still matches the rule set's content, so any edit to a number, a quote or a
 *   citation after signing turns the engine off again until it is re-signed.
 *
 * Agents ship rule sets with `enabled: false` and an empty sign-off, and never sign them. The pin
 * uses the same canonical-JSON SHA-256 as the Mental Health Act timeframe sign-off
 * (`timeframeContentSha256` in `src/lib/mha-timeline.ts`), so one person can check both the same way.
 */

export type RuleSignOff = {
  /** The owner's switch. Even a signed rule set stays off until this is true. */
  readonly enabled: boolean;
  /** The clinician who checked every figure against its source, by name. Must equal the approved record's name. */
  readonly signedBy: string | null;
  /** The signer's Supabase auth user id (UUID); must be in `APPROVED_RULE_SIGNERS`. */
  readonly signedByUserId: string | null;
  /** UTC ISO instant, e.g. "2026-10-04T01:30:00.000Z". */
  readonly signedAt: string | null;
  /** `ruleContentSha256(content)` at the moment of signing. */
  readonly signedContentSha256: string | null;
};

export type RuleGateOffReason =
  | "unsigned"
  | "signer-not-approved"
  | "not-a-named-person"
  | "bad-sign-off-time"
  | "signed-in-future"
  | "review-date-passed"
  | "standard-not-in-force"
  | "content-changed-since-sign-off"
  | "switched-off";

export type RuleGate = { readonly on: true } | { readonly on: false; readonly reason: RuleGateOffReason };

/** Plain words for each reason, for a screen or a log. */
export const RULE_GATE_REASON_WORDS: Readonly<Record<RuleGateOffReason, string>> = {
  unsigned: "Not yet signed by a named clinician",
  "signer-not-approved": "The signer is not on the approved signer list",
  "not-a-named-person": "Signed by a system or role name, not a named clinician",
  "bad-sign-off-time": "The sign-off has no proper UTC date and time",
  "signed-in-future": "The sign-off is dated in the future",
  "review-date-passed": "The source's review date has passed, so the rules need re-checking and signing again",
  "standard-not-in-force": "The standard these rules come from was not in force for the period asked about",
  "content-changed-since-sign-off": "The rules changed after they were signed, so they need signing again",
  "switched-off": "Signed, but switched off",
};

/** The canonical, sign-off agnostic SHAPE every pin is taken over: keys sorted at every depth. */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalise(record[key])]),
  );
}

/** The sign-off pin for any rule content: SHA-256 hex of its canonical JSON. */
export function ruleContentSha256(content: unknown): string {
  return sha256Hex(JSON.stringify(canonicalise(content)));
}

/**
 * Names that identify software, a team or a role rather than a person who can be asked about a
 * figure. Lower-case, compared after trimming. "PsychSift" is here because the nine Mental Health
 * Act timeframes are currently marked reviewed by it, which the Today plan says is not a sign-off.
 */
const NOT_A_PERSON = new Set([
  "psychsift",
  "system",
  "admin",
  "administrator",
  "owner",
  "the owner",
  "claude",
  "codex",
  "agent",
  "ai",
  "bot",
  "automation",
  "locally reviewed",
  "reviewed",
  "clinician",
  "psychiatrist",
  "consultant",
  "test",
  "unknown",
  "lead",
  "director",
  "registrar",
  "manager",
  "call",
  "governance",
  "committee",
  "team",
  "service",
  "department",
  "signed",
  "unsigned",
  "tbd",
  "tba",
  "pending",
  "placeholder",
  "example clinician",
]);

/**
 * A real person's name: at least two words containing letters (a given name and a family name,
 * with or without a title such as "Dr"), and not a known system or role name.
 */
export function isNamedPerson(name: string | null | undefined): boolean {
  if (typeof name !== "string") return false;
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (NOT_A_PERSON.has(trimmed.toLowerCase())) return false;
  const words = trimmed.split(" ").filter((word) => /\p{L}/u.test(word));
  const titles = new Set(["dr", "dr.", "prof", "prof.", "professor", "a/prof", "mr", "ms", "mrs", "mx"]);
  const nameWords = words.filter((word) => !titles.has(word.toLowerCase()));
  return nameWords.length >= 2 && !nameWords.some((word) => NOT_A_PERSON.has(word.toLowerCase()));
}

const UTC_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** A real UTC ISO instant, never date-only and never an offset (mirrors the timeframe sign-off). */
export function isUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_ISO_TIMESTAMP.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const normalised = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  return new Date(milliseconds).toISOString() === normalised;
}

export type ApprovedRuleSigner = { readonly userId: string; readonly name: string };

/**
 * Verified identities allowed to sign rule sets, read from `today-rule-sign-offs.json`. Ships EMPTY:
 * agents never add entries. The owner adds their own auth user id (an administrator-role user, see
 * `isAdministratorUser`) and name with `npm run rules:sign`.
 */
export const APPROVED_RULE_SIGNERS: readonly ApprovedRuleSigner[] = Object.freeze([
  ...(signOffStore as TodayRuleSignOffStore).approvedSigners,
]);

/**
 * Every Today rule sign-off, in `today-rule-sign-offs.json`. Only `npm run rules:sign`, run by the owner
 * at a real terminal, writes that file; it ships with no signers and every rule set unsigned and off.
 */
export type TodayRuleSignOffStore = {
  readonly approvedSigners: readonly ApprovedRuleSigner[];
  readonly fatigue: RuleSignOff;
  readonly cpd: RuleSignOff;
  readonly mhaTimerSwitch: {
    readonly medicalDeviceRuling: { readonly confirmedOn: string; readonly record: string } | null;
    readonly signOff: RuleSignOff;
  };
};

export const TODAY_RULE_SIGN_OFFS = signOffStore as TodayRuleSignOffStore;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only when the id is a UUID listed as approved and the name matches that record exactly. */
export function isApprovedSigner(
  userId: string | null | undefined,
  name: string | null | undefined,
  approved: readonly ApprovedRuleSigner[],
): boolean {
  if (typeof userId !== "string" || typeof name !== "string" || !UUID.test(userId)) return false;
  const record = approved.find((entry) => entry.userId.toLowerCase() === userId.toLowerCase());
  return record !== undefined && record.name.trim() === name.trim();
}

/** Whether a rule set may run, and if not, the first reason it may not. Fails closed. */
export function ruleGate(
  signOff: RuleSignOff,
  content: unknown,
  approvedSigners: readonly ApprovedRuleSigner[] = APPROVED_RULE_SIGNERS,
  /** Evaluation time in epoch ms; a sign-off dated after it is rejected. */
  now: number = Date.now(),
): RuleGate {
  if (signOff.signedBy === null || signOff.signedBy.trim() === "") return { on: false, reason: "unsigned" };
  if (!isApprovedSigner(signOff.signedByUserId, signOff.signedBy, approvedSigners)) {
    return { on: false, reason: "signer-not-approved" };
  }
  if (!isNamedPerson(signOff.signedBy)) return { on: false, reason: "not-a-named-person" };
  if (!isUtcIsoTimestamp(signOff.signedAt)) return { on: false, reason: "bad-sign-off-time" };
  if (Date.parse(signOff.signedAt) > now) return { on: false, reason: "signed-in-future" };
  if (signOff.signedContentSha256 !== ruleContentSha256(content)) {
    return { on: false, reason: "content-changed-since-sign-off" };
  }
  if (signOff.enabled !== true) return { on: false, reason: "switched-off" };
  return { on: true };
}

/** The empty sign-off every rule set ships with. */
export const UNSIGNED: RuleSignOff = Object.freeze({
  enabled: false,
  signedBy: null,
  signedByUserId: null,
  signedAt: null,
  signedContentSha256: null,
});
