import {
  appModeHomeHref,
  dsmSearchHref,
  factsheetsSearchHref,
  factsheetsTopicsHref,
  type AppModeId,
} from "@/lib/app-modes";
import { consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";
import { ON_CALL_ADMIN_ROWS_HREF, ON_CALL_WHOS_ON_ENABLED } from "@/lib/on-call/feature-flags";
import { SOURCE_METHOD_ROUTE } from "@/lib/sources/rating-method";
import { therapyWorkspaceNavigationEntries } from "@/lib/therapy-compass-navigation";

export type ModeSecondaryNavigationEntry = {
  id: string;
  label: string;
  shortLabel?: string;
  href?: string;
  /**
   * Which part of the mode's pages sheet the entry sits in. Absent means the
   * mode's own pages; "tools" and "more" draw under their own headings below
   * them (On Call only, kit 1.7).
   */
  group?: "tools" | "more";
  /** "editors": shown in the pages sheet only to a reader who can edit (F24). */
  audience?: "editors";
  /** Registered and routed, but left out of the pages sheet (a page behind a flag). */
  hidden?: boolean;
};

/**
 * Canonical secondary destinations for every app mode. These are deliberately
 * task-oriented: the global/sidebar navigation already owns mode homes, so a
 * secondary bar must never repeat a generic Home destination.
 */
export const modeSecondaryNavigationRegistry = {
  // Empty is a real answer, not a gap. These eight modes each registered one
  // `action: "search"` entry, which rendered a lone <button> inside its own
  // <nav> landmark whose only effect was focusing a composer already visible on
  // the same screen — a landmark and a tab stop spent on a no-op. Every one of
  // them is genuinely single-surface (records, or one page), so there was no
  // destination to adopt onto the shared bar and nothing to replace the button
  // with. Deleted rather than ported.
  answer: [],
  documents: [],
  services: [],
  forms: [],
  favourites: [],
  differentials: [
    { id: "search", label: "Search", href: appModeHomeHref("differentials", { focus: true }) },
    { id: "diagnoses", label: "Diagnoses", href: "/differentials/diagnoses" },
    { id: "presentations", label: "Presentations", href: "/differentials/presentations" },
    { id: "compare", label: "Compare", href: "/differentials/compare" },
  ],
  dsm: [
    { id: "search", label: "Search", href: dsmSearchHref },
    { id: "compare", label: "Compare", href: "/dsm/compare" },
  ],
  specifiers: [
    { id: "search", label: "Search", href: consolidatedModeSearchPath("specifiers") },
    { id: "builder", label: "Build", href: "/specifiers/builder" },
    { id: "compare", label: "Compare", href: "/specifiers/compare" },
    { id: "map", label: "Map", href: "/specifiers/map" },
  ],
  formulation: [
    { id: "search", label: "Find", href: appModeHomeHref("formulation", { focus: true }) },
    { id: "builder", label: "Build", href: "/formulation/builder" },
    { id: "compare", label: "Compare", href: "/formulation/compare" },
    { id: "map", label: "Map", href: "/formulation/map" },
  ],
  prescribing: [],
  tools: [],
  calculators: [],
  // Record-owned outputs (briefs and patient sheets) deliberately stay off the
  // global mode bar: they require an explicitly selected therapy. This prevents
  // a generic navigation action from silently opening an unrelated default
  // record. The global/sidebar mode switch already owns Home.
  "therapy-compass": [
    { id: "search", label: "Search", href: "/therapy-compass/search" },
    { id: "recommend", label: "Recommend", href: "/therapy-compass/recommend" },
    { id: "compare", label: "Compare", href: "/therapy-compass/compare" },
    { id: "pathways", label: "Pathways", href: "/therapy-compass/pathways" },
    { id: "review", label: "Review", href: "/therapy-compass/review" },
  ],
  // Two genuinely distinct surfaces: `/factsheets/search` (query + filters +
  // result rows) and `/factsheets/topics` (category browse). Search leads, the
  // same way Dictionary leads with Terms then Topics. `/factsheets/[slug]` is a
  // record and never reaches here — `hasLocalInformationPageNavigation` returns
  // null for it first.
  //
  // No `focus: true` on Topics, unlike the Search/Find entry of every mode
  // above. Those tabs are the mode's search affordance, so focusing the composer
  // on arrival is the point. Topics is a browse destination — autofocusing there
  // would open the phone keyboard over the topics the user asked to see. The
  // search affordance for this mode is the Search tab.
  factsheets: [
    { id: "search", label: "Search", href: factsheetsSearchHref },
    { id: "topics", label: "Topics", href: factsheetsTopicsHref },
  ],
  // Search and Browse were one catalogue behind two destinations: the same
  // entries, the same rows, the same data, so a reader who typed a term while on
  // Browse had to change tab to see it. They are merged onto `/dictionary/search`,
  // which is why the surviving tab is labelled for the content ("Terms") rather
  // than for one of the two verbs it now covers. `/dictionary/browse` redirects.
  //
  // Four destinations, not five, is also what puts Terms and Topics — the two a
  // reader reaches for — in the phone bar's three slots beside More, instead of
  // Search and Browse, which were the same place.
  dictionary: [
    { id: "search", label: "Terms", href: "/dictionary/search" },
    { id: "topics", label: "Topics", href: "/dictionary/topics" },
    { id: "compare", label: "Compare", href: "/dictionary/compare" },
    { id: "sources", label: "Sources", href: "/dictionary/sources" },
  ],
  sources: [
    { id: "catalogue", label: "Catalogue", href: "/sources/search" },
    { id: "topics", label: "Topics", href: "/sources/topics" },
    { id: "publishers", label: "Publishers", href: "/sources/publishers" },
    { id: "method", label: "Method", href: SOURCE_METHOD_ROUTE },
  ],
  // On Call's destinations, restored. They were removed once, and the reason is
  // worth keeping: every section route is an information page, so
  // `PageSecondaryNavigation` returns null for all of them and the SHELL can
  // never draw this mode's bar. That was read as "the bar cannot work here" and
  // the entries were deleted; the actual fix is that the PAGE mounts
  // `RegistryModeNav` itself, exactly as `differential-presentation-workflow-page`
  // does. `docs/superpowers/specs/2026-09-04-on-call-mode-design.md` §8.3 always
  // intended this ("On Call joins the adopted-nav set with a density profile").
  //
  // The six shift pages lead (kit 1.7): Now is the mode home and the page a
  // shift opens; Who's on, Call, Playbook, Refer and Find follow in the order a
  // night uses them. Two tools sit under their own heading, and the pages that
  // are moving out to their own modes sit under More until each sibling mode's
  // build removes its row with a redirect.
  //
  // No `count` on any entry, deliberately. `ModeNavItem.count` is documented as
  // "state, not size" — a fill like 3/4, never a catalogue total.
  //
  // The pocket card is a destination rather than an action because it is a real
  // route with a real URL, and a `ModeNavItem` takes an href by design so deep
  // links, back and prefetch keep working.
  "on-call": [
    { id: "now", label: "Now", href: "/on-call" },
    // Routed and built, but left out of the sheet until the owner turns it on.
    { id: "whoson", label: "Who's on", href: "/on-call/whos-on", hidden: !ON_CALL_WHOS_ON_ENABLED },
    { id: "call", label: "Call", href: "/on-call/call" },
    { id: "playbook", label: "Playbook", href: "/on-call/playbook" },
    { id: "refer", label: "Refer", href: "/on-call/refer" },
    { id: "find", label: "Find", href: "/on-call/find" },
    { id: "card", label: "Pocket card", href: "/on-call/card", group: "tools" },
    // The invited multi-clinician service handbook, shown to editors only (F24).
    { id: "service", label: "Manage service", href: "/on-call/service", group: "tools", audience: "editors" },
    // Moving out: each sibling mode's build removes its own row with a redirect.
    // Compliance is a VIEW over the `logistics` section, discriminated by
    // `details.kind` (src/lib/on-call/compliance.ts). "Admin" and "Teaching" are
    // labels only: the stored section ids and database check constraints stay
    // `logistics` and `education`. More goes straight to Admin / Teaching homes;
    // `/on-call/compliance`, `/on-call/logistics` and `/on-call/education` stay
    // as bookmarks (compliance/logistics redirect; education page is retained).
    { id: "compliance", label: "Compliance", href: "/admin/renewals", group: "more" },
    { id: "logistics", label: "Admin", href: ON_CALL_ADMIN_ROWS_HREF, group: "more" },
    { id: "teaching", label: "Teaching", href: "/teaching", group: "more" },
    { id: "whoswho", label: "Who's who", href: "/on-call/who-is-who", group: "more" },
    { id: "orientation", label: "Orientation checklists", href: "/on-call/orientation", group: "more" },
  ],
  // CPD's five pages. Older /cme/* addresses remain routed and map to their
  // owning page below. Like On Call's, they are registered so the mode
  // pill's section level can open them, but CPD is deliberately absent from
  // `MODE_NAV_ADOPTED_MODES` below: no page mounts the shared bar, because the
  // pill already opens exactly these and a rail repeating them would be two
  // controls doing one job.
  //
  // Today leads because the dashboard is the page the mode is judged by.
  // Year check, Routines, Calendar, Training and Programme are tabs reached
  // from their parent pages. Customise and the annual summary stay secondary.
  cme: [
    { id: "year", label: "Today", href: "/cme" },
    { id: "log", label: "Log", href: "/cme/log" },
    { id: "plan", label: "Plan", href: "/cme/plan" },
    { id: "learning", label: "Learning", href: "/cme/learning" },
    { id: "setup", label: "Set up", href: "/cme/setup" },
  ],
  // Teaching's pages, for the mode pill's page list, like CME's. Teaching is
  // absent from `MODE_NAV_ADOPTED_MODES`: the pill already opens these, so no
  // page mounts the shared bar. Organise is hidden from the pill for anyone
  // who is not an organiser or admin (`src/lib/teaching/page-visibility.ts`);
  teaching: [
    { id: "today", label: "Today", href: "/teaching" },
    { id: "week", label: "Week", href: "/teaching/week" },
    { id: "whats-on", label: "What's on", href: "/teaching/whats-on" },
    { id: "resources", label: "Resources", href: "/teaching/resources" },
    { id: "logbook", label: "Logbook", href: "/teaching/logbook" },
    { id: "teach", label: "Teach", href: "/teaching/teach" },
    { id: "supervision", label: "Supervision", href: "/teaching/supervision" },
    { id: "organise", label: "Organise", href: "/teaching/organise" },
  ],
  // Psychiatry's home is itself the list of sections it gathers, and each
  // section keeps its own navigation, so the hub registers no destinations.
  psychiatry: [],
  // Admin keeps the internal mode id for existing preferences and links.
  "my-work": [
    { id: "admin-today", label: "Today", href: "/admin" },
    { id: "renewals", label: "Renewals", href: "/admin/renewals" },
    { id: "new-job", label: "New job", href: "/admin/new-job" },
    { id: "help", label: "Help", href: "/admin/help" },
  ],
  // Roster's pages, registered so the mode pill's section sheet can open them.
  // Manage is deliberately absent: this registry is the same for everyone and
  // non-managers must not see it, so managers reach /roster/manage from a row
  // on Today and on Settings. Like On Call and CME, Roster is absent from
  // `MODE_NAV_ADOPTED_MODES`, so no shared rail is mounted. Its pages carry no
  // in-page navigation header either: the mode pill's section sheet is how a
  // reader moves between its pages.
  roster: [
    { id: "today", label: "Today", href: "/roster" },
    { id: "shifts", label: "Shifts", href: "/roster/shifts" },
    { id: "team", label: "Team", href: "/roster/team" },
    { id: "swaps", label: "Swaps", href: "/roster/swaps" },
    { id: "requests", label: "Requests", href: "/roster/requests" },
    { id: "settings", label: "Settings", href: "/roster/settings" },
  ],
  // First Nations, spec §3 order. The pages sheet's group headings ("At the
  // bedside", "During the stay", "Leaving hospital") wait for the shared pages
  // sheet to support groups (On Call's rebuild).
  "first-nations": [
    { id: "first-nations-bedside", label: "Bedside", href: "/first-nations" },
    { id: "first-nations-contacts", label: "Contacts", href: "/first-nations/contacts" },
    { id: "first-nations-talking", label: "Talking", href: "/first-nations/talking" },
    { id: "first-nations-family", label: "Family", href: "/first-nations/family" },
    { id: "first-nations-mental-health", label: "Mental health", href: "/first-nations/mental-health" },
    { id: "first-nations-on-the-ward", label: "On the ward", href: "/first-nations/on-the-ward" },
    { id: "first-nations-mistakes", label: "Common mistakes", href: "/first-nations/mistakes" },
    { id: "first-nations-going-home", label: "Going home", href: "/first-nations/going-home" },
    { id: "first-nations-end-of-life", label: "End of life", href: "/first-nations/end-of-life" },
  ],
  // My Day is one page: the merged list is itself the navigation, and each row
  // links into the mode that owns the item, so it registers no destinations.
  // My Day's pages, registered so the mode pill's section sheet can open them.
  // Like Roster, it is absent from `MODE_NAV_ADOPTED_MODES` and its pages carry
  // no in-page navigation header: the section sheet is how a reader moves
  // between them. Ids are prefixed so they stay unique across modes.
  "my-day": [
    { id: "my-day-today", label: "Today", href: "/my-day" },
    { id: "my-day-week", label: "Week", href: "/my-day/week" },
    { id: "my-day-hours", label: "Hours", href: "/my-day/hours" },
  ],
} as const satisfies Record<AppModeId, readonly ModeSecondaryNavigationEntry[]>;

type RegistryEntry = (typeof modeSecondaryNavigationRegistry)[AppModeId][number];

/**
 * The ids of registry entries that carry an `href`, and so can become a
 * `ModeNavItem`. Derived from the registry literal rather than written out, so
 * adding a routed entry without choosing an icon for it fails the typecheck in
 * `RegistryModeNav` instead of shipping a silent default.
 */
export type RoutedModeSecondaryNavigationId = Extract<RegistryEntry, { href: string }>["id"];

/**
 * Modes whose destinations render as the shared header bar rather than the
 * in-flow `SecondaryNavigation` strip.
 *
 * Listed rather than derived from "has two or more routed entries". The
 * derivation is the *criterion*, and `tests/mode-secondary-navigation.test.ts`
 * checks this set against it — but a registry edit must not silently move a
 * mode onto a different navigation surface. Adoption is a per-mode decision
 * with its own density evidence (`tests/ui-mode-nav-density.spec.ts`).
 *
 * Therapy uses the same registry as every other multi-route catalogue. Its
 * record-owned brief and patient-sheet outputs are intentionally absent.
 */
export const MODE_NAV_ADOPTED_MODES = [
  "dsm",
  "specifiers",
  "formulation",
  "differentials",
  "factsheets",
  "therapy-compass",
  "dictionary",
  "sources",
  // On Call is deliberately absent. Its thirteen destinations stay registered
  // below — the mode pill's section level reads them — but no page mounts the
  // shared bar, because the pill already opens exactly those pages and a rail
  // repeating them was two controls doing one job. The section pages carry the
  // in-page header instead, whose list is the current page's own groups.
] as const satisfies readonly AppModeId[];

export type ModeNavAdoptedMode = (typeof MODE_NAV_ADOPTED_MODES)[number];

export function modeUsesHeaderModeNav(modeId: AppModeId): modeId is ModeNavAdoptedMode {
  return (MODE_NAV_ADOPTED_MODES as readonly AppModeId[]).includes(modeId);
}

export function modeSecondaryNavigationEntries(modeId: AppModeId): readonly ModeSecondaryNavigationEntry[] {
  return modeSecondaryNavigationRegistry[modeId];
}

/** Count of registry entries that carry an href (eligible ModeNav slots). */
export function routedModeSecondaryNavigationCount(modeId: AppModeId): number {
  return modeSecondaryNavigationEntries(modeId).filter((entry) => Boolean(entry.href)).length;
}

const ON_CALL_ACTIVE_IDS: Readonly<Record<string, string>> = {
  "/on-call": "now",
  "/on-call/whos-on": "whoson",
  "/on-call/call": "call",
  "/on-call/contacts": "call",
  "/on-call/playbook": "playbook",
  "/on-call/now": "playbook",
  "/on-call/refer": "refer",
  "/on-call/referrals": "refer",
  "/on-call/find": "find",
  "/on-call/card": "card",
  "/on-call/service": "service",
  // Bookmark paths (proxy/page redirects still serve these) plus the direct
  // Admin/Teaching homes More now opens.
  "/on-call/compliance": "compliance",
  "/admin/renewals": "compliance",
  "/on-call/logistics": "logistics",
  "/admin/help": "logistics",
  "/on-call/education": "teaching",
  "/teaching": "teaching",
  "/on-call/who-is-who": "whoswho",
  "/on-call/orientation": "orientation",
};

/**
 * Split a mode's entries into its own pages, its tools and the pages moving
 * out. Order within each group is the registry's. Modes that set no `group`
 * come back entirely in `main`.
 */
export function groupModeSecondaryNavigationEntries<T extends ModeSecondaryNavigationEntry>(
  entries: readonly T[],
): { main: T[]; tools: T[]; more: T[] } {
  return {
    main: entries.filter((entry) => !entry.group),
    tools: entries.filter((entry) => entry.group === "tools"),
    more: entries.filter((entry) => entry.group === "more"),
  };
}

/**
 * The entries a pages sheet shows this reader: drops `hidden` entries, and
 * `audience: "editors"` entries when `isEditor` is false. On Call passes
 * `readOnCallEditorFlag()`, which is true while the role is still unknown and
 * false only for a known non-editor (review S3); the page does the real gating.
 * The routes stay registered either way, so the pill still names the page.
 */
export function visibleModeSecondaryNavigationEntries<T extends ModeSecondaryNavigationEntry>(
  entries: readonly T[],
  { isEditor }: { readonly isEditor: boolean },
): T[] {
  return entries.filter((entry) => !entry.hidden && (entry.audience !== "editors" || isEditor));
}

/**
 * Which destination is current for `modeId` on `pathname`.
 *
 * Returns `null` when no registered destination owns the route (record/detail
 * pages, unknown in-mode paths). Callers that always pass this into `ModeNav`
 * must treat `null` as "no `aria-current`", not fall back to the first slot —
 * otherwise Find/Search is falsely marked current on every unmatched path.
 */
export function activeModeSecondaryNavigationId(modeId: AppModeId, pathname: string): string | null {
  if (modeId === "differentials") {
    if (pathname.startsWith("/differentials/diagnoses")) return "diagnoses";
    // Browse + presentation detail are one Presentations family (symmetric with Diagnoses).
    if (pathname.startsWith("/differentials/presentations")) return "presentations";
    if (pathname === "/differentials/compare" || pathname.startsWith("/differentials/compare/")) {
      return "compare";
    }
    if (pathname === "/differentials" || pathname.startsWith("/differentials?")) return "search";
    return null;
  }
  if (modeId === "dsm") {
    if (pathname.startsWith("/dsm/compare")) return "compare";
    if (pathname === "/dsm" || pathname === "/dsm/search" || pathname.startsWith("/dsm?")) return "search";
    return null;
  }
  if (modeId === "specifiers") {
    if (pathname === "/specifiers/builder" || pathname.startsWith("/specifiers/builder/")) return "builder";
    if (pathname === "/specifiers/compare" || pathname.startsWith("/specifiers/compare/")) return "compare";
    if (pathname === "/specifiers/map" || pathname.startsWith("/specifiers/map/")) return "map";
    if (pathname === "/specifiers/search" || pathname.startsWith("/specifiers/search?")) return "search";
    if (pathname === "/specifiers" || pathname.startsWith("/specifiers?")) return "search";
    return null;
  }
  if (modeId === "formulation") {
    // Exact segment prefixes, not `includes`: a future slug containing
    // "map"/"compare"/"builder" must not steal `aria-current` from Find.
    // Matches the exact-path checks in `isModeSecondaryNavigationRoute`.
    if (pathname === "/formulation/builder" || pathname.startsWith("/formulation/builder/")) return "builder";
    if (pathname === "/formulation/compare" || pathname.startsWith("/formulation/compare/")) return "compare";
    if (pathname === "/formulation/map" || pathname.startsWith("/formulation/map/")) return "map";
    if (pathname === "/formulation" || pathname.startsWith("/formulation?")) return "search";
    return null;
  }
  if (modeId === "factsheets") {
    if (pathname === "/factsheets/search" || pathname.startsWith("/factsheets/search?")) return "search";
    if (pathname === "/factsheets/topics" || pathname.startsWith("/factsheets/topics?")) return "topics";
    // `/factsheets` redirects to the shared home and never renders ModeNav.
    // `/factsheets/<slug>` is a record. Neither path is Search or Topics;
    // without this explicit null they would inherit the mode's first entry.
    return null;
  }
  if (modeId === "therapy-compass") {
    if (pathname === "/therapy-compass/search") return "search";
    if (pathname === "/therapy-compass/recommend") return "recommend";
    if (pathname === "/therapy-compass/compare") return "compare";
    if (pathname === "/therapy-compass/pathways") return "pathways";
    if (pathname === "/therapy-compass/review") return "review";
    return null;
  }
  if (modeId === "dictionary") {
    // `/dictionary/browse` is absent deliberately: it redirects to
    // `/dictionary/search` before a page renders, so it can never reach here.
    if (pathname === "/dictionary/search") return "search";
    if (pathname === "/dictionary/topics" || pathname.startsWith("/dictionary/topics/")) return "topics";
    if (pathname === "/dictionary/compare") return "compare";
    if (pathname === "/dictionary/sources") return "sources";
    return null;
  }
  if (modeId === "sources") {
    if (pathname === "/sources/search") return "catalogue";
    if (pathname === "/sources/topics") return "topics";
    if (pathname === "/sources/publishers") return "publishers";
    if (pathname === SOURCE_METHOD_ROUTE) return "method";
    return null;
  }
  if (modeId === "on-call") {
    // Exact paths only (kit 1.7): a prefix test would mark Now current on every
    // route, and `/on-call/whos-on/x` is no page of its own. The two editors
    // (Contacts, Referrals) light the page that replaced them, and the "Who do
    // I call now?" picker lights Playbook, whose question it answers.
    return ON_CALL_ACTIVE_IDS[pathname] ?? null;
  }
  if (modeId === "cme") {
    if (
      pathname === "/cme/log" ||
      pathname.startsWith("/cme/log/") ||
      pathname === "/cme/routines" ||
      pathname === "/cme/new"
    )
      return "log";
    if (pathname === "/cme/check") return "year";
    if (pathname === "/cme/training" || pathname === "/cme/calendar" || pathname === "/cme/plan") return "plan";
    if (pathname === "/cme/learning") return "learning";
    if (pathname === "/cme/programme" || pathname === "/cme/setup") return "setup";
    // Exact match only, for the same reason On Call's home is: a prefix test
    // here would mark Today current on every CPD route as well as its own.
    if (pathname === "/cme") return "year";
    return null;
  }
  if (modeId === "teaching") {
    // Exact match only, as for On Call and CME: a prefix test would mark
    // Today current on every Teaching route as well as its own.
    if (pathname === "/teaching") return "today";
    if (pathname === "/teaching/week") return "week";
    if (pathname === "/teaching/whats-on") return "whats-on";
    if (pathname === "/teaching/resources" || pathname.startsWith("/teaching/resources/")) return "resources";
    if (pathname === "/teaching/teach") return "teach";
    if (pathname === "/teaching/supervision") return "supervision";
    if (pathname === "/teaching/review" || pathname === "/teaching/feedback") return "logbook";
    if (pathname === "/teaching/import") return "organise";
    if (pathname === "/teaching/logbook") return "logbook";
    if (pathname === "/teaching/organise") return "organise";
    return null;
  }
  if (modeId === "my-work") {
    if (pathname === "/admin/renewals") return "renewals";
    if (pathname === "/admin/new-job" || pathname === "/admin/new-job/records" || pathname === "/admin/new-job/pack")
      return "new-job";
    if (pathname === "/admin/help") return "help";
    if (pathname === "/admin") return "admin-today";
    return null;
  }
  if (modeId === "my-day") {
    // Exact matches only, for the same reason Roster's are: a prefix test would
    // mark Today current on every My Day route as well as its own.
    if (pathname === "/my-day/week") return "my-day-week";
    if (pathname === "/my-day/hours") return "my-day-hours";
    if (pathname === "/my-day") return "my-day-today";
    return null;
  }
  if (modeId === "roster") {
    if (pathname === "/roster/shifts") return "shifts";
    if (pathname === "/roster/team") return "team";
    if (pathname === "/roster/swaps") return "swaps";
    if (pathname === "/roster/requests") return "requests";
    if (pathname === "/roster/settings") return "settings";
    // Exact match only, for the same reason On Call's and CME's homes are: a
    // prefix test here would mark Today current on every Roster route as well
    // as its own.
    if (pathname === "/roster") return "today";
    return null;
  }
  // Every mode with destinations has a branch above; the rest register none, so
  // nothing can be current. This used to be
  // `modeSecondaryNavigationRegistry[modeId][0]?.id ?? null`, which existed only
  // to keep a lone action button lit. With real multi-tab modes it would mark
  // the first slot current on every unmatched path — the exact bug this
  // function's doc comment warns callers about.
  return null;
}

export function isModeSecondaryNavigationRoute(params: {
  modeId: AppModeId;
  pathname: string;
  hasSubmittedSearch: boolean;
}): boolean {
  const { modeId, pathname, hasSubmittedSearch } = params;
  // Load-bearing for all five adopted modes: it is the only thing that puts the
  // bar on a submitted-search mode home, e.g. `/differentials?q=…&run=1`, whose
  // clause below lists only the workflow routes. Not leftover gating.
  if (hasSubmittedSearch) return true;

  if (modeId === "differentials") {
    return (
      pathname === "/differentials/diagnoses" ||
      pathname === "/differentials/presentations" ||
      pathname.startsWith("/differentials/presentations/") ||
      pathname === "/differentials/compare" ||
      pathname.startsWith("/differentials/compare/")
    );
  }
  if (modeId === "dsm") return pathname === "/dsm/search" || pathname === "/dsm/compare";
  if (modeId === "specifiers") {
    return (
      pathname === "/specifiers/search" ||
      pathname.startsWith("/specifiers/search?") ||
      pathname === "/specifiers/builder" ||
      pathname === "/specifiers/compare" ||
      pathname === "/specifiers/map"
    );
  }
  if (modeId === "formulation") {
    return (
      pathname === "/formulation/builder" || pathname === "/formulation/compare" || pathname === "/formulation/map"
    );
  }
  // Same shape as `dsm` above: list the routed destinations that are not the
  // mode home. The clean `/factsheets` home stays out so the shared home remains
  // the single answer to "where can I go"; it reaches the bar through the
  // `hasSubmittedSearch` early return. Topics browse and Search both show the bar.
  if (modeId === "factsheets") return pathname === "/factsheets/search" || pathname === "/factsheets/topics";
  if (modeId === "therapy-compass") return pathname !== "/therapy-compass";
  if (modeId === "dictionary") {
    return ["/dictionary/search", "/dictionary/topics", "/dictionary/compare", "/dictionary/sources"].includes(
      pathname,
    );
  }
  if (modeId === "sources") {
    return ["/sources/search", "/sources/topics", "/sources/publishers", SOURCE_METHOD_ROUTE].includes(pathname);
  }
  if (modeId === "my-day") return pathname === "/my-day/week" || pathname === "/my-day/hours";
  if (modeId === "roster") {
    return ["/roster/shifts", "/roster/team", "/roster/swaps", "/roster/requests", "/roster/settings"].includes(
      pathname,
    );
  }
  return false;
}

function navigationHrefWithParams(href: string, entries: Iterable<readonly [string, string]>): string {
  const url = new URL(href, "http://secondary-navigation.local");
  const replacedKeys = new Set<string>();
  for (const [key, value] of entries) {
    if (!value) continue;
    if (!replacedKeys.has(key)) {
      url.searchParams.delete(key);
      replacedKeys.add(key);
    }
    url.searchParams.append(key, value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim())),
  );
}

/** Carry route-backed query and selection state between compatible workflows. */
export function modeSecondaryNavigationHref(params: {
  modeId: AppModeId;
  itemId: string;
  href: string;
  currentSearchParams: URLSearchParams;
}): string {
  const { modeId, itemId, href, currentSearchParams } = params;
  const query = currentSearchParams.get("q") ?? currentSearchParams.get("query") ?? "";

  if (modeId === "therapy-compass") {
    return navigationHrefWithParams(href, therapyWorkspaceNavigationEntries(currentSearchParams));
  }

  if (modeId === "differentials") {
    const entries: Array<readonly [string, string]> = query ? [["q", query]] : [];
    // Returning to Search with a carried query must reopen the results view
    // (`run=1`), not the empty mode home — even when the previous tab lacked run.
    if (itemId === "search" && query) entries.push(["run", "1"]);
    else if (itemId === "search" && currentSearchParams.get("run") === "1") entries.push(["run", "1"]);
    // Compare (and other in-mode tabs) reuse URL-backed selection so ticks on
    // search survive ModeNav handoff without a second client store.
    if (currentSearchParams.get("ids")) {
      entries.push(["ids", currentSearchParams.get("ids") ?? ""]);
    }
    return navigationHrefWithParams(href, entries);
  }

  if (modeId === "dsm") {
    if (itemId === "search") {
      const category = currentSearchParams.get("category");
      const support = currentSearchParams.get("support");
      const ids = currentSearchParams.get("ids");
      return navigationHrefWithParams(dsmSearchHref, [
        ...(query ? ([["q", query]] as const) : []),
        ...(category ? ([["category", category]] as const) : []),
        ...(support ? ([["support", support]] as const) : []),
        // Returning to Search with a carried query must reopen the results view
        // (`run=1`), not the empty search surface — even when the previous tab
        // lacked run. When Search is the current tab, `run` travels with the
        // query so clicking the tab you are on does not re-place the composer.
        ...(query ? ([["run", "1"]] as const) : []),
        ...(ids ? ([["ids", ids]] as const) : []),
      ]);
    }
    return navigationHrefWithParams(href, [
      ...(query ? ([["q", query]] as const) : []),
      ...(currentSearchParams.get("ids") ? ([["ids", currentSearchParams.get("ids") ?? ""]] as const) : []),
    ]);
  }

  if (modeId === "specifiers") {
    const selections = uniqueValues([
      ...currentSearchParams.getAll("specifier"),
      currentSearchParams.get("a"),
      currentSearchParams.get("b"),
      currentSearchParams.get("selected"),
    ]);
    if (itemId === "search") {
      const entries: Array<readonly [string, string]> = query ? [["q", query]] : [];
      // Returning to Search with a carried query must reopen the results view
      // (`run=1`), not the empty catalogue — even when the prior tab lacked run.
      if (query) entries.push(["run", "1"]);
      else if (currentSearchParams.get("run") === "1") entries.push(["run", "1"]);
      const scope = currentSearchParams.get("scope");
      if (scope) entries.push(["scope", scope]);
      const family = currentSearchParams.get("family");
      if (family) entries.push(["family", family]);
      const diagnosis = currentSearchParams.get("diagnosis");
      if (diagnosis) entries.push(["diagnosis", diagnosis]);
      for (const category of currentSearchParams.getAll("category")) {
        entries.push(["category", category]);
      }
      if (currentSearchParams.get("reviewed") === "1") entries.push(["reviewed", "1"]);
      for (const value of selections) {
        entries.push(["specifier", value]);
      }
      return navigationHrefWithParams(href, entries);
    }
    if (itemId === "builder")
      return navigationHrefWithParams(
        href,
        selections.map((value) => ["specifier", value] as const),
      );
    if (itemId === "compare") {
      return navigationHrefWithParams(
        href,
        selections.slice(0, 2).map((value, index) => [index === 0 ? "a" : "b", value] as const),
      );
    }
    if (itemId === "map" && selections[0]) {
      return navigationHrefWithParams(href, [
        ["selected", selections[0]],
        ...selections.map((value) => ["specifier", value] as const),
      ]);
    }
    return navigationHrefWithParams(href, [
      ...(query ? ([["q", query]] as const) : []),
      ...selections.map((value) => ["specifier", value] as const),
    ]);
  }

  if (modeId === "formulation") {
    const selections = uniqueValues([
      ...currentSearchParams.getAll("mechanism"),
      currentSearchParams.get("a"),
      currentSearchParams.get("b"),
    ]);
    const template = currentSearchParams.get("template");
    const templateEntry: Array<readonly [string, string]> = template ? [["template", template]] : [];
    if (itemId === "builder")
      return navigationHrefWithParams(href, [
        ...selections.map((value) => ["mechanism", value] as const),
        ...templateEntry,
      ]);
    if (itemId === "compare") {
      return navigationHrefWithParams(href, [
        ...selections.slice(0, 2).map((value, index) => [index === 0 ? "a" : "b", value] as const),
        ...templateEntry,
      ]);
    }
    if (itemId === "map" && selections[0]) {
      return navigationHrefWithParams(href, [
        ...selections.map((value) => ["mechanism", value] as const),
        ...templateEntry,
      ]);
    }
    return navigationHrefWithParams(href, [
      ...(query ? ([["q", query]] as const) : []),
      ...selections.map((value) => ["mechanism", value] as const),
      ...templateEntry,
    ]);
  }

  if (modeId === "factsheets") {
    // Search carries the live query and category filter so switching tabs does
    // not silently discard them. Topics goes to the clean category browse: it
    // reads neither param, so appending them would only produce a misleading URL.
    if (itemId !== "search") return href;
    const category = currentSearchParams.get("category");
    return navigationHrefWithParams(href, [
      ...(query ? ([["q", query]] as const) : []),
      ...(category ? ([["category", category]] as const) : []),
      // `run` travels with the query, as it does for dsm. Search is the current
      // tab on /factsheets/search, and dropping `run` from its own link flips
      // `hasSubmittedModeSearch` (global-search-shell.tsx:421) to false, which
      // re-places the composer — a layout jump from clicking where you already are.
      ...(query && currentSearchParams.get("run") === "1" ? ([["run", "1"]] as const) : []),
    ]);
  }

  if (modeId === "dictionary") {
    if (itemId === "search") {
      // Terms is the current tab on `/dictionary/search`, so its own link must
      // not reset what you are looking at: `view` (the Terms/Abbrev scope),
      // `letter` and `run` travel with the query and the facets. `run` in
      // particular flips `hasSubmittedModeSearch` in `global-search-shell.tsx`,
      // which re-places the composer — a layout jump from clicking the tab you
      // are already on.
      return navigationHrefWithParams(href, [
        ...(query ? ([["q", query]] as const) : []),
        ...(query && currentSearchParams.get("run") === "1" ? ([["run", "1"]] as const) : []),
        ...(currentSearchParams.get("view") ? ([["view", currentSearchParams.get("view") ?? ""]] as const) : []),
        ...(currentSearchParams.get("letter") ? ([["letter", currentSearchParams.get("letter") ?? ""]] as const) : []),
        ...currentSearchParams.getAll("topic").map((value) => ["topic", value] as const),
        ...currentSearchParams.getAll("kind").map((value) => ["kind", value] as const),
      ]);
    }
    if (itemId === "compare") {
      return navigationHrefWithParams(href, [
        ...(currentSearchParams.get("a") ? ([["a", currentSearchParams.get("a") ?? ""]] as const) : []),
        ...(currentSearchParams.get("b") ? ([["b", currentSearchParams.get("b") ?? ""]] as const) : []),
      ]);
    }
  }

  if (modeId === "sources") {
    if (itemId === "method") return href;
    const entries: Array<readonly [string, string]> = [];
    if (query) entries.push(["q", query]);
    for (const usage of currentSearchParams.getAll("usedBy")) entries.push(["usedBy", usage]);
    return navigationHrefWithParams(href, entries);
  }

  return href;
}
