import { evaluateYear } from "@/lib/cme/evaluate";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { addDaysToDate, formatPerthDay } from "@/lib/perth-time";
import type { ShiftKind } from "@/lib/roster/shift-kind";
import { workSearchAreaLabels, type WorkAreaRead, type WorkItem, type WorkSearchArea } from "@/lib/work-search/model";

/**
 * Built-in answers to the common plain questions, worked out in the browser from
 * the reader's own records. No AI: a small fixed set of question shapes, each
 * answered by code that reads the records, in the same spirit as Roster's Ask
 * ("a strict, finite grammar; it never sends text"). Anything else falls back
 * to ordinary word matches.
 *
 * Every answer says what it understood (`understood`), where it came from
 * (`source`) and, when an area it needed could not load, says so instead of
 * answering — a failed read is never "nothing due".
 */

export interface WorkAnswerInput {
  readonly items: readonly WorkItem[];
  readonly areas: readonly WorkAreaRead[];
  readonly today: string;
  /** The reader's confirmed CPD targets for the year their activities belong to, when read. */
  readonly cpd: { readonly set: CmeRequirementSet | null; readonly entries: readonly CmeEntry[] } | null;
}

export interface WorkAnswer {
  /** The area whose colour the card wears, or "all" for a cross-area answer. */
  readonly area: WorkSearchArea | "all";
  /** Small label over the headline, e.g. "Your next night". */
  readonly label: string;
  readonly headline: string;
  readonly sub: string | null;
  readonly meta: readonly string[];
  /** Records the answer is built from, shown under it. */
  readonly items: readonly WorkItem[];
  /** One line on what the question was read as: "Showing your next night shift". */
  readonly understood: string;
  readonly source: string;
  /** Set instead of an answer when an area the question needs did not load. */
  readonly unavailable?: string;
  /** A caution printed under the card, e.g. that dates are as the reader recorded them. */
  readonly footnote?: string;
  /** The primary action, when there is one. */
  readonly action?: { readonly label: string; readonly href: string };
}

const SHIFT_WORDS: ReadonlyArray<[RegExp, ShiftKind, string, string]> = [
  [/\bnights?\b/, "night", "night", "nights"],
  [/\bevenings?\b|\blates?\b/, "evening", "evening", "evenings"],
  [/\bon[- ]?call\b/, "on_call", "on-call shift", "on-call shifts"],
  [/\bdays?\b(?! off)/, "day", "day shift", "day shifts"],
];

function areaStatus(input: WorkAnswerInput, area: WorkSearchArea) {
  return input.areas.find((read) => read.area === area)?.status ?? "loading";
}

/** The question's needed areas that are not ready, named for an honest "couldn't check" line. */
function notReady(input: WorkAnswerInput, areas: readonly WorkSearchArea[]): string | null {
  const missing = areas.filter((area) => areaStatus(input, area) !== "ready");
  if (missing.length === 0) return null;
  const loading = missing.every((area) => areaStatus(input, area) === "loading");
  const names = [...new Set(missing.map((area) => workSearchAreaLabels[area]))].join(" and ");
  return loading ? `Still loading ${names}.` : `${names} couldn't load, so this can't be answered yet.`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function inDays(today: string, date: string): string {
  const days = daysBetween(today, date);
  if (days < 0) return days === -1 ? "Yesterday" : `${-days} days ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function longDay(date: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function dayMonth(date: string): string {
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function unavailableAnswer(area: WorkSearchArea | "all", understood: string, why: string): WorkAnswer {
  return {
    area,
    label: "Can't check yet",
    headline: why,
    sub: null,
    meta: [],
    items: [],
    understood,
    source: "",
    unavailable: why,
  };
}

function nextShift(input: WorkAnswerInput, kind: ShiftKind | null, one: string, many: string): WorkAnswer {
  const understood = `Showing your next ${one}`;
  const why = notReady(input, ["roster"]);
  if (why) return unavailableAnswer("roster", understood, why);
  const upcoming = input.items
    .filter((item) => item.kind === "shift" && item.date !== null && item.date >= input.today)
    .filter((item) => kind === null || item.facet === kind)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const first = upcoming[0];
  if (!first?.date) {
    return {
      area: "roster",
      label: `Your next ${one}`,
      headline: `No ${many} in your roster`,
      sub: "Nothing ahead in the shifts your roster holds.",
      meta: [],
      items: [],
      understood,
      source: "From your Roster",
      action: { label: "Open Roster", href: "/roster/shifts" },
    };
  }
  // A run: consecutive days of the same kind starting at the first.
  let run = 1;
  while (upcoming[run]?.date === addDaysToDate(first.date, run)) run += 1;
  return {
    area: "roster",
    label: `Your next ${one}`,
    headline: longDay(first.date),
    sub: first.detail?.split(" · ").slice(1).join(" · ") || null,
    meta: [...(run > 1 ? [`First of ${run} ${many}`] : []), inDays(input.today, first.date)],
    items: upcoming.slice(0, Math.max(run, 3)),
    understood,
    source: "From your Roster",
    action: { label: "Open shift", href: first.href },
  };
}

function nextLeave(input: WorkAnswerInput): WorkAnswer {
  const understood = "Showing your next leave";
  const why = notReady(input, ["roster"]);
  if (why) return unavailableAnswer("roster", understood, why);
  const leave = input.items
    .filter((item) => item.kind === "leave" && (item.until ?? item.date ?? "") >= input.today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const first = leave[0];
  if (!first?.date) {
    return {
      area: "roster",
      label: "Your next leave",
      headline: "No leave booked ahead",
      sub: null,
      meta: [],
      items: [],
      understood,
      source: "From your Roster",
      action: { label: "Request leave", href: "/roster/requests" },
    };
  }
  const days = daysBetween(first.date, first.until ?? first.date) + 1;
  return {
    area: "roster",
    label: "Your next leave",
    headline:
      first.until && first.until !== first.date
        ? `${formatPerthDay(first.date)} to ${formatPerthDay(first.until)}`
        : longDay(first.date),
    sub: first.title,
    meta: [
      `${days} ${days === 1 ? "day" : "days"}`,
      first.date <= input.today ? "On leave now" : inDays(input.today, first.date),
    ],
    items: leave.slice(0, 3),
    understood,
    source: "From your Roster",
    action: { label: "View leave", href: first.href },
  };
}

function endOfMonth(today: string): string {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${today.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** The window "due" covers, as the question names it. Printed in the answer, never implied. */
function dueWindow(query: string, today: string): { to: string; words: string; label: string } {
  if (/\bthis week\b|\bweek\b/.test(query)) {
    const to = addDaysToDate(today, 6);
    return { to, words: `in the next 7 days (to ${formatPerthDay(to)})`, label: `Due by ${dayMonth(to)}` };
  }
  if (/\bthis month\b|\bmonth\b/.test(query)) {
    const to = endOfMonth(today);
    return { to, words: `by ${longDay(to)}`, label: `Due by ${dayMonth(to)}` };
  }
  const to = addDaysToDate(today, 30);
  return { to, words: `in the next 30 days (to ${formatPerthDay(to)})`, label: `Due by ${dayMonth(to)}` };
}

function due(input: WorkAnswerInput, query: string): WorkAnswer {
  const window = dueWindow(query, input.today);
  const understood = `Showing renewals and talks due ${window.words}, overdue first`;
  const why = notReady(input, ["my-work", "teaching"]);
  if (why) return unavailableAnswer("all", understood, why);
  const overdue = input.items
    .filter((item) => item.kind === "renewal" && item.date !== null && item.date < input.today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const upcoming = input.items
    .filter(
      (item) =>
        (item.kind === "renewal" || item.facet === "presenting") &&
        item.date !== null &&
        item.date >= input.today &&
        item.date <= window.to,
    )
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const all = [...overdue, ...upcoming];
  const first = upcoming[0];
  return {
    area: "all",
    label: window.label,
    headline:
      all.length === 0
        ? "Nothing recorded as due"
        : [
            overdue.length > 0 ? `${overdue.length} overdue` : null,
            upcoming.length > 0
              ? `${upcoming.length} coming up${first?.date ? `, the first ${inDays(input.today, first.date).toLowerCase()}` : ""}`
              : null,
          ]
            .filter(Boolean)
            .join(", "),
    sub: null,
    meta: [],
    items: all,
    understood,
    source: "From your Admin renewal dates and Teaching",
    footnote: "Dates are shown as you recorded them",
  };
}

function presenting(input: WorkAnswerInput): WorkAnswer {
  const understood = "Showing sessions you're presenting in the next six weeks";
  const why = notReady(input, ["teaching"]);
  if (why) return unavailableAnswer("teaching", understood, why);
  const talks = input.items
    .filter((item) => item.facet === "presenting" && item.date !== null && item.date >= input.today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const first = talks[0];
  return {
    area: "teaching",
    label: "You're presenting",
    headline: first?.date ? longDay(first.date) : "No talks in the next six weeks",
    sub: first ? first.title : null,
    meta: first?.date ? [inDays(input.today, first.date)] : [],
    items: talks,
    understood,
    source: "From your Teaching programme",
    ...(first ? { action: { label: "Open session", href: first.href } } : {}),
  };
}

function cpdHours(input: WorkAnswerInput): WorkAnswer {
  const understood = "Showing your CPD targets for this year";
  const why = notReady(input, ["cme"]);
  if (why || !input.cpd) return unavailableAnswer("cme", understood, why ?? "Still loading CPD.");
  const { set, entries } = input.cpd;
  if (!set) {
    return {
      area: "cme",
      label: "CPD hours",
      headline: "No targets confirmed for this year",
      sub: "Confirm your year's targets in CPD to see what's still short.",
      meta: [],
      items: [],
      understood,
      source: "From your CPD log",
      action: { label: "Set up CPD", href: "/cme/setup" },
    };
  }
  const status = evaluateYear({ set, entries });
  const labels = new Map(set.requirements.map((requirement) => [requirement.id, requirement.label]));
  return {
    area: "cme",
    label: `CPD ${set.year}`,
    headline:
      status.unmet.length === 0
        ? "Every target reached"
        : `${status.unmet.length} of ${status.statuses.length} targets still short`,
    sub: `${status.totalHours} h logged`,
    meta: status.statuses.map((row) => `${labels.get(row.requirementId) ?? "Target"}: ${row.summary}`),
    items: [],
    understood,
    source: `From your CPD log, against the targets you confirmed on ${formatPerthDay(set.confirmedOn.slice(0, 10))}`,
    action: { label: "Open CPD", href: "/cme" },
  };
}

/** The built-in answer for `query`, or null when it is not one of the known question shapes. */
export function answerWorkQuestion(query: string, input: WorkAnswerInput): WorkAnswer | null {
  const text = query.trim().toLowerCase();
  if (text.length < 3) return null;

  const asksWhen = /\b(next|when|upcoming)\b/.test(text);
  if (/\b(presenting|my talk|am i presenting|my presentation)\b/.test(text)) return presenting(input);
  if (/\b(due|renewals?|renew|expir\w*|overdue)\b/.test(text)) return due(input, text);
  if (/\b(cpd|cme)\b/.test(text) && /\b(hours?|left|need|short|target|on track)\b/.test(text)) return cpdHours(input);
  if (asksWhen && /\b(leave|holiday|annual leave)\b/.test(text)) return nextLeave(input);
  if (asksWhen) {
    for (const [pattern, kind, one, many] of SHIFT_WORDS) {
      if (pattern.test(text)) return nextShift(input, kind, one, many);
    }
    if (/\b(shift|work|rostered|working)\b/.test(text)) return nextShift(input, null, "shift", "shifts");
  }
  return null;
}
