import { z } from "zod";

import {
  ON_CALL_CALL_LOG_NAME_MESSAGE,
  onCallCallLogTime,
  onCallLabelLooksLikeName,
  type OnCallCallLogEntry,
} from "@/lib/on-call/call-log";
import { onCallDeviceStoreChangedEvent } from "@/lib/on-call/device-state-keys";
import {
  parsePatientLabelExpiryStamp,
  patientLabelStorageKey,
  readPatientLabels,
  removePatientLabels,
  writePatientLabels,
} from "@/lib/patient-label-storage";

/**
 * The handover form: one short record per patient, filled in fast during the
 * night and turned into a table at the end of it (Josh's request, 5 Oct 2026).
 *
 * Built only from what is already decided. Still open with the owner, and so
 * deliberately absent here (decisions-5-oct.md, "Handover"):
 *  - **No name or record-number field.** The patient is a bed number or up to
 *    four initials, exactly as the call log refuses a name in its label field.
 *  - **No pick lists.** Legal status, impression and referrals are typed, not
 *    chosen from the app's lists, because those lists need clinical sign-off.
 *  - **No share.** The handover leaves the device only by Copy or Print.
 *  - **Psychiatry only.** The other specialties' fields are not yet agreed.
 *
 * Privacy, the same as the call log it sits beside:
 *  - **On this device only.** Nothing is sent to a server, a provider, a log,
 *    analytics or a URL. It is never searched and never sent to AI:
 *    `tests/work-search.test.ts` fails if a work-search file imports the
 *    patient-label store this reads through.
 *  - **Gone after the shift.** Kept only through `patient-label-storage.ts`,
 *    which wipes it at the end of the shift and at every sign-out or account
 *    switch. Each record also lapses 12 hours after it was started.
 */

/** The patient-label store name; the full key is `patientLabelStorageKey(ON_CALL_HANDOVER_STORE)`. */
export const ON_CALL_HANDOVER_STORE = "on-call-handover";
export const onCallHandoverStorageKey = patientLabelStorageKey(ON_CALL_HANDOVER_STORE);

const EXPIRY_MS = 12 * 60 * 60 * 1000;
/** A full ward fits; the cap only bounds a runaway list. */
export const ON_CALL_HANDOVER_LIMIT = 30;

export const ON_CALL_HANDOVER_FIELD_LIMITS = {
  bed: 12,
  ward: 40,
  legal: 60,
  impression: 80,
  story: 600,
  referrals: 120,
  plan: 400,
} as const;

export type OnCallHandoverTextField = keyof typeof ON_CALL_HANDOVER_FIELD_LIMITS;
export type OnCallHandoverReview = "yes" | "no" | "";

const text = (max: number) => z.string().max(max);

const patientSchema = z
  .object({
    id: z.string().min(1).max(64),
    at: z.string().min(1),
    bed: text(ON_CALL_HANDOVER_FIELD_LIMITS.bed),
    ward: text(ON_CALL_HANDOVER_FIELD_LIMITS.ward),
    legal: text(ON_CALL_HANDOVER_FIELD_LIMITS.legal),
    impression: text(ON_CALL_HANDOVER_FIELD_LIMITS.impression),
    story: text(ON_CALL_HANDOVER_FIELD_LIMITS.story),
    referrals: text(ON_CALL_HANDOVER_FIELD_LIMITS.referrals),
    review: z.enum(["yes", "no", ""]),
    plan: text(ON_CALL_HANDOVER_FIELD_LIMITS.plan),
  })
  .strict();

const listSchema = z.array(patientSchema);

export type OnCallHandoverPatient = z.infer<typeof patientSchema>;
export type OnCallHandoverDraft = Omit<OnCallHandoverPatient, "id" | "at">;

export const emptyOnCallHandoverDraft: OnCallHandoverDraft = {
  bed: "",
  ward: "",
  legal: "",
  impression: "",
  story: "",
  referrals: "",
  review: "",
  plan: "",
};

/** The table's columns, in the form's order. The heading words are the owner's own field names. */
export const ON_CALL_HANDOVER_COLUMNS: readonly { readonly key: keyof OnCallHandoverDraft; readonly label: string }[] =
  [
    { key: "bed", label: "Bed" },
    { key: "ward", label: "Ward" },
    { key: "legal", label: "Legal" },
    { key: "impression", label: "Impression" },
    { key: "story", label: "Story" },
    { key: "referrals", label: "Referrals" },
    { key: "review", label: "Requires review" },
    { key: "plan", label: "Plan" },
  ];

export const ON_CALL_HANDOVER_FULL_MESSAGE = `The handover holds ${ON_CALL_HANDOVER_LIMIT} patients. Delete some before adding more.`;

/** True when nothing has been typed or chosen. */
export function onCallHandoverDraftIsEmpty(draft: OnCallHandoverDraft): boolean {
  return (Object.keys(emptyOnCallHandoverDraft) as (keyof OnCallHandoverDraft)[]).every(
    (key) => draft[key].trim() === "",
  );
}

/** Why this record cannot be kept, or null. Checked before every write so a refused record never reaches storage. */
export function onCallHandoverProblem(draft: OnCallHandoverDraft): string | null {
  if (onCallLabelLooksLikeName(draft.bed)) return ON_CALL_CALL_LOG_NAME_MESSAGE;
  for (const key of Object.keys(ON_CALL_HANDOVER_FIELD_LIMITS) as OnCallHandoverTextField[]) {
    if (draft[key].trim().length > ON_CALL_HANDOVER_FIELD_LIMITS[key]) return "That entry is too long to keep.";
  }
  return null;
}

function live(patients: readonly OnCallHandoverPatient[], now: Date): OnCallHandoverPatient[] {
  const cutoff = now.getTime() - EXPIRY_MS;
  return patients.filter((patient) => {
    const at = Date.parse(patient.at);
    return Number.isFinite(at) && at > cutoff && at <= now.getTime() + 60_000;
  });
}

/** Whole-list rejection, as the other On Call stores do: a foreign payload is an empty handover. */
export function parseOnCallHandover(raw: string | null): OnCallHandoverPatient[] {
  if (!raw) return [];
  try {
    const parsed = listSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** What the screen shows, oldest first: nothing at all once the shift's labels have expired. Pure, so safe during render. */
export function visibleOnCallHandover(
  rawList: string | null,
  rawStamp: string | null,
  now: Date = new Date(),
): { readonly patients: OnCallHandoverPatient[]; readonly expiresAt: number | null } {
  const expiresAt = parsePatientLabelExpiryStamp(rawStamp)?.expiresAt ?? null;
  if (expiresAt === null || now.getTime() >= expiresAt) return { patients: [], expiresAt: null };
  return {
    patients: live(parseOnCallHandover(rawList), now).sort((a, b) => a.at.localeCompare(b.at)),
    expiresAt,
  };
}

function readStored(now: Date): OnCallHandoverPatient[] {
  if (typeof window === "undefined") return [];
  return live(parseOnCallHandover(readPatientLabels(ON_CALL_HANDOVER_STORE, { now: now.getTime() })), now);
}

function write(patients: readonly OnCallHandoverPatient[], now: Date): boolean {
  if (patients.length === 0) removePatientLabels(ON_CALL_HANDOVER_STORE);
  else if (!writePatientLabels(ON_CALL_HANDOVER_STORE, JSON.stringify(patients), { now: now.getTime() })) return false;
  try {
    window.dispatchEvent(new Event(onCallDeviceStoreChangedEvent));
  } catch {
    // No window events to send; nothing is listening either.
  }
  return true;
}

function newId(now: Date): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${now.getTime().toString(36)}-${random}`.slice(0, 64);
}

function clean(draft: OnCallHandoverDraft): OnCallHandoverDraft {
  return {
    bed: draft.bed.trim(),
    ward: draft.ward.trim(),
    legal: draft.legal.trim(),
    impression: draft.impression.trim(),
    story: draft.story.trim(),
    referrals: draft.referrals.trim(),
    review: draft.review,
    plan: draft.plan.trim(),
  };
}

export type OnCallHandoverWrite =
  { readonly ok: true; readonly patient: OnCallHandoverPatient } | { readonly ok: false; readonly problem: string };

/**
 * Keep one patient's record: a new one when `id` is null, otherwise the record
 * with that id is replaced in place. Refused or empty records are never written.
 */
export function saveOnCallHandoverPatient(
  id: string | null,
  draft: OnCallHandoverDraft,
  now: Date = new Date(),
): OnCallHandoverWrite {
  if (onCallHandoverDraftIsEmpty(draft)) return { ok: false, problem: "Write something about the patient first." };
  const problem = onCallHandoverProblem(draft);
  if (problem) return { ok: false, problem };
  if (typeof window === "undefined") return { ok: false, problem: "This device cannot keep the handover." };
  const current = readStored(now);
  const existing = id ? current.find((patient) => patient.id === id) : undefined;
  if (!existing && current.length >= ON_CALL_HANDOVER_LIMIT)
    return { ok: false, problem: ON_CALL_HANDOVER_FULL_MESSAGE };
  const patient: OnCallHandoverPatient = existing
    ? { ...existing, ...clean(draft) }
    : { id: newId(now), at: now.toISOString(), ...clean(draft) };
  const next = existing ? current.map((item) => (item.id === patient.id ? patient : item)) : [...current, patient];
  return write(next, now) ? { ok: true, patient } : { ok: false, problem: "This device would not keep the handover." };
}

export function removeOnCallHandoverPatient(id: string, now: Date = new Date()): void {
  if (typeof window === "undefined") return;
  write(
    readStored(now).filter((patient) => patient.id !== id),
    now,
  );
}

/** Clear the whole handover on this device. */
export function clearOnCallHandover(): void {
  if (typeof window === "undefined") return;
  write([], new Date());
}

/**
 * A call-log note as a handover record, for "Add as patient": the bed or
 * initials carry over, what happened becomes the story and what is still to do
 * becomes the plan. Nothing is invented.
 */
export function onCallHandoverDraftFromCall(entry: OnCallCallLogEntry): OnCallHandoverDraft {
  const story = [onCallCallLogTime(entry.at), entry.caller ? `call from ${entry.caller}` : "", entry.note]
    .filter(Boolean)
    .join(". ")
    .slice(0, ON_CALL_HANDOVER_FIELD_LIMITS.story);
  return {
    ...emptyOnCallHandoverDraft,
    bed: entry.label.slice(0, ON_CALL_HANDOVER_FIELD_LIMITS.bed),
    story,
    plan: entry.followUp.slice(0, ON_CALL_HANDOVER_FIELD_LIMITS.plan),
  };
}

/** A cell's words for the table and the copies. */
export function onCallHandoverCell(patient: OnCallHandoverDraft, key: keyof OnCallHandoverDraft): string {
  if (key === "review") return patient.review === "yes" ? "Yes" : patient.review === "no" ? "No" : "";
  return patient[key];
}

function dateWords(now: Date): string {
  // Built from parts so the line reads "Mon 5 Oct" whatever punctuation this engine's locale data adds.
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return [part("weekday"), part("day"), part("month")].filter(Boolean).join(" ");
}

export function onCallHandoverTitle(now: Date = new Date()): string {
  return `Psychiatry handover, ${dateWords(now)}`;
}

/** Plain text for pasting where a table will not go: one block per patient, empty fields left out. */
export function onCallHandoverPlainText(patients: readonly OnCallHandoverPatient[], now: Date = new Date()): string {
  if (patients.length === 0) return "";
  const blocks = patients.map((patient, index) => {
    const lines = [`${index + 1}. ${[patient.bed, patient.ward].filter(Boolean).join(", ") || "Patient"}`];
    for (const { key, label } of ON_CALL_HANDOVER_COLUMNS) {
      if (key === "bed" || key === "ward") continue;
      const value = onCallHandoverCell(patient, key);
      if (value) lines.push(`   ${label}: ${value}`);
    }
    return lines.join("\n");
  });
  return [onCallHandoverTitle(now), "", ...blocks.flatMap((block) => [block, ""])].join("\n").trimEnd();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The same handover as an HTML table, so pasting into a document or an email
 * keeps the columns. Every value is escaped: this is the reader's own typing.
 */
export function onCallHandoverHtmlTable(patients: readonly OnCallHandoverPatient[], now: Date = new Date()): string {
  const cell = "border:1px solid gray;padding:4px 6px;vertical-align:top;text-align:left";
  const head = ON_CALL_HANDOVER_COLUMNS.map(({ label }) => `<th style="${cell}">${escapeHtml(label)}</th>`).join("");
  const rows = patients
    .map(
      (patient) =>
        `<tr>${ON_CALL_HANDOVER_COLUMNS.map(
          ({ key }) =>
            `<td style="${cell}">${escapeHtml(onCallHandoverCell(patient, key)).replace(/\n/g, "<br>")}</td>`,
        ).join("")}</tr>`,
    )
    .join("");
  return `<p><strong>${escapeHtml(onCallHandoverTitle(now))}</strong></p><table style="border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}
