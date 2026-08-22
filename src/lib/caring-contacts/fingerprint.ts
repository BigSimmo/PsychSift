// src/lib/caring-contacts/fingerprint.ts
//
// The idempotency fingerprint every store uses to tell a genuine replay from a key reused for a
// different write.
//
// Extracted so the in-memory and Postgres stores share one definition. Two copies would be two
// definitions of "the same request", and the day they drifted, one store would replay a write the
// other refused — which for this domain means one store sending a second caring contact.
//
// Two properties, and the second one is why the hash is here rather than in either store.
//
//   * STABLE AND ORDER-INDEPENDENT. Object keys are sorted and undefined entries dropped, so a
//     caller that builds the same request twice fingerprints it identically both times.
//
//   * OPAQUE. Both stores write this value into a row — `caring_contacts.idempotency_records`,
//     scoped by row-level security to the writing team — and the requests it is computed over carry
//     patient data: `createPlan`'s input holds the patient's name, mobile number, identifiers and
//     cultural identity, and `stopService`'s and `resolveDispatchDiscrepancy`'s hold a responder's
//     free-text incident note. The canonical string below is a faithful rendering of all of it, so
//     persisting it verbatim put patient detail in a table that exists only to answer an equality
//     question. It is hashed HERE, inside the shared definition, so both stores change together and
//     one cannot be fixed while the other keeps writing plaintext.
//
// The only comparison either store makes on the returned value is `===` (see `runWrite` in both
// stores: a replay is `previous.fingerprint === fingerprint`, and anything else is
// `idempotency-key-reused-for-a-different-write`). Hashing a canonical string preserves that
// exactly: equal canonical strings hash equal, and unequal ones differ short of a SHA-256 collision.
// Replay semantics are therefore unchanged, which `tests/caring-contacts-fingerprint.test.ts` pins
// from both directions rather than asserting only the absence of the plaintext.
import { createHash } from "node:crypto";

/**
 * The canonical rendering the digest is taken over. Private on purpose: it is a faithful
 * reconstruction of the request, so anything that returned it to a caller would reintroduce the
 * escape the hash exists to close.
 */
function canonicalise(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (value instanceof Date) return `D:${value.getTime()}`;
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${key}:${canonicalise(entry)}`).join(",")}}`;
  }
  return `${typeof value}:${String(value)}`;
}

/** A fixed-width, opaque digest of the request. Compared for equality and for nothing else. */
export function fingerprintOf(value: unknown): string {
  return createHash("sha256").update(canonicalise(value), "utf8").digest("hex");
}
