import { z } from "zod";

import { ON_CALL_HANDOVER_LEGAL_STATUSES_ENABLED } from "@/lib/on-call/feature-flags";
import { formTitleForCode, normalizeCode, officialForms, type OfficialForm } from "@/lib/form-register";

import {
  ON_CALL_CALL_LOG_NAME_MESSAGE,
  onCallCallLogTime,
  onCallHandoverItems,
  onCallLabelLooksLikeName,
  type OnCallCallLogEntry,
} from "@/lib/on-call/call-log";
import { onCallDeviceStoreChangedEvent } from "@/lib/on-call/device-state-keys";
import {
  PATIENT_LABEL_FALLBACK_LIFETIME_MS,
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
 *  - **No unsigned pick lists.** Impression and referrals are typed. Legal
 *    status can be typed as written or picked from the official forms register;
 *    the two plain statuses wait behind `ON_CALL_HANDOVER_LEGAL_STATUSES_ENABLED`.
 *  - **No share.** The handover leaves the device only by Copy or Print
 *    (`ON_CALL_HANDOVER_SHARE_ENABLED` is off).
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
    /** The call-log note this record was made from, so the form stops offering that call again. */
    fromCall: z.string().min(1).max(64).optional(),
  })
  .strict();

const listSchema = z.array(patientSchema);

export type OnCallHandoverPatient = z.infer<typeof patientSchema>;
export type OnCallHandoverDraft = Omit<OnCallHandoverPatient, "id" | "at">;
type OnCallHandoverField = Exclude<keyof OnCallHandoverDraft, "fromCall">;

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

export const ON_CALL_HANDOVER_FULL_MESSAGE = `The handover holds ${ON_CALL_HANDOVER_LIMIT} patients. Delete some before adding more.`;

export const ON_CALL_HANDOVER_GONE_MESSAGE = "This patient was cleared from the handover, so the edit was not kept.";

/** True when nothing has been typed or chosen. */
export function onCallHandoverDraftIsEmpty(draft: OnCallHandoverDraft): boolean {
  return (Object.keys(emptyOnCallHandoverDraft) as OnCallHandoverField[]).every((key) => draft[key].trim() === "");
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
): {
  readonly patients: OnCallHandoverPatient[];
  readonly expiresAt: number | null;
  /** When this shift's labels were first kept (epoch ms), for the table's date line. */
  readonly startedAt?: number | null;
} {
  const stamp = parsePatientLabelExpiryStamp(rawStamp);
  const expiresAt = stamp?.expiresAt ?? null;
  if (expiresAt === null || now.getTime() >= expiresAt) return { patients: [], expiresAt: null, startedAt: null };
  return {
    patients: live(parseOnCallHandover(rawList), now).sort((a, b) => a.at.localeCompare(b.at)),
    expiresAt,
    startedAt: stamp?.startedAt ?? null,
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
    ...(draft.fromCall ? { fromCall: draft.fromCall } : {}),
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
  // A record that was cleared (shift end, sign-out, another tab) is never brought back by a stale draft.
  if (id && !existing) return { ok: false, problem: ON_CALL_HANDOVER_GONE_MESSAGE };
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
    fromCall: entry.id.slice(0, 64),
  };
}

/** A cell's words for the table and the copies. */
export function onCallHandoverCell(patient: OnCallHandoverDraft, key: OnCallHandoverField): string {
  if (key === "review") return patient.review === "yes" ? "Yes" : patient.review === "no" ? "No" : "";
  return patient[key];
}

/* ---------------------------------------------------------------------------
 * Handover types. Only psychiatry has agreed fields; the other three are named
 * so the picker matches the owner's design, but they show no form until their
 * fields are checked against the hospital's own handover format.
 * ------------------------------------------------------------------------- */

export type OnCallHandoverType = "psychiatry" | "general-medicine" | "general-surgery" | "orthopaedics";

export const ON_CALL_HANDOVER_TYPES: readonly {
  readonly key: OnCallHandoverType;
  readonly label: string;
  readonly ready: boolean;
}[] = [
  { key: "psychiatry", label: "Psychiatry", ready: true },
  { key: "general-medicine", label: "Gen med", ready: false },
  { key: "general-surgery", label: "Gen surg", ready: false },
  { key: "orthopaedics", label: "Ortho", ready: false },
];

export const ON_CALL_HANDOVER_NOT_SET_UP =
  "Not set up yet: these fields need checking against the hospital's own handover format";

/* ---------------------------------------------------------------------------
 * Legal status: the two plain statuses a handover needs, then every form in
 * the app's official forms register, exactly as the register words them.
 * ------------------------------------------------------------------------- */

/** Not forms, so not in the register: shown as plain statuses (wording awaits the owner's confirmation). */
export const ON_CALL_HANDOVER_LEGAL_STATUSES = ["Voluntary", "Not under the Act"] as const;

/** The register's official title for a stored legal value, or null for a status or anything else. */
export function onCallHandoverLegalTitle(value: string): string | null {
  return value.trim() ? formTitleForCode(value) : null;
}

/** True when the value is a form code from the register (shown as a code badge). */
export function onCallHandoverLegalIsForm(value: string): boolean {
  return onCallHandoverLegalTitle(value) !== null;
}

/** Legal values already used in this shift's handover, most recent first, each once. Nothing comes from anywhere else. */
export function onCallHandoverRecentLegal(patients: readonly OnCallHandoverPatient[], limit = 5): string[] {
  const seen = new Set<string>();
  const recent: string[] = [];
  for (const patient of [...patients].sort((a, b) => b.at.localeCompare(a.at))) {
    const value = patient.legal.trim();
    const key = normalizeCode(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    recent.push(value);
    if (recent.length >= limit) break;
  }
  return recent;
}

function matchesQuery(haystack: string, query: string): boolean {
  const words = normalizeCode(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const text = normalizeCode(haystack);
  return words.every((word) => text.includes(word));
}

/** The plain statuses that match a search by words. */
export function onCallHandoverLegalStatusesMatching(query: string): string[] {
  if (!ON_CALL_HANDOVER_LEGAL_STATUSES_ENABLED) return [];
  return ON_CALL_HANDOVER_LEGAL_STATUSES.filter((status) => matchesQuery(status, query));
}

export type OnCallHandoverLegalGroup = { readonly category: string; readonly forms: readonly OfficialForm[] };

/**
 * The register's forms grouped by its own categories, in register order, each
 * filtered by a search on code or words. Empty groups are left out.
 */
/**
 * The register's categories whose forms describe where a patient stands under
 * the Act. Records such as search and seizure, restraint, seclusion or ECT
 * statistics are forms, not a legal status, so they are never offered here.
 */
export const ON_CALL_HANDOVER_LEGAL_CATEGORIES: readonly string[] = [
  "Inpatient treatment orders",
  "Community treatment orders",
  "Referral and detention",
];

export function onCallHandoverLegalGroups(query = ""): OnCallHandoverLegalGroup[] {
  const groups = new Map<string, OfficialForm[]>();
  for (const form of officialForms) {
    if (!ON_CALL_HANDOVER_LEGAL_CATEGORIES.includes(form.category)) continue;
    const code = normalizeCode(form.code);
    const q = normalizeCode(query);
    const hit = !q || code === q || code.startsWith(`${q} `) || matchesQuery(`${form.code} ${form.title}`, query);
    if (!hit) continue;
    const list = groups.get(form.category) ?? [];
    list.push(form);
    groups.set(form.category, list);
  }
  return [...groups].map(([category, forms]) => ({ category, forms }));
}

/* ---------------------------------------------------------------------------
 * Labels, counts and the shift header.
 * ------------------------------------------------------------------------- */

/** "Bed 12" for a bed number, the initials as typed, or "Patient 3" when the bed was left empty. */
export function onCallHandoverPatientLabel(bed: string, index: number): string {
  const value = bed.trim();
  if (!value) return `Patient ${index + 1}`;
  return /^\d/.test(value) ? `Bed ${value}` : value;
}

export function onCallHandoverReviewCount(patients: readonly OnCallHandoverDraft[]): number {
  return patients.filter((patient) => patient.review === "yes").length;
}

/**
 * What "Before it leaves" says the table holds. The bed field refuses a name, but
 * the free-text fields cannot be checked, so it asks the reader to check them
 * rather than promising "beds and initials only".
 */
export function onCallHandoverExportSummary(patients: readonly OnCallHandoverDraft[]): {
  readonly title: string;
  readonly detail: string;
} {
  const count = patients.length;
  const review = onCallHandoverReviewCount(patients);
  return {
    title: `This handover lists ${count === 1 ? "1 patient" : `${count} patients`}`,
    detail: [
      "Check the free text for names or record numbers",
      review > 0 ? `${review} for review` : "none for review",
    ].join(" · "),
  };
}

/** The wards in the handover, each once, in the order entered. */
export function onCallHandoverWards(patients: readonly OnCallHandoverDraft[]): string[] {
  const seen = new Set<string>();
  const wards: string[] = [];
  for (const patient of patients) {
    const ward = patient.ward.trim();
    if (!ward || seen.has(ward.toLowerCase())) continue;
    seen.add(ward.toLowerCase());
    wards.push(ward);
  }
  return wards;
}

/** The ward to copy into the next patient's form: the last one typed. */
export function onCallHandoverLastWard(patients: readonly OnCallHandoverDraft[]): string {
  for (let i = patients.length - 1; i >= 0; i -= 1) {
    const ward = patients[i]!.ward.trim();
    if (ward) return ward;
  }
  return "";
}

/** Open notes in tonight's call log that are not in the handover yet: neither made into a record nor matching a bed. */
export function onCallHandoverCallsNotIn(
  entries: readonly OnCallCallLogEntry[],
  patients: readonly OnCallHandoverPatient[],
): OnCallCallLogEntry[] {
  const fromCalls = new Set(patients.map((patient) => patient.fromCall).filter(Boolean));
  const beds = new Set(patients.map((patient) => patient.bed.trim().toLowerCase()).filter(Boolean));
  return onCallHandoverItems(entries).filter(
    (entry) => !fromCalls.has(entry.id) && !(entry.label.trim() && beds.has(entry.label.trim().toLowerCase())),
  );
}

function dateParts(at: Date): { readonly weekday: string; readonly day: string; readonly month: string } {
  // Built from parts so the line reads "Mon 5 Oct" whatever punctuation this engine's locale data adds.
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: part("weekday"), day: part("day"), month: part("month") };
}

function dateWords(now: Date): string {
  const { weekday, day, month } = dateParts(now);
  return [weekday, day, month].filter(Boolean).join(" ");
}

/**
 * The shift's dates in Perth: "Sun 4 – Mon 5 Oct" across midnight, "Mon 5 Oct"
 * within one day. Built from when this shift's labels were first kept and when
 * they clear, so it is never guessed.
 */
export function onCallHandoverDateRange(startedAt: number, endsAt: number): string {
  const start = dateParts(new Date(startedAt));
  const end = dateParts(new Date(endsAt));
  const same = start.day === end.day && start.month === end.month;
  if (same) return [end.weekday, end.day, end.month].filter(Boolean).join(" ");
  const first = start.month === end.month ? [start.weekday, start.day] : [start.weekday, start.day, start.month];
  return `${first.filter(Boolean).join(" ")} – ${[end.weekday, end.day, end.month].filter(Boolean).join(" ")}`;
}

/**
 * The date line for an export. The clear time is only a shift end when it came
 * from the roster; with no roster it is the 12-hour fallback, which says nothing
 * about when the shift finished, so only the start date is shown. The stamp does
 * not record its source, so an exact fallback lifetime is read as "no roster".
 */
export function onCallHandoverShiftDates(startedAt: number, expiresAt: number): string {
  const fromRoster = expiresAt - startedAt !== PATIENT_LABEL_FALLBACK_LIFETIME_MS;
  return onCallHandoverDateRange(startedAt, fromRoster ? expiresAt : startedAt);
}

/** What the copies carry above the patients. All optional: an unknown is left out, never guessed. */
export type OnCallHandoverHeading = {
  /** "Sun 4 – Mon 5 Oct"; the export date is used when absent. */
  readonly dates?: string | null;
  /** "Night to day", only when the shift is known. */
  readonly shift?: string | null;
};

function headingLine(now: Date, heading: OnCallHandoverHeading): string {
  return `Psychiatry handover · ${heading.dates || dateWords(now)}`;
}

/** Plain text for pasting where a table will not go: one block per patient, empty fields left out. */
export function onCallHandoverPlainText(
  patients: readonly OnCallHandoverPatient[],
  now: Date = new Date(),
  heading: OnCallHandoverHeading = {},
): string {
  if (patients.length === 0) return "";
  const blocks = patients.map((patient, index) => {
    const number = String(index + 1);
    const pad = " ".repeat(number.length + 2);
    const lines = [
      `${number}  ${[onCallHandoverPatientLabel(patient.bed, index), patient.ward].filter(Boolean).join(" · ")}`,
    ];
    const legal = [patient.legal ? `Legal ${patient.legal}` : "", patient.impression].filter(Boolean).join(" · ");
    if (legal) lines.push(`${pad}${legal}`);
    const review = [
      patient.review === "yes" ? "REVIEW: YES" : patient.review === "no" ? "Review: No" : "",
      patient.referrals ? `Referral ${patient.referrals}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (review) lines.push(`${pad}${review}`);
    if (patient.story) lines.push(`${pad}Story  ${patient.story.replace(/\n/g, `\n${pad}       `)}`);
    if (patient.plan) lines.push(`${pad}Plan   ${patient.plan.replace(/\n/g, `\n${pad}       `)}`);
    return lines.join("\n");
  });
  const head = [headingLine(now, heading), heading.shift ?? ""].filter(Boolean);
  return [...head, "", ...blocks.flatMap((block) => [block, ""])].join("\n").trimEnd();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The table's columns, as the screen and the copies show them. The patient cell carries the bed or initials and the ward. */
export const ON_CALL_HANDOVER_TABLE_COLUMNS = [
  { key: "patient", label: "Patient" },
  { key: "legal", label: "Legal" },
  { key: "impression", label: "Impression" },
  { key: "review", label: "Review" },
  { key: "referrals", label: "Referral" },
  { key: "story", label: "Story" },
  { key: "plan", label: "Plan" },
] as const;

/**
 * The same handover as an HTML table, so pasting into a document or an email
 * keeps the columns; rows for review are shaded. Every value is escaped: this
 * is the reader's own typing.
 */
export function onCallHandoverHtmlTable(
  patients: readonly OnCallHandoverPatient[],
  now: Date = new Date(),
  heading: OnCallHandoverHeading = {},
): string {
  const cell = "border:1px solid gray;padding:4px 6px;vertical-align:top;text-align:left";
  const head = ON_CALL_HANDOVER_TABLE_COLUMNS.map(({ label }) => `<th style="${cell}">${escapeHtml(label)}</th>`).join(
    "",
  );
  const rows = patients
    .map((patient, index) => {
      const shade = patient.review === "yes" ? ' style="background:gainsboro"' : "";
      const cells = ON_CALL_HANDOVER_TABLE_COLUMNS.map(({ key }) => {
        const value =
          key === "patient"
            ? [onCallHandoverPatientLabel(patient.bed, index), patient.ward].filter(Boolean).join("\n")
            : onCallHandoverCell(patient, key);
        return `<td style="${cell}">${escapeHtml(value).replace(/\n/g, "<br>")}</td>`;
      }).join("");
      return `<tr${shade}>${cells}</tr>`;
    })
    .join("");
  const shift = heading.shift ? `<br>${escapeHtml(heading.shift)}` : "";
  return `<p><strong>${escapeHtml(headingLine(now, heading))}</strong>${shift}</p><table style="border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}
