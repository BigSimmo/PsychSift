import { dateKeyToUtcMillis, isValidTime } from "@/lib/calendar/date-keys";

/**
 * The owner's reminder controls: whether each kind of reminder shows in the
 * app, whether it puts an alert on the phone through the calendar, quiet hours
 * for those alerts, and how many alerts one day may carry.
 *
 * This is a settings layer over reminders that already exist. It never decides
 * when a CME routine is due or when a compliance date passes; it only decides
 * whether an existing nudge is shown, and whether an existing calendar event
 * carries an alarm. The defaults reproduce the app as it was before this
 * existed: every nudge shown in the app, no calendar alarms at all.
 *
 * Nothing here sends anything anywhere. A calendar alarm reaches a phone only
 * through the owner's own calendar link or a file they downloaded.
 *
 * This file holds the types, defaults and normalising only, and imports nothing
 * but the date-key helpers: the account preferences load it on every page. The
 * alarm and quiet-hours logic is in `@/lib/reminders/settings`, which re-exports
 * everything here.
 */

/**
 * Every reminder type, in priority order: when a day has more alerts than the
 * owner allows, the ones earlier in this list are kept. A new reminder (for
 * example a future "Shifts" type) is one more line here plus its labels.
 */
export const REMINDER_TYPES = [
  "compliance-dates",
  "on-call-checks",
  "shifts",
  "cpd-year-end",
  "cpd-routines",
  "teaching",
] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

/** The order the Settings block lists them in: CPD first, as the plan reads. */
export const REMINDER_TYPE_DISPLAY_ORDER: readonly ReminderType[] = [
  "cpd-routines",
  "cpd-year-end",
  "on-call-checks",
  "shifts",
  "compliance-dates",
  "teaching",
];

export const REMINDER_TYPE_LABELS: Record<ReminderType, string> = {
  "cpd-routines": "CPD routines due",
  "cpd-year-end": "CPD year-end claim",
  "on-call-checks": "On Call checks",
  "compliance-dates": "Compliance dates",
  teaching: "Teaching",
  shifts: "Shifts",
};

/**
 * Where a type's calendar alert can reach. On Call checks are never calendar
 * events (they are derived from how long ago a row was confirmed), and
 * compliance dates are deliberately kept out of the private calendar link, so
 * they reach a phone only through a downloaded file.
 */
export type ReminderCalendarReach = "link-and-file" | "file-only" | "none";
export const REMINDER_CALENDAR_REACH: Record<ReminderType, ReminderCalendarReach> = {
  "cpd-routines": "link-and-file",
  "cpd-year-end": "link-and-file",
  "on-call-checks": "none",
  "compliance-dates": "file-only",
  teaching: "link-and-file",
  shifts: "link-and-file",
};

/**
 * `"evening-before"` is a fixed 20:00 Perth alarm the day before, not a
 * duration before the shift's own start time (a night shift starting at
 * 21:30 would otherwise alert mid-afternoon). It is offered only for the
 * `"shifts"` type; every other type keeps its calendar alert off or picks
 * one of the duration-based lead times.
 */
export const REMINDER_LEAD_TIMES = ["off", "at-time", "1h", "1d", "1w", "evening-before"] as const;
export type ReminderLeadTime = (typeof REMINDER_LEAD_TIMES)[number];

export const REMINDER_LEAD_TIME_LABELS: Record<ReminderLeadTime, string> = {
  off: "Off",
  "at-time": "At the time",
  "1h": "1 hour before",
  "1d": "1 day before",
  "1w": "1 week before",
  "evening-before": "The evening before (20:00)",
};

export type ReminderTypeSettings = {
  /** Off hides this type's nudges in the app. It never touches the calendar. */
  readonly showInApp: boolean;
  readonly calendarAlert: ReminderLeadTime;
  /** Perth date, `YYYY-MM-DD`: the nudge is hidden before this day. Null when not snoozed. */
  readonly snoozedUntil: string | null;
};

export type ReminderQuietHours = {
  readonly enabled: boolean;
  /** Perth wall-clock `HH:MM`. A window may cross midnight (21:00 to 07:00). */
  readonly start: string;
  readonly end: string;
};

/**
 * The morning brief: one phone alert instead of many. It goes out at `workday`
 * on a day with a shift and at `dayOff` otherwise, waits until 14:00 after a
 * night shift, and moves to the end of quiet hours (owner decisions 2 and 3,
 * 5 Oct 2026). Off by default, so nobody is buzzed who did not ask.
 */
export type MorningBriefSettings = {
  readonly enabled: boolean;
  /** Perth wall-clock `HH:MM`. */
  readonly workday: string;
  readonly dayOff: string;
};

export type ReminderSettings = {
  readonly types: Readonly<Record<ReminderType, ReminderTypeSettings>>;
  readonly quietHours: ReminderQuietHours;
  /** Calendar alerts a single Perth day may carry. */
  readonly maxAlertsPerDay: number;
  readonly brief: MorningBriefSettings;
};

export type ReminderSettingsPatch = {
  readonly types?: Partial<Record<ReminderType, Partial<ReminderTypeSettings>>>;
  readonly quietHours?: Partial<ReminderQuietHours>;
  readonly maxAlertsPerDay?: number;
  readonly brief?: Partial<MorningBriefSettings>;
};

export const MIN_ALERTS_PER_DAY = 1;
export const MAX_ALERTS_PER_DAY = 10;
export const SNOOZE_DAYS = 7;

/** Where an all-day event's alert is anchored, in Perth wall-clock minutes (09:00). */
export const ALL_DAY_ALERT_BASE_MINUTES = 9 * 60;

const DEFAULT_TYPE_SETTINGS: ReminderTypeSettings = { showInApp: true, calendarAlert: "off", snoozedUntil: null };

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  types: {
    "compliance-dates": DEFAULT_TYPE_SETTINGS,
    "on-call-checks": DEFAULT_TYPE_SETTINGS,
    shifts: DEFAULT_TYPE_SETTINGS,
    "cpd-year-end": DEFAULT_TYPE_SETTINGS,
    "cpd-routines": DEFAULT_TYPE_SETTINGS,
    teaching: DEFAULT_TYPE_SETTINGS,
  },
  quietHours: { enabled: false, start: "21:00", end: "07:00" },
  maxAlertsPerDay: 3,
  brief: { enabled: false, workday: "07:00", dayOff: "09:00" },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isReminderType(value: unknown): value is ReminderType {
  return typeof value === "string" && (REMINDER_TYPES as readonly string[]).includes(value);
}

function isLeadTime(value: unknown): value is ReminderLeadTime {
  return typeof value === "string" && (REMINDER_LEAD_TIMES as readonly string[]).includes(value);
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && dateKeyToUtcMillis(value) !== null;
}

function normalizeTypeSettings(input: unknown): ReminderTypeSettings {
  if (!isPlainObject(input)) return DEFAULT_TYPE_SETTINGS;
  return {
    showInApp: typeof input.showInApp === "boolean" ? input.showInApp : DEFAULT_TYPE_SETTINGS.showInApp,
    calendarAlert: isLeadTime(input.calendarAlert) ? input.calendarAlert : DEFAULT_TYPE_SETTINGS.calendarAlert,
    snoozedUntil: isDateKey(input.snoozedUntil) ? input.snoozedUntil : null,
  };
}

/** Any stored value, including garbage, becomes a complete and valid settings object. */
export function normalizeReminderSettings(input: unknown): ReminderSettings {
  if (!isPlainObject(input)) return DEFAULT_REMINDER_SETTINGS;
  const types = isPlainObject(input.types) ? input.types : {};
  const quiet = isPlainObject(input.quietHours) ? input.quietHours : {};
  const brief = isPlainObject(input.brief) ? input.brief : {};
  const defaults = DEFAULT_REMINDER_SETTINGS;
  const cap = input.maxAlertsPerDay;
  return {
    types: Object.fromEntries(REMINDER_TYPES.map((type) => [type, normalizeTypeSettings(types[type])])) as Record<
      ReminderType,
      ReminderTypeSettings
    >,
    quietHours: {
      enabled: typeof quiet.enabled === "boolean" ? quiet.enabled : defaults.quietHours.enabled,
      start: typeof quiet.start === "string" && isValidTime(quiet.start) ? quiet.start : defaults.quietHours.start,
      end: typeof quiet.end === "string" && isValidTime(quiet.end) ? quiet.end : defaults.quietHours.end,
    },
    maxAlertsPerDay:
      typeof cap === "number" && Number.isInteger(cap) && cap >= MIN_ALERTS_PER_DAY && cap <= MAX_ALERTS_PER_DAY
        ? cap
        : defaults.maxAlertsPerDay,
    brief: {
      enabled: typeof brief.enabled === "boolean" ? brief.enabled : defaults.brief.enabled,
      workday: typeof brief.workday === "string" && isValidTime(brief.workday) ? brief.workday : defaults.brief.workday,
      dayOff: typeof brief.dayOff === "string" && isValidTime(brief.dayOff) ? brief.dayOff : defaults.brief.dayOff,
    },
  };
}

/**
 * Apply a partial update field by field, so a client that knows fewer reminder
 * types than the server (an older tab) never resets the ones it omits.
 */
export function mergeReminderSettings(base: ReminderSettings, patch: ReminderSettingsPatch): ReminderSettings {
  return normalizeReminderSettings({
    types: Object.fromEntries(
      REMINDER_TYPES.map((type) => [type, { ...base.types[type], ...(patch.types?.[type] ?? {}) }]),
    ),
    quietHours: { ...base.quietHours, ...(patch.quietHours ?? {}) },
    maxAlertsPerDay: patch.maxAlertsPerDay ?? base.maxAlertsPerDay,
    brief: { ...base.brief, ...(patch.brief ?? {}) },
  });
}

export function updateReminderType(
  settings: ReminderSettings,
  type: ReminderType,
  patch: Partial<ReminderTypeSettings>,
): ReminderSettings {
  return { ...settings, types: { ...settings.types, [type]: { ...settings.types[type], ...patch } } };
}
