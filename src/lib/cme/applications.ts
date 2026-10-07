import { z } from "zod";

import { looksLikePatientDetails } from "@/lib/work-search/signals";

/**
 * Job applications season (#22): the doctor's own plan for one recruitment
 * season, kept on this device only.
 *
 * NO RECRUITMENT DATE IS BUILT IN. Nothing in this repository records a
 * checked WA recruitment timeline, so every date on the season rail is one the
 * doctor typed from the advert they are applying to, and the page says so.
 * A stage with no date is drawn as "Date not added", never guessed.
 *
 * Referees are colleagues, so their name and role are kept, with a status the
 * doctor sets and a short dated history. A name may not carry digits, so a
 * record, bed or phone number cannot hide in it; every other free-text field
 * goes through the same patient-detail reading the work search uses.
 */

export const APPLICATION_STAGES = [
  { id: "adverts", label: "Adverts out" },
  { id: "close", label: "Applications close" },
  { id: "interviews", label: "Interviews" },
  { id: "offers", label: "Offers" },
  { id: "start", label: "Start date" },
] as const;
export type ApplicationStageId = (typeof APPLICATION_STAGES)[number]["id"];
export const applicationStageIds = APPLICATION_STAGES.map((stage) => stage.id) as [
  ApplicationStageId,
  ...ApplicationStageId[],
];
export function stageLabel(id: ApplicationStageId): string {
  return APPLICATION_STAGES.find((stage) => stage.id === id)!.label;
}

export const REFEREE_STATUSES = [
  { id: "not-asked", label: "Not asked" },
  { id: "asked", label: "Asked" },
  { id: "agreed", label: "Agreed" },
  { id: "sent", label: "Report sent" },
  { id: "declined", label: "Declined" },
] as const;
export type RefereeStatus = (typeof REFEREE_STATUSES)[number]["id"];
const refereeStatusIds = REFEREE_STATUSES.map((status) => status.id) as [RefereeStatus, ...RefereeStatus[]];
export function refereeStatusLabel(id: RefereeStatus): string {
  return REFEREE_STATUSES.find((status) => status.id === id)!.label;
}

export const REFEREE_LIMIT = 8;
export const NAME_LIMIT = 60;
export const ROLE_LIMIT = 80;
export const SOURCE_LIMIT = 80;
export const STATEMENT_LIMIT = 600;
/** Days after asking (or the last nudge) before a quiet referee is raised. */
export const REFEREE_QUIET_DAYS = 5;
/** Days before a date the reminder starts showing. */
export const DATE_REMINDER_DAYS = 7;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .or(z.literal(""));

const seasonDateSchema = z.object({
  stage: z.enum(applicationStageIds),
  on: dateKey,
  time: clock,
  source: z.string().max(SOURCE_LIMIT),
  remind: z.boolean(),
  addedOn: dateKey,
});
const historySchema = z.union([
  z.object({ kind: z.literal("status"), status: z.enum(refereeStatusIds), on: dateKey }),
  z.object({ kind: z.literal("nudge"), on: dateKey }),
]);
const refereeSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(NAME_LIMIT),
  role: z.string().max(ROLE_LIMIT),
  status: z.enum(refereeStatusIds),
  history: z.array(historySchema).max(40),
});
const stateSchema = z.object({
  version: z.literal(1),
  dates: z.array(seasonDateSchema).max(APPLICATION_STAGES.length),
  referees: z.array(refereeSchema).max(REFEREE_LIMIT),
  statement: z.string().max(STATEMENT_LIMIT),
  hiddenCvLines: z.array(z.string().min(1).max(120)).max(300),
});

export type SeasonDate = z.infer<typeof seasonDateSchema>;
export type RefereeHistory = z.infer<typeof historySchema>;
export type Referee = z.infer<typeof refereeSchema>;
export type ApplicationsState = z.infer<typeof stateSchema>;

export const EMPTY_APPLICATIONS: ApplicationsState = {
  version: 1,
  dates: [],
  referees: [],
  statement: "",
  hiddenCvLines: [],
};

function stageIndex(stage: ApplicationStageId): number {
  return APPLICATION_STAGES.findIndex((item) => item.id === stage);
}

function noDuplicateStages(state: ApplicationsState): boolean {
  return new Set(state.dates.map((date) => date.stage)).size === state.dates.length;
}

export function parseApplications(raw: string | null): ApplicationsState {
  if (!raw) return EMPTY_APPLICATIONS;
  try {
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || !noDuplicateStages(parsed.data)) return EMPTY_APPLICATIONS;
    // A value saved before a check existed is read again, never shown if it fails now.
    return {
      ...parsed.data,
      referees: parsed.data.referees.filter(
        (referee) => !refereeNameProblem(referee.name) && !applicationTextProblem(referee.role),
      ),
      dates: parsed.data.dates.filter((date) => !applicationTextProblem(date.source)),
      statement: applicationTextProblem(parsed.data.statement) ? "" : parsed.data.statement,
    };
  } catch {
    return EMPTY_APPLICATIONS;
  }
}

export function isValidApplications(state: ApplicationsState): boolean {
  return stateSchema.safeParse(state).success && noDuplicateStages(state);
}

/* ---------------------------------------------------------------- patient-detail checks */

export type ApplicationTextProblem = { readonly title: string; readonly body: string };

const AGE_SEX = /\b\d{1,3}\s?(?:yo|y\/o)\b|\b\d{1,3}\s?yrs?\s?[MFmf]\b|\b\d{1,3}[MF]\b/;

/**
 * Null when the words read as safe. Otherwise a short reason, in the style of
 * the Remind me catch: the field cannot hold a patient detail.
 */
export function applicationTextProblem(
  text: string,
  thisYear = new Date().getFullYear(),
): ApplicationTextProblem | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (looksLikePatientDetails(trimmed, thisYear) || AGE_SEX.test(trimmed))
    return {
      title: "This looks like a patient detail",
      body: "Leave out names, record numbers, bed numbers and dates of birth. Nothing about a patient belongs here.",
    };
  return null;
}

const TITLES = /^(?:dr|doctor|prof|professor|a\/prof|assoc(?:iate)?\.?\s+prof(?:essor)?|mr|mrs|ms|mx|miss)\.?\s+/i;

/** A referee's name: letters only (no digits, so no number can hide in it), and never empty. */
export function refereeNameProblem(name: string): ApplicationTextProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return { title: "Add a name", body: "Type the referee's name, for example Dr Grant." };
  if (/\d/.test(trimmed))
    return {
      title: "A name has no numbers",
      body: "Leave out record, bed and phone numbers. Only the referee's name goes here.",
    };
  if (/[@:#/\\]/.test(trimmed.replace(/^a\/prof/i, "")))
    return { title: "Only the name goes here", body: "Leave out email addresses and other details." };
  // A colleague's title and surname are the point of this field, so the title is read past.
  const rest = trimmed.replace(TITLES, "");
  if (/\b(?:dob|urn|umrn|mrn|bed)\b/i.test(rest))
    return { title: "Only the name goes here", body: "Leave out record numbers, bed numbers and dates of birth." };
  return null;
}

/* ---------------------------------------------------------------- dates */

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function seasonDateFor(state: ApplicationsState, stage: ApplicationStageId): SeasonDate | null {
  return state.dates.find((date) => date.stage === stage) ?? null;
}

/** Adds or replaces the date for one stage. Stages stay in season order. */
export function upsertSeasonDate(state: ApplicationsState, date: SeasonDate): ApplicationsState {
  const dates = [...state.dates.filter((existing) => existing.stage !== date.stage), date].sort(
    (a, b) => stageIndex(a.stage) - stageIndex(b.stage),
  );
  return { ...state, dates };
}

export function removeSeasonDate(state: ApplicationsState, stage: ApplicationStageId): ApplicationsState {
  return { ...state, dates: state.dates.filter((date) => date.stage !== stage) };
}

/**
 * Dates typed out of order (an interview before applications close) are not
 * rearranged, because the doctor typed them from the advert. They are named,
 * so a typo can be fixed.
 */
export function outOfOrderStages(state: ApplicationsState): ApplicationStageId[] {
  const flagged: ApplicationStageId[] = [];
  let latest: string | null = null;
  for (const date of state.dates) {
    if (latest && date.on < latest) flagged.push(date.stage);
    else latest = date.on;
  }
  return flagged;
}

/** The season's year: the start date's year when added, otherwise the next calendar year. */
export function seasonYear(state: ApplicationsState, today: string): number {
  const start = seasonDateFor(state, "start");
  return start ? Number(start.on.slice(0, 4)) : Number(today.slice(0, 4)) + 1;
}

export type RailItem =
  | {
      readonly kind: "stage";
      readonly stage: ApplicationStageId;
      readonly label: string;
      readonly date: SeasonDate | null;
      readonly past: boolean;
    }
  | { readonly kind: "today"; readonly countdown: string | null };

export function countdownWords(days: number, label: string): string {
  const what = label.charAt(0).toLowerCase() + label.slice(1);
  if (days === 0) return `${label} today`;
  if (days === 1) return `1 day to ${what}`;
  return `${days} days to ${what}`;
}

/**
 * The rail in stage order. "Today" sits before the first dated stage still to
 * come, with a countdown to it. With no dates there is no Today marker,
 * because there is nothing to place it against.
 */
export function seasonRail(state: ApplicationsState, today: string): RailItem[] {
  const items: RailItem[] = [];
  let placed = state.dates.length === 0;
  for (const stage of APPLICATION_STAGES) {
    const date = seasonDateFor(state, stage.id);
    if (!placed && date && date.on >= today) {
      items.push({ kind: "today", countdown: countdownWords(daysBetween(today, date.on), stage.label) });
      placed = true;
    }
    items.push({ kind: "stage", stage: stage.id, label: stage.label, date, past: Boolean(date && date.on < today) });
  }
  if (!placed) items.push({ kind: "today", countdown: null });
  return items;
}

/* ---------------------------------------------------------------- referees */

export function addReferee(
  state: ApplicationsState,
  input: { name: string; role: string; status: RefereeStatus },
  today: string,
  id: string,
): ApplicationsState {
  const referee: Referee = {
    id,
    name: input.name.trim().slice(0, NAME_LIMIT),
    role: input.role.trim().slice(0, ROLE_LIMIT),
    status: input.status,
    history: input.status === "not-asked" ? [] : [{ kind: "status", status: input.status, on: today }],
  };
  return { ...state, referees: [...state.referees, referee] };
}

export function updateRefereeDetails(
  state: ApplicationsState,
  id: string,
  details: { name: string; role: string },
): ApplicationsState {
  return {
    ...state,
    referees: state.referees.map((referee) =>
      referee.id === id
        ? { ...referee, name: details.name.trim().slice(0, NAME_LIMIT), role: details.role.trim().slice(0, ROLE_LIMIT) }
        : referee,
    ),
  };
}

export function setRefereeStatus(
  state: ApplicationsState,
  id: string,
  status: RefereeStatus,
  today: string,
): ApplicationsState {
  return {
    ...state,
    referees: state.referees.map((referee) =>
      referee.id === id && referee.status !== status
        ? {
            ...referee,
            status,
            history: [...referee.history, { kind: "status" as const, status, on: today }].slice(-40),
          }
        : referee,
    ),
  };
}

export function recordNudge(state: ApplicationsState, id: string, today: string): ApplicationsState {
  return {
    ...state,
    referees: state.referees.map((referee) =>
      referee.id === id
        ? { ...referee, history: [...referee.history, { kind: "nudge" as const, on: today }].slice(-40) }
        : referee,
    ),
  };
}

export function removeReferee(state: ApplicationsState, id: string): ApplicationsState {
  return { ...state, referees: state.referees.filter((referee) => referee.id !== id) };
}

/** When the doctor last asked (or nudged) this referee, or null if never. */
export function lastAskedOn(referee: Referee): string | null {
  let last: string | null = null;
  for (const event of referee.history) {
    if ((event.kind === "status" && event.status === "asked") || event.kind === "nudge") last = event.on;
  }
  return last;
}

/** Asked, no change since, and at least five days gone: worth a nudge. */
export function quietReferees(state: ApplicationsState, today: string): { referee: Referee; days: number }[] {
  return state.referees
    .filter((referee) => referee.status === "asked")
    .map((referee) => {
      const since = lastAskedOn(referee);
      return { referee, days: since ? daysBetween(since, today) : 0 };
    })
    .filter((item) => item.days >= REFEREE_QUIET_DAYS)
    .sort((a, b) => b.days - a.days);
}

export function agreedCount(state: ApplicationsState): number {
  return state.referees.filter((referee) => referee.status === "agreed" || referee.status === "sent").length;
}

const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Thu 1 Oct", with the year added when it is not `today`'s year. */
export function shortDate(on: string, today?: string): string {
  const [year, month, day] = on.split("-").map(Number) as [number, number, number];
  const weekday = SHORT_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const label = `${weekday} ${day} ${SHORT_MONTHS[month - 1]}`;
  return today && today.slice(0, 4) !== on.slice(0, 4) ? `${label} ${year}` : label;
}

/** The status line under a referee's name. */
export function refereeLine(referee: Referee, today: string): string {
  const lastStatus = [...referee.history].reverse().find((event) => event.kind === "status");
  if (!lastStatus) return referee.role || "Not asked yet";
  const when = lastStatus.on === today ? "today" : shortDate(lastStatus.on, today);
  if (referee.status === "asked") {
    const quiet = quietReferees({ ...EMPTY_APPLICATIONS, referees: [referee] }, today)[0];
    return quiet ? `Asked ${when} · no reply in ${quiet.days} days` : `Asked ${when}`;
  }
  return `${refereeStatusLabel(referee.status)} ${when}`;
}

/** A short, polite follow-up the doctor pastes into their own email. */
export function nudgeMessage(referee: Referee, today: string): string {
  const asked = lastAskedOn(referee);
  const when = asked ? (daysBetween(asked, today) <= 7 ? "last week" : `on ${shortDate(asked, today)}`) : "recently";
  return `Hi ${referee.name}, just checking you got my referee request from ${when}. Happy to send anything that helps. Thanks`;
}

/* ---------------------------------------------------------------- hooks for other areas */

export const APPLICATIONS_HREF = "/cme/applications";
export const APPLICATIONS_CV_HREF = "/cme/applications/cv";

export type ApplicationsNeedsYouItem = {
  readonly id: string;
  readonly title: string;
  readonly dueOn: string | null;
  readonly area: "cpd";
  readonly href: string;
  readonly kind: "action" | "update";
};

/**
 * For the Notification centre: a date with Remind me on, from a week before
 * to the day itself; and a referee asked five or more days ago with no reply.
 */
export function applicationsNeedsYouItems(state: ApplicationsState, today: string): ApplicationsNeedsYouItem[] {
  const items: ApplicationsNeedsYouItem[] = [];
  for (const date of state.dates) {
    if (!date.remind) continue;
    const days = daysBetween(today, date.on);
    if (days < 0 || days > DATE_REMINDER_DAYS) continue;
    const label = stageLabel(date.stage);
    items.push({
      id: `cpd:applications:date:${date.stage}`,
      title: days === 0 ? `${label} today` : days === 1 ? `${label} tomorrow` : `${label} in ${days} days`,
      dueOn: date.on,
      area: "cpd",
      href: APPLICATIONS_HREF,
      kind: "action",
    });
  }
  for (const { referee, days } of quietReferees(state, today)) {
    items.push({
      id: `cpd:applications:referee:${referee.id}`,
      title: `${referee.name} has not replied in ${days} days`,
      dueOn: today,
      area: "cpd",
      href: APPLICATIONS_HREF,
      kind: "action",
    });
  }
  return items;
}

export type ApplicationsSearchRecord = {
  readonly title: string;
  readonly area: "cpd";
  readonly keywords: readonly string[];
  readonly href: string;
};

export function applicationsSearchRecords(state: ApplicationsState): ApplicationsSearchRecord[] {
  const records: ApplicationsSearchRecord[] = [
    {
      title: "Job applications",
      area: "cpd",
      keywords: ["jobs", "applications", "recruitment", "season", "referees", "references", "interview", "rotation"],
      href: APPLICATIONS_HREF,
    },
    {
      title: "CV from your records",
      area: "cpd",
      keywords: ["cv", "resume", "curriculum vitae", "job application"],
      href: APPLICATIONS_CV_HREF,
    },
  ];
  for (const date of state.dates)
    records.push({
      title: `${stageLabel(date.stage)}, ${shortDate(date.on)}`,
      area: "cpd",
      keywords: ["jobs", "applications", "date", stageLabel(date.stage).toLowerCase()],
      href: APPLICATIONS_HREF,
    });
  for (const referee of state.referees)
    records.push({
      title: `${referee.name}, referee`,
      area: "cpd",
      keywords: ["referee", "reference", refereeStatusLabel(referee.status).toLowerCase()],
      href: APPLICATIONS_HREF,
    });
  return records;
}

/** The next dated stage still to come, for a Today card. */
export function nextSeasonDate(state: ApplicationsState, today: string): { date: SeasonDate; days: number } | null {
  const upcoming = state.dates
    .filter((date) => date.on >= today)
    .sort((a, b) => a.on.localeCompare(b.on) || stageIndex(a.stage) - stageIndex(b.stage))[0];
  return upcoming ? { date: upcoming, days: daysBetween(today, upcoming.on) } : null;
}

function shiftDays(on: string, days: number): string {
  const [year, month, day] = on.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The made-up sample shown in the local demo build, so every control can be
 * tried. Names and dates are invented and the page labels them as a sample.
 */
export function sampleApplications(today: string): ApplicationsState {
  return {
    version: 1,
    dates: [
      {
        stage: "close",
        on: shiftDays(today, 24),
        time: "17:00",
        source: "the sample advert",
        remind: true,
        addedOn: shiftDays(today, -5),
      },
    ],
    referees: [
      {
        id: "sample-moss",
        name: "Dr Moss",
        role: "Consultant, Example Hospital",
        status: "agreed",
        history: [
          { kind: "status", status: "asked", on: shiftDays(today, -9) },
          { kind: "status", status: "agreed", on: shiftDays(today, -5) },
        ],
      },
      {
        id: "sample-grant",
        name: "Dr Grant",
        role: "Consultant, Example Hospital",
        status: "asked",
        history: [{ kind: "status", status: "asked", on: shiftDays(today, -5) }],
      },
      { id: "sample-lowe", name: "Dr Lowe", role: "Clinic B", status: "not-asked", history: [] },
    ],
    statement: "",
    hiddenCvLines: [],
  };
}

export function newApplicationsId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
