"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { ON_CALL_VIEW_TITLES, type OnCallPageView } from "@/components/on-call/on-call-section-identity";
import { OnCallFreshnessBadge } from "@/components/on-call/on-call-freshness-badge";
import { OnCallVerifyButton, type OnCallVerifyButtonProps } from "@/components/on-call/on-call-verify-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Select, type SelectOption } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn, fieldControlPlain, InlineNotice, textMuted } from "@/components/ui-primitives";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import { isComplianceEntry, ON_CALL_ADMIN_CATEGORIES, ON_CALL_COMPLIANCE_CATEGORIES } from "@/lib/on-call/compliance";
import { mergeOnCallEditorDetails } from "@/lib/on-call/editor-details";
import { ON_CALL_HOME_TAGS } from "@/lib/on-call/home-modules";
import {
  ON_CALL_COMPLIANCE_CONSEQUENCES,
  ON_CALL_COMPLIANCE_PROVENANCE,
  ON_CALL_RECURRENCE_FREQUENCIES,
  onCallDetailsSchemaFor,
  onCallEntryFreshness,
  onCallEntrySchema,
  type OnCallComplianceConsequence,
  type OnCallComplianceProvenance,
  type OnCallEntry,
  type OnCallRecurrenceFrequency,
  type OnCallSection,
  type OnCallStepHours,
} from "@/lib/on-call/entry-model";
import { isOnCallExampleEntry } from "@/lib/on-call/entry-store";
import { isRoleExplainerEntry } from "@/lib/on-call/who-is-who";

/**
 * The owner's only way to add, correct, or retire an On Call entry. Without
 * this a stale phone extension has no path back to correct except a coding
 * task — see docs/superpowers/sdd/2026-09-04-on-call-mode/task-11-brief.md.
 *
 * PATCH is a full replace, not a partial update (src/app/api/on-call/entries/[id]/route.ts,
 * `updateOnCallEntrySchema`): a body missing a field is rejected with 400
 * rather than silently defaulting it — the worst case of that default was
 * `lastVerifiedAt`, the record that an entry was ever confirmed correct.
 * `buildSavePayload` below always sends every field of the entry it holds,
 * carrying `lastVerifiedAt`, `sortOrder` and `linkedDocumentIds` through
 * unchanged, so an ordinary edit can never reset them.
 */

/** The one detail the editor writes as a nested object rather than a string. */
const RECURRENCE_RULE_KEY = "recurrenceRule";

type DetailFieldKind = "text" | "textarea" | "list" | "select" | "number";

type DetailFieldSpec = {
  key: string;
  label: string;
  kind: DetailFieldKind;
  required?: boolean;
  hint?: string;
  /** Native input type, "text" fields only (e.g. "tel", "url"). */
  type?: string;
  options?: SelectOption[];
  /**
   * An empty value on this control is a real choice, so it must beat the stored
   * one (`clearedKeys` in `mergeOnCallEditorDetails`).
   *
   * This started as "only on selects that name their own empty option", on the
   * reasoning that emptying a text box could not be told apart from a control
   * that never rendered. **That reasoning was wrong**, and Codex P2 on PR #2900
   * caught what it cost: the loop in `handleSave` iterates
   * `detailFieldsFor(...)`, which IS the set of controls on screen, so a
   * control that never rendered never reaches it. The overlay that protects
   * unrendered keys is a different mechanism and is applied before
   * `clearedKeys` either way.
   *
   * What the old default actually did was make a recorded expiry undeletable:
   * the owner cleared the box, `handleSave` omitted the empty value,
   * `mergeOnCallEditorDetails` restored it from `entry.details`, and the save
   * reported success. On a page about regulatory records that is the wrong way
   * round — a date you can no longer remove outlives the thing it describes.
   * So every optional control on the Compliance form carries this: expiry,
   * lead time, issuer, evidence link, URL.
   *
   * The same is true of the other five section forms, whose optional controls
   * still cannot be cleared — a decommissioned ward extension can be corrected
   * but not removed. That is older than this page and is filed as follow-up
   * rather than fixed here, because it changes saving behaviour on surfaces
   * this change does not otherwise touch, and because two of the branches in
   * `handleSave` (`list` and `escalationSteps`) do not read this flag at all.
   *
   * Never on a REQUIRED control, and the reason is worth stating because the
   * obvious fix for a blank required select is to put it here. A blank
   * required field is refused by `handleSave` before the merge runs, so the
   * flag would never be read; an unreadable flag reads as a protection that is
   * in force when it is not. The protection is the `field.required` check and
   * the tests pinning it.
   */
  clearWhenEmpty?: boolean;
};

/**
 * How often a teaching session comes round.
 *
 * A select rather than a tick box: the schedule can compute with three
 * frequencies, and a single tick could only ever mean "weekly". The empty value
 * is a real choice — "does not repeat" is what most sessions are — which is why
 * it is a listed option rather than a placeholder the reader has to guess at.
 *
 * Each label says what the option actually DOES, because bare "Monthly" reads as
 * "however this meeting recurs" and means something narrower: the anchor's
 * calendar date. A third-Sunday journal club set to Monthly walks onto a
 * Wednesday within two months and sends someone to an empty room. Neither a
 * weekday-of-the-month rule nor a term with an end date is representable at all,
 * so the hint names both rather than letting the reader discover it later.
 * Codex P2 on PR #2806.
 *
 * Typed as a full `Record` of the frequency union: adding a fourth frequency to
 * the model then fails to compile here rather than quietly shipping a raw enum
 * value into a select. A test also pins that every frequency reaches the list.
 */
const RECURRENCE_LABELS: Record<OnCallRecurrenceFrequency, string> = {
  weekly: "Weekly, on the same weekday",
  fortnightly: "Fortnightly, on the same weekday",
  monthly: "Monthly, on the same date",
};

const RECURRENCE_HINT =
  "Only these fixed patterns can be computed. A schedule tied to a position in the month (a third Sunday), or one that stops at the end of a term, cannot be expressed here — leave it as does not repeat and keep the date current by hand.";

const RECURRENCE_OPTIONS: SelectOption[] = [
  { value: "", label: "Does not repeat" },
  ...ON_CALL_RECURRENCE_FREQUENCIES.map((frequency) => ({
    value: frequency,
    label: RECURRENCE_LABELS[frequency],
  })),
];

/** A list of folder names, as the select wants them. */
function categoryOptions(categories: readonly string[]): SelectOption[] {
  return categories.map((category) => ({ value: category, label: category }));
}

/**
 * ONE WORD PER FOLDER, in all three lists below. This is a hard constraint, not
 * a preference.
 *
 * Whatever is chosen here is STORED, and the stored string is then drawn twice:
 * as the page's group heading, and as a slot in the in-page navigation bar —
 * a 48px row of bare words that truncate rather than fold (`wordmark-five` in
 * src/components/mode-nav/mode-nav-bands.ts). "What you can authorise" measured
 * 165px in that row against a 288px phone viewport and was cut to "Authorise"
 * for exactly this reason; the measurement is recorded in
 * `tests/ui-on-call-boards.spec.ts` (board 11). A multi-word folder added here
 * is a truncated heading on a phone read at 3am, and it is worse than a
 * truncated label elsewhere because the reader cannot tell which folder they
 * are looking at.
 *
 * So a folder that seems to need a phrase needs a better word instead:
 * "Rosters", not "Rosters and hours"; "Access", not "IT and access". Where a
 * phrase genuinely carries meaning a word cannot — the Compliance consequence
 * BANDS, which are not folders — the page keeps the phrase as its heading and
 * gives the bar a separate short label (`ON_CALL_COMPLIANCE_BANDS`). That
 * escape hatch is not available here, because these strings go in the database.
 */

/**
 * The Admin folders — the work admin a doctor does for themselves.
 *
 * No "Other": `category` is the page's group heading and a slot in its
 * navigation, so an "Other" bucket is a heading that says nothing and grows
 * without limit. A folder that is genuinely missing is a change to this list.
 * "Facilities" is here because the section used to be site logistics, and the
 * rooms-and-food rows written then still have to land somewhere.
 */
const ADMIN_CATEGORY_OPTIONS: SelectOption[] = categoryOptions([...ON_CALL_ADMIN_CATEGORIES]);

/** The Compliance folders. Same stored section, different taxonomy — see
 *  `src/lib/on-call/compliance.ts`. One word each, per the note above; these
 *  render as a pill on the row rather than a heading, but the owner should not
 *  have to learn two naming conventions inside one editor. */
const COMPLIANCE_CATEGORY_OPTIONS: SelectOption[] = categoryOptions([...ON_CALL_COMPLIANCE_CATEGORIES]);

/**
 * The Orientation folders. Unlike the two above, the empty value is offered:
 * `orientationDetails.category` is optional because rows already existed
 * without one, and those rows render under the page's fallback heading rather
 * than disappearing.
 *
 * "Departure" rather than "Before you leave": the folder is a slot in the bar,
 * and the manual named "Before you leave" still carries that title on its own
 * card, so nothing is lost by the folder above it being one word.
 */
const ORIENTATION_CATEGORY_OPTIONS: SelectOption[] = [
  { value: "", label: "No folder" },
  ...categoryOptions(["Induction", "Manuals", "Policies", "Departure"]),
];

/**
 * What lapsing costs, in the words a holder would use.
 *
 * This is the field the Compliance page SORTS BY, so the labels have to say
 * what the value does rather than name a band: a reader choosing "chased" is
 * deciding this one goes below the registration renewal.
 *
 * A full `Record` of the union, like `RECURRENCE_LABELS`: adding a band to the
 * model then fails to compile here rather than shipping a raw enum value into a
 * select.
 */
const CONSEQUENCE_LABELS: Record<OnCallComplianceConsequence, string> = {
  "stops-work": "Lapsing stops you working",
  "stops-part": "Lapsing stops part of your work",
  chased: "Lapsing gets you chased",
};

const CONSEQUENCE_OPTIONS: SelectOption[] = [
  // A real choice, not an absence: the page gives unrecorded rows their own
  // band, because unknown is not the same as harmless.
  { value: "", label: "Not recorded" },
  ...ON_CALL_COMPLIANCE_CONSEQUENCES.map((consequence) => ({
    value: consequence,
    label: CONSEQUENCE_LABELS[consequence],
  })),
];

/**
 * How the recorded date came to be believed — never a verdict on whether the
 * requirement is held.
 *
 * Nothing in this app is checked with an issuing body, so none of these labels
 * may read as "compliant", "valid" or "current to". Each one names who said so
 * and leaves the judgement to the reader.
 */
const PROVENANCE_LABELS: Record<OnCallComplianceProvenance, string> = {
  confirmed: "You checked it yourself",
  typed: "Typed in from memory",
  "read-from-certificate": "Read off the certificate",
};

const PROVENANCE_OPTIONS: SelectOption[] = [
  { value: "", label: "Not recorded" },
  ...ON_CALL_COMPLIANCE_PROVENANCE.map((provenance) => ({
    value: provenance,
    label: PROVENANCE_LABELS[provenance],
  })),
];

/** Admin: a note about a process, a place or a form. */
const ADMIN_DETAIL_FIELDS: DetailFieldSpec[] = [
  // Required, and `handleSave` enforces it. Left blank, the key is not sent,
  // the overlay restores the stored value, and the row saves under a folder
  // from the OTHER taxonomy that the owner never chose — an Admin note filed
  // under "Registration". See the `field.required` check in `handleSave`.
  { key: "category", label: "Category", kind: "select", required: true, options: ADMIN_CATEGORY_OPTIONS },
  { key: "location", label: "Location", kind: "text" },
  { key: "hours", label: "Hours", kind: "text" },
  { key: "phone", label: "Phone", kind: "text", type: "tel" },
  { key: "url", label: "URL", kind: "text", type: "url" },
];

/**
 * Compliance: the same stored section, asking the questions a thing that
 * expires has to answer.
 *
 * `consequence` comes before the date deliberately — it is what the page orders
 * on, and asking for it first is what stops every row arriving unranked.
 */
const COMPLIANCE_DETAIL_FIELDS: DetailFieldSpec[] = [
  { key: "category", label: "Category", kind: "select", required: true, options: COMPLIANCE_CATEGORY_OPTIONS },
  {
    key: "consequence",
    label: "What lapsing costs",
    kind: "select",
    options: CONSEQUENCE_OPTIONS,
    clearWhenEmpty: true,
    hint: "Compliance is ordered by this, not by the date: what stops you working comes above what gets you an email.",
  },
  {
    key: "expiresOn",
    label: "Recorded expiry",
    kind: "text",
    type: "date",
    clearWhenEmpty: true,
    hint: "The date you hold, not one anybody has checked with the issuing body.",
  },
  {
    key: "leadTimeDays",
    label: "Days of notice you need",
    kind: "number",
    clearWhenEmpty: true,
    hint: "How far ahead this one has to be started. A police clearance takes months; an online module takes days.",
  },
  {
    key: "issuingBody",
    label: "Issued by",
    kind: "text",
    clearWhenEmpty: true,
    hint: 'Who to chase — e.g. "Ahpra", "RANZCP".',
  },
  {
    key: "evidenceUrl",
    label: "Evidence link",
    kind: "text",
    type: "url",
    clearWhenEmpty: true,
    hint: "A link to where you keep the certificate. Do not upload it here: it is identity data, and uploads are indexed into the document corpus.",
  },
  {
    key: "provenance",
    label: "How this date was recorded",
    kind: "select",
    options: PROVENANCE_OPTIONS,
    clearWhenEmpty: true,
  },
  { key: "url", label: "URL", kind: "text", type: "url", clearWhenEmpty: true },
];

/** Mirrors `onCallDetailsSchemaFor` (src/lib/on-call/entry-model.ts) field for field. The
 *  `logistics` row here is the Admin shape; a compliance row swaps in
 *  `COMPLIANCE_DETAIL_FIELDS` — see `detailFieldsFor`. */
const SECTION_DETAIL_FIELDS: Record<OnCallSection, DetailFieldSpec[]> = {
  contacts: [
    {
      key: "role",
      label: "Role",
      kind: "text",
      required: true,
      hint: 'e.g. "ED registrar", "Ward 4B nurse in charge".',
    },
    {
      key: "contactName",
      label: "Contact name",
      kind: "text",
      hint: "Shown only to you. Anyone else who can see this entry sees it without the name.",
    },
    { key: "phone", label: "Direct phone", kind: "text", type: "tel" },
    { key: "afterHoursPhone", label: "After-hours phone", kind: "text", type: "tel" },
    { key: "pager", label: "Pager", kind: "text", type: "tel" },
    { key: "extension", label: "Extension", kind: "text" },
    { key: "availability", label: "Availability", kind: "text", hint: 'e.g. "24/7", "Business hours".' },
  ],
  playbook: [
    { key: "trigger", label: "Trigger", kind: "text", required: true, hint: "When this escalation applies." },
    {
      key: "escalationSteps",
      label: "Escalation steps",
      kind: "textarea",
      hint: 'One step per line: who to call | when | phone (optional) | "in hours" or "after hours" (optional).',
    },
  ],
  referrals: [
    { key: "accepts", label: "Accepts", kind: "list", hint: "Comma-separated." },
    { key: "exclusions", label: "Exclusions", kind: "list", hint: "Comma-separated." },
    { key: "catchment", label: "Catchment", kind: "text" },
    { key: "hours", label: "Hours", kind: "text" },
    { key: "howToRefer", label: "How to refer", kind: "text" },
    { key: "phone", label: "Phone", kind: "text", type: "tel" },
    { key: "fax", label: "Fax", kind: "text", type: "tel" },
    { key: "referralFormUrl", label: "Referral form URL", kind: "text", type: "url" },
  ],
  orientation: [
    {
      key: "category",
      label: "Folder",
      kind: "select",
      options: ORIENTATION_CATEGORY_OPTIONS,
      clearWhenEmpty: true,
    },
  ],
  education: [
    { key: "recurrence", label: "Recurrence", kind: "text" },
    { key: "nextOccurrence", label: "Next occurrence", kind: "text" },
    {
      key: "nextOccurrenceDate",
      label: "Next occurrence date",
      kind: "text",
      type: "date",
      hint: "YYYY-MM-DD. Needed for Coming up on the home; the free-text field above is still what Teaching shows.",
    },
    {
      key: RECURRENCE_RULE_KEY,
      label: "Repeats",
      kind: "select",
      options: RECURRENCE_OPTIONS,
      hint: RECURRENCE_HINT,
    },
    { key: "presenter", label: "Presenter", kind: "text" },
    { key: "location", label: "Location", kind: "text" },
    { key: "recordingUrl", label: "Recording URL", kind: "text", type: "url" },
    { key: "topics", label: "Topics", kind: "list", hint: "Comma-separated." },
  ],
  logistics: ADMIN_DETAIL_FIELDS,
};

/**
 * The fields this editor is rendering right now.
 *
 * Admin and Compliance share the `logistics` section — `section` is a database
 * CHECK constraint, so the split lives in `details.kind` — which means the
 * section alone cannot say which form to draw.
 */
function detailFieldsFor(section: OnCallSection, isCompliance: boolean): DetailFieldSpec[] {
  if (section === "logistics" && isCompliance) return COMPLIANCE_DETAIL_FIELDS;
  return SECTION_DETAIL_FIELDS[section];
}

/**
 * The `logistics` detail keys that belong to exactly one of the two taxonomies.
 *
 * Derived from the two field lists rather than written out, so a field added to
 * either list is covered without anybody having to remember these constants
 * exist. `category` and `url` are in both lists and therefore in neither set: a
 * URL means the same thing on an admin note and on a requirement, and
 * `category` is re-asked by `setCompliance` on every switch.
 *
 * They exist for the save-time sweep in `handleSave`, which enforces one
 * invariant AT THE MOMENT THE OWNER SWITCHES the row from one taxonomy to the
 * other: a `logistics` row keeps the taxonomy-specific fields of the taxonomy
 * it is moving into, and none of the one it is leaving. A save that does not
 * change the taxonomy sweeps nothing — see the gate in `handleSave`.
 *
 * Without that invariant, unticking "Compliance requirement" left the expiry,
 * the consequence and the issuing body sitting in the row. `handleSave` only
 * speaks for the fields on screen, so the ones belonging to the taxonomy being
 * left were neither written nor cleared, and `mergeOnCallEditorDetails` kept
 * them from the stored row. Two things followed, both bad. The Admin page
 * renders none of those keys, so the data became invisible rather than deleted
 * — one mis-tap and an expiry date existed in the database and on no screen.
 * And ticking the box again on a later edit re-seeded the form from the stored
 * row, so an old, never-reconfirmed expiry reappeared pre-filled, as though the
 * owner had just entered it. Every date in this feature is meant to be one a
 * person actually recorded.
 */
function exclusiveDetailKeys(mine: DetailFieldSpec[], other: DetailFieldSpec[]): readonly string[] {
  const shared = new Set(other.map((field) => field.key));
  return mine.map((field) => field.key).filter((key) => !shared.has(key));
}

const ADMIN_ONLY_DETAIL_KEYS = exclusiveDetailKeys(ADMIN_DETAIL_FIELDS, COMPLIANCE_DETAIL_FIELDS);
const COMPLIANCE_ONLY_DETAIL_KEYS = exclusiveDetailKeys(COMPLIANCE_DETAIL_FIELDS, ADMIN_DETAIL_FIELDS);

/** Both sides of the split, which is what the save-time sweep walks. */
const TAXONOMY_EXCLUSIVE_DETAIL_KEYS: readonly string[] = [...ADMIN_ONLY_DETAIL_KEYS, ...COMPLIANCE_ONLY_DETAIL_KEYS];

/** "a, b and c" — for naming the boxes an untick would empty. */
function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

type EscalationStep = { order: number; whoToCall: string; when: string; phone?: string; hours?: OnCallStepHours };

function detailStringValue(details: unknown, key: string): string {
  if (!details || typeof details !== "object") return "";
  const value = (details as Record<string, unknown>)[key];
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(", ");
  // `leadTimeDays` is the one stored number. Without this it would seed as an
  // empty box; with `clearWhenEmpty` that empty box would then delete the
  // stored lead time on an unrelated save. Seed the digits so the owner sees
  // what is recorded and can clear it on purpose.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value : "";
}

/** The stored frequency, or "" for a session that does not repeat. */
function recurrenceFrequencyValue(details: unknown): string {
  const rule = (details as { recurrenceRule?: unknown } | null | undefined)?.recurrenceRule;
  if (!rule || typeof rule !== "object") return "";
  const frequency = (rule as { frequency?: unknown }).frequency;
  return typeof frequency === "string" ? frequency : "";
}

function escalationStepsToText(details: unknown): string {
  const steps = (details as { escalationSteps?: unknown } | null)?.escalationSteps;
  if (!Array.isArray(steps)) return "";
  return steps
    .map((step) => {
      if (!step || typeof step !== "object") return "";
      const record = step as { whoToCall?: unknown; when?: unknown; phone?: unknown; hours?: unknown };
      const who = typeof record.whoToCall === "string" ? record.whoToCall : "";
      const when = typeof record.when === "string" ? record.when : "";
      const phoneValue = typeof record.phone === "string" ? record.phone : "";
      const hours = record.hours === "in-hours" ? "in hours" : record.hours === "after-hours" ? "after hours" : "";
      const tail = hours ? ` | ${phoneValue} | ${hours}` : phoneValue ? ` | ${phoneValue}` : "";
      return who || when ? `${who} | ${when}${tail}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** "in hours" / "after hours" / blank or "any". Anything else is a typo, and null says so. */
function parseStepHours(raw: string | undefined): OnCallStepHours | null {
  const value = (raw ?? "")
    .toLowerCase()
    .replace(/[-\s]+/g, " ")
    .trim();
  if (value === "" || value === "any" || value === "any time") return "any";
  if (value === "in hours") return "in-hours";
  if (value === "after hours" || value === "out of hours") return "after-hours";
  return null;
}

/** Returns `null` on a malformed line so the caller can surface one FieldError
 *  rather than silently dropping the step. */
function parseEscalationSteps(raw: string): EscalationStep[] | null {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const steps: EscalationStep[] = [];
  for (const line of lines) {
    const [whoToCall, when, phone, hoursText] = line.split("|").map((part) => part.trim());
    if (!whoToCall || !when) return null;
    const hours = parseStepHours(hoursText);
    if (hours === null) return null;
    steps.push({
      order: steps.length + 1,
      whoToCall,
      when,
      ...(phone ? { phone } : {}),
      ...(hours !== "any" ? { hours } : {}),
    });
  }
  return steps;
}

function draftTagList(tags: string): string[] {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** Whether the comma-separated draft carries a home tag, matched as the home matches it. */
function draftHasTag(tags: string, tag: string): boolean {
  return draftTagList(tags).some((candidate) => candidate.toLowerCase() === tag);
}

/**
 * Adds or removes one home tag in the comma-separated draft, leaving every other
 * tag, and the first tag that groups a contact, where the owner put it. The tag
 * stays the stored model; the tick box only spares a new doctor from learning it.
 */
function setDraftTag(tags: string, tag: string, on: boolean): string {
  const others = draftTagList(tags).filter((candidate) => candidate.toLowerCase() !== tag);
  return (on ? [...others, tag] : others).join(", ");
}

function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "entry";
}

/** Not cryptographic — just enough entropy that two entries sharing a title do
 *  not collide on the table's `unique (owner_id, section, slug)` constraint. */
function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

type DraftState = {
  title: string;
  subtitle: string;
  body: string;
  tags: string;
  isPersonal: boolean;
  includeOnCard: boolean;
  isRoleExplainer: boolean;
  isCompliance: boolean;
  details: Record<string, string>;
};

function buildInitialDraft(
  section: OnCallSection,
  entry: OnCallEntry | null | undefined,
  createAsRoleExplainer = false,
  createAsCompliance = false,
): DraftState {
  // The row's taxonomy has to be settled before the draft is seeded, because
  // it decides which fields are seeded at all. Seeding BOTH taxonomies (which
  // this did until the orphaned-field fix) is what let a stale compliance date
  // left behind on an admin row walk back into the form, pre-filled, the moment
  // the box was ticked again. Only the taxonomy in force is seeded now, so the
  // other form always opens empty and every value in it is one somebody entered.
  const isCompliance = entry ? isComplianceEntry(entry) : createAsCompliance && section === "logistics";
  const details: Record<string, string> = {};
  for (const field of detailFieldsFor(section, isCompliance)) {
    if (field.key === "escalationSteps") {
      details[field.key] = escalationStepsToText(entry?.details);
    } else if (field.key === RECURRENCE_RULE_KEY) {
      details[field.key] = recurrenceFrequencyValue(entry?.details);
    } else {
      details[field.key] = detailStringValue(entry?.details, field.key);
    }
  }
  return {
    title: entry?.title ?? "",
    subtitle: entry?.subtitle ?? "",
    body: entry?.body ?? "",
    tags: entry?.tags.join(", ") ?? "",
    // A compliance requirement is about one named person — their registration,
    // their indemnity, their police clearance — so it is private, full stop.
    // Forced rather than defaulted, because an entry that is not personal is
    // readable by anyone signed in to this site, and a row
    // stored before this rule existed must not stay shared just because it was
    // saved first.
    isPersonal: isCompliance || (entry?.isPersonal ?? false),
    includeOnCard: entry?.includeOnCard ?? false,
    isRoleExplainer: entry ? isRoleExplainerEntry(entry) : createAsRoleExplainer && section === "contacts",
    isCompliance,
    details,
  };
}

function TextAreaField({
  label,
  hint,
  error,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <FormField label={label} hint={hint} error={error}>
      {(field) => (
        <textarea
          id={field.id}
          aria-invalid={field.invalid || undefined}
          aria-describedby={field.describedBy}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          className={cn(fieldControlPlain, "h-auto min-h-24 resize-y py-2 leading-6")}
        />
      )}
    </FormField>
  );
}

function DetailField({
  field,
  value,
  error,
  onChange,
}: {
  field: DetailFieldSpec;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  if (field.kind === "textarea") {
    return <TextAreaField label={field.label} hint={field.hint} error={error} value={value} onChange={onChange} />;
  }
  if (field.kind === "select") {
    const options = field.options ?? [];
    // A stored value from outside this preset (an older or hand-entered row)
    // still has to render as itself rather than silently falling back to the
    // first option, so it is offered as an extra choice rather than dropped.
    const resolvedOptions =
      !value || options.some((option) => option.value === value) ? options : [...options, { value, label: value }];
    // A field whose own options already name the empty value has said what
    // "nothing chosen" means -- "Does not repeat" is an answer, not an absence.
    // Adding the generic placeholder on top would offer two empty rows and make
    // the reader guess which one is the real "none".
    const namesItsOwnEmptyValue = options.some((option) => option.value === "");
    return (
      <Select
        label={field.label}
        required={field.required}
        hint={field.hint}
        error={error}
        options={resolvedOptions}
        placeholder={namesItsOwnEmptyValue ? undefined : "Choose one"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <TextField
      label={field.label}
      required={field.required}
      hint={field.hint}
      error={error}
      type={field.kind === "number" ? "number" : (field.type ?? "text")}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export interface OnCallEntryEditorProps {
  open: boolean;
  onClose: () => void;
  /** Which section's field shape to render (`onCallDetailsSchemaFor`). */
  section: OnCallSection;
  /** The entry being edited; `null`/omitted creates a new one in `section`. */
  entry?: OnCallEntry | null;
  /** Called with the saved (created, edited, or verified) entry. The caller owns
   *  where entries live — see `src/lib/on-call/entry-store.ts` `cacheOnCallEntries`. */
  onSaved: (entry: OnCallEntry) => void;
  /** Called with the deleted entry's id. Omit to disable delete (create-only use). */
  onDeleted?: (id: string) => void;
  /**
   * When creating a contacts entry from Who's who, seed the role-explainer
   * discriminator. Without this, a new role cannot be told apart from a
   * dialling contact and lands in the wrong list.
   */
  createAsRoleExplainer?: boolean;
  /**
   * When creating from the Compliance page, seed the compliance discriminator —
   * the `logistics` mirror of `createAsRoleExplainer`.
   *
   * Both pages write `section: "logistics"`, so without this a requirement
   * created from Compliance would be saved as an ordinary Admin note and
   * disappear off the page it was added on. The owner can still reach it with
   * the tick box inside the editor, so a caller that omits this costs a tap
   * rather than the feature.
   */
  createAsCompliance?: boolean;
}

export function OnCallEntryEditor({
  open,
  onClose,
  section,
  entry = null,
  onSaved,
  onDeleted,
  createAsRoleExplainer = false,
  createAsCompliance = false,
}: OnCallEntryEditorProps) {
  const [draft, setDraft] = useState<DraftState>(() =>
    buildInitialDraft(section, entry, createAsRoleExplainer, createAsCompliance),
  );
  // The page the new entry is being added to, not the stored section it is
  // written to: "Add requirement" on Compliance and "Add role" on Who's who
  // both write another page's section, and titled the sheet "Add to Admin" and
  // "Add to Contacts" until 2026-09-24 (the #NB4SHF class of bug).
  const creatingView: OnCallPageView =
    createAsCompliance && section === "logistics"
      ? "compliance"
      : createAsRoleExplainer && section === "contacts"
        ? "who-is-who"
        : section;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"saving" | "deleting" | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Ticking "Compliance requirement" swaps five fields for eight, immediately
  // below the tick box. Sighted readers see that happen; this is the only way
  // anybody else does. Set on the switch rather than derived from
  // `draft.isCompliance`, because a live region that always carries text
  // announces its own mount as though something had just changed — the same
  // reasoning as `OnCallOfflineBanner`.
  const [formShapeAnnouncement, setFormShapeAnnouncement] = useState("");

  // React's supported "adjust state during render" pattern (also used by
  // SettingsDialog) rather than a reset effect: this component stays mounted
  // while the Sheet hides it, so the draft has to re-seed the moment `open`,
  // `entry`, or `section` actually changes — not on every render.
  const nextOpenKey = open ? `${section}:${entry?.id ?? "new"}` : null;
  if (nextOpenKey !== openKey) {
    setOpenKey(nextOpenKey);
    if (nextOpenKey) {
      setDraft(buildInitialDraft(section, entry, createAsRoleExplainer, createAsCompliance));
      setFieldErrors({});
      setFormError(null);
      setConfirmDeleteOpen(false);
      setFormShapeAnnouncement("");
    }
  }

  const fieldSpecs = detailFieldsFor(section, draft.isCompliance);
  const freshness = entry ? onCallEntryFreshness(entry) : null;

  /**
   * A compliance requirement is one person's own record, so it is never a
   * shared row and the privacy tick box is not a choice on this form.
   */
  const complianceForcesPrivate = section === "logistics" && draft.isCompliance;

  /**
   * Which taxonomy the STORED row is in — `null` while creating, where there is
   * nothing stored to lose. This, not the tick box, is what says whether a save
   * would move the row.
   */
  const storedIsCompliance = entry && section === "logistics" ? isComplianceEntry(entry) : null;

  /**
   * Whether the tick box now disagrees with the stored row. The save-time sweep
   * runs on this and nothing else: deleting the departing taxonomy's fields is
   * a consequence of a choice the owner made in this sheet, never of an
   * unrelated edit to a row that happens to be carrying them.
   */
  const taxonomyChanged = storedIsCompliance !== null && draft.isCompliance !== storedIsCompliance;

  /** Whether this key still holds something the sweep would delete. The stored
   *  row as well as the draft: an emptied text box means "the form said
   *  nothing", so the stored value is still there and still goes. */
  function detailStillHolds(key: string): boolean {
    return (draft.details[key] ?? "").trim().length > 0 || detailStringValue(entry?.details, key).trim().length > 0;
  }

  /**
   * What changing this row's taxonomy would delete, named by the boxes those
   * values sit in.
   *
   * Deleting them is the honest outcome — the page the row moves to renders
   * none of them, so a row that quietly kept them would be holding an expiry
   * date that exists in the database and on no screen — but it has to be said
   * before it happens rather than discovered a year later. One mis-tap is
   * enough, and nothing else on this form warns about it.
   *
   * Read off the STORED taxonomy, so it is true in both directions. Reading the
   * compliance fields only left the commoner tap unwarned: ticking the box on
   * an admin note deletes its Location, Hours and Phone, and said nothing,
   * because the compliance-only keys it looked at are empty by construction —
   * `buildInitialDraft` seeds only the taxonomy in force.
   *
   * Only the keys the destination form has no box for. The keys it DOES render
   * are on screen, blank, and what the owner sees there is what the save
   * stores; a warning about a box they are looking at would be noise.
   */
  const fieldsAtRisk =
    storedIsCompliance === null
      ? []
      : (storedIsCompliance ? COMPLIANCE_DETAIL_FIELDS : ADMIN_DETAIL_FIELDS)
          .filter(
            (field) =>
              (storedIsCompliance ? COMPLIANCE_ONLY_DETAIL_KEYS : ADMIN_ONLY_DETAIL_KEYS).includes(field.key) &&
              detailStillHolds(field.key),
          )
          .map((field) => `\u201c${field.label}\u201d`);

  // The destination is always the taxonomy the stored row is NOT in, whether
  // the owner has flipped the box yet or not.
  const destination = storedIsCompliance ? "an Admin entry" : "a compliance requirement";
  const them = fieldsAtRisk.length > 1 ? "them" : "it";
  const switchLossWarning =
    fieldsAtRisk.length === 0
      ? null
      : taxonomyChanged
        ? ` Saving now deletes ${listPhrase(fieldsAtRisk)} — ${destination} has nowhere to keep ${them}. ${
            storedIsCompliance ? "Tick" : "Untick"
          } the box again to keep ${them}.`
        : ` ${storedIsCompliance ? "Untick" : "Tick"} it and ${listPhrase(fieldsAtRisk)} ${
            fieldsAtRisk.length > 1 ? "are" : "is"
          } deleted — ${destination} has nowhere to keep ${them}.`;

  function setDetailValue(key: string, value: string) {
    setDraft((current) => ({ ...current, details: { ...current.details, [key]: value } }));
  }

  /**
   * Reclassifying an Admin note as a Compliance requirement, or back.
   *
   * The two taxonomies share no folder name, so a category chosen under one of
   * them is meaningless under the other and is dropped rather than carried
   * across — the select is required, so the owner is asked again rather than
   * shown a Leave folder on the Compliance page. Anything the owner typed that
   * is not in either preset is dropped by the same test, which is right: this
   * tick is a decision about what kind of row it is.
   */
  function setCompliance(next: boolean) {
    setFormShapeAnnouncement(
      next
        ? "Compliance requirement fields replaced the admin fields below this tick box."
        : "Admin fields replaced the compliance requirement fields below this tick box.",
    );
    setDraft((current) => {
      const allowed = next ? COMPLIANCE_CATEGORY_OPTIONS : ADMIN_CATEGORY_OPTIONS;
      const category = current.details.category ?? "";
      const keep = allowed.some((option) => option.value === category);
      return {
        ...current,
        isCompliance: next,
        // A compliance requirement is one person's registration, indemnity or
        // police clearance, so it is never a shared row: ticking forces privacy
        // on, and the tick box for it is replaced by a plain statement while
        // the row stays a requirement.
        //
        // Unticking deliberately LEAVES it on, and puts the choice back on
        // screen still ticked. A row that was private must not become readable
        // by anyone on the internet as a side effect of reclassifying it; if
        // the owner wants it shared they can say so, seeing the state they are
        // changing.
        isPersonal: next ? true : current.isPersonal,
        details: { ...current.details, category: keep ? category : "" },
      };
    });
  }

  async function handleSave() {
    // Belt and braces: an example row is never written to the account.
    if (entry && isOnCallExampleEntry(entry)) return;
    if (busy) return;
    setFormError(null);

    const nextErrors: Record<string, string> = {};
    const trimmedTitle = draft.title.trim();
    if (!trimmedTitle) nextErrors.title = "Title is required.";

    const formDetails: Record<string, unknown> = section === "orientation" ? { pinnedSummaryIsOwnerNote: true } : {};
    const clearedKeys: string[] = [];
    for (const field of fieldSpecs) {
      const raw = draft.details[field.key] ?? "";
      // "Required" was decoration until this line: nothing in the save path
      // read `field.required`. An emptied required control sends nothing, the
      // overlay in `mergeOnCallEditorDetails` restores the stored value, and
      // the row saves under a value the owner can no longer see — which is how
      // unticking "Compliance requirement" filed an Admin note under the
      // Compliance folder "Registration". The field's own error is the right
      // place to say so: `FormField` renders it under the control the owner is
      // looking at, and points `aria-describedby` at it.
      if (field.required && !raw.trim()) {
        nextErrors[field.key] = `${field.label} is required.`;
        continue;
      }
      if (field.key === RECURRENCE_RULE_KEY) {
        const frequency = raw.trim();
        if (!frequency) {
          // "Does not repeat" has to beat a stored rule, and an omitted key
          // cannot say that — the overlay would simply keep the old one.
          clearedKeys.push(RECURRENCE_RULE_KEY);
        } else if (!(draft.details.nextOccurrenceDate ?? "").trim()) {
          // A frequency with nothing to count from is a control that appears to
          // have worked and silently does nothing, which is worse than refusing.
          nextErrors[RECURRENCE_RULE_KEY] = "A repeating session needs a next occurrence date to count from.";
        } else {
          formDetails[RECURRENCE_RULE_KEY] = { frequency };
        }
        continue;
      }
      if (field.key === "escalationSteps") {
        const steps = parseEscalationSteps(raw);
        if (steps === null) {
          nextErrors[field.key] =
            'Each step needs at least a who and a when, separated by |. The optional fourth part is "in hours" or "after hours".';
        } else {
          formDetails[field.key] = steps;
        }
        continue;
      }
      if (field.kind === "list") {
        const items = raw
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        formDetails[field.key] = items;
        continue;
      }
      const trimmedValue = raw.trim();
      if (field.kind === "number") {
        // The schema wants a non-negative integer, and a string would fail
        // validation under a message naming a type rather than the mistake.
        if (trimmedValue) {
          const days = Number(trimmedValue);
          if (!Number.isInteger(days) || days < 0) nextErrors[field.key] = "A whole number of days, or leave it blank.";
          else formDetails[field.key] = days;
        } else {
          clearedKeys.push(field.key);
        }
        continue;
      }
      if (trimmedValue) formDetails[field.key] = trimmedValue;
      // "None chosen" on a select that names its own empty option, and an
      // emptied optional compliance text field, both have to beat the stored
      // value — see `clearWhenEmpty` on `DetailFieldSpec`.
      else clearedKeys.push(field.key);
    }

    // The Admin/Compliance invariant, applied where the owner creates the need
    // for it: when this save MOVES the row from one taxonomy to the other, it
    // keeps the taxonomy-specific fields of the one it is moving into and none
    // of the one it is leaving. The loop above speaks only for the fields on
    // screen, so without this the departing taxonomy's fields are neither
    // written nor cleared, and the overlay in `mergeOnCallEditorDetails` keeps
    // them from the stored row — invisible on the page they land on, and
    // re-offered pre-filled the next time the box is ticked. The arriving
    // taxonomy's fields are swept on the same pass when the form left them
    // blank, which is what stops a date nobody entered appearing on the
    // Compliance page as though they had. See `TAXONOMY_EXCLUSIVE_DETAIL_KEYS`.
    //
    // `taxonomyChanged` is the whole gate, and it replaced an unconditional
    // sweep that ran on every `logistics` save. That version was described as a
    // repair — opening and saving an already-orphaned row was enough to clean
    // it — and the description was true, but the price was not worth paying.
    // The "repair" was a permanent, undoable deletion of data the owner typed,
    // triggered by an edit to something else entirely, in exactly the case
    // where the warning beside the tick box provably cannot fire — the draft
    // never held those keys, so it had nothing to name. Correcting a title must
    // not delete a registration's expiry date. An orphan now survives until the
    // owner makes the choice that actually strands it, and that choice is
    // warned about by name first.
    //
    // This argument used to open with "an orphaned key is inert: no page
    // renders it and no form re-offers it". **That is no longer true**, and the
    // conclusion survives the correction rather than resting on it. Since the
    // compliance privacy fix, a stranded compliance key on a `logistics` row
    // decides whether the row is published to other readers at all —
    // `rowMayBeComplianceRequirement` in src/lib/on-call/repository.ts reads
    // exactly these keys. So an orphan is now load-bearing, and withholding
    // such a row is the intended outcome: it looks like a compliance record
    // and nobody has established that it is not. What has NOT changed is that
    // deleting the owner's data during an unrelated edit is the wrong repair
    // for it.
    //
    // Keys the form DID send are skipped, so this can never delete what the
    // owner just typed. `category` and `url` are in both forms and so are not
    // swept at all: a URL means the same thing on either kind of row.
    if (taxonomyChanged) {
      for (const key of TAXONOMY_EXCLUSIVE_DETAIL_KEYS) {
        if (!(key in formDetails)) clearedKeys.push(key);
      }
    }

    const detailsInput = mergeOnCallEditorDetails({
      section,
      formDetails,
      existingDetails: entry?.details,
      roleExplainer: section === "contacts" ? draft.isRoleExplainer : undefined,
      complianceRequirement: section === "logistics" ? draft.isCompliance : undefined,
      clearedKeys,
    });
    const parsedDetails = onCallDetailsSchemaFor(section).safeParse(detailsInput);
    if (!parsedDetails.success) {
      for (const issue of parsedDetails.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !nextErrors[key]) nextErrors[key] = issue.message;
      }
    }

    if (Object.keys(nextErrors).length > 0 || !parsedDetails.success) {
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});

    const tagsArray = draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    // Every field of the entry, always — the PATCH route requires a complete
    // body and rejects a partial one with 400 (see the file banner above).
    const payload = {
      section,
      slug: entry ? entry.slug : `${slugifyTitle(trimmedTitle)}-${randomSlugSuffix()}`,
      title: trimmedTitle,
      subtitle: draft.subtitle.trim() || null,
      body: draft.body.trim() || null,
      details: parsedDetails.data,
      linkedDocumentIds: entry?.linkedDocumentIds ?? [],
      tags: tagsArray,
      // Enforced, not defaulted. An entry that is not personal is returned to
      // every signed-in caller of the shared read, so a compliance requirement
      // left unticked would put a named doctor's registration, indemnity,
      // credentialing or police-clearance record on a page any account on this
      // site can open. There is no version of a compliance requirement
      // that belongs to anybody but its owner, so the editor does not offer
      // the choice — see the statement that replaces the tick box below.
      isPersonal: complianceForcesPrivate || draft.isPersonal,
      // Forced off for the same reason `isPersonal` is forced on, and with the
      // same asymmetry: a compliance row is never printed, so storing a true
      // flag it cannot act on would mean that unticking "Compliance
      // requirement" later put the row on the card without anyone choosing it.
      includeOnCard: complianceForcesPrivate ? false : draft.includeOnCard,
      sortOrder: entry?.sortOrder ?? 0,
      lastVerifiedAt: entry?.lastVerifiedAt ?? null,
    };

    setBusy("saving");
    try {
      const response = await fetch(entry ? `/api/on-call/entries/${entry.id}` : "/api/on-call/entries", {
        method: entry ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw await parseApiErrorResponse(response);
      const body: unknown = await response.json();
      const parsedEntry = onCallEntrySchema.safeParse((body as { entry?: unknown } | null)?.entry);
      if (!parsedEntry.success) throw new Error("Save response was invalid.");
      onSaved(parsedEntry.data);
      onClose();
    } catch (error) {
      if (
        (typeof navigator !== "undefined" && !navigator.onLine) ||
        (error instanceof TypeError &&
          (error.message.toLowerCase().includes("fetch") || error.message.toLowerCase().includes("load failed")))
      ) {
        setFormError("You are offline. Connect to save this entry.");
      } else {
        setFormError(error instanceof Error ? error.message : "Could not save this entry.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!entry) return;
    // Belt and braces: an example row is never written to the account.
    if (isOnCallExampleEntry(entry)) return;
    setBusy("deleting");
    setFormError(null);
    try {
      const response = await fetch(`/api/on-call/entries/${entry.id}`, { method: "DELETE" });
      if (!response.ok) throw await parseApiErrorResponse(response);
      setConfirmDeleteOpen(false);
      onDeleted?.(entry.id);
      onClose();
    } catch (error) {
      setConfirmDeleteOpen(false);
      if (
        (typeof navigator !== "undefined" && !navigator.onLine) ||
        (error instanceof TypeError &&
          (error.message.toLowerCase().includes("fetch") || error.message.toLowerCase().includes("load failed")))
      ) {
        setFormError("You are offline. Connect to delete this entry.");
      } else {
        setFormError(error instanceof Error ? error.message : "Could not delete this entry.");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={entry ? `Edit ${entry.title}` : `Add to ${ON_CALL_VIEW_TITLES[creatingView]}`}
        mobilePlacement="bottom"
        testId="on-call-entry-editor"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {entry && onDeleted ? (
              <Button
                variant="danger"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={busy !== null}
                icon={Trash2}
                testId="on-call-entry-editor-delete"
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSave()}
                busy={busy === "saving"}
                busyLabel="Saving…"
                disabled={busy !== null}
                testId="on-call-entry-editor-save"
              >
                Save
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4">
          {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}

          {entry && freshness?.state === "stale" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2">
              <OnCallFreshnessBadge freshness={freshness} />
              <OnCallVerifyButton
                entry={entry}
                onVerified={(verified) => {
                  onSaved(verified);
                  onClose();
                }}
              />
            </div>
          ) : null}

          <TextField
            label="Title"
            required
            hint="Shown as the row's heading."
            error={fieldErrors.title}
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />

          {/* Above the fields, not down with the other tick boxes: it decides
              which fields render below it and which folders they offer, so it
              has to be answered first to read as anything but a surprise. */}
          {section === "logistics" ? (
            <>
              <Checkbox
                label="Compliance requirement"
                description={
                  <>
                    Something that expires — registration, indemnity, a mandatory module. It moves to Compliance, it
                    asks what lapsing costs, and it is kept private to you.
                    {switchLossWarning ? (
                      <strong className="font-semibold text-[color:var(--warning)]">{switchLossWarning}</strong>
                    ) : null}
                  </>
                }
                checked={draft.isCompliance}
                onChange={(event) => setCompliance(event.target.checked)}
              />
              {/* The only way a reader who cannot see the form learns that it
                  just changed shape. A sibling node rather than `aria-live` on
                  the fields themselves, which would re-announce on mount. */}
              <span role="status" aria-live="polite" className="sr-only" data-testid="on-call-entry-editor-form-shape">
                {formShapeAnnouncement}
              </span>
            </>
          ) : null}

          {fieldSpecs.map((field) => (
            <DetailField
              key={field.key}
              field={field}
              value={draft.details[field.key] ?? ""}
              error={fieldErrors[field.key]}
              onChange={(value) => setDetailValue(field.key, value)}
            />
          ))}

          {section === "orientation" ? (
            <p className={cn("text-sm", textMuted)}>
              An orientation entry is a document and, optionally, your own pinned note. The folder above is the only
              other thing stored here — leave it unset and the entry files under the page&rsquo;s fallback heading.
            </p>
          ) : null}

          <TextField
            label="Tags"
            hint={
              section === "contacts"
                ? 'Comma-separated. The first tag groups this entry, e.g. "Ward 4B".'
                : "Comma-separated."
            }
            value={draft.tags}
            onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
          />

          <TextField
            label="Subtitle"
            value={draft.subtitle}
            onChange={(event) => setDraft((current) => ({ ...current, subtitle: event.target.value }))}
          />

          <TextAreaField
            label="Notes"
            hint="Administrative notes only. Clinical guidance belongs in a linked document, not here."
            value={draft.body}
            onChange={(value) => setDraft((current) => ({ ...current, body: value }))}
          />

          {/* Both privacy sentences below used to end "and out of any export".
              On Call has no export — no route, no button, no serialiser — so
              that clause was a privacy guarantee about a feature that does not
              exist, on the one form in this app where the reader is deciding
              what happens to their own registration and clearance records. It
              names the two surfaces that are real: the shared read
              (`isPersonal`) and the printable card (`selectCardEntries`). If an
              export is ever built, excluding private rows is the work, and this
              wording can then say so truthfully. */}
          <div className="grid gap-1">
            {section === "contacts" && !draft.isRoleExplainer ? (
              <Checkbox
                label="Call first on the home"
                description="Puts this number on the On Call home as one of the first two to ring on a shift."
                checked={draftHasTag(draft.tags, ON_CALL_HOME_TAGS.callFirst)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    tags: setDraftTag(current.tags, ON_CALL_HOME_TAGS.callFirst, event.target.checked),
                  }))
                }
                data-testid="on-call-entry-editor-call-first"
              />
            ) : null}
            {section === "contacts" ? (
              <Checkbox
                label="Who's who entry"
                description="A role explainer instead of a dialling contact. The number to ring stays on Contacts."
                checked={draft.isRoleExplainer}
                onChange={(event) => setDraft((current) => ({ ...current, isRoleExplainer: event.target.checked }))}
              />
            ) : null}
            {complianceForcesPrivate ? (
              /* A sentence, not a ticked and disabled tick box. A control that
                 cannot be operated still reads as a setting somebody forgot to
                 enable; where there is no choice to make, saying so in words is
                 the honest form. */
              <p
                data-testid="on-call-entry-editor-compliance-privacy"
                className={cn("px-1 py-1.5 text-xs leading-5", textMuted)}
              >
                Private to you. A compliance requirement is your own record, so this entry is never shared: it stays off
                the pages other signed-in users read, and off the printable card.
              </p>
            ) : (
              <Checkbox
                label="Private — only you"
                description="An entry that is not private can be read by anyone signed in to this site. A private one stays off their pages and off the printable card."
                checked={draft.isPersonal}
                onChange={(event) => setDraft((current) => ({ ...current, isPersonal: event.target.checked }))}
              />
            )}
            {/* Not offered on a compliance requirement, for the same reason the
                privacy tick box is not: it would be a control that cannot do
                anything. `selectCardEntries` excludes these rows outright — a
                requirement's meaning is its date, its consequence band and how
                the date came to be believed, and the card has room for none of
                them, nor for the note saying nothing here is checked with an
                issuing body. Ticking a box that silently never prints is the
                same defect as a privacy box that silently never protects. */}
            {complianceForcesPrivate ? null : (
              <Checkbox
                label="Include on printable card"
                checked={draft.includeOnCard}
                onChange={(event) => setDraft((current) => ({ ...current, includeOnCard: event.target.checked }))}
              />
            )}
          </div>
        </div>
      </Sheet>

      {entry ? (
        <ConfirmDialog
          open={confirmDeleteOpen}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={() => void handleDelete()}
          title="Delete entry"
          description={`This permanently removes "${entry.title}" from On Call. This cannot be undone.`}
          confirmLabel={`Delete ${entry.title}`}
          busy={busy === "deleting"}
          busyLabel="Deleting…"
        />
      ) : null}
    </>
  );
}

// Re-exported so existing imports keep working; the button itself lives on its own
// so the section lists do not pull this editor into first load.
export { OnCallVerifyButton, type OnCallVerifyButtonProps };
