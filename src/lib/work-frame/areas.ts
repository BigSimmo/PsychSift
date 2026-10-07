import type { AppModeId } from "@/lib/app-modes";
import { ON_CALL_ADMIN_ROWS_HREF, ON_CALL_WHOS_ON_ENABLED } from "@/lib/on-call/feature-flags";

/**
 * The work-mode frame's own navigation table (work-mode redesign, owner
 * request 6 Oct 2026).
 *
 * Every work area shows exactly three pinned tabs plus "More", and More opens
 * a sheet listing the area's whole navigation: the pinned tabs first, then the
 * area's other pages in groups, with the current page ticked. This table is
 * that navigation. It is deliberately separate from
 * `modeSecondaryNavigationRegistry`, which still feeds the mode pill's pages
 * sheet and is pinned by its own tests (On Call's four-tab registry in
 * particular stays as it is).
 *
 * Every item goes somewhere real: an existing route, or an action a page has
 * registered (`useWorkFrameAction`). An action nobody has registered is left
 * out of the sheet, so the sheet never shows a dead control. A page the
 * mockup draws but the app does not have yet is simply not listed.
 */

export type WorkAreaId = "day" | "rost" | "open" | "manage" | "teach" | "assess" | "cpd" | "admin" | "call";

/** Names the frame's icon map resolves (`work-frame-icons.ts`). */
export type WorkFrameIconName =
  | "alarm"
  | "award"
  | "bell"
  | "board"
  | "book"
  | "calendar"
  | "calendar-plus"
  | "card"
  | "check-list"
  | "clipboard"
  | "clock"
  | "compass"
  | "download"
  | "file"
  | "flag"
  | "folder"
  | "grid"
  | "hand"
  | "help"
  | "history"
  | "inbox"
  | "layers"
  | "link"
  | "list"
  | "log"
  | "map"
  | "pen"
  | "people"
  | "phone"
  | "plus"
  | "pulse"
  | "qr"
  | "refer"
  | "repeat"
  | "search"
  | "send"
  | "settings"
  | "shield"
  | "sliders"
  | "sparkle"
  | "star"
  | "sun"
  | "swap"
  | "target"
  | "upload"
  | "user"
  | "users";

/**
 * Who may see an item. A page that is not for this reader stays out of the
 * sheet; the route still answers a direct visit with its own message.
 */
export type WorkFrameGate =
  /** Teaching organisers and admins (`modePageVisible`'s organiser rule). */
  | "teaching-organiser"
  /** Open shifts posters (roster managers), once a read has said so. */
  | "open-shifts-poster"
  /** On Call handbook editors, as the pill's pages sheet decides. */
  | "on-call-editor";

/** Actions a page can register for the More sheet to run. */
export type WorkFrameActionId = "my-day-reminders" | "my-day-customise" | "assess-record-epa";

export type WorkFrameItem = {
  readonly id: string;
  readonly label: string;
  /** A short static line under the label. Never a live count: the frame holds no records. */
  readonly sub?: string;
  readonly icon: WorkFrameIconName;
  /** Where the item goes. Exactly one of `href` and `action`. */
  readonly href?: string;
  readonly action?: WorkFrameActionId;
  /**
   * The paths on which this item is the current page: exact, or a prefix when
   * the entry ends in "/". Defaults to the path of `href`. An empty list means
   * the item is never current (a link into another area).
   */
  readonly paths?: readonly string[];
  /** Query values the address must carry for this item to be current. */
  readonly query?: Readonly<Record<string, string>>;
  /** The page title the band shows on this item's page. Defaults to `label`. */
  readonly title?: string;
  /**
   * False where the page keeps its own header (a tool page with a back arrow,
   * an editor), so the band stays off it as it always has. The item is still
   * listed and still ticked in More.
   */
  readonly band?: false;
  readonly gate?: WorkFrameGate;
  /** Tints the item's icon with another area's colour, because the tap leaves this area. */
  readonly leadsTo?: AppModeId;
  /**
   * The name the fourth tab shows while this More page is open (navigation
   * follow-up, owner request 7 Oct 2026). Defaults to `label`; set it where the
   * label is too long for four tabs on a 320px phone.
   */
  readonly short?: string;
  /**
   * This item opens an inner area with its own three tabs (Open shifts and
   * Manage team inside Roster, Assessments inside Teaching). More shows it as
   * one wide row rather than a tile, and it is never the current page.
   */
  readonly opens?: WorkAreaId;
};

export type WorkFrameGroup = { readonly label: string; readonly items: readonly WorkFrameItem[] };

export type WorkArea = {
  readonly id: WorkAreaId;
  /** The name the band, the pill's small line and the More sheet title use. */
  readonly name: string;
  /** The `data-mode-identity` palette the frame paints with. */
  readonly identity: AppModeId;
  /** The three pinned tabs, in order. */
  readonly tabs: readonly [WorkFrameItem, WorkFrameItem, WorkFrameItem];
  /** The rest of the area, grouped, in the More sheet after the tabs. */
  readonly groups: readonly WorkFrameGroup[];
  /**
   * The area this one sits inside. An inner area draws a back arrow to its
   * parent on every page, and its More ends with a way back.
   */
  readonly parent?: WorkAreaId;
};

const myDay: WorkArea = {
  id: "day",
  name: "My Day",
  identity: "my-day",
  tabs: [
    { id: "my-day-today", label: "Today", sub: "Your day", icon: "sun", href: "/my-day", title: "Today" },
    {
      id: "my-day-week",
      label: "Week",
      sub: "Shifts and dates",
      icon: "calendar",
      href: "/my-day/week",
      title: "This week",
    },
    { id: "my-day-hours", label: "Hours", sub: "Rostered, not pay", icon: "clock", href: "/my-day/hours" },
  ],
  groups: [
    {
      label: "My Day",
      items: [
        {
          id: "my-day-all",
          label: "Needs you",
          sub: "Overdue first",
          icon: "inbox",
          href: "/my-day?view=all",
          paths: ["/my-day"],
          query: { view: "all" },
        },
        {
          id: "my-day-work",
          label: "On shift",
          sub: "Calls, who is on",
          icon: "phone",
          href: "/my-day?page=work",
          paths: ["/my-day"],
          query: { page: "work" },
        },
        {
          id: "my-day-me",
          label: "My records",
          sub: "Leave, CPD, dates",
          icon: "user",
          href: "/my-day?page=me",
          paths: ["/my-day"],
          query: { page: "me" },
        },
        { id: "my-day-reminders", label: "Reminders", sub: "On this phone", icon: "alarm", action: "my-day-reminders" },
      ],
    },
    {
      label: "Set up",
      items: [
        {
          id: "my-day-profile",
          label: "Work profile",
          sub: "Stage, workplaces",
          icon: "user",
          href: "/my-day/profile",
          band: false,
        },
        {
          id: "my-day-alerts",
          label: "Alerts",
          sub: "Brief, quiet hours",
          icon: "bell",
          href: "/my-day/alerts",
          band: false,
        },
        {
          id: "my-day-privacy",
          label: "Privacy",
          sub: "What is kept where",
          icon: "shield",
          href: "/my-day/profile#privacy",
          paths: [],
        },
        {
          id: "my-day-customise",
          label: "Customise",
          sub: "Cards on Today",
          icon: "sliders",
          action: "my-day-customise",
        },
      ],
    },
  ],
};

const roster: WorkArea = {
  id: "rost",
  name: "Roster",
  identity: "roster",
  tabs: [
    { id: "month", label: "Month", sub: "Your calendar", icon: "calendar", href: "/roster", title: "Roster" },
    { id: "team", label: "Team", sub: "Who is on", icon: "users", href: "/roster/team" },
    { id: "swaps", label: "Swaps", sub: "Ask and answer", icon: "swap", href: "/roster/swaps" },
  ],
  groups: [
    {
      label: "My roster",
      items: [
        { id: "today", label: "Today", sub: "Your shift today", icon: "sun", href: "/roster/today" },
        { id: "shifts", label: "My shifts", sub: "Week by week", icon: "layers", href: "/roster/shifts" },
        { id: "requests", label: "Leave", sub: "Leave and requests", icon: "flag", href: "/roster/requests" },
        {
          id: "hours",
          label: "Hours and rest",
          short: "Hours",
          sub: "Rest checks",
          icon: "pulse",
          href: "/roster?view=hours",
          paths: ["/roster"],
          query: { view: "hours" },
        },
      ],
    },
    {
      label: "Inside Roster",
      items: [
        {
          id: "open-shifts",
          label: "Open shifts",
          sub: "Browse, requests, alerts",
          icon: "search",
          href: "/open-shifts",
          paths: [],
          opens: "open",
        },
        {
          id: "manage",
          label: "Manage team",
          sub: "Inbox, cover, team",
          icon: "clipboard",
          href: "/roster/manage",
          paths: [],
          // Roster managers are the teams' Open shifts posters.
          gate: "open-shifts-poster",
          opens: "manage",
        },
      ],
    },
    {
      label: "Set up",
      items: [
        {
          id: "calendar",
          label: "Calendar sync",
          sub: "Phone calendar",
          icon: "link",
          href: "/roster/calendar",
          band: false,
        },
        { id: "join", label: "Join a team", sub: "Invite code", icon: "qr", href: "/roster/join", band: false },
        { id: "settings", label: "Settings", sub: "Alerts and data", icon: "settings", href: "/roster/settings" },
      ],
    },
  ],
};

/** Open shifts, inside Roster: the shifts on offer, your requests and alerts. */
const openShifts: WorkArea = {
  id: "open",
  name: "Open shifts",
  identity: "roster",
  parent: "rost",
  tabs: [
    {
      id: "open-shifts-browse",
      label: "Browse",
      sub: "Shifts on offer",
      icon: "search",
      href: "/open-shifts",
      title: "Open shifts",
    },
    {
      id: "open-shifts-mine",
      label: "Requests",
      sub: "Asked and booked",
      icon: "send",
      href: "/open-shifts/mine",
      title: "My requests",
    },
    {
      id: "open-shifts-alerts",
      label: "Alerts",
      sub: "When shifts appear",
      icon: "bell",
      href: "/open-shifts/alerts",
      title: "Shift alerts",
    },
  ],
  groups: [
    {
      label: "Open shifts",
      items: [
        {
          id: "open-shifts-post",
          label: "Post a shift",
          short: "Post",
          sub: "Managers",
          icon: "plus",
          href: "/open-shifts/post",
          gate: "open-shifts-poster",
        },
        {
          id: "open-shifts-board",
          label: "Week board",
          sub: "Managers",
          icon: "grid",
          href: "/open-shifts/board",
          gate: "open-shifts-poster",
          band: false,
        },
        {
          id: "open-shifts-log",
          label: "Log a shift",
          sub: "Offered to you",
          icon: "pen",
          href: "/open-shifts/log",
          band: false,
        },
      ],
    },
  ],
};

/**
 * Manage team, inside Roster, for roster managers. One page whose three views
 * are the tabs; the page itself tells anyone else it is for managers only.
 */
const manageTeam: WorkArea = {
  id: "manage",
  name: "Manage team",
  identity: "roster",
  parent: "rost",
  tabs: [
    {
      id: "manage-inbox",
      label: "Inbox",
      sub: "Swaps and requests",
      icon: "inbox",
      href: "/roster/manage",
      title: "Inbox",
    },
    {
      id: "manage-cover",
      label: "Cover",
      sub: "Gaps to fill",
      icon: "users",
      href: "/roster/manage?view=cover",
      paths: ["/roster/manage"],
      query: { view: "cover" },
    },
    {
      id: "manage-team",
      label: "Team",
      sub: "Publish, people, rules",
      icon: "settings",
      href: "/roster/manage?view=team",
      paths: ["/roster/manage"],
      query: { view: "team" },
    },
  ],
  groups: [
    {
      label: "Shifts",
      items: [
        {
          id: "manage-post",
          label: "Post a shift",
          sub: "Open shifts",
          icon: "plus",
          href: "/open-shifts/post",
          paths: [],
          gate: "open-shifts-poster",
        },
        {
          id: "manage-board",
          label: "Week board",
          sub: "Posted shifts",
          icon: "grid",
          href: "/open-shifts/board",
          paths: [],
          gate: "open-shifts-poster",
        },
        {
          id: "manage-team-week",
          label: "Who is on",
          sub: "Team roster",
          icon: "calendar",
          href: "/roster/team",
          paths: [],
        },
      ],
    },
  ],
};

const teaching: WorkArea = {
  id: "teach",
  name: "Teaching",
  identity: "teaching",
  tabs: [
    { id: "today", label: "Today", sub: "What is on", icon: "sun", href: "/teaching", title: "Teaching" },
    {
      id: "week",
      label: "Week",
      sub: "This week's sessions",
      icon: "calendar",
      href: "/teaching/week",
      title: "This week",
    },
    { id: "logbook", label: "Logbook", sub: "Your record", icon: "book", href: "/teaching/logbook" },
  ],
  groups: [
    {
      label: "Sessions",
      items: [
        { id: "teach", label: "Presenting", sub: "Your next talk", icon: "board", href: "/teaching/teach" },
        { id: "whats-on", label: "What's on", sub: "Other services", icon: "grid", href: "/teaching/whats-on" },
        { id: "term", label: "Term", sub: "Dates and goals", icon: "layers", href: "/teaching/term" },
        {
          id: "resources",
          label: "Resources",
          sub: "Slides, papers",
          icon: "folder",
          href: "/teaching/resources",
        },
      ],
    },
    {
      label: "Your record",
      items: [
        { id: "feedback", label: "Feedback", sub: "Rate a session", icon: "star", href: "/teaching/feedback" },
        { id: "review", label: "Log to CPD", sub: "Weekly review", icon: "award", href: "/teaching/review" },
        { id: "exam-prep", label: "Exam prep", sub: "Your plan", icon: "pen", href: "/teaching/exam-prep" },
      ],
    },
    {
      label: "Supervise and organise",
      items: [
        // These two open the Assessments sub-area, which has its own frame.
        {
          id: "assessments",
          label: "Assessments",
          sub: "Forms, EPAs, supervision",
          icon: "file",
          href: "/teaching/assessments",
          paths: [],
          opens: "assess",
        },
        {
          id: "supervision",
          label: "Supervision",
          sub: "Hours to confirm",
          icon: "users",
          href: "/teaching/supervision",
          paths: [],
        },
        {
          id: "organise",
          label: "Organise",
          sub: "Run the program",
          icon: "sliders",
          href: "/teaching/organise",
          gate: "teaching-organiser",
        },
        {
          id: "import",
          label: "Import",
          sub: "Timetable",
          icon: "upload",
          href: "/teaching/import",
          gate: "teaching-organiser",
        },
      ],
    },
  ],
};

const assessments: WorkArea = {
  id: "assess",
  name: "Assessments",
  identity: "teaching",
  parent: "teach",
  tabs: [
    {
      id: "assess-todo",
      label: "To do",
      sub: "Forms to finish",
      icon: "check-list",
      href: "/teaching/assessments",
      title: "Assessments",
    },
    {
      id: "assess-progress",
      label: "Progress",
      sub: "Against targets",
      icon: "target",
      href: "/teaching/assessments?view=progress",
      paths: ["/teaching/assessments"],
      query: { view: "progress" },
    },
    {
      id: "assess-supervision",
      label: "Supervision",
      sub: "Hours to confirm",
      icon: "users",
      href: "/teaching/supervision",
    },
  ],
  groups: [
    {
      label: "Assessments",
      items: [
        { id: "assess-epa", label: "Record an EPA", sub: "Two taps", icon: "plus", action: "assess-record-epa" },
        {
          id: "assess-times",
          label: "Your times",
          sub: "For the window",
          icon: "clock",
          href: "/teaching/assessments?view=times&as=supervisor",
          paths: ["/teaching/assessments"],
          query: { view: "times" },
        },
        {
          id: "assess-history",
          label: "History",
          sub: "Every assessment",
          icon: "history",
          href: "/teaching/assessments?view=all",
          paths: ["/teaching/assessments"],
          query: { view: "all" },
        },
        {
          id: "assess-help",
          label: "Get help",
          sub: "Concerns, doctors",
          icon: "help",
          href: "/teaching/assessments?view=help",
          paths: ["/teaching/assessments"],
          query: { view: "help" },
        },
      ],
    },
    {
      label: "Teaching",
      items: [
        {
          id: "assess-teach-week",
          label: "This week",
          sub: "Teaching sessions",
          icon: "calendar",
          href: "/teaching/week",
          paths: [],
        },
        {
          id: "assess-teach-presenting",
          label: "Presenting",
          sub: "Your next talk",
          icon: "board",
          href: "/teaching/teach",
          paths: [],
        },
        {
          id: "assess-teach-record",
          label: "My record",
          sub: "Logbook",
          icon: "book",
          href: "/teaching/logbook",
          paths: [],
        },
        {
          id: "assess-teach-resources",
          label: "Resources",
          sub: "Slides, papers",
          icon: "folder",
          href: "/teaching/resources",
          paths: [],
        },
      ],
    },
  ],
};

const cpd: WorkArea = {
  id: "cpd",
  name: "CPD",
  identity: "cme",
  tabs: [
    {
      id: "year",
      label: "Summary",
      sub: "Your year",
      icon: "award",
      href: "/cme",
      paths: ["/cme", "/cme/calendar"],
      title: "CPD",
    },
    { id: "log", label: "Log", sub: "Activities", icon: "list", href: "/cme/log", paths: ["/cme/log", "/cme/new"] },
    { id: "learning", label: "Learning", sub: "Courses on offer", icon: "compass", href: "/cme/learning" },
  ],
  groups: [
    {
      label: "Your year",
      items: [
        { id: "setup", label: "Report", sub: "Year check", icon: "check-list", href: "/cme/check" },
        { id: "plan", label: "Plan", sub: "Your goals", icon: "target", href: "/cme/plan" },
        {
          id: "targets",
          label: "Targets",
          sub: "Your confirmed numbers",
          icon: "flag",
          href: "/cme/setup",
          paths: ["/cme/setup", "/cme/programme"],
        },
        { id: "training", label: "Training", sub: "Registrar record", icon: "layers", href: "/cme/training" },
      ],
    },
    {
      label: "Records",
      items: [
        {
          id: "finish",
          label: "To finish",
          sub: "Drafts and teaching",
          icon: "clipboard",
          href: "/cme/log?tab=finish",
          paths: ["/cme/log"],
          query: { tab: "finish" },
        },
        { id: "routines", label: "Routines", sub: "Regular activities", icon: "repeat", href: "/cme/routines" },
      ],
    },
    {
      label: "Settings",
      items: [
        {
          id: "customise",
          label: "Customise",
          sub: "Summary sections",
          icon: "sliders",
          href: "/cme/customise",
          band: false,
        },
        {
          id: "setup-edit",
          label: "Set up",
          sub: "Home and total",
          icon: "settings",
          href: "/cme/setup?edit=1",
          paths: ["/cme/setup"],
          query: { edit: "1" },
        },
      ],
    },
  ],
};

const admin: WorkArea = {
  id: "admin",
  name: "Admin",
  identity: "my-work",
  tabs: [
    { id: "admin-today", label: "Today", sub: "What needs doing", icon: "sun", href: "/admin", title: "Admin" },
    { id: "renewals", label: "Renewals", sub: "Dates to act on", icon: "repeat", href: "/admin/renewals" },
    {
      id: "new-job",
      label: "New job",
      sub: "Before you start",
      icon: "card",
      href: "/admin/new-job",
      paths: ["/admin/new-job", "/admin/new-job/records", "/admin/new-job/pack"],
    },
  ],
  groups: [
    {
      label: "Paperwork",
      items: [
        {
          id: "admin-compliance",
          label: "Compliance",
          sub: "Every requirement",
          icon: "shield",
          href: "/admin/compliance",
        },
        { id: "admin-export", label: "Export", sub: "Spreadsheet", icon: "download", href: "/admin/compliance/export" },
        { id: "help", label: "Help", sub: "Crisis lines first", icon: "help", href: "/admin/help" },
      ],
    },
    {
      label: "Pay and hours",
      items: [
        // Extra time is kept in Roster's hours panel, so the tap leaves Admin.
        {
          id: "admin-overtime",
          label: "Overtime",
          sub: "Extra time in Roster",
          icon: "clock",
          href: "/roster?view=hours",
          paths: [],
          leadsTo: "roster",
        },
      ],
    },
  ],
};

const onCall: WorkArea = {
  id: "call",
  name: "On Call",
  identity: "on-call",
  tabs: [
    { id: "now", label: "Now", sub: "Your shift", icon: "pulse", href: "/on-call", title: "On Call" },
    {
      id: "call",
      label: "People",
      sub: "Who to ring",
      icon: "phone",
      href: "/on-call/call",
      paths: ["/on-call/call", "/on-call/contacts"],
    },
    {
      id: "refer",
      label: "Refer",
      sub: "Who takes it",
      icon: "refer",
      href: "/on-call/refer",
      paths: ["/on-call/refer", "/on-call/referrals"],
    },
  ],
  groups: [
    {
      label: "Reference",
      items: [
        { id: "find", label: "Handbook", sub: "Wards, systems", icon: "book", href: "/on-call/find" },
        { id: "playbook", label: "Playbook", sub: "What to do", icon: "clipboard", href: "/on-call/playbook" },
        { id: "whoswho", label: "Who's who", sub: "Roles and teams", icon: "users", href: "/on-call/who-is-who" },
        {
          id: "orientation",
          label: "Orientation",
          sub: "Checklists",
          icon: "check-list",
          href: "/on-call/orientation",
        },
        { id: "card", label: "Pocket card", sub: "To print", icon: "card", href: "/on-call/card" },
      ],
    },
    {
      label: "Tonight tools",
      items: [
        {
          id: "call-now",
          label: "Who to call now",
          short: "Call now",
          sub: "Pick a problem",
          icon: "phone",
          href: "/on-call/now",
        },
        ...(ON_CALL_WHOS_ON_ENABLED
          ? [
              {
                id: "whoson",
                label: "Who's on",
                sub: "Tonight's team",
                icon: "users",
                href: "/on-call/whos-on",
              } as const,
            ]
          : []),
        {
          id: "pulse",
          label: "Shift pulse",
          sub: "How it is going",
          icon: "pulse",
          href: "/on-call/pulse",
          band: false,
        },
        {
          id: "check",
          label: "Check these",
          sub: "Before you leave",
          icon: "check-list",
          href: "/on-call/check",
          band: false,
        },
        {
          id: "first-night",
          label: "First night",
          sub: "New to this site",
          icon: "star",
          href: "/on-call/first-night",
          band: false,
        },
        {
          id: "handover",
          label: "Handover",
          sub: "Kept on this phone",
          icon: "send",
          href: "/on-call/handover",
          band: false,
        },
      ],
    },
    {
      label: "Other areas",
      items: [
        {
          id: "teaching",
          label: "Teaching",
          sub: "This week",
          icon: "board",
          href: "/teaching",
          paths: [],
          leadsTo: "teaching",
        },
        {
          id: "logistics",
          label: "Admin",
          sub: "Help and numbers",
          icon: "help",
          href: ON_CALL_ADMIN_ROWS_HREF,
          paths: [],
          leadsTo: "my-work",
        },
        {
          id: "compliance",
          label: "Compliance",
          sub: "Renewals",
          icon: "repeat",
          href: "/admin/renewals",
          paths: [],
          leadsTo: "my-work",
        },
      ],
    },
    {
      label: "Service",
      items: [
        {
          id: "service",
          label: "Manage service",
          short: "Service",
          sub: "Editors",
          icon: "settings",
          href: "/on-call/service",
          gate: "on-call-editor",
        },
      ],
    },
  ],
};

export const WORK_AREAS: Readonly<Record<WorkAreaId, WorkArea>> = {
  day: myDay,
  rost: roster,
  open: openShifts,
  manage: manageTeam,
  teach: teaching,
  assess: assessments,
  cpd,
  admin,
  call: onCall,
};

/** Assessments is a sub-area of Teaching: these paths draw its frame, not Teaching's. */
const ASSESSMENT_PATHS: readonly string[] = ["/teaching/assessments", "/teaching/supervision"];

/**
 * The work area a band draws for this mode and address, or null for every mode
 * that is not a work area (clinical modes keep their band exactly as it was).
 */
export function workAreaFor(modeId: AppModeId, pathname: string): WorkArea | null {
  switch (modeId) {
    case "my-day":
      return myDay;
    case "roster":
      return pathname === "/roster/manage" || pathname.startsWith("/roster/manage/") ? manageTeam : roster;
    case "open-shifts":
      // Open shifts is an inner area of Roster, with Roster's colours. The mode
      // id stays `open-shifts` for search and the registry.
      return openShifts;
    case "teaching":
      return ASSESSMENT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
        ? assessments
        : teaching;
    case "cme":
      return cpd;
    case "my-work":
      return admin;
    case "on-call":
      return onCall;
    default:
      return null;
  }
}

/** Every item of an area, pinned tabs first, in sheet order. */
export function workAreaItems(area: WorkArea): readonly WorkFrameItem[] {
  return [...area.tabs, ...area.groups.flatMap((group) => group.items)];
}

function hrefPath(href: string): string {
  return href.split(/[?#]/)[0] ?? href;
}

function pathMatches(paths: readonly string[], pathname: string): boolean {
  return paths.some((path) => (path.endsWith("/") ? pathname.startsWith(path) : pathname === path));
}

function itemPaths(item: WorkFrameItem): readonly string[] {
  if (item.paths) return item.paths;
  return item.href ? [hrefPath(item.href)] : [];
}

/**
 * The item that is the current page. An item that asks for query values wins
 * over one that does not, so `/my-day?page=work` is On shift and plain
 * `/my-day` is Today. `search` is the address's query string, with or without
 * its "?"; pass "" when it is not known yet (server render).
 */
export function workFrameCurrentItem(area: WorkArea, pathname: string, search: string): WorkFrameItem | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const onPath = workAreaItems(area).filter((item) => pathMatches(itemPaths(item), pathname));
  const withQuery = onPath.find(
    (item) => item.query && Object.entries(item.query).every(([key, value]) => params.get(key) === value),
  );
  if (withQuery) return withQuery;
  return onPath.find((item) => !item.query) ?? null;
}

/** The pinned tab index (0 to 2) of an item id, or -1 when it lives in More. */
export function workFrameTabIndex(area: WorkArea, itemId: string | null): number {
  return itemId ? area.tabs.findIndex((tab) => tab.id === itemId) : -1;
}

/** Finds an item by id, for a page that names its own current page. */
export function workFrameItemById(area: WorkArea, itemId: string): WorkFrameItem | null {
  return workAreaItems(area).find((item) => item.id === itemId) ?? null;
}

/**
 * What the band will draw for this mode and address before it has mounted:
 * the area and the page it names, decided from the address alone (no query,
 * no page override), exactly as the band's own first render decides it. Null
 * where no framed band is drawn: a clinical mode, a `band: false` page, or an
 * address no frame item owns. The top bar uses it so its pill and tint are
 * right in the server HTML, before the band publishes them.
 */
export function workFrameForRoute(
  modeId: AppModeId,
  pathname: string,
): { readonly area: WorkArea; readonly page: WorkFrameItem } | null {
  const area = workAreaFor(modeId, pathname);
  const page = area ? workFrameCurrentItem(area, pathname, "") : null;
  if (!area || !page || page.band === false) return null;
  return { area, page };
}

/** The area an inner area sits inside, or null for a top-level area. */
export function workAreaParent(area: WorkArea): WorkArea | null {
  return area.parent ? WORK_AREAS[area.parent] : null;
}

/** What the fourth tab says while this More page is open. */
export function workFrameTabLabel(item: WorkFrameItem): string {
  return item.short ?? item.label;
}

/** The most tabs the row ever shows, More aside: six on a tablet. */
export const WORK_FRAME_MAX_TABS = 6;

/**
 * More pages that join the tab row when the screen is wide enough to show
 * them (navigation follow-up, owner request 7 Oct 2026). The width decides:
 * the three pinned tabs always show, then these in the order More lists them,
 * as many as fit, up to six tabs. Only plain pages of this area qualify: not
 * actions, inner areas, links into other areas or pages that keep their own
 * header. The caller drops gated pages the reader cannot see.
 */
export function workFrameExtraTabs(area: WorkArea): readonly WorkFrameItem[] {
  return area.groups
    .flatMap((group) => group.items)
    .filter(
      (item) =>
        Boolean(item.href) &&
        !item.action &&
        !item.opens &&
        !item.leadsTo &&
        item.band !== false &&
        item.paths?.length !== 0,
    );
}
