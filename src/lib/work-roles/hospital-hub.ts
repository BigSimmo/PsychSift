import {
  decideWorkCapability,
  WORK_ROLE_LABEL,
  type WorkCapability,
  type WorkRole,
  type WorkRoleGrant,
  type WorkScope,
} from "@/lib/work-roles/model";
import { hospitalStartersHref } from "@/lib/work-roles/hospital-starters-model";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";
import { formatZonedDay, formatZonedRange, zonedDateOf } from "@/lib/work-time/format";

import type { HospitalShortStaffedView } from "./hospital-short-staffed-view";

/**
 * Hospital (`/admin/hospital`): the one way in for people who hold a hospital
 * role. This file is pure and client safe. It decides which sections and rows
 * the screen shows for the roles a person holds, and lays out the hospital's
 * sick calls (`/admin/hospital/sick`). Short-staffed days
 * (`/admin/hospital/short-staffed`) are laid out in `hospital-short-staffed-view.ts`. Nothing here is a permission: every
 * screen it links to checks the role again on the server.
 */

/* ------------------------------------------------------------ sick calls */

export type HospitalSickStatus = "needs-cover" | "offered" | "asked" | "covered";
export type HospitalSickKind = "day" | "evening" | "night" | "on_call" | "other";

/** One sick call, as `GET /api/work/hospital/sick` sends it. No reason or health detail exists to send. */
export type HospitalSickCall = {
  readonly id: string;
  readonly serviceId: string;
  readonly teamName: string;
  readonly name: string;
  readonly kind: HospitalSickKind;
  readonly shiftCode: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reportedAt: string;
  readonly status: HospitalSickStatus;
};

export type HospitalRef = { readonly id: string; readonly name: string };
export type HospitalTeamRef = { readonly serviceId: string; readonly name: string };

export type HospitalSickView = {
  readonly hospital: HospitalRef;
  readonly teams: readonly HospitalTeamRef[];
  readonly calls: readonly HospitalSickCall[];
};

/** The status words, exactly as every screen says them. */
export const HOSPITAL_SICK_STATUS_WORDS: Readonly<Record<HospitalSickStatus, string>> = {
  "needs-cover": "Needs cover",
  offered: "Offered to team",
  asked: "Someone asked to take it",
  covered: "Covered",
};

/** The status tag's colour. Always with the words, never colour alone. */
export const HOSPITAL_SICK_STATUS_TONE: Readonly<Record<HospitalSickStatus, "red" | "amber" | "green">> = {
  "needs-cover": "red",
  offered: "amber",
  asked: "amber",
  covered: "green",
};

const KIND_WORDS: Readonly<Record<HospitalSickKind, string>> = {
  day: "Day",
  evening: "Evening",
  night: "Night",
  on_call: "On call",
  other: "Shift",
};

const STATUS_ORDER: Readonly<Record<HospitalSickStatus, number>> = {
  "needs-cover": 0,
  offered: 1,
  asked: 2,
  covered: 3,
};

const SICK_STATUSES = Object.keys(STATUS_ORDER) as HospitalSickStatus[];
const SICK_KINDS = Object.keys(KIND_WORDS) as HospitalSickKind[];

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseCall(value: unknown): HospitalSickCall | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id);
  const serviceId = text(row.serviceId);
  const startsAt = text(row.startsAt);
  const endsAt = text(row.endsAt);
  const status = SICK_STATUSES.find((entry) => entry === row.status);
  if (!id || !serviceId || !startsAt || !endsAt || !status) return null;
  if (Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))) return null;
  return {
    id,
    serviceId,
    teamName: text(row.teamName) ?? "Team",
    name: text(row.name) ?? "Team member",
    kind: SICK_KINDS.find((entry) => entry === row.kind) ?? "other",
    shiftCode: text(row.shiftCode) ?? "",
    startsAt,
    endsAt,
    reportedAt: text(row.reportedAt) ?? startsAt,
    status,
  };
}

/** Reads the API's answer leniently: a row it cannot read is dropped, never shown half right. */
export function parseHospitalSickView(body: unknown): HospitalSickView | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const hospital = record.hospital as Record<string, unknown> | null | undefined;
  const id = text(hospital?.id);
  if (!id) return null;
  const teams = Array.isArray(record.teams)
    ? record.teams.flatMap((team) => {
        const row = (team ?? {}) as Record<string, unknown>;
        const serviceId = text(row.serviceId);
        return serviceId ? [{ serviceId, name: text(row.name) ?? "Team" }] : [];
      })
    : [];
  const calls = Array.isArray(record.calls)
    ? record.calls.flatMap((call) => {
        const parsed = parseCall(call);
        return parsed ? [parsed] : [];
      })
    : [];
  return { hospital: { id, name: text(hospital?.name) ?? "Your hospital" }, teams, calls };
}

/** Calls for one team, or every call when no team is picked. */
export function filterSickCalls(
  calls: readonly HospitalSickCall[],
  serviceId: string | null,
): readonly HospitalSickCall[] {
  return serviceId ? calls.filter((call) => call.serviceId === serviceId) : calls;
}

/** How many calls each team has, for the filter chips. */
export function sickCallsPerTeam(calls: readonly HospitalSickCall[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const call of calls) counts.set(call.serviceId, (counts.get(call.serviceId) ?? 0) + 1);
  return counts;
}

export type HospitalSickDay = {
  /** `YYYY-MM-DD` in the work time zone. */
  readonly date: string;
  readonly label: string;
  readonly past: boolean;
  readonly needsCover: number;
  readonly calls: readonly HospitalSickCall[];
};

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** "Today", "Tomorrow", "Yesterday", else "Mon 3 Oct". */
export function sickDayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  if (date === addDays(today, -1)) return "Yesterday";
  return formatZonedDay(date);
}

/**
 * Groups calls by the day their shift starts in the work time zone. Today and
 * the days ahead come first, in order, then earlier days (most recent first),
 * because what still needs cover matters most. Within a day, calls needing
 * cover come first, then by start time.
 */
export function groupSickCallsByDay(
  calls: readonly HospitalSickCall[],
  today: string,
  zone: string,
): readonly HospitalSickDay[] {
  const byDay = new Map<string, HospitalSickCall[]>();
  for (const call of calls) {
    const date = zonedDateOf(call.startsAt, zone);
    const list = byDay.get(date);
    if (list) list.push(call);
    else byDay.set(date, [call]);
  }
  const dates = [...byDay.keys()];
  const ahead = dates.filter((date) => date >= today).sort();
  const earlier = dates.filter((date) => date < today).sort((a, b) => b.localeCompare(a));
  return [...ahead, ...earlier].map((date) => {
    const list = byDay.get(date)!;
    const sorted = [...list].sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
        a.id.localeCompare(b.id),
    );
    return {
      date,
      label: sickDayLabel(date, today),
      past: date < today,
      needsCover: sorted.filter((call) => call.status === "needs-cover").length,
      calls: sorted,
    };
  });
}

/** Calls still needing cover from today through the next six days, in the work time zone. */
export function sickNeedsCoverThisWeek(calls: readonly HospitalSickCall[], today: string, zone: string): number {
  const last = addDays(today, 6);
  return calls.filter((call) => {
    if (call.status !== "needs-cover") return false;
    const date = zonedDateOf(call.startsAt, zone);
    return date >= today && date <= last;
  }).length;
}

/** "2 need cover this week", "1 needs cover this week" or "None need cover this week". */
export function sickSummaryLine(calls: readonly HospitalSickCall[], today: string, zone: string): string {
  const count = sickNeedsCoverThisWeek(calls, today, zone);
  if (count === 0) return "None need cover this week";
  return count === 1 ? "1 needs cover this week" : `${count} need cover this week`;
}

/** The row's short line: "Ward A psychiatry · Night 22:00 to 08:30". */
export function sickCallLine(call: HospitalSickCall, zone: string): string {
  return `${call.teamName} · ${KIND_WORDS[call.kind]} ${formatZonedRange(call.startsAt, call.endsAt, zone)}`;
}

/** Where a sick call is acted on: that team's own Manage team inbox. */
export function sickCallHref(call: Pick<HospitalSickCall, "serviceId">): string {
  return manageTeamHref(call.serviceId);
}

/* ---------------------------------------------------------------- links */

export const HOSPITAL_HUB_HREF = "/admin/hospital";
export const HOSPITAL_SICK_HREF = "/admin/hospital/sick";
export const HOSPITAL_SHORT_STAFFED_HREF = "/admin/hospital/short-staffed";

const withQuery = (path: string, query: Record<string, string | null | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) search.set(key, value);
  const rendered = search.toString();
  return rendered ? `${path}?${rendered}` : path;
};

export function manageTeamHref(serviceId: string): string {
  return withQuery("/roster/manage", { team: serviceId });
}

export function teamCoverHref(serviceId: string): string {
  return withQuery("/roster/manage", { view: "cover", team: serviceId });
}

export function hospitalSickHref(hospitalId: string | null): string {
  return withQuery(HOSPITAL_SICK_HREF, { hospitalId });
}

export function hospitalShortStaffedHref(hospitalId: string | null): string {
  return withQuery(HOSPITAL_SHORT_STAFFED_HREF, { hospitalId });
}

export function peopleAndRolesHref(hospitalId: string | null): string {
  return withQuery("/admin/people", { hospitalId });
}

/**
 * Real PGY1 and PGY2 assessments stay in CLA (owner decision 7 Oct 2026), so a
 * signed-in reader's Assessments page says so. Each link says it before the tap.
 */
const ASSESSMENTS_IN_CLA = "Real records are kept in CLA";
export const SUPERVISOR_INBOX_HREF = "/teaching/assessments?view=inbox&as=supervisor";
export const SUPERVISOR_TIMES_HREF = "/teaching/assessments?view=times&as=supervisor";
export const TERM_OVERVIEW_HREF = "/teaching/assessments?view=overview&as=supervisor";
export const NEW_STARTERS_HREF = "/admin/workforce";

/* ------------------------------------------------------------- sections */

export type HospitalSectionId = "workforce" | "dct" | "supervisor" | "manager";

/** What a row's icon shows. The screen maps it to an icon, so this file stays icon free. */
export type HospitalLinkIcon =
  | "sick"
  | "short"
  | "starters"
  | "people"
  | "overview"
  | "assign"
  | "inbox"
  | "times"
  | "team"
  | "cover"
  | "rotation"
  | "course"
  | "post";

export type HospitalLink = {
  readonly id: string;
  readonly label: string;
  readonly sub: string;
  readonly href: string;
  readonly icon: HospitalLinkIcon;
};

export type HospitalLinkContext = {
  /** The hospital picked on the screen, or null when there is none to pick. */
  readonly hospitalId: string | null;
  /** The team, for a roster manager's rows. */
  readonly serviceId?: string | null;
};

/**
 * Extra rows for a role, for screens other threads build (Rotation rounds,
 * Courses). Empty for now: add an entry here once its route exists, and every
 * person holding that role sees it on Hospital.
 */
export type HospitalExtraLink = {
  readonly id: "rotation-rounds" | "courses" | (string & {});
  readonly label: string;
  readonly sub: string;
  readonly icon: HospitalLinkIcon;
  readonly href: (context: HospitalLinkContext) => string;
};

export const HOSPITAL_EXTRA_LINKS: Readonly<Record<HospitalSectionId, readonly HospitalExtraLink[]>> = {
  workforce: [],
  dct: [],
  supervisor: [],
  manager: [],
};

export type HospitalSection = {
  readonly id: HospitalSectionId;
  /** A stable key: the section id, or the section and team for a roster manager of several teams. */
  readonly key: string;
  readonly title: string;
  /** A short line beside the label, such as the team name. */
  readonly note: string | null;
  /** The team, on a roster manager's section. */
  readonly serviceId?: string | null;
  readonly links: readonly HospitalLink[];
};

export type HospitalSectionOptions = {
  /** The Workforce section's sick-call line ("2 need cover this week"), once it is known. */
  readonly sickSummary?: string | null;
  /** Team names by service id, for a roster manager's rows. */
  readonly teamNames?: ReadonlyMap<string, string>;
  readonly extraLinks?: Readonly<Record<HospitalSectionId, readonly HospitalExtraLink[]>>;
  /** Screens still behind the live preview switch, true when this reader gets them. */
  readonly previews?: HospitalPreviews;
};

/** Screens other threads build, behind the live preview switch for now. */
export type HospitalPreviews = {
  /** `useLivePreview("rotation-preferences")`. */
  readonly rotationRounds: boolean;
  /** `useLivePreview("course-bookings")`. */
  readonly courses: boolean;
};

/** Rotation rounds, for whoever manages rotations. No team in the address yet. */
export const ROTATION_ROUNDS_HREF = "/roster/manage/rotations";

const PREVIEW_ROWS: readonly {
  readonly preview: keyof HospitalPreviews;
  readonly capability: WorkCapability;
  /** Only these roles count, while the screen itself checks fewer roles than the capability names. */
  readonly onlyRoles?: readonly WorkRole[];
  readonly links: readonly HospitalLink[];
}[] = [
  {
    preview: "rotationRounds",
    capability: "rotations.manage",
    links: [
      {
        id: "rotation-rounds",
        label: "Rotation rounds",
        sub: "Preferences and placements",
        href: ROTATION_ROUNDS_HREF,
        icon: "rotation",
      },
    ],
  },
  {
    preview: "courses",
    capability: "courses.manage",
    links: [
      {
        id: "courses",
        label: "Courses",
        sub: "Courses and bookings",
        href: ADMIN_WORK_SCREEN_HREFS.courses,
        icon: "course",
      },
      {
        id: "post-course",
        label: "Post a course",
        sub: "Add one for doctors to book",
        href: ADMIN_WORK_SCREEN_HREFS.postCourse,
        icon: "post",
      },
    ],
  },
];

/** Where a section's role applies, for checking a capability against it. Supervisors manage neither. */
function sectionScope(section: HospitalSection, hospitalId: string | null): WorkScope | null {
  if (section.id === "supervisor") return null;
  if (section.id === "manager") return section.serviceId ? { kind: "team", serviceId: section.serviceId } : null;
  // No hospital to pick: only the administrator's rule, which applies everywhere, can say yes.
  return hospitalId ? { kind: "hospital", hospitalId } : { kind: "everyone" };
}

/**
 * Adds each preview screen once, to the first section whose role may use it
 * (Workforce or the administrator, then the DCT, then a team's roster
 * manager), so someone holding several roles never sees it twice.
 */
function withPreviewRows(
  sections: readonly HospitalSection[],
  grants: readonly WorkRoleGrant[],
  hospitalId: string | null,
  previews: HospitalPreviews,
): readonly HospitalSection[] {
  const result = sections.map((section) => ({ ...section, links: [...section.links] }));
  for (const row of PREVIEW_ROWS) {
    if (!previews[row.preview]) continue;
    const { onlyRoles } = row;
    const counted = onlyRoles ? grants.filter((grant) => onlyRoles.includes(grant.role)) : grants;
    const target = result.find((section) => {
      const scope = sectionScope(section, hospitalId);
      return scope !== null && decideWorkCapability(counted, row.capability, scope);
    });
    target?.links.push(...row.links);
  }
  return result;
}

function extras(
  id: HospitalSectionId,
  context: HospitalLinkContext,
  table: Readonly<Record<HospitalSectionId, readonly HospitalExtraLink[]>>,
): HospitalLink[] {
  return table[id].map((link) => ({
    id: link.id,
    label: link.label,
    sub: link.sub,
    icon: link.icon,
    href: link.href(context),
  }));
}

function holdsAt(grants: readonly WorkRoleGrant[], role: "workforce" | "dct", hospitalId: string | null): boolean {
  return grants.some(
    (grant) =>
      grant.role === role && (hospitalId === null || ("hospitalId" in grant && grant.hospitalId === hospitalId)),
  );
}

/** Supervisor cover in words: "2 trainees and 1 team". */
export function supervisorCoverLine(grants: readonly WorkRoleGrant[]): string {
  let trainees = 0;
  let teams = 0;
  for (const grant of grants) {
    if (grant.role !== "supervisor") continue;
    if (grant.subjectUserId) trainees += 1;
    else if (grant.serviceId) teams += 1;
  }
  const parts = [
    trainees ? `${trainees} ${trainees === 1 ? "trainee" : "trainees"}` : null,
    teams ? `${teams} ${teams === 1 ? "team" : "teams"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" and ") : "Your trainees";
}

/**
 * The sections for the roles a person holds, in a fixed order: Medical
 * Workforce (or the site administrator), DCT, supervisor, roster manager.
 * Hospital-wide sections are for the picked hospital, so a DCT at one
 * hospital and Workforce at another sees each when that hospital is picked.
 */
export function hospitalSections(
  grants: readonly WorkRoleGrant[],
  hospitalId: string | null,
  options: HospitalSectionOptions = {},
): readonly HospitalSection[] {
  const table = options.extraLinks ?? HOSPITAL_EXTRA_LINKS;
  const sections: HospitalSection[] = [];
  const administrator = grants.some((grant) => grant.role === "administrator");
  const context: HospitalLinkContext = { hospitalId };

  if (administrator || holdsAt(grants, "workforce", hospitalId)) {
    sections.push({
      id: "workforce",
      key: "workforce",
      title: holdsAt(grants, "workforce", hospitalId) ? WORK_ROLE_LABEL.workforce : WORK_ROLE_LABEL.administrator,
      note: null,
      links: [
        {
          id: "sick",
          label: "Sick calls",
          sub: options.sickSummary ?? "Across the hospital's teams",
          href: hospitalSickHref(hospitalId),
          icon: "sick",
        },
        {
          id: "short-staffed",
          label: "Short-staffed days",
          sub: "Teams below their safe number",
          href: hospitalShortStaffedHref(hospitalId),
          icon: "short",
        },
        {
          id: "starters",
          label: "New starters",
          sub: "Doctors who share their New job list",
          href: hospitalStartersHref(hospitalId),
          icon: "starters",
        },
        {
          id: "people",
          label: "People and roles",
          sub: "Who holds which role",
          href: peopleAndRolesHref(hospitalId),
          icon: "people",
        },
        ...extras("workforce", context, table),
      ],
    });
  }

  if (holdsAt(grants, "dct", hospitalId)) {
    sections.push({
      id: "dct",
      key: "dct",
      title: WORK_ROLE_LABEL.dct,
      note: null,
      links: [
        {
          id: "overview",
          label: "Term overview",
          sub: ASSESSMENTS_IN_CLA,
          href: TERM_OVERVIEW_HREF,
          icon: "overview",
        },
        {
          id: "assign",
          label: "Assign supervisors",
          sub: "Give and change supervisors",
          href: peopleAndRolesHref(hospitalId),
          icon: "assign",
        },
        ...extras("dct", context, table),
      ],
    });
  }

  if (grants.some((grant) => grant.role === "supervisor")) {
    sections.push({
      id: "supervisor",
      key: "supervisor",
      title: WORK_ROLE_LABEL.supervisor,
      note: supervisorCoverLine(grants),
      links: [
        {
          id: "inbox",
          label: "Assessments inbox",
          sub: ASSESSMENTS_IN_CLA,
          href: SUPERVISOR_INBOX_HREF,
          icon: "inbox",
        },
        {
          id: "times",
          label: "Your free times",
          sub: ASSESSMENTS_IN_CLA,
          href: SUPERVISOR_TIMES_HREF,
          icon: "times",
        },
        ...extras("supervisor", context, table),
      ],
    });
  }

  const teams = [
    ...new Set(grants.flatMap((grant) => (grant.role === "manager" && grant.serviceId ? [grant.serviceId] : []))),
  ];
  for (const serviceId of teams) {
    const name = options.teamNames?.get(serviceId) ?? null;
    const teamContext: HospitalLinkContext = { hospitalId, serviceId };
    sections.push({
      id: "manager",
      key: teams.length > 1 ? `manager:${serviceId}` : "manager",
      title: WORK_ROLE_LABEL.manager,
      note: name,
      serviceId,
      links: [
        {
          id: `team:${serviceId}`,
          label: "Manage team",
          sub: "Inbox with sick calls and swaps",
          href: manageTeamHref(serviceId),
          icon: "team",
        },
        {
          id: `cover:${serviceId}`,
          label: "Cover and safe number",
          sub: "Who's on against the safe number",
          href: teamCoverHref(serviceId),
          icon: "cover",
        },
        ...extras("manager", teamContext, table),
      ],
    });
  }

  return options.previews ? withPreviewRows(sections, grants, hospitalId, options.previews) : sections;
}

/* -------------------------------------------------------------- hospitals */

/**
 * The hospitals a person covers: those named on their Medical Workforce and
 * DCT roles, and for the site administrator every hospital the people API
 * lists. In the order given, without repeats. The listed name wins.
 */
export function hospitalsCovered(
  grants: readonly WorkRoleGrant[],
  listed: readonly HospitalRef[] = [],
): readonly HospitalRef[] {
  const seen = new Map<string, HospitalRef>();
  for (const hospital of listed) if (hospital.id && !seen.has(hospital.id)) seen.set(hospital.id, hospital);
  for (const grant of grants) {
    if (grant.role !== "workforce" && grant.role !== "dct") continue;
    if (!grant.hospitalId || seen.has(grant.hospitalId)) continue;
    seen.set(grant.hospitalId, { id: grant.hospitalId, name: grant.hospitalName?.trim() || "Your hospital" });
  }
  return [...seen.values()];
}

/** The hospitals whose sick calls a person may read: the administrator's list, or their Medical Workforce roles. */
export function sickHospitals(
  grants: readonly WorkRoleGrant[],
  listed: readonly HospitalRef[] = [],
): readonly HospitalRef[] {
  const administrator = grants.some((grant) => grant.role === "administrator");
  return hospitalsCovered(
    grants.filter((grant) => grant.role === "workforce"),
    administrator ? listed : [],
  );
}

/** True when a person may open the hospital sick calls screen at all. */
export function maySeeHospitalSick(grants: readonly WorkRoleGrant[]): boolean {
  return grants.some((grant) => grant.role === "administrator" || grant.role === "workforce");
}

/** Picks the hospital to show: the asked-for one when it is covered, else the first. */
export function pickHospital(hospitals: readonly HospitalRef[], wanted: string | null): HospitalRef | null {
  return hospitals.find((hospital) => hospital.id === wanted) ?? hospitals[0] ?? null;
}

/* ------------------------------------------------------------- My Day card */

export type HospitalCardRow = {
  readonly id: HospitalSectionId;
  readonly key: string;
  readonly title: string;
  readonly sub: string;
  readonly href: string;
};

/**
 * One row per role section for My Day's Hospital card: the role, what it
 * opens, and a tap to its main screen. Roster managers of several teams get
 * one row, which opens Hospital so they can pick the team.
 */
export function hospitalCardRows(
  grants: readonly WorkRoleGrant[],
  hospitalId: string | null,
  teamNames?: ReadonlyMap<string, string>,
): readonly HospitalCardRow[] {
  const sections = hospitalSections(grants, hospitalId, { teamNames });
  const rows: HospitalCardRow[] = [];
  const managers = sections.filter((section) => section.id === "manager");
  for (const section of sections) {
    if (section.id === "manager") continue;
    rows.push({
      id: section.id,
      key: section.key,
      title: section.title,
      sub: section.links.map((link, index) => (index === 0 ? link.label : link.label.toLowerCase())).join(", "),
      href: section.links[0]!.href,
    });
  }
  if (managers.length === 1) {
    const only = managers[0]!;
    rows.push({
      id: "manager",
      key: "manager",
      title: only.title,
      sub: only.note ? `${only.note} · Manage team, cover` : "Manage team, cover and safe number",
      href: only.links[0]!.href,
    });
  } else if (managers.length > 1) {
    rows.push({
      id: "manager",
      key: "manager",
      title: WORK_ROLE_LABEL.manager,
      sub: `${managers.length} teams`,
      href: HOSPITAL_HUB_HREF,
    });
  }
  return rows;
}

/* ---------------------------------------------------------- example data */

/** The example records for Hospital: a reader holding every role, and each hospital's sick calls and short-staffed days. */
export type ExampleHospitalHub = {
  readonly grants: readonly WorkRoleGrant[];
  readonly hospitals: readonly HospitalSickView[];
  /** One per hospital, in the same order as `hospitals`. */
  readonly shortStaffed: readonly HospitalShortStaffedView[];
};

/** Team names across every example hospital, for a roster manager's rows. */
export function exampleTeamNames(example: ExampleHospitalHub): ReadonlyMap<string, string> {
  return new Map(example.hospitals.flatMap((view) => view.teams.map((team) => [team.serviceId, team.name] as const)));
}
