import { addDaysToDate, formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/perth-time";

/**
 * My Day › Earlier alerts: the alerts that buzzed THIS phone in the last 7 days.
 *
 * There is no server history of sent alerts. The server sends only a type code
 * (`{t:"brief"}`), the service worker (`public/sw.js`, `ROSTER_PUSH`) owns
 * every word on the lock screen and where a tap goes, and nothing records what
 * arrived. So this list is built on the phone from what the phone can see:
 *
 * - the alerts still on the lock screen (`registration.getNotifications()`),
 * - and alerts that arrive while a PsychSift page is open (the worker tells
 *   open pages the code).
 *
 * Each alert is kept here as its code and time only, never words from a
 * record, for 7 days, on this device, for this account.
 *
 * `ALERT_CODES` mirrors `ROSTER_PUSH` in `public/sw.js` word for word (a test
 * reads that file and fails when they drift).
 */

export const EARLIER_ALERTS_STORAGE_KEY = "psychsift:my-day:earlier-alerts-v1";
export const EARLIER_ALERTS_DAYS = 7;
export const EARLIER_ALERTS_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export type EarlierAlertArea = "roster" | "brief" | "reminder" | "test";

export const EARLIER_ALERT_AREAS: Readonly<
  Record<EarlierAlertArea, { readonly label: string; readonly mode: string }>
> = {
  roster: { label: "Roster", mode: "roster" },
  brief: { label: "Morning brief", mode: "my-day" },
  reminder: { label: "Reminders", mode: "my-day" },
  test: { label: "Test alerts", mode: "my-day" },
};
export const EARLIER_ALERT_AREA_ORDER: readonly EarlierAlertArea[] = ["roster", "brief", "reminder", "test"];

export type AlertCode = "changed" | "request" | "offer" | "manage" | "test" | "brief" | "reminder";

export type AlertCodeInfo = {
  /** The lock screen's title, as the worker draws it. */
  readonly lockTitle: string;
  /** The lock screen's words, exactly as the worker draws them. */
  readonly lockBody: string;
  /** Where a tap on the lock screen goes, and so where this row opens. */
  readonly path: string;
  readonly area: EarlierAlertArea;
  /** The short source word under the row ("Roster", "Morning brief"). */
  readonly source: string;
};

export const ALERT_CODES: Readonly<Record<AlertCode, AlertCodeInfo>> = {
  changed: {
    lockTitle: "Roster",
    lockBody: "Your roster changed. Open Roster to see what moved.",
    path: "/roster",
    area: "roster",
    source: "Roster",
  },
  request: {
    lockTitle: "Roster",
    lockBody: "Something in Roster is waiting for you.",
    path: "/roster/swaps",
    area: "roster",
    source: "Roster",
  },
  offer: {
    lockTitle: "Roster",
    lockBody: "A shift is open in your team. Open Roster to see it.",
    path: "/roster/swaps",
    area: "roster",
    source: "Roster",
  },
  manage: {
    lockTitle: "Roster",
    lockBody: "Something in Manage is waiting for you.",
    path: "/roster/manage",
    area: "roster",
    source: "Roster manager",
  },
  test: {
    lockTitle: "PsychSift",
    lockBody: "Test alert. Phone alerts are working on this device.",
    path: "/my-day/alerts",
    area: "test",
    source: "Test alert",
  },
  brief: {
    lockTitle: "PsychSift",
    lockBody: "Your morning brief is ready.",
    path: "/my-day",
    area: "brief",
    source: "Morning brief",
  },
  reminder: {
    lockTitle: "PsychSift",
    lockBody: "A reminder you set is due. Open PsychSift to see it.",
    path: "/my-day/alerts",
    area: "reminder",
    source: "Reminder",
  },
};

export function isAlertCode(value: unknown): value is AlertCode {
  return typeof value === "string" && Object.hasOwn(ALERT_CODES, value);
}

/** The row's title: the lock screen's first sentence, so the row says only what the lock screen said. */
export function alertRowTitle(code: AlertCode): string {
  const body = ALERT_CODES[code].lockBody;
  const end = body.indexOf(". ");
  return end === -1 ? body.replace(/\.$/, "") : body.slice(0, end);
}

export type EarlierAlert = {
  /** `<code>:<epoch ms>` for an exact time, `<code>:seen:<epoch ms>` when the phone gave no time. */
  readonly id: string;
  readonly code: AlertCode;
  /** Epoch ms it arrived, or when it was first seen on the lock screen (`approx`). */
  readonly at: number;
  /** True when the phone gave no arrival time, so `at` is when this page first saw it. */
  readonly approx: boolean;
  /** Epoch ms it was opened from this list, or null. */
  readonly openedAt: number | null;
};

/** One alert as the phone reports it: a code and, where the browser gives one, a time. */
export type SeenAlert = { readonly code: AlertCode; readonly at: number | null };

export type EarlierAlertsSnapshot = {
  readonly alerts: readonly EarlierAlert[];
  /** How many time-less alerts of each code were on the lock screen at the last read. */
  readonly trayApprox: Readonly<Partial<Record<AlertCode, number>>>;
  /** Ids the reader removed, so an alert still on the lock screen is not read back in. */
  readonly hidden: readonly string[];
};

export const EMPTY_SNAPSHOT: EarlierAlertsSnapshot = { alerts: [], trayApprox: {}, hidden: [] };
const HIDDEN_LIMIT = 200;

type Stored = {
  v: 1;
  owner: string;
  alerts: EarlierAlert[];
  trayApprox: Partial<Record<AlertCode, number>>;
  hidden: string[];
};

function isFiniteTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validAlert(value: unknown): value is EarlierAlert {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length <= 80 &&
    isAlertCode(row.code) &&
    isFiniteTime(row.at) &&
    typeof row.approx === "boolean" &&
    (row.openedAt === null || isFiniteTime(row.openedAt))
  );
}

/** Drops alerts older than 7 days (or from the future), newest first, at most 100. */
export function pruneAlerts(alerts: readonly EarlierAlert[], now: number): EarlierAlert[] {
  const oldest = now - EARLIER_ALERTS_DAYS * DAY_MS;
  const seen = new Set<string>();
  return [...alerts]
    .filter((alert) => alert.at >= oldest && alert.at <= now + 60_000)
    .sort((first, second) => second.at - first.at)
    .filter((alert) => (seen.has(alert.id) ? false : (seen.add(alert.id), true)))
    .slice(0, EARLIER_ALERTS_LIMIT);
}

/**
 * Reads the stored list for this account. Anything unreadable, or kept for a
 * different account (the sign-out clear may not have reached this key), reads
 * as an empty list, never as someone else's alerts.
 */
export function parseEarlierAlerts(raw: string | null, owner: string, now: number): EarlierAlertsSnapshot {
  if (!raw || !owner) return EMPTY_SNAPSHOT;
  try {
    const value = JSON.parse(raw) as Partial<Stored> | null;
    if (!value || value.v !== 1 || value.owner !== owner || !Array.isArray(value.alerts)) return EMPTY_SNAPSHOT;
    const trayApprox: Partial<Record<AlertCode, number>> = {};
    if (value.trayApprox && typeof value.trayApprox === "object") {
      for (const [code, count] of Object.entries(value.trayApprox)) {
        if (isAlertCode(code) && Number.isInteger(count) && (count as number) >= 0) trayApprox[code] = count as number;
      }
    }
    const hidden = Array.isArray(value.hidden)
      ? value.hidden.filter((id): id is string => typeof id === "string" && id.length <= 80).slice(-HIDDEN_LIMIT)
      : [];
    return { alerts: pruneAlerts(value.alerts.filter(validAlert), now), trayApprox, hidden };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export function serializeEarlierAlerts(snapshot: EarlierAlertsSnapshot, owner: string): string {
  const stored: Stored = {
    v: 1,
    owner,
    alerts: [...snapshot.alerts],
    trayApprox: { ...snapshot.trayApprox },
    hidden: [...snapshot.hidden],
  };
  return JSON.stringify(stored);
}

/**
 * Adds what the lock screen shows now. An alert with a time is the same alert
 * on every read (its id is code and time). One without a time (some phones
 * give none) is counted: only the extra ones since the last read are new, and
 * they are marked as "seen by" this read.
 */
export function mergeTray(
  snapshot: EarlierAlertsSnapshot,
  tray: readonly SeenAlert[],
  now: number,
): EarlierAlertsSnapshot {
  const added: EarlierAlert[] = [];
  const approxCounts: Partial<Record<AlertCode, number>> = {};
  for (const seen of tray) {
    if (seen.at !== null && isFiniteTime(seen.at)) {
      added.push({ id: `${seen.code}:${seen.at}`, code: seen.code, at: seen.at, approx: false, openedAt: null });
    } else {
      approxCounts[seen.code] = (approxCounts[seen.code] ?? 0) + 1;
    }
  }
  for (const code of Object.keys(approxCounts) as AlertCode[]) {
    const extra = (approxCounts[code] ?? 0) - (snapshot.trayApprox[code] ?? 0);
    for (let index = 0; index < extra; index += 1) {
      added.push({ id: `${code}:seen:${now}:${index}`, code, at: now, approx: true, openedAt: null });
    }
  }
  const known = new Set([...snapshot.alerts.map((alert) => alert.id), ...snapshot.hidden]);
  return {
    ...snapshot,
    alerts: pruneAlerts([...snapshot.alerts, ...added.filter((alert) => !known.has(alert.id))], now),
    trayApprox: approxCounts,
  };
}

/** Adds one alert the worker told an open page about, at the moment it arrived. */
export function addArrival(snapshot: EarlierAlertsSnapshot, code: AlertCode, now: number): EarlierAlertsSnapshot {
  const id = `${code}:${now}`;
  if (snapshot.alerts.some((alert) => alert.id === id) || snapshot.hidden.includes(id)) return snapshot;
  return {
    ...snapshot,
    alerts: pruneAlerts([{ id, code, at: now, approx: false, openedAt: null }, ...snapshot.alerts], now),
  };
}

export function markAlertOpened(snapshot: EarlierAlertsSnapshot, id: string, now: number): EarlierAlertsSnapshot {
  return {
    ...snapshot,
    alerts: snapshot.alerts.map((alert) =>
      alert.id === id && alert.openedAt === null ? { ...alert, openedAt: now } : alert,
    ),
  };
}

function hide(hidden: readonly string[], ids: readonly string[]): string[] {
  return [...new Set([...hidden, ...ids])].slice(-HIDDEN_LIMIT);
}

export function removeAlert(snapshot: EarlierAlertsSnapshot, id: string): EarlierAlertsSnapshot {
  return {
    ...snapshot,
    alerts: snapshot.alerts.filter((alert) => alert.id !== id),
    hidden: hide(snapshot.hidden, [id]),
  };
}

/** Empties the list. Alerts still on the lock screen stay out of it until they leave the lock screen. */
export function clearAlerts(snapshot: EarlierAlertsSnapshot): EarlierAlertsSnapshot {
  return {
    ...snapshot,
    alerts: [],
    hidden: hide(
      snapshot.hidden,
      snapshot.alerts.map((alert) => alert.id),
    ),
  };
}

/* ------------------------------------------------------------ view model */

export type AreaFilter = EarlierAlertArea | "all";

export function isAreaFilter(value: unknown): value is AreaFilter {
  return value === "all" || (typeof value === "string" && Object.hasOwn(EARLIER_ALERT_AREAS, value));
}

export function filterAlerts(alerts: readonly EarlierAlert[], filter: AreaFilter): EarlierAlert[] {
  return filter === "all" ? [...alerts] : alerts.filter((alert) => ALERT_CODES[alert.code].area === filter);
}

/** One chip per area that has alerts, in a fixed order, with counts that add up to All. */
export function areaChips(alerts: readonly EarlierAlert[]): { area: EarlierAlertArea; label: string; count: number }[] {
  return EARLIER_ALERT_AREA_ORDER.flatMap((area) => {
    const count = alerts.filter((alert) => ALERT_CODES[alert.code].area === area).length;
    return count ? [{ area, label: EARLIER_ALERT_AREAS[area].label, count }] : [];
  });
}

export type EarlierAlertDay = { readonly date: string; readonly label: string; readonly alerts: EarlierAlert[] };

/** Newest day first, each day's alerts newest first. Days are Perth days. */
export function groupAlertsByDay(alerts: readonly EarlierAlert[], now: number): EarlierAlertDay[] {
  const today = perthDateOf(now);
  const yesterday = addDaysToDate(today, -1);
  const days: EarlierAlertDay[] = [];
  for (const alert of [...alerts].sort((first, second) => second.at - first.at)) {
    const date = perthDateOf(alert.at);
    const last = days.at(-1);
    if (last && last.date === date) last.alerts.push(alert);
    else
      days.push({
        date,
        label: date === today ? "Today" : date === yesterday ? "Yesterday" : formatPerthDay(date),
        alerts: [alert],
      });
  }
  return days;
}

/** The row's line under the title: "Roster · 18:12", or "Reminder · seen by 07:42" for a time-less one. */
export function alertRowSub(alert: EarlierAlert): string {
  const time = perthTimeOf(alert.at);
  return `${ALERT_CODES[alert.code].source} · ${alert.approx ? `seen by ${time}` : time}`;
}

/** Spoken label for the whole row, so a screen reader hears the day too. */
export function alertRowLabel(alert: EarlierAlert, dayLabel: string): string {
  return `${alertRowTitle(alert.code)}. ${alertRowSub(alert)}, ${dayLabel}. ${alert.openedAt ? "Opened" : "Not opened yet"}. Opens ${pageName(ALERT_CODES[alert.code].path)}.`;
}

function pageName(path: string): string {
  if (path.startsWith("/roster/manage")) return "Roster manager";
  if (path.startsWith("/roster/swaps")) return "Roster swaps";
  if (path.startsWith("/roster")) return "Roster";
  if (path === "/my-day/alerts") return "Alerts";
  return "My Day";
}

/**
 * The signed-out sample: invented alerts built in the browser from `now`, read
 * from no server and kept nowhere (the mock-up's own rows).
 */
export function sampleEarlierAlerts(now: number): EarlierAlert[] {
  const today = perthDateOf(now);
  const at = (daysBack: number, time: string) => {
    const date = addDaysToDate(today, -daysBack);
    return Date.parse(`${date}T${time}:00+08:00`);
  };
  const rows: [AlertCode, number, string, boolean][] = [
    ["brief", 0, "07:00", true],
    ["request", 1, "18:12", false],
    ["brief", 1, "07:00", true],
    ["reminder", 2, "14:00", true],
    ["changed", 5, "16:40", false],
  ];
  return rows
    .map(([code, daysBack, time, opened]) => {
      const when = at(daysBack, time);
      return { id: `${code}:${when}`, code, at: when, approx: false, openedAt: opened ? when + 60_000 : null };
    })
    .filter((alert) => alert.at <= now);
}
