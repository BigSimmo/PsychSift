import {
  BedDouble,
  Ban,
  ArrowLeftRight,
  BookOpenText,
  Brain,
  BookMarked,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarX2,
  Clock,
  ClipboardCheck,
  ClipboardList,
  Feather,
  GitCompareArrows,
  House,
  Landmark,
  LayoutGrid,
  LibraryBig,
  ListChecks,
  LifeBuoy,
  MessageCircle,
  Network,
  NotebookPen,
  Phone,
  NotebookText,
  Presentation,
  Printer,
  Search,
  Settings,
  Sparkles,
  SlidersHorizontal,
  Stethoscope,
  Sunrise,
  Scale,
  Target,
  Users,
  UsersRound,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import {
  ON_CALL_HUB_PAGE_ICONS,
  ON_CALL_SECTION_ICONS,
  ON_CALL_VIEW_ICONS,
} from "@/components/on-call/on-call-section-identity";
import { type RoutedModeSecondaryNavigationId } from "@/lib/mode-secondary-navigation";

/**
 * Exhaustive by type, deliberately. A `?? FileText` fallback compiles for a
 * registry id nobody has chosen an icon for, and the entry then ships wearing a
 * document icon that means nothing — a silent default on the one surface where
 * the icon is half the slot's width. Adding a routed entry to the registry
 * without an icon fails the typecheck instead.
 */
export const iconByItemId: Record<RoutedModeSecondaryNavigationId, LucideIcon> = {
  search: Search,
  review: ClipboardCheck,
  diagnoses: Stethoscope,
  presentations: ClipboardList,
  compare: GitCompareArrows,
  builder: ListChecks,
  map: Network,
  recommend: Sparkles,
  pathways: Waypoints,
  // The Factsheets hero glyph (`appModeIcons.factsheets`), so the tab wears the
  // same mark as the surface it points at. Not LayoutGrid: the search page uses
  // that for its card/list view toggle, and one glyph must not mean two things
  // on the same screen.
  topics: BookOpenText,
  sources: BookMarked,
  catalogue: LibraryBig,
  publishers: Landmark,
  method: Scale,
  // On Call. READ from the identity maps, never restated: a section must wear
  // one mark in the rail, on its own page header and in the home's tile grid,
  // and the way to guarantee that is to have one map and not two.
  //
  // This block used to be a hand copy carrying a comment that said it matched
  // `ON_CALL_SECTION_ICONS` — and it had already stopped matching. `logistics`
  // sat here as `MapPinned` while the identity map had moved to
  // `BriefcaseBusiness` with the section's own move from site logistics to
  // Admin, so the Admin rail slot wore a map pin and the Admin page wore a
  // briefcase. A comment asserting two lists agree cannot make them agree; a
  // reference can, and the mismatch is now unrepresentable.
  //
  // `extended` hides these below its top band; they still have to be right,
  // because the sheet and the wide bar both show them.
  //
  // The six shift pages read `ON_CALL_HUB_PAGE_ICONS`, the map their own pages
  // use. Call and Refer are the successors of Contacts and Referrals, so they
  // wear the same Phone and Repeat.
  now: ON_CALL_HUB_PAGE_ICONS.now,
  whoson: ON_CALL_HUB_PAGE_ICONS["whos-on"],
  call: ON_CALL_HUB_PAGE_ICONS.call,
  playbook: ON_CALL_SECTION_ICONS.playbook,
  refer: ON_CALL_HUB_PAGE_ICONS.refer,
  find: ON_CALL_HUB_PAGE_ICONS.find,
  orientation: ON_CALL_SECTION_ICONS.orientation,
  // The registry id and the stored section id genuinely differ here, and this
  // is the only place the two vocabularies meet: the rail slot is `teaching`
  // (what the reader is shown) and the section is `education` (route segment,
  // database check constraint). Same pair as `whoswho` / `who-is-who` below.
  teaching: ON_CALL_SECTION_ICONS.education,
  logistics: ON_CALL_SECTION_ICONS.logistics,
  // Compliance and Who's who are VIEWS over a stored section, not sections, so
  // neither has an entry in `ON_CALL_SECTION_ICONS` — their glyphs live in
  // `ON_CALL_VIEW_ICONS`, which is where these read them from. A rail slot and
  // the page it opens must wear the same mark. Compliance is not a shield with
  // a tick, and not by accident: `ON_CALL_VIEW_ICONS` carries the reasoning,
  // which is that the page may never render a verdict on anything it lists.
  compliance: ON_CALL_VIEW_ICONS.compliance,
  whoswho: ON_CALL_VIEW_ICONS["who-is-who"],
  service: Building2,
  card: Printer,
  // CME. Matched to the glyphs the mode already uses for the same ideas
  // (`cmeSections` in `cme/cme-nav-header.tsx`, and the dashboard's own module
  // icons), so a destination wears one mark in the mode sheet and inside the
  // page it opens.
  year: CalendarDays,
  log: NotebookPen,
  plan: Target,
  learning: Presentation,
  setup: ListChecks,
  // Admin's page destinations in the mode picker.
  "admin-today": Sunrise,
  renewals: ON_CALL_VIEW_ICONS.compliance,
  "new-job": BriefcaseBusiness,
  help: LifeBuoy,
  // Roster. Today is the mode home a shift opens to; Shifts reuses the mode's
  // own CalendarRange mark (`category-identity.ts`); Team is the people on the
  // roster; Swaps is the swap arrows; Requests is the crossed-out day, since
  // dates you can't work and leave are what it holds; Settings gets the generic
  // gear, matched to nothing else in this rail so it cannot be mistaken for a
  // section.
  today: CalendarClock,
  shifts: CalendarRange,
  team: UsersRound,
  swaps: ArrowLeftRight,
  requests: CalendarX2,
  settings: Settings,
  // My Day. Today wears the mode's own Sunrise (as Admin's Today does), Week the
  // seven-day range, Hours the clock.
  "my-day-today": Sunrise,
  "my-day-week": CalendarRange,
  "my-day-hours": Clock,
  // First Nations. Prefixed ids, so On Call's "contacts" icon is not shared —
  // each mode's rail slots wear their own mark even where the idea overlaps.
  "first-nations-bedside": LayoutGrid,
  "first-nations-contacts": Phone,
  "first-nations-talking": MessageCircle,
  "first-nations-family": Users,
  "first-nations-mental-health": Brain,
  "first-nations-on-the-ward": BedDouble,
  "first-nations-mistakes": Ban,
  "first-nations-going-home": House,
  "first-nations-end-of-life": Feather,
  // Teaching shares the Today calendar icon with Roster.
  week: CalendarClock,
  logbook: NotebookText,
  organise: SlidersHorizontal,
  "whats-on": CalendarDays,
  resources: LibraryBig,
  teach: Presentation,
  supervision: Users,
};

/**
 * The glyph for one registry destination, for callers outside the rail.
 *
 * The mode sheet draws this mode's own pages using the same rows it draws modes
 * with, so it needs the same marks — a section must not wear one glyph in the
 * rail and another in the sheet. Returns a widened lookup rather than the
 * exhaustive record, because a caller holding a plain string id cannot prove it
 * is a registered one; an unregistered id gets no icon rather than a wrong one.
 */
export function modeSectionIcon(itemId: string): LucideIcon | null {
  return iconByItemId[itemId as RoutedModeSecondaryNavigationId] ?? null;
}
