import { z } from "zod";

import { onCallDeviceStoreChangedEvent } from "@/lib/on-call/device-state-keys";
import {
  parsePatientLabelExpiryStamp,
  patientLabelStorageKey,
  readPatientLabels,
  removePatientLabels,
  writePatientLabels,
} from "@/lib/patient-label-storage";

/**
 * The quick call log and the handover it feeds (Today-page plan, Tier A:
 * "Quick call capture" and "Handover builder").
 *
 * At 3 am the registrar takes a call, does something about it, and by 8 am has
 * to hand the loose ends over. This keeps a short note of each call so the
 * handover can be built from the night rather than from memory.
 *
 * Privacy, because these notes are about patients:
 *  - **On this device only.** Nothing here is sent to a server or written to a
 *    database. The handover leaves the device only when the reader copies it.
 *  - **Identifiers allowed, by owner decision (3 Oct 2026).** The registrar
 *    may type a record number, date of birth or similar into a note. That is
 *    why everything above and below holds: the text lives only in the private
 *    patient-label store, and is never sent to a provider, a log, analytics or
 *    a URL. The bed-or-initials label field still refuses a full name.
 *  - **Only open notes leave the device.** The handover carries notes not
 *    marked done, and only when the reader copies it.
 *  - **Gone after the shift.** The notes are kept only through the shared
 *    patient-label store (`src/lib/patient-label-storage.ts`), which wipes
 *    every label at the end of the shift and at every sign-out or account
 *    switch. Each note also lapses 12 hours after it was written, and the
 *    reader can clear the lot at any time.
 */

/** The patient-label store name; the full key is `patientLabelStorageKey(ON_CALL_CALL_LOG_STORE)`. */
export const ON_CALL_CALL_LOG_STORE = "on-call-call-log";
export const onCallCallLogStorageKey = patientLabelStorageKey(ON_CALL_CALL_LOG_STORE);

export const ON_CALL_CALL_LOG_HOURS = 12;
const EXPIRY_MS = ON_CALL_CALL_LOG_HOURS * 60 * 60 * 1000;
/** A busy night fits; the cap only bounds a runaway list. */
export const ON_CALL_CALL_LOG_LIMIT = 30;

export const ON_CALL_CALL_LOG_FIELD_LIMITS = {
  label: 12,
  caller: 40,
  note: 280,
  followUp: 200,
} as const;

const entrySchema = z
  .object({
    id: z.string().min(1).max(64),
    at: z.string().min(1),
    label: z.string().max(ON_CALL_CALL_LOG_FIELD_LIMITS.label),
    caller: z.string().max(ON_CALL_CALL_LOG_FIELD_LIMITS.caller),
    note: z.string().max(ON_CALL_CALL_LOG_FIELD_LIMITS.note),
    followUp: z.string().max(ON_CALL_CALL_LOG_FIELD_LIMITS.followUp),
    done: z.boolean(),
  })
  .strict();

const logSchema = z.array(entrySchema);

export type OnCallCallLogEntry = z.infer<typeof entrySchema>;

/** What the reader types; the store adds the id, the time and `done`. */
export type OnCallCallLogDraft = Pick<OnCallCallLogEntry, "label" | "caller" | "note" | "followUp">;

/**
 * A label is a bed (anything with a digit, such as "4B-12") or initials (up
 * to four letters, such as "JS"). Anything else, such as "Smith" or "Jane
 * Smith", reads as a name and is refused.
 */
function labelLooksLikeName(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed === "" || /\d/.test(trimmed)) return false;
  return !/^[\p{L}.\s]{1,4}$/u.test(trimmed) || trimmed.replace(/[.\s]/g, "").length > 4;
}

export const ON_CALL_CALL_LOG_NAME_MESSAGE = "Use a bed number or up to four initials here, not a name.";
export const ON_CALL_CALL_LOG_FULL_MESSAGE = `The log holds ${ON_CALL_CALL_LOG_LIMIT} calls. Delete or clear some before adding more.`;

/**
 * Why this draft cannot be kept, or null. Checked before every write so a
 * refused note never reaches storage.
 */
export function onCallCallLogProblem(draft: OnCallCallLogDraft): string | null {
  const fields = [draft.label, draft.caller, draft.note, draft.followUp];
  if (fields.every((field) => field.trim() === "")) return "Write something about the call first.";
  if (labelLooksLikeName(draft.label)) return ON_CALL_CALL_LOG_NAME_MESSAGE;
  for (const key of Object.keys(ON_CALL_CALL_LOG_FIELD_LIMITS) as (keyof OnCallCallLogDraft)[]) {
    if (draft[key].trim().length > ON_CALL_CALL_LOG_FIELD_LIMITS[key]) return "That note is too long to keep.";
  }
  return null;
}

function live(entries: readonly OnCallCallLogEntry[], now: Date): OnCallCallLogEntry[] {
  const cutoff = now.getTime() - EXPIRY_MS;
  return entries.filter((entry) => {
    const at = Date.parse(entry.at);
    return Number.isFinite(at) && at > cutoff && at <= now.getTime() + 60_000;
  });
}

/** Whole-list rejection, as the other On Call stores do: a foreign payload is an empty log. */
export function parseOnCallCallLog(raw: string | null): OnCallCallLogEntry[] {
  if (!raw) return [];
  try {
    const parsed = logSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Reads through the patient-label store, which first wipes anything past the end of the shift. */
function readStored(now: Date): OnCallCallLogEntry[] {
  if (typeof window === "undefined") return [];
  return parseOnCallCallLog(readPatientLabels(ON_CALL_CALL_LOG_STORE, { now: now.getTime() }));
}

function write(entries: readonly OnCallCallLogEntry[], now: Date): boolean {
  if (entries.length === 0) removePatientLabels(ON_CALL_CALL_LOG_STORE);
  else if (!writePatientLabels(ON_CALL_CALL_LOG_STORE, JSON.stringify(entries), { now: now.getTime() })) return false;
  try {
    window.dispatchEvent(new Event(onCallDeviceStoreChangedEvent));
  } catch {
    // No window events to send; nothing is listening either.
  }
  return true;
}

/** Live notes, newest first, from a stored value already read. Pure, so it is safe during render. */
export function liveOnCallCallLog(
  entries: readonly OnCallCallLogEntry[],
  now: Date = new Date(),
): OnCallCallLogEntry[] {
  return live(entries, now).sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * When this shift's patient labels are wiped, read straight from the stamp
 * without wiping anything, so it is safe during render. Null when there is no
 * usable stamp, which the screen treats as no notes (fail closed).
 */
export function parsePatientLabelExpiry(rawStamp: string | null): number | null {
  return parsePatientLabelExpiryStamp(rawStamp)?.expiresAt ?? null;
}

/** What the screen shows: nothing at all once the shift's labels have expired, even before the watcher wipes them. */
export function visibleOnCallCallLog(
  rawLog: string | null,
  rawStamp: string | null,
  now: Date = new Date(),
): { readonly entries: OnCallCallLogEntry[]; readonly expiresAt: number | null } {
  const expiresAt = parsePatientLabelExpiry(rawStamp);
  if (expiresAt === null || now.getTime() >= expiresAt) return { entries: [], expiresAt: null };
  return { entries: liveOnCallCallLog(parseOnCallCallLog(rawLog), now), expiresAt };
}

/** Notes from this shift (and the last 12 hours), newest first. */
export function readOnCallCallLog(now: Date = new Date()): OnCallCallLogEntry[] {
  return liveOnCallCallLog(readStored(now), now);
}

function newId(now: Date): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${now.getTime().toString(36)}-${random}`.slice(0, 64);
}

export type OnCallCallLogWrite =
  { readonly ok: true; readonly entry: OnCallCallLogEntry } | { readonly ok: false; readonly problem: string };

/** Keep a note of a call. Refused drafts are never written. */
export function addOnCallCallLogEntry(draft: OnCallCallLogDraft, now: Date = new Date()): OnCallCallLogWrite {
  const problem = onCallCallLogProblem(draft);
  if (problem) return { ok: false, problem };
  if (typeof window === "undefined") return { ok: false, problem: "This device cannot keep notes." };
  const entry: OnCallCallLogEntry = {
    id: newId(now),
    at: now.toISOString(),
    label: draft.label.trim(),
    caller: draft.caller.trim(),
    note: draft.note.trim(),
    followUp: draft.followUp.trim(),
    done: false,
  };
  const current = live(readStored(now), now);
  // Refuse rather than silently dropping the oldest note, which may still be open.
  if (current.length >= ON_CALL_CALL_LOG_LIMIT) return { ok: false, problem: ON_CALL_CALL_LOG_FULL_MESSAGE };
  const next = [entry, ...current];
  return write(next, now) ? { ok: true, entry } : { ok: false, problem: "This device would not keep the note." };
}

/** Mark a note's follow-up done, or not done. */
export function setOnCallCallLogDone(id: string, done: boolean, now: Date = new Date()): void {
  if (typeof window === "undefined") return;
  write(
    live(readStored(now), now).map((entry) => (entry.id === id ? { ...entry, done } : entry)),
    now,
  );
}

export function removeOnCallCallLogEntry(id: string, now: Date = new Date()): void {
  if (typeof window === "undefined") return;
  write(
    live(readStored(now), now).filter((entry) => entry.id !== id),
    now,
  );
}

/** Clear every note on this device. */
export function clearOnCallCallLog(): void {
  if (typeof window === "undefined") return;
  write([], new Date());
}

/** Perth wall-clock time for a note, "02:14". On Call reads in hospital time. */
export function onCallCallLogTime(iso: string): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/** The notes the handover carries: those still open, oldest first so the story reads in order. */
export function onCallHandoverItems(entries: readonly OnCallCallLogEntry[]): OnCallCallLogEntry[] {
  return entries.filter((entry) => !entry.done).sort((a, b) => a.at.localeCompare(b.at));
}

function line(entry: OnCallCallLogEntry): string {
  const head = [onCallCallLogTime(entry.at), entry.label, entry.caller ? `from ${entry.caller}` : ""]
    .filter(Boolean)
    .join(" · ");
  const parts = [head];
  if (entry.note) parts.push(`  ${entry.note}`);
  if (entry.followUp) parts.push(`  To do: ${entry.followUp}`);
  return parts.join("\n");
}

/**
 * Plain text for pasting into the hospital's own handover: one block per open
 * note, oldest first. The heading words are deliberately neutral: the iSoBAR
 * headings are shown only once the WA source has been captured (see
 * `isobar-source.ts`), so none is written here from memory.
 */
export function onCallHandoverText(entries: readonly OnCallCallLogEntry[], now: Date = new Date()): string {
  const items = onCallHandoverItems(entries);
  if (items.length === 0) return "";
  // Built from parts so the line reads "Sat 3 Oct" whatever punctuation this engine's locale data adds.
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const date = [part("weekday"), part("day"), part("month")].filter(Boolean).join(" ");
  return [`On call handover, ${date}`, "", ...items.map(line).flatMap((block) => [block, ""])].join("\n").trimEnd();
}
