import { TERMS_VERSION } from "@/lib/front-door-content";

/**
 * Where a terms acceptance is recorded, and how it is read back.
 *
 * No new database column. The record goes in the signed-in user's Supabase Auth
 * `user_metadata` (written with `auth.updateUser({ data })`, which merges
 * top-level keys), under `TERMS_METADATA_KEY`, so it follows the user between
 * devices without a migration. A copy goes in this browser's `localStorage`,
 * keyed by user id, so the prompt stays dismissed if the metadata write fails or
 * the session has not refreshed yet.
 *
 * `user_metadata` is editable by the user themselves, so this is a record that
 * the user clicked Accept, not a tamper-proof audit trail. A server-owned audit
 * record would need a reviewed table and the owner's permission for that
 * database change.
 */

export const TERMS_METADATA_KEY = "psychsift_terms";

export type TermsAcceptanceRecord = { version: string; acceptedAt: string };

const LOCAL_TERMS_PREFIX = "psychsift:terms-accepted:";
const LOCAL_GUIDE_PREFIX = "psychsift:first-run-guide-dismissed:";
/** Metadata flag so the first-run guide stays dismissed on other devices too. */
export const GUIDE_METADATA_KEY = "psychsift_first_run_guide_dismissed";

export function readTermsAcceptance(metadata: unknown): TermsAcceptanceRecord | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = (metadata as Record<string, unknown>)[TERMS_METADATA_KEY];
  if (!record || typeof record !== "object") return null;
  const { version, acceptedAt } = record as Record<string, unknown>;
  if (typeof version !== "string" || typeof acceptedAt !== "string") return null;
  return { version, acceptedAt };
}

/** True only for the exact current version: a new version re-prompts. */
export function hasAcceptedTerms({
  metadata,
  localVersion,
  currentVersion = TERMS_VERSION,
}: {
  metadata: unknown;
  localVersion: string | null;
  currentVersion?: string;
}): boolean {
  if (readTermsAcceptance(metadata)?.version === currentVersion) return true;
  return localVersion === currentVersion;
}

export function buildTermsAcceptance(now: Date = new Date(), version = TERMS_VERSION): TermsAcceptanceRecord {
  return { version, acceptedAt: now.toISOString() };
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the account record still holds it.
  }
}

export function readLocalTermsVersion(userId: string): string | null {
  return safeGet(`${LOCAL_TERMS_PREFIX}${userId}`);
}

export function writeLocalTermsVersion(userId: string, version: string) {
  safeSet(`${LOCAL_TERMS_PREFIX}${userId}`, version);
}

/** `owner` is the signed-in user id. */
export function isFirstRunGuideDismissed(owner: string, metadata: unknown): boolean {
  if (metadata && typeof metadata === "object" && (metadata as Record<string, unknown>)[GUIDE_METADATA_KEY]) {
    return true;
  }
  return safeGet(`${LOCAL_GUIDE_PREFIX}${owner}`) !== null;
}

export function markFirstRunGuideDismissed(owner: string, now: Date = new Date()) {
  safeSet(`${LOCAL_GUIDE_PREFIX}${owner}`, now.toISOString());
}
