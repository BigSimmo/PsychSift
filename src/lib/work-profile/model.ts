import type { WorkStagePreference } from "@/lib/account-preferences";
import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import { RULE_GATE_REASON_WORDS, type RuleGate } from "@/lib/admin/rule-sign-off";
import { setupRequirementRecorded, type SetupRequirement } from "@/lib/admin/setup";
import { isComplianceEntry } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { fatigueWarnings } from "@/lib/roster/fatigue-rules";
import { FATIGUE_RULE_SET, FATIGUE_RULES_SIGN_OFF } from "@/lib/roster/fatigue-rules-source";
import { perthCalendarDate } from "@/lib/perth-time";

/**
 * Work profile: the one page where a doctor sets up the Work side once. This
 * module turns each area's loaded data into the row the page shows, so the
 * honest-state rules live in one tested place:
 *   - a read that failed, or has not finished, never shows "Ready", "recorded"
 *     or a zero count — it shows "Not checked";
 *   - Admin never shows a tick, because the app cannot check registration with
 *     Ahpra, only the dates the doctor typed;
 *   - a date never entered is a neutral note, not a warning (it is not overdue).
 */

export type WorkProfileTab = "profile" | "work" | "alerts" | "privacy";

export const WORK_PROFILE_TABS: ReadonlyArray<{ id: WorkProfileTab; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "work", label: "Work & leave" },
  { id: "alerts", label: "Alerts" },
  { id: "privacy", label: "Privacy" },
];

export function readWorkProfileTab(value: string | null | undefined): WorkProfileTab {
  return WORK_PROFILE_TABS.some((tab) => tab.id === value) ? (value as WorkProfileTab) : "profile";
}

/** A source as the page sees it: still loading, failed, signed out, or loaded. */
export type Loaded<T> =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "signed-out" }
  | { readonly status: "ready"; readonly value: T };

export type AreaId = "roster" | "teaching" | "cpd" | "admin" | "on-call";

/**
 * The right-hand state of one "Set up each area" row.
 * - `ready`: set up (a quiet tick and "Ready").
 * - `start`: nothing set up yet; the row is the first step.
 * - `optional`: usable with nothing to set.
 * - `count`: a neutral figure (Admin's "2 recorded" / "1 not recorded").
 * - `not-checked`: the read failed or is still running, so nothing is claimed.
 */
export type AreaState = "ready" | "start" | "optional" | "count" | "not-checked";

export type AreaRow = {
  readonly id: AreaId;
  readonly title: string;
  readonly subtitle: string;
  readonly state: AreaState;
  readonly label: string;
};

const NOT_CHECKED = "Not checked";

function notChecked(id: AreaId, title: string, loaded: Loaded<unknown>): AreaRow {
  return {
    id,
    title,
    subtitle: loaded.status === "loading" ? "Checking…" : "Didn’t load",
    state: "not-checked",
    label: NOT_CHECKED,
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function rosterArea(loaded: Loaded<{ workplaces: number; rowName: string | null }>): AreaRow {
  if (loaded.status !== "ready") return notChecked("roster", "Roster", loaded);
  const { workplaces, rowName } = loaded.value;
  if (workplaces === 0 && !rowName) {
    return {
      id: "roster",
      title: "Roster",
      subtitle: "Import your roster to see your shifts",
      state: "start",
      label: "Start",
    };
  }
  const parts = [plural(workplaces, "workplace", "workplaces")];
  if (rowName) parts.push(`your line ${rowName}`);
  return { id: "roster", title: "Roster", subtitle: parts.join(" · "), state: "ready", label: "Ready" };
}

export function teachingArea(loaded: Loaded<{ teams: number }>): AreaRow {
  if (loaded.status !== "ready") return notChecked("teaching", "Teaching", loaded);
  if (loaded.value.teams === 0) {
    return {
      id: "teaching",
      title: "Teaching",
      subtitle: "Ask your service’s organiser to invite you",
      state: "start",
      label: "Start",
    };
  }
  return {
    id: "teaching",
    title: "Teaching",
    subtitle: `${plural(loaded.value.teams, "team", "teams")} followed`,
    state: "ready",
    label: "Ready",
  };
}

export function cpdArea(
  loaded: Loaded<{ configured: boolean; routines: number }>,
  stage: WorkStagePreference | null,
  ranzcpStage: number | null = null,
): AreaRow {
  // The Medical Board (checked 5 Oct 2026): for PGY3+ doctors in college
  // training, "Your CPD is taken care of in your training."
  // Self-reported, so no tick: a neutral "Covered", and only once a RANZCP stage
  // is chosen (a service registrar outside training still needs a CPD home).
  if (stage === "registrar" && ranzcpStage) {
    return { id: "cpd", title: "CPD", subtitle: "Through your RANZCP training", state: "optional", label: "Covered" };
  }
  if (loaded.status !== "ready") return notChecked("cpd", "CPD", loaded);
  if (!loaded.value.configured) {
    return {
      id: "cpd",
      title: "CPD",
      subtitle: "Set your CPD home and this year’s plan",
      state: "start",
      label: "Start",
    };
  }
  const year = "This year’s plan";
  const subtitle =
    loaded.value.routines > 0 ? `${year} and ${plural(loaded.value.routines, "routine", "routines")}` : year;
  return { id: "cpd", title: "CPD", subtitle, state: "ready", label: "Ready" };
}

const SETUP_DATES: ReadonlyArray<{ kind: SetupRequirement; label: string }> = [
  { kind: "registration", label: "Medical registration renewal" },
  { kind: "indemnity", label: "Indemnity insurance" },
];

export type AdminSummary = {
  /** Compliance dates the doctor has entered. */
  readonly recorded: number;
  /** The setup dates (registration, indemnity) never entered, by name. */
  readonly missing: readonly string[];
  /** True when the list came from the phone's copy after a failed refresh. */
  readonly partial: boolean;
};

export function summariseAdmin(entries: readonly OnCallEntry[], partial: boolean): AdminSummary {
  return {
    recorded: entries.filter(isComplianceEntry).length,
    missing: SETUP_DATES.filter(({ kind }) => !setupRequirementRecorded(entries, kind)).map(({ label }) => label),
    partial,
  };
}

export function adminArea(loaded: Loaded<AdminSummary>): AreaRow {
  if (loaded.status !== "ready") return notChecked("admin", "Admin", loaded);
  const { recorded, missing, partial } = loaded.value;
  const row = { id: "admin", title: "Admin" } as const;
  const subtitle = partial
    ? "Only partly loaded · not checked with Ahpra"
    : "Dates you entered; not checked with Ahpra";
  // A partial copy with nothing in it proves nothing: it may just be the part that didn't load.
  if (recorded === 0 && partial) return { ...row, subtitle, state: "not-checked", label: NOT_CHECKED };
  if (recorded === 0) {
    return { ...row, subtitle: "Record registration and other renewal dates", state: "start", label: "Start" };
  }
  const figure = missing.length > 0 ? `${missing.length} not recorded` : `${recorded} recorded`;
  return { ...row, subtitle, state: "count", label: partial ? `At least ${figure}` : figure };
}

export function onCallArea(hospitalPhone: boolean): AreaRow {
  return {
    id: "on-call",
    title: "On Call",
    subtitle: hospitalPhone ? "Hospital phone on" : "Hospital phone off",
    state: "ready",
    label: "Ready",
  };
}

/**
 * The setup dates never entered, from a complete Admin read that has something
 * in it. A failed or partial read gives none rather than a list that could be
 * too short, and an empty Admin is already a Start row, so nothing doubles it.
 */
export function missingSetupDates(admin: Loaded<AdminSummary>): readonly string[] {
  if (admin.status !== "ready" || admin.value.partial || admin.value.recorded === 0) return [];
  return admin.value.missing;
}

/** The Profile tab's count: the setup dates never entered, or nothing. */
export function profileTabCount(admin: Loaded<AdminSummary>): number | undefined {
  return missingSetupDates(admin).length || undefined;
}

export type RestRule = { readonly label: string; readonly clause: string; readonly value: string };

/** The agreement figures Roster checks a fortnight against, read from the one signed source. */
export function restRules(): readonly RestRule[] {
  const { rules } = FATIGUE_RULE_SET;
  return [
    { label: "Break between shifts", clause: rules.minBreakHours.clause, value: `${rules.minBreakHours.hours} h` },
    { label: "Most hours in 7 days", clause: rules.maxHours7d.clause, value: `${rules.maxHours7d.hours} h` },
    {
      label: `Days in a row before ${rules.maxDaysBeforeTwoDaysOff.hoursOff} h off`,
      clause: rules.maxDaysBeforeTwoDaysOff.clause,
      value: String(rules.maxDaysBeforeTwoDaysOff.days),
    },
  ];
}

/** "2 Sep 2027" from a calendar date or an instant (read on the Perth day), as the Renewals page prints dates. */
function formatIsoDate(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatRecordedDate(value);
  return Number.isNaN(Date.parse(value)) ? null : formatRecordedDate(perthCalendarDate(value));
}

/** Whether Roster is applying the rest rules now: the same gate as its Hours check, review date included. */
export function restRulesGate(now: number = Date.now()): RuleGate {
  return fatigueWarnings([], FATIGUE_RULES_SIGN_OFF, undefined, now).gate;
}

/**
 * Where the rest-rule figures come from, and whether Roster is using them.
 * Off reads plainly (the gate's reason) rather than implying the limits apply.
 */
export function restRulesProvenance(gate: RuleGate = restRulesGate()): string {
  const { source } = FATIGUE_RULE_SET;
  const checked = formatIsoDate(source.checkedOn);
  const expires = formatIsoDate(source.expiresOn);
  let signed: string;
  if (gate.on) {
    signed = `checked ${checked} and signed off by ${FATIGUE_RULES_SIGN_OFF.signedBy} on ${formatIsoDate(FATIGUE_RULES_SIGN_OFF.signedAt)}.`;
  } else {
    const reason = RULE_GATE_REASON_WORDS[gate.reason];
    signed = `checked ${checked}. Roster doesn’t check them now: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`;
  }
  return `Quoted from the agreement, ${signed} It expires on ${expires} but stays in force until a new one is made. These are the agreement’s limits, not a safety judgement.`;
}

const WEEKDAY = new Intl.DateTimeFormat("en-AU", { weekday: "long", timeZone: "UTC" });

/** "Thursday" from a team's pay-fortnight anchor date (YYYY-MM-DD). */
export function payFortnightWeekday(anchor: string | null): string | null {
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return null;
  const time = Date.parse(`${anchor}T00:00:00Z`);
  return Number.isFinite(time) ? WEEKDAY.format(time) : null;
}

/** Workplace names as Roster lists them: any import's workplace, plus any with saved shift codes. */
export function workplaceNames(
  shifts: ReadonlyArray<{ readonly workplace: string | null }>,
  codes: Readonly<Record<string, unknown>>,
): string[] {
  const names = new Set<string>();
  for (const shift of shifts) if (shift.workplace) names.add(shift.workplace);
  for (const name of Object.keys(codes)) if (name) names.add(name);
  return [...names].sort((a, b) => a.localeCompare(b));
}
