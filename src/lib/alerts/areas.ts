import {
  isSnoozed,
  REMINDER_CALENDAR_REACH,
  type ReminderLeadTime,
  type ReminderSettings,
  type ReminderType,
} from "@/lib/reminders/settings";

/**
 * The areas the Alerts page lists under "By area", each over the reminder
 * types that already exist for it. Every line a row shows is built here from
 * the stored settings, so the subtitle always says what the app will actually
 * do, never what the design hopes it will do.
 */
export const ALERT_AREA_IDS = ["roster", "renewals", "cpd", "teaching", "on-call"] as const;
export type AlertAreaId = (typeof ALERT_AREA_IDS)[number];

export type AlertArea = {
  readonly id: AlertAreaId;
  readonly title: string;
  /** The mode whose colour the row's dot is painted in. */
  readonly mode: string;
  readonly description: string;
  /** Reminder types whose calendar alerts this area's sheet sets. */
  readonly types: readonly ReminderType[];
  /**
   * Types whose "Show in the app" decides what My Day shows. Empty means My
   * Day always shows the area (Roster, and renewals by owner decision).
   */
  readonly myDayTypes: readonly ReminderType[];
};

export const ALERT_AREAS: Readonly<Record<AlertAreaId, AlertArea>> = {
  roster: {
    id: "roster",
    title: "Roster and shifts",
    mode: "roster",
    description: "Roster changes, swap and open-shift requests, and your next shift",
    types: ["shifts"],
    myDayTypes: [],
  },
  renewals: {
    id: "renewals",
    title: "Admin renewals",
    mode: "my-work",
    description: "Registration, indemnity, life support, manual handling and more",
    types: ["compliance-dates"],
    myDayTypes: [],
  },
  cpd: {
    id: "cpd",
    title: "CPD",
    mode: "cme",
    description: "Your CPD routines and the year-end claim",
    types: ["cpd-routines", "cpd-year-end"],
    myDayTypes: ["cpd-routines"],
  },
  teaching: {
    id: "teaching",
    title: "Teaching",
    mode: "teaching",
    description: "Teaching sessions on your calendar",
    types: ["teaching"],
    myDayTypes: ["teaching"],
  },
  "on-call": {
    id: "on-call",
    title: "On Call checks",
    mode: "on-call",
    description: "On Call details that are due to be checked again",
    types: ["on-call-checks"],
    myDayTypes: ["on-call-checks"],
  },
};

export const LEAD_PHRASES: Readonly<Record<Exclude<ReminderLeadTime, "off">, string>> = {
  "at-time": "at the time",
  "1h": "1 hour before",
  "1d": "1 day before",
  "1w": "1 week before",
  "evening-before": "the evening before",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-10-12" -> "12 Oct". */
export function shortDay(dateKey: string): string {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]}`;
}

/** What the reader has set for Roster's own phone alerts, as the Roster settings store it. */
export type RosterAlertChoices = {
  /** Whether THIS device is receiving phone alerts. */
  readonly phoneOn: boolean;
  /** Null until Roster's settings have loaded, so a default is never shown as the reader's choice. */
  readonly changes: boolean | null;
  readonly requests: boolean | null;
  /** Roster's settings could not be read. */
  readonly failed?: boolean;
  /** Null while Roster's settings have not loaded. */
  readonly calendarShifts: boolean | null;
};

function inMyDayPart(area: AlertArea, settings: ReminderSettings, today: string): string {
  if (area.myDayTypes.length === 0) return "Always in My Day";
  const shown = area.myDayTypes.filter((type) => settings.types[type].showInApp);
  if (shown.length === 0) return "Hidden in My Day";
  const snoozed = shown
    .filter((type) => isSnoozed(settings, type, today))
    .map((type) => settings.types[type].snoozedUntil!)
    .sort();
  if (snoozed.length === shown.length) return `Snoozed until ${shortDay(snoozed[snoozed.length - 1]!)}`;
  return "In My Day";
}

function calendarPart(area: AlertArea, settings: ReminderSettings): string | null {
  const reachable = area.types.filter((type) => REMINDER_CALENDAR_REACH[type] !== "none");
  if (reachable.length === 0) return null;
  const leads = [
    ...new Set(reachable.map((type) => settings.types[type].calendarAlert).filter((lead) => lead !== "off")),
  ];
  if (leads.length === 0) return null;
  if (leads.length > 1) return "calendar alerts on";
  return `calendar ${LEAD_PHRASES[leads[0] as Exclude<ReminderLeadTime, "off">]}`;
}

function rosterPhonePart(roster: RosterAlertChoices): string {
  if (!roster.phoneOn) return "In Roster and My Day";
  if (roster.changes === null || roster.requests === null)
    return roster.failed ? "Couldn't load Roster settings" : "Checking Roster settings";
  if (roster.changes && roster.requests) return "Changes and requests straight away";
  if (roster.changes) return "Changes straight away";
  if (roster.requests) return "Requests straight away";
  return "Not on this device";
}

/** The one-line subtitle of an area's row. */
export function areaSummary(
  id: AlertAreaId,
  settings: ReminderSettings,
  today: string,
  roster: RosterAlertChoices,
): string {
  const area = ALERT_AREAS[id];
  if (id === "roster") {
    const parts = [rosterPhonePart(roster)];
    // A shift calendar alert can only fire once shifts are on the calendar link.
    if (roster.calendarShifts !== false) {
      if (settings.types.shifts.calendarAlert === "evening-before") parts.push("next shift the evening before");
      else {
        const calendar = calendarPart(area, settings);
        if (calendar) parts.push(calendar);
      }
    }
    return parts.join(" · ");
  }
  const parts = [inMyDayPart(area, settings, today)];
  const calendar = calendarPart(area, settings);
  if (calendar) parts.push(calendar);
  else if (parts[0] === "In My Day" && area.types.every((type) => REMINDER_CALENDAR_REACH[type] === "none"))
    parts[0] = "In My Day only";
  return parts.join(" · ");
}
