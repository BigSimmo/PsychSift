"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Heart,
  LayoutGrid,
  MonitorCog,
  MessageSquarePlus,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Pin,
  Pill,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  SunMedium,
  SunMoon,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { appModeIcons } from "@/lib/app-mode-icons";
import { BrandMark } from "@/components/clinical-dashboard/brand";
import { BRAND_CATCHPHRASE_BARE, BRAND_MENU_DESCRIPTION, BRAND_NAME } from "@/lib/brand";
import {
  cn,
  fieldControlWithIcon,
  fieldIcon,
  sidebarItem,
  statusDotReady,
  textMuted,
  toolbarButton,
} from "@/components/ui-primitives";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import { phoneModeGroups, phoneModeGroupsForSide } from "@/lib/phone-mode-groups";
import { isDashboardModeHref } from "@/lib/search-route-ownership";
import {
  defaultSidebarPinnedModeIds,
  useSidebarPins,
  pinnableSidebarModeIds,
} from "@/components/clinical-dashboard/use-sidebar-pins";
import { POISONS_INFORMATION_CONTACT, WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";
import { useTheme } from "@/components/clinical-dashboard/use-theme";
import type { ThemePreference } from "@/lib/theme";
import {
  CLINICAL_MENU_PANEL_ID,
  ClinicalMenuBell,
  ClinicalMenuRecentPages,
  ClinicalMenuTabs,
  ClinicalMenuWorkAreas,
  clinicalMenuTabId,
} from "@/components/clinical-dashboard/clinical-menu-drawer";
import { LazyWorkSideCounts } from "@/components/work-frame/lazy-work-side-counts";
import { useWorkSideCounts } from "@/components/work-frame/work-frame-store";
import { useNewWorkMode } from "@/components/work-mode-launch/work-mode-launch-provider";
import { needsYouBellVisibleForAuth } from "@/lib/needs-you/homes";
import type { ModeMenuSideId } from "@/lib/phone-mode-groups";
import { useAuthSession } from "@/lib/supabase/client";
import type { WorkAreaId } from "@/lib/work-frame/areas";

export type SidebarIdentity = {
  displayName: string;
  initials: string;
  detail: string;
  signedIn: boolean;
};

export function deriveSidebarIdentity(email: string | null | undefined): SidebarIdentity {
  const normalized = email?.trim();
  if (!normalized) {
    return { displayName: "Guest", initials: "G", detail: "Not signed in", signedIn: false };
  }
  const handle = normalized.split("@")[0] || normalized;
  const parts = handle.split(/[._\-+]+/).filter(Boolean);
  const initials = (parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : handle.slice(0, 2)).toUpperCase() || "U";
  const displayName =
    parts.length > 0 ? parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : normalized;
  return { displayName, initials, detail: normalized, signedIn: true };
}

function accountProfileLabel(identity: SidebarIdentity) {
  const action = identity.signedIn ? "Open account profile" : "Set up workspace";
  return `${identity.initials} ${identity.displayName} ${identity.detail}. ${action}`;
}

const sidebarToolItems = [
  { id: "answer", label: "Answer", icon: Sparkles, href: "/?mode=answer" },
  // Owner decision 2026-08-27, extended: the sidebar has pointed straight at the
  // shared "Clinical Documents" home since before `/documents` itself redirected.
  // `/documents` now also redirects (it joined the consolidated modes), so this
  // entry is no longer saving a hop over its own route — it is consistent with
  // every other pinned entry below. `/documents` keeps its route and its inbound
  // link from the Tools directory (`tools-catalog.ts`).
  { id: "documents", label: "Documents", icon: FileText, href: "/?mode=documents" },
  // Every consolidated mode links to the one shared home; their bare paths are now
  // redirects onto it, so pointing a pinned entry at `/services` or `/factsheets`
  // would spend a round trip arriving at the same place.
  { id: "services", label: "Services", icon: appModeIcons.services, href: "/?mode=services" },
  // Medication also redirects now (via its own bespoke proxy fast-path, not the
  // shared consolidatedModeHomePaths map — see `src/proxy.ts`), so this entry
  // points straight at the shared home too, matching Documents/Services above.
  { id: "prescribing", label: appModeDefinition("prescribing").label, icon: Pill, href: "/?mode=prescribing" },
  { id: "factsheets", label: "Factsheets", icon: appModeIcons.factsheets, href: "/?mode=factsheets" },
  // Tools left the menu (usefulness and layout audit, 11 Oct 2026, item 8): its
  // calculators and dictionary now sit under Psychiatry. `/tools` still opens
  // for old links and bookmarks.
] as const;

const sidebarAccountLibraryItems = [
  { id: "favourites" as const, label: "Favourites", icon: Heart, href: "/favourites" },
] as const;

const visibleSidebarToolItems = sidebarToolItems;

/** Specialist modes that are available from More modes but are not first-run pins. */
// Clinical in the menu's grouped order (Psychiatry and its sections, then
// Medicines, then Sources), then Work.
const sidebarMoreModeIds = [
  "psychiatry",
  "dsm",
  "differentials",
  "specifiers",
  "formulation",
  "therapy-compass",
  "forms",
  "calculators",
  "dictionary",
  "first-nations",
  "medicines",
  "sources",
  "my-day",
  "on-call",
  "open-shifts",
  "roster",
  "teaching",
  "cme",
  "my-work",
] as const satisfies readonly AppModeId[];

/* Typed by `AppModeId` rather than the literal ids listed above, so a caller may
 * still ask about a mode the menu no longer lists (Tools, kept for old links)
 * without the comparison becoming a type error. */
type SidebarModeItem = { id: AppModeId; label: string; description: string; icon: SidebarIcon; href: string };
type SidebarIcon = (typeof sidebarToolItems)[number]["icon"];

const sidebarModeItems: readonly SidebarModeItem[] = [
  ...visibleSidebarToolItems.map((item) => ({
    ...item,
    description: appModeDefinition(item.id).description,
  })),
  ...sidebarMoreModeIds.map((id) => ({
    id,
    label: appModeDefinition(id).label,
    description: appModeDefinition(id).description,
    icon: appModeIcons[id],
    href: appModeHomeHref(id),
  })),
];

export function sidebarModeItem(modeId: AppModeId): SidebarModeItem | undefined {
  return sidebarModeItems.find((item) => item.id === modeId);
}

/**
 * Sidebar shortcuts render as real links so middle-click, modified clicks and
 * "open in new tab" keep working, but a plain left click on a shared-home entry
 * (`/?mode=<id>`) is handed to `onSelectMode` instead of the router. That is the
 * same in-place switch the mode pill uses: on the shared home it rewrites the
 * URL with no server round trip, and elsewhere it sets the mode itself before
 * navigating. Routing the sidebar through a plain Next navigation meant every
 * click waited on an RSC fetch of `/` before anything changed, and the mode only
 * followed once the URL sync noticed — which a stale UI-change flag could skip
 * entirely, leaving the address bar on one mode and the page on another.
 * Standalone destinations (`/tools`, `/favourites`) keep ordinary link behaviour.
 */
export function selectModeFromLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  item: { id: AppModeId; href: string },
  onSelectMode: ((mode: AppModeId) => void) | undefined,
) {
  if (!onSelectMode || !isDashboardModeHref(item.href)) return false;
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (event.currentTarget.target && event.currentTarget.target !== "_self") return false;
  event.preventDefault();
  onSelectMode(item.id);
  return true;
}

// Display-free base so callers can compose `grid` / `hidden lg:grid` without
// conflicting display utilities (cn does not de-duplicate classes).
const collapsedSidebarControl =
  "h-tap w-tap shrink-0 place-items-center rounded-xl border border-transparent text-[color:var(--text-muted)] transition hover:border-[color:var(--border)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";
const collapsedSidebarButton = `grid ${collapsedSidebarControl}`;
/* The same state on a full-width row, and deliberately the same language: the
 * rail and the expanded list mark the current mode, so they may not mark it two
 * different ways.
 *
 * What this replaces is a 2px `border-l` in the accent. On a `rounded-lg` row a
 * left border follows the corner radius, so it rendered as a blue arc
 * bracketing the row rather than a bar beside it. It was also carrying the
 * state alone: the fill it came with, `--surface-chrome`, is #f7f9fc in light —
 * the exact value of the hover fill `--surface-subtle` — so an active row and a
 * hovered row were otherwise pixel-identical.
 *
 * So the row becomes a tinted pill: accent-soft ground, hairline accent border,
 * heading-weight label, accent icon (kept at the call sites). The label goes to
 * `--text-heading` rather than the accent, because accent text across a 320px
 * row reads as a link and the icon already carries the colour.
 *
 * The border is a real border, not a ring or a pseudo-element, because that is
 * what survives forced-colors: a background tint is dropped there, while the
 * inactive rows' `border border-transparent` reservation stays invisible, so
 * the active row is the only one the system paints an edge on. `aria-current`
 * carries the same fact to assistive technology. */
const sidebarItemActive =
  "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] font-semibold text-[color:var(--text-heading)] hover:bg-[color:var(--clinical-accent-soft)]";
/* One divider for the whole rail. Every group separator is the same 32px rule
   with the same 12px of air on both sides, so the rail reads as one column of
   48px controls broken into groups rather than four rules with three spacings. */
const collapsedSidebarDivider = "my-1.5 h-px w-8 shrink-0 bg-[color:var(--border)]";

/* The rail's items wear the work rail's look: an icon in a soft pill with its
   name underneath, so a reader never has to guess what an icon is and the two
   sides read as one app (desktop and tablet shell, 11 Oct 2026 audit). The
   classes live with the work rail in work-mode.css. */
const railItem = "work-rail__item clinical-rail__item";

/* Shorter names where a mode's own label would not fit under its icon. */
const railShortLabels: Partial<Record<AppModeId, string>> = {
  dsm: "DSM-5",
  medicines: "Medicines",
  "therapy-compass": "Therapy",
};

function railLabel(id: AppModeId | "favourites", label: string) {
  return (id !== "favourites" && railShortLabels[id]) || label;
}

function RailItemBody({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <>
      <span className="work-rail__pill" aria-hidden="true">
        <Icon aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
      </span>
      <span className="work-rail__label" aria-hidden="true">
        {label}
      </span>
    </>
  );
}

/* Brand lockup header — the phone drawer (ClinicalMobileSidebar) and the
 * expanded desktop sidebar share it, so the two entry points to the same
 * navigation read as one product rather than two headers that happen to carry
 * the same words.
 *
 * The stock Sheet header is built for a dialog that has to explain itself: a
 * 5-unit pad, an 18px title, and a `text-sm leading-6` description paragraph.
 * On this drawer that combination spent roughly 160px — a third of the first
 * screenful above the notch on a 390px phone — restating what the drawer is,
 * to a user who has just tapped the menu button and can see it. The description
 * also wrapped to two lines, because the title column is squeezed between the
 * brand mark and a 48px close button, which is why the block was so tall.
 *
 * So the header reads as a brand lockup rather than a dialog preamble: mark,
 * wordmark, one strapline that cannot wrap, and a close control that keeps its
 * full 48px tap target while giving up the boxed chrome that made it the
 * loudest thing in the header.
 *
 * What makes it a *band* rather than a row is the ground: one accent wash
 * anchored at the top edge, dissolving before it reaches the close control and
 * before the divider, over a vertical surface fade that only resolves in dark
 * (where `--surface-lux` and `--surface-raised` differ). It is the same idiom
 * the document-summary and mode-switch headers already use, so the drawer gains
 * a lit top edge without inventing a colour. The wash strength is the
 * `--brand-band-wash` role token rather than a mix written here, because light
 * and dark need opposite recipes to land on the same read — see its definition
 * in `globals.css`. The divider stays a real `border-b`: a pseudo-element rule
 * would disappear in forced-colors, which is exactly where a divider matters.
 *
 * On the phone drawer that top edge is the top of the screen, and the band has
 * to own it. Under `viewport-fit=cover` the panel's own `pt-safe` used to paint
 * the notch strip in plain `--surface-raised`, directly above a wash anchored at
 * `0% 0%` — its strongest point sat exactly on that join, so a tinted band met a
 * white strip along a dead-straight line across the top of the drawer, reported
 * from an iPhone as a stark cut-off. Dark had the same seam one layer down,
 * where the surface fade opened at `--surface-lux` against a `--surface-raised`
 * strip. `drawerHeader` therefore pulls itself up over that padding and re-adds
 * the inset as its own, so the ground runs to the physical top of the display:
 * the only boundary left is the edge of the screen, which cannot read as a line.
 *
 * The other end is deliberately the opposite, and the two ends together are the
 * whole contract: **no stop inside the box may reach `transparent`.** The wash
 * opens at full strength on the top edge and its last stop is still 24% of the
 * token at the ellipse's far edge, so every row of pixels in the band carries
 * colour and the `border-b` is what ends it. Two earlier revisions failed here
 * in the same way from opposite directions — one completed the falloff early so
 * the band would dissolve into the menu, the next landed zero exactly on the
 * bottom edge — and both read on a phone as a header that had run out of colour
 * rather than one that stops. A gradient may stop against a rule. It may not
 * stop against nothing.
 *
 * The reach (`130% 160%` from `0% 0%`) is the pre-2026-09-06 coverage restored:
 * a wash that spreads over the whole band rather than pooling behind the mark.
 * A tighter ellipse is not a safe edit here, because the band is now roughly
 * twice its original height — it carries the notch inset too, and the lockup
 * sits at about 70% of that height, so anything shorter strands the mark on
 * bare surface.
 *
 * The top edge is at full strength on purpose, and that is a reversal: an
 * earlier revision diluted the first stop to keep the wash off the system
 * status bar. The owner asked twice for more colour up there, which is the
 * decision that governs — do not reintroduce the dilution as a tidy-up.
 *
 * For the same reason the band carries no `--shadow-inset` bevel: that is an
 * inset 1px top highlight, i.e. a straight line drawn along an edge this ground
 * exists to dissolve.
 *
 * The mark is drawn bare on that ground, never on a tile: see the brand note in
 * `@/components/clinical-dashboard/brand` for why the tiled form is reserved for
 * formats with no transparency.
 *
 * These are overrides on the shared Sheet rather than edits to it: every other
 * dialog in the app uses that header, and the case for a compact brand header
 * is specific to a navigation drawer that is already showing its own contents. */
const brandHeaderGround =
  "bg-[radial-gradient(130%_160%_at_0%_0%,var(--brand-band-wash)_0%,color-mix(in_oklab,var(--brand-band-wash)_46%,transparent)_62%,color-mix(in_oklab,var(--brand-band-wash)_24%,transparent)_100%),linear-gradient(180deg,var(--surface-lux)_0%,var(--surface-raised)_100%)]";
/* Wordmark and strapline as one type pair, so the drawer and the sidebar cannot
 * drift into two different settings of the same two lines.
 *
 * The setting is not a new one: it is the lockup the shared home's header drew
 * until 12 Oct 2026 (the rail now carries the mark alone), matched line for
 * line, and the reasoning behind every value was measured rather than chosen —
 * 18px/800 on the display tracking step for the name, 12px/500 in --text-muted
 * for the strapline. In particular the strapline may not drop to --text-soft
 * (3.07:1 on this ground, under the 4.5:1 floor) or to an 11px step
 * (bottom-light for no gain).
 *
 * The strapline is the bare catchphrase: under a wordmark it is an identity
 * label rather than a sentence, and `@/lib/brand` keeps the unpunctuated variant
 * for exactly this position. */
const brandWordmark =
  "truncate text-lg font-extrabold leading-5 tracking-[var(--tracking-display)] text-[color:var(--text-heading)]";
const brandStrapline = "block truncate text-xs font-medium leading-5 text-[color:var(--text-muted)]";
/* The expanded desktop sidebar's lockup: the mark and the name on the panel's
 * own ground, no band or strapline (owner request, 15 Oct 2026: slimmer, more
 * subtle). The phone drawer keeps the full band above. */
const desktopWordmark =
  "truncate text-base font-bold leading-5 tracking-[var(--tracking-display)] text-[color:var(--text-heading)]";
/* One eyebrow for every list heading in the sidebar and drawer. */
const sectionEyebrow = "text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]";
const drawerHeaderFrame =
  "-mt-[var(--safe-area-top)] gap-x-3 border-[color:var(--border-lux)] px-4 pt-[calc(0.75rem+var(--safe-area-top))] sm:px-5 sm:pt-[calc(0.875rem+var(--safe-area-top))]";
const drawerHeader = `${drawerHeaderFrame} pb-3 sm:pb-3.5 ${brandHeaderGround}`;
/* With the Clinical | Work tabs the band ends at the tabs' own underline, so it
 * gives up its bottom padding and the active tab's rule sits on the divider. */
const drawerHeaderWithTabs = `${drawerHeaderFrame} pb-0 ${brandHeaderGround}`;
const drawerHeaderTitle = brandWordmark;
/* Ghost close control, matching the collapsed rail's idiom (transparent border
 * that resolves on hover, so forced-colors still has an edge to paint) instead
 * of the toolbar recipe's resting border, fill and inset shadow. The tap target
 * is unchanged at h-tap/w-tap; only the chrome is quieter, and the hover now
 * resolves into the accent rather than a neutral fill, so the one control in the
 * band answers the accent in the ground behind the mark.
 *
 * The glyph is lifted to --spacing-icon-lg, the 20px "header / primary controls"
 * step, via a child variant: Sheet hardcodes its X at 16px, which reads as a
 * default-sized icon adrift once the surrounding box is removed. Scoped here
 * rather than changed in Sheet, since that icon is shared by every dialog. */
const drawerHeaderClose =
  "grid h-tap w-tap shrink-0 place-items-center rounded-full border border-transparent text-[color:var(--text-muted)] transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--clinical-accent-soft)] hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] [&>svg]:size-icon-lg";

function SidebarModesTrigger({
  variant,
  active,
  open,
  onOpen,
  triggerRef,
}: {
  variant: "edit" | "expanded" | "collapsed";
  active: boolean;
  open: boolean;
  onOpen: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  if (variant === "edit") {
    return (
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="px-2 text-xs text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)]"
        onClick={onOpen}
      >
        Edit
      </Button>
    );
  }

  if (variant === "collapsed") {
    return (
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="More modes"
        data-testid="sidebar-more-modes"
        data-current={active ? "true" : undefined}
        className={railItem}
        onClick={onOpen}
      >
        <RailItemBody icon={LayoutGrid} label="More" />
      </button>
    );
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="sidebar-more-modes"
      className={cn(sidebarItem, "border border-transparent", active && sidebarItemActive)}
    >
      <LayoutGrid
        aria-hidden="true"
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-muted)]",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-left">More modes</span>
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
    </button>
  );
}

export function SidebarModesEditorSheet({
  open,
  onClose,
  activeMode,
  pinnedModeIds,
  onTogglePinnedMode,
  onMovePinnedMode,
  onNavigate,
  onSelectMode,
  onPrefetchApplications,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  activeMode: AppModeId;
  pinnedModeIds: AppModeId[];
  onTogglePinnedMode: (modeId: AppModeId) => void;
  onMovePinnedMode: (modeId: AppModeId, direction: -1 | 1) => void;
  onNavigate?: () => void;
  onSelectMode?: (mode: AppModeId) => void;
  onPrefetchApplications?: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [modeQuery, setModeQuery] = useState("");
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = modeQuery.trim().toLowerCase();

  function closeEditor() {
    setModeQuery("");
    setStatus("");
    onClose();
  }

  const hasMatches = sidebarModeItems.some((mode) =>
    `${mode.label} ${mode.description}`.toLowerCase().includes(normalizedQuery),
  );
  const matchesQuery = (mode: (typeof sidebarModeItems)[number]) =>
    `${mode.label} ${mode.description}`.toLowerCase().includes(normalizedQuery);
  // Shortcuts first, then everything else under the same groups the mode menu
  // draws (Psychiatry, Medicines, Work...), rather than one long mixed list
  // (usefulness and layout audit, 11 Oct 2026, item 8).
  const pinnedModes = pinnedModeIds
    .map(sidebarModeItem)
    .filter((mode): mode is NonNullable<typeof mode> => Boolean(mode))
    .filter(matchesQuery);
  const unpinnedModes = sidebarModeItems.filter((mode) => !pinnedModeIds.includes(mode.id) && matchesQuery(mode));
  const groupedSections = phoneModeGroups
    .filter((group) => group.drawn)
    .map((group) => ({
      id: group.id,
      label: group.showHeading ? group.label : group.side === "work" ? "Work" : "Library",
      modes: unpinnedModes.filter((mode) => (group.modeIds as readonly AppModeId[]).includes(mode.id)),
    }));
  const groupedIds = new Set(groupedSections.flatMap((section) => section.modes.map((mode) => mode.id)));
  const sections = [
    { id: "pinned", label: "Shortcuts", modes: pinnedModes },
    ...groupedSections,
    { id: "other", label: "More", modes: unpinnedModes.filter((mode) => !groupedIds.has(mode.id)) },
  ].filter((section) => section.modes.length > 0);

  return (
    <Sheet
      open={open}
      onClose={closeEditor}
      title="More modes"
      description="Open any clinical mode or pin the ones you use most."
      closeLabel="Close more modes"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      mobilePlacement="bottom"
      mobileSize="viewport"
      mobileHeaderSafeArea="padding"
      testId="sidebar-more-modes-sheet"
      contentClassName="max-h-[calc(100dvh-0.5rem)] sm:max-w-xl"
      bodyClassName="p-3 sm:p-4"
      headerClassName="bg-[color:var(--surface-lux)] px-4 py-3"
    >
      <label className="relative block">
        <Search aria-hidden="true" className={fieldIcon} />
        <input
          ref={inputRef}
          data-sheet-autofocus="true"
          type="search"
          value={modeQuery}
          onChange={(event) => setModeQuery(event.target.value)}
          placeholder="Find a mode…"
          aria-label="Find a mode"
          className={fieldControlWithIcon}
        />
      </label>

      <nav aria-label="More modes" className="mt-4 grid gap-4">
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`sidebar-more-modes-${section.id}`} className="grid gap-1">
            <h3
              id={`sidebar-more-modes-${section.id}`}
              className="px-2 text-xs font-semibold tracking-wide text-[color:var(--text-muted)] uppercase"
            >
              {section.label}
            </h3>
            {section.modes.map((mode) => {
              const Icon = mode.icon;
              const pinnedIndex = pinnedModeIds.indexOf(mode.id);
              const pinned = pinnedIndex >= 0;
              const modeActive = activeMode === mode.id;
              const modeLabelId = `sidebar-mode-${mode.id}-label`;
              const modeDescriptionId = `sidebar-mode-${mode.id}-description`;
              return (
                <div
                  key={mode.id}
                  className="flex min-w-0 items-center gap-1 rounded-lg border border-transparent p-1 transition-colors hover:border-[color:var(--border)] hover:bg-[color:var(--surface-subtle)]"
                >
                  <Link
                    href={mode.href}
                    prefetch={mode.id === "tools" ? true : undefined}
                    onFocus={mode.id === "tools" ? onPrefetchApplications : undefined}
                    onPointerEnter={mode.id === "tools" ? onPrefetchApplications : undefined}
                    onClick={(event) => {
                      selectModeFromLinkClick(event, mode, onSelectMode);
                      closeEditor();
                      onNavigate?.();
                    }}
                    aria-current={modeActive ? "page" : undefined}
                    aria-labelledby={modeLabelId}
                    aria-describedby={modeDescriptionId}
                    className={cn(sidebarItem, "h-auto flex-1 py-2")}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "h-4 w-4 shrink-0",
                        modeActive ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-muted)]",
                      )}
                    />
                    <span className="min-w-0 text-left">
                      <span id={modeLabelId} className="block text-sm font-semibold text-[color:var(--text)]">
                        {mode.label}
                      </span>
                      <span
                        id={modeDescriptionId}
                        className="block truncate text-xs font-normal text-[color:var(--text-muted)]"
                      >
                        {mode.description}
                      </span>
                    </span>
                  </Link>
                  {pinned ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onMovePinnedMode(mode.id, -1);
                          setStatus(`${mode.label} moved up.`);
                        }}
                        disabled={pinnedIndex === 0}
                        className={toolbarButton}
                        aria-label={`Move ${mode.label} up`}
                        title={`Move ${mode.label} up`}
                      >
                        <ArrowUp aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onMovePinnedMode(mode.id, 1);
                          setStatus(`${mode.label} moved down.`);
                        }}
                        disabled={pinnedIndex === pinnedModeIds.length - 1}
                        className={toolbarButton}
                        aria-label={`Move ${mode.label} down`}
                        title={`Move ${mode.label} down`}
                      >
                        <ArrowDown aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      onTogglePinnedMode(mode.id);
                      setStatus(`${mode.label} ${pinned ? "unpinned" : "pinned"}.`);
                    }}
                    className={cn(
                      toolbarButton,
                      pinned &&
                        "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
                    )}
                    aria-label={`${pinned ? "Unpin" : "Pin"} ${mode.label}`}
                    aria-pressed={pinned}
                    title={`${pinned ? "Unpin" : "Pin"} ${mode.label}`}
                  >
                    <Pin aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </section>
        ))}

        {!hasMatches ? (
          <div className="rounded-lg border border-dashed border-[color:var(--border)] p-5 text-center text-sm text-[color:var(--text-muted)]">
            No modes match “{modeQuery}”.
          </div>
        ) : null}
      </nav>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </Sheet>
  );
}

const appearanceOptions = [
  { value: "light", label: "Light", description: "Always use the light theme", icon: SunMedium },
  { value: "dark", label: "Dark", description: "Always use the dark theme", icon: Moon },
  { value: "system", label: "Auto", description: "Follow your device setting", icon: MonitorCog },
] as const satisfies readonly {
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof SunMedium;
}[];

function appearanceLabel(preference: ThemePreference) {
  return appearanceOptions.find((option) => option.value === preference)?.label ?? "Auto";
}

/**
 * The Appearance control. As a sidebar row it opens its menu upward over the
 * rows above it. On a rail (`railClassName`) it is an icon item showing the
 * theme in use, and its menu opens beside the rail, positioned against the
 * viewport so the rail's own scrolling column cannot clip it.
 */
export function SidebarAppearanceMenu({
  rowItem = sidebarItem,
  railClassName,
}: { rowItem?: string; railClassName?: string } = {}) {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const [railMenuPosition, setRailMenuPosition] = useState<{ left: number; bottom: number; maxHeight: number } | null>(
    null,
  );
  const rail = Boolean(railClassName);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const lastItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [open]);

  function openMenu() {
    const rect = rail ? triggerRef.current?.getBoundingClientRect() : undefined;
    if (rect) {
      // The menu grows up from the trigger's foot; cap its height so a short
      // window scrolls the options instead of pushing the heading off the top.
      const bottom = Math.max(8, window.innerHeight - rect.bottom);
      setRailMenuPosition({ left: rect.right + 8, bottom, maxHeight: Math.max(0, window.innerHeight - bottom - 8) });
    }
    setOpen(true);
  }

  function focusMenuEdge(edge: "first" | "last") {
    window.requestAnimationFrame(() => (edge === "first" ? firstItemRef.current : lastItemRef.current)?.focus());
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }

    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp")
      nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex !== null && items[nextIndex]) {
      event.preventDefault();
      items[nextIndex].focus({ preventScroll: true });
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          openMenu();
          focusMenuEdge("first");
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openMenu();
          focusMenuEdge(event.key === "ArrowUp" ? "last" : "first");
        }}
        className={railClassName ?? rowItem}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "sidebar-appearance-menu" : undefined}
        aria-label={rail ? `Appearance, ${appearanceLabel(preference)}` : undefined}
        title={rail ? `Appearance: ${appearanceLabel(preference)}` : undefined}
      >
        {rail ? (
          <RailItemBody icon={SunMoon} label="Appearance" />
        ) : (
          <>
            <SunMoon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 text-left">Appearance</span>
            <span className="text-xs font-medium text-[color:var(--text-muted)]">{appearanceLabel(preference)}</span>
            <ChevronRight
              aria-hidden="true"
              className={cn("h-4 w-4 shrink-0 transition-transform", open && "-rotate-90")}
            />
          </>
        )}
      </button>

      {open ? (
        <div
          id="sidebar-appearance-menu"
          role="menu"
          aria-label="Appearance"
          onKeyDown={handleMenuKeyDown}
          style={rail && railMenuPosition ? railMenuPosition : undefined}
          className={cn(
            "z-30 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-1.5 shadow-[var(--shadow-overlay)]",
            rail ? "fixed w-64 overflow-y-auto" : "absolute bottom-[calc(100%+0.5rem)] left-0 right-0",
          )}
        >
          <div className="px-2 py-1.5">
            <p className="text-sm font-semibold text-[color:var(--text-heading)]">Appearance</p>
            <p className="text-xs text-[color:var(--text-muted)]">Choose a theme for this device.</p>
          </div>
          {appearanceOptions.map((option) => {
            const Icon = option.icon;
            const checked = preference === option.value;
            return (
              <button
                ref={option.value === "light" ? firstItemRef : option.value === "system" ? lastItemRef : undefined}
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                onClick={() => {
                  setPreference(option.value);
                  setOpen(false);
                  window.requestAnimationFrame(() => triggerRef.current?.focus());
                }}
                className={cn(rowItem, "h-auto py-2")}
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-semibold text-[color:var(--text)]">{option.label}</span>
                  <span className="block text-xs font-normal text-[color:var(--text-muted)]">{option.description}</span>
                </span>
                {checked ? <Check aria-hidden="true" className="h-4 w-4 text-[color:var(--clinical-accent)]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ClinicalSidebarContent({
  recentQueries,
  identity,
  activeMode,
  showAccountLibrary = false,
  onNewChat,
  onPickRecent,
  onOpenSettings,
  onOpenAccount,
  onPrefetchSettings,
  onPrefetchAccount,
  onPrefetchApplications,
  showHeader = true,
  onCollapsedChange,
  onNavigate,
  onSelectMode,
  onOpenSearch,
  drawer = false,
  workPane,
}: {
  /**
   * The phone drawer's layout: 44px rows (the owner's side-menu height), every
   * clinical page listed under the mode menu's groups in place of the More
   * modes sheet, and one current-page mark only (no standing tint on the
   * newest recent chat).
   */
  drawer?: boolean;
  /** The drawer's Work tab: replaces New chat and the clinical list, keeping the foot. */
  workPane?: ReactNode;
  recentQueries: string[];
  identity: SidebarIdentity;
  activeMode: AppModeId;
  /** Account-scoped nav (Favourites). Shown for signed-in users and demo mode. */
  showAccountLibrary?: boolean;
  onNewChat: () => void;
  onPickRecent: (query: string) => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onPrefetchSettings?: () => void;
  onPrefetchAccount?: () => void;
  onPrefetchApplications?: () => void;
  showHeader?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onNavigate?: () => void;
  /**
   * In-place mode switch for shared-home shortcuts (`/?mode=<id>`); see
   * `selectModeFromLinkClick`. Without it every shortcut is a plain link.
   */
  onSelectMode?: (mode: AppModeId) => void;
  onOpenSearch: () => void;
}) {
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [modeEditorOpen, setModeEditorOpen] = useState(false);
  const editModesTriggerRef = useRef<HTMLButtonElement>(null);
  const moreModesTriggerRef = useRef<HTMLButtonElement>(null);
  const modeEditorReturnFocusRef = useRef<HTMLElement>(null);
  const { pinnedModeIds, togglePinnedMode, movePinnedMode } = useSidebarPins();
  const visibleRecentQueries = recentQueries.slice(0, showAllRecent ? 5 : 3);
  const pinnedModeItems = pinnedModeIds
    .map(sidebarModeItem)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  // Design audit D14: on the phone drawer the product-default pins only repeated the page groups
  // below, so until the reader edits their shortcuts the drawer offers the urgent tools instead.
  // The desktop sidebar has no groups beneath, so it keeps the default pins.
  const showUrgentShortcuts = Boolean(drawer) && pinsAreProductDefault(pinnedModeIds);
  const moreModesActive =
    (pinnableSidebarModeIds as readonly AppModeId[]).includes(activeMode) && !pinnedModeIds.includes(activeMode);
  const accountLabel = accountProfileLabel(identity);
  // Medium weight at rest, so only the current row (semibold) stands out.
  const rowItem = cn(sidebarItem, "font-medium");
  // One heading rhythm for every list heading in the drawer: a 36px row whose
  // 48px Edit target overhangs it invisibly, so the gaps above each heading match.
  const sectionHeading = drawer
    ? "flex h-9 items-center justify-between gap-2 px-1"
    : "flex h-8 items-center justify-between gap-2 px-2.5";

  function openModeEditor(triggerRef: RefObject<HTMLButtonElement | null>) {
    modeEditorReturnFocusRef.current = triggerRef.current;
    setModeEditorOpen(true);
  }

  return (
    <div className="clinical-sidebar-content flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      {showHeader ? (
        /* Same lockup, ground and divider as the phone drawer header, so the two
           entry points to this navigation read as one product. The negative
           margins bleed it to the edges of the `p-4` aside below — the band is a
           header, not a card floating inside the padding — which couples it to
           that padding; both live in this file, a few hundred lines apart. */
        <div className="-mx-1 -mt-1 flex shrink-0 items-center justify-between gap-2 pl-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark tone="emphasis" optical="chrome" className="h-7 w-7" />
            <p className={desktopWordmark}>{BRAND_NAME}</p>
          </div>
          <Button
            variant="ghost"
            icon={PanelLeftClose}
            className="h-tap w-tap shrink-0 gap-0 rounded-lg px-0 text-[color:var(--text-muted)] [&>span]:hidden"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            onClick={() => onCollapsedChange?.(true)}
          >
            <span className="sr-only">Collapse sidebar</span>
          </Button>
        </div>
      ) : null}

      {workPane ?? (
        <>
          <div className="grid shrink-0 gap-0.5">
            <button
              type="button"
              onClick={() => {
                onNewChat();
                onNavigate?.();
              }}
              className={cn(rowItem, "border border-transparent text-[color:var(--text-heading)]")}
            >
              <MessageSquarePlus aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" />
              <span className="min-w-0 flex-1 truncate text-left">New chat</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onNavigate?.();
                window.requestAnimationFrame(onOpenSearch);
              }}
              aria-label="Search PsychSift"
              aria-keyshortcuts="Control+K Meta+K"
              className={cn(rowItem, "border border-transparent")}
            >
              <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">Search</span>
              <kbd className="hidden rounded border border-[color:var(--border)] px-1.5 py-px text-2xs font-semibold text-[color:var(--text-muted)] pointer-fine:inline-block">
                Ctrl K
              </kbd>
            </button>
          </div>

          {/* Scroll region: recent chats and shortcuts scroll together on short
          viewports while the header, New chat, Search and account footer stay
          pinned. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
            <section className="min-w-0 shrink-0">
              <div className={sectionHeading}>
                <p className={sectionEyebrow}>Recent</p>
              </div>
              <div className="grid gap-0.5">
                {visibleRecentQueries.length ? (
                  visibleRecentQueries.map((recent, index) => (
                    <button
                      key={`${recent}:${index}`}
                      type="button"
                      onClick={() => {
                        onPickRecent(recent);
                        onNavigate?.();
                      }}
                      title={recent}
                      className={cn(rowItem, "border border-transparent", !drawer && index === 0 && sidebarItemActive)}
                    >
                      <MessageSquare
                        aria-hidden="true"
                        className={cn(
                          "h-4 w-4 shrink-0",
                          !drawer && index === 0 && "text-[color:var(--clinical-accent)]",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-left">{recent}</span>
                    </button>
                  ))
                ) : (
                  <p className={cn("px-2.5 py-1 text-sm", textMuted)}>Recent chats will appear here.</p>
                )}
                {recentQueries.length > 3 ? (
                  <Button
                    variant="ghost"
                    className="w-full justify-start px-2.5 text-left text-[color:var(--text-muted)]"
                    onClick={() => setShowAllRecent((current) => !current)}
                  >
                    {showAllRecent ? "Show less" : "View all chats"}
                  </Button>
                ) : null}
              </div>
            </section>

            {drawer ? <ClinicalMenuRecentPages variant="clinical" onNavigate={() => onNavigate?.()} /> : null}

            <section className="min-w-0 shrink-0">
              <div className={sectionHeading}>
                <p className={sectionEyebrow}>Shortcuts</p>
                <SidebarModesTrigger
                  variant="edit"
                  active={false}
                  open={modeEditorOpen}
                  onOpen={() => openModeEditor(editModesTriggerRef)}
                  triggerRef={editModesTriggerRef}
                />
              </div>
              <nav aria-label="Pinned shortcuts" className="grid gap-0.5">
                {showUrgentShortcuts ? <UrgentShortcuts rowItem={rowItem} onNavigate={onNavigate} /> : null}
                {(showUrgentShortcuts ? [] : pinnedModeItems).map((item) => {
                  const Icon = item.icon;
                  const active = activeMode === item.id;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      prefetch={item.id === "tools" ? true : undefined}
                      onFocus={item.id === "tools" ? onPrefetchApplications : undefined}
                      onPointerEnter={item.id === "tools" ? onPrefetchApplications : undefined}
                      onClick={(event) => {
                        selectModeFromLinkClick(event, item, onSelectMode);
                        onNavigate?.();
                      }}
                      aria-current={active ? "page" : undefined}
                      className={cn(rowItem, "border border-transparent", active && sidebarItemActive)}
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          "h-4 w-4 shrink-0",
                          active ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-muted)]",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                    </Link>
                  );
                })}
                {!pinnedModeItems.length && !showUrgentShortcuts ? (
                  <p className="rounded-lg border border-dashed border-[color:var(--border)] px-3 py-2 text-sm text-[color:var(--text-muted)]">
                    Pin your most-used modes.
                  </p>
                ) : null}
                {drawer ? null : (
                  <SidebarModesTrigger
                    variant="expanded"
                    active={moreModesActive}
                    open={modeEditorOpen}
                    onOpen={() => openModeEditor(moreModesTriggerRef)}
                    triggerRef={moreModesTriggerRef}
                  />
                )}
              </nav>
            </section>

            {drawer ? (
              <SidebarGroupedModes
                activeMode={activeMode}
                rowItem={rowItem}
                showAccountLibrary={showAccountLibrary}
                onSelectMode={onSelectMode}
                onNavigate={onNavigate}
              />
            ) : showAccountLibrary ? (
              <section className="min-w-0 shrink-0">
                <div className={sectionHeading}>
                  <p className={sectionEyebrow}>Your library</p>
                </div>
                <nav aria-label="Your library" className="grid gap-0.5">
                  {sidebarAccountLibraryItems.map((item) => {
                    const Icon = item.icon;
                    const active = activeMode === item.id;
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(rowItem, "border border-transparent", active && sidebarItemActive)}
                      >
                        <Icon
                          aria-hidden="true"
                          className={cn(
                            "h-4 w-4 shrink-0",
                            active ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-muted)]",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                      </Link>
                    );
                  })}
                </nav>
              </section>
            ) : null}
          </div>
        </>
      )}

      <div className="mt-auto grid shrink-0 gap-0.5 border-t border-[color:var(--border)] pt-2">
        <SidebarAppearanceMenu rowItem={rowItem} />
        <Button
          variant="ghost"
          icon={SettingsIcon}
          trailingIcon={ChevronRight}
          className={cn(rowItem, "justify-start [&>span]:min-w-0 [&>span]:flex-1 [&>span]:text-left")}
          onClick={() => {
            onNavigate?.();
            window.requestAnimationFrame(onOpenSettings);
          }}
          onPointerEnter={onPrefetchSettings}
          onFocus={onPrefetchSettings}
        >
          Settings
        </Button>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            window.requestAnimationFrame(onOpenAccount);
          }}
          onPointerEnter={onPrefetchAccount}
          onFocus={onPrefetchAccount}
          data-testid="sidebar-account-settings"
          className="flex min-h-tap w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          aria-label={accountLabel}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-[color:var(--clinical-accent-border)]/60 bg-[color:var(--clinical-accent-soft)] text-xs font-bold text-[color:var(--clinical-accent)]">
            {identity.initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[color:var(--text)]">
              {identity.displayName}
            </span>
            <span className={cn("flex items-center gap-1.5 text-xs", textMuted)}>
              {identity.signedIn ? <span className={statusDotReady} aria-hidden="true" /> : null}
              <span className="truncate">{identity.detail}</span>
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />
        </button>
      </div>

      <SidebarModesEditorSheet
        open={modeEditorOpen}
        onClose={() => setModeEditorOpen(false)}
        activeMode={activeMode}
        pinnedModeIds={pinnedModeIds}
        onTogglePinnedMode={togglePinnedMode}
        onMovePinnedMode={movePinnedMode}
        onNavigate={onNavigate}
        onSelectMode={onSelectMode}
        onPrefetchApplications={onPrefetchApplications}
        returnFocusRef={modeEditorReturnFocusRef}
      />
    </div>
  );
}
function pinsAreProductDefault(pinnedModeIds: readonly AppModeId[]): boolean {
  return (
    pinnedModeIds.length === defaultSidebarPinnedModeIds.length &&
    pinnedModeIds.every((id, index) => id === defaultSidebarPinnedModeIds[index])
  );
}

// Loaded on first open: the drawer is on every page and most readers never open this.
const LazyCrisisLinesCard = dynamic(() => import("@/components/crisis-lines-card").then((mod) => mod.CrisisLinesCard));
const SIDEBAR_CRISIS_CONTACTS = [
  ...WA_CRISIS_CONTACTS.filter((contact) =>
    ["SYN-CRISIS-CONTACT-001", "SYN-CRISIS-CONTACT-002", "SYN-CRISIS-CONTACT-005"].includes(contact.id),
  ),
  POISONS_INFORMATION_CONTACT,
];

const urgentShortcutLinks = [
  { id: "mha-time-limits", label: "MHA time limits", href: "/psychiatry/mha-clock", icon: Timer },
  { id: "safety-plan", label: "Safety plan", href: "/safety-plan", icon: ShieldCheck },
  { id: "forms", label: "Forms", href: "/forms", icon: FileText },
] as const;

/**
 * The phone drawer's default shortcuts (design audit D14): the tools a clinician needs fast,
 * none of which the page groups below already list as a row. Crisis numbers open in place with
 * the same call rows as the answer page and Admin Help, so a number is two taps from any page.
 */
function UrgentShortcuts({ rowItem, onNavigate }: { rowItem: string; onNavigate?: () => void }) {
  const [crisisOpen, setCrisisOpen] = useState(false);
  return (
    <>
      <details
        className="group/urgent min-w-0"
        data-testid="sidebar-urgent-crisis"
        onToggle={(event) => setCrisisOpen(event.currentTarget.open)}
      >
        <summary className={cn(rowItem, "min-h-12 cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
          <Phone aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />
          <span className="min-w-0 flex-1 truncate text-left">Crisis numbers</span>
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-[color:var(--text-muted)] transition-transform group-open/urgent:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="pb-2 pt-1">
          {crisisOpen ? (
            <LazyCrisisLinesCard
              contacts={SIDEBAR_CRISIS_CONTACTS}
              testId="sidebar-crisis-lines"
              rowTestIdPrefix="sidebar-crisis"
              label="Crisis numbers"
            />
          ) : null}
        </div>
      </details>
      {urgentShortcutLinks.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.id}
            href={item.href}
            onClick={() => onNavigate?.()}
            data-testid={`sidebar-urgent-${item.id}`}
            className={cn(rowItem, "min-h-12 border border-transparent")}
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />
            <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
          </Link>
        );
      })}
    </>
  );
}

/**
 * The drawer's page list: every clinical page as a one-tap row under the mode
 * menu's own groups (Search, Psychiatry, Medicines, Library), in place of the
 * More modes sheet.
 *
 * The rules that keep it from reading as a second copy of Shortcuts:
 * - Groups list every page, so a reader always finds a page where it lives,
 *   whatever they have pinned. Shortcuts stay the reader's own pins above.
 * - The current page is marked once: in Shortcuts when it is pinned there,
 *   otherwise in its group.
 * - A group's own dashboard (Psychiatry, Medicines) is its first row, named
 *   "Overview", so the heading is never repeated as a row beneath it.
 */
function SidebarGroupedModes({
  activeMode,
  rowItem,
  showAccountLibrary,
  onSelectMode,
  onNavigate,
}: {
  activeMode: AppModeId;
  rowItem: string;
  showAccountLibrary: boolean;
  onSelectMode?: (mode: AppModeId) => void;
  onNavigate?: () => void;
}) {
  const { pinnedModeIds } = useSidebarPins();
  // Only the drawer shows these groups, and there default pins give way to the urgent tools, so
  // the current page is then marked here.
  const currentInGroups = pinsAreProductDefault(pinnedModeIds) || !pinnedModeIds.includes(activeMode);
  const groups = phoneModeGroupsForSide("clinical").map((group) => ({
    id: group.id,
    label: group.showHeading ? group.label : "Library",
    items: (group.modeIds as readonly AppModeId[])
      .filter((id) => showAccountLibrary || id !== "favourites")
      .map((id) => {
        if (id === "favourites") return { id, label: "Favourites", icon: Heart, href: "/favourites" };
        const item = sidebarModeItem(id) ?? {
          id,
          label: appModeDefinition(id).label,
          icon: appModeIcons[id],
          href: appModeHomeHref(id),
        };
        return groupOverviewModeIds.has(id) ? { ...item, label: "Overview" } : item;
      }),
  }));
  return (
    <>
      {groups.map((group) =>
        group.items.length ? (
          <section
            key={group.id}
            className="min-w-0 shrink-0"
            aria-labelledby={`sidebar-group-${group.id}`}
            data-testid={`sidebar-group-${group.id}`}
          >
            <p
              id={`sidebar-group-${group.id}`}
              className="flex h-9 items-center px-1 text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]"
            >
              {group.label}
            </p>
            <nav aria-labelledby={`sidebar-group-${group.id}`} className="grid gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = currentInGroups && activeMode === item.id;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={(event) => {
                      selectModeFromLinkClick(event, item, onSelectMode);
                      onNavigate?.();
                    }}
                    aria-current={active ? "page" : undefined}
                    aria-label={item.label === "Overview" ? `${group.label} overview` : undefined}
                    className={cn(rowItem, "border border-transparent", active && sidebarItemActive)}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "h-4 w-4 shrink-0",
                        active ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-muted)]",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </section>
        ) : null,
      )}
    </>
  );
}

/** Modes that are their group's own dashboard, listed first in the group as "Overview". */
const groupOverviewModeIds = new Set<AppModeId>(["psychiatry", "medicines"]);

function ClinicalCollapsedRail({
  hiddenOnDesktop,
  collapseLocked,
  identity,
  activeMode,
  onCollapsedChange,
  onNewChat,
  onOpenSettings,
  onOpenAccount,
  onPrefetchSettings,
  onPrefetchAccount,
  onPrefetchApplications,
  onSelectMode,
  onOpenSearch,
}: {
  /** Tablet-only rail: hide from lg up when the expanded sidebar takes over. */
  hiddenOnDesktop: boolean;
  collapseLocked: boolean;
  identity: SidebarIdentity;
  activeMode: AppModeId;
  showAccountLibrary?: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onPrefetchSettings?: () => void;
  onPrefetchAccount?: () => void;
  onPrefetchApplications: () => void;
  onSelectMode?: (mode: AppModeId) => void;
  onOpenSearch: () => void;
}) {
  const accountLabel = accountProfileLabel(identity);
  const [modeEditorOpen, setModeEditorOpen] = useState(false);
  const moreModesTriggerRef = useRef<HTMLButtonElement>(null);
  const modeEditorReturnFocusRef = useRef<HTMLElement>(null);
  const { pinnedModeIds, togglePinnedMode, movePinnedMode } = useSidebarPins();
  const pinnedModeItems = pinnedModeIds
    .map(sidebarModeItem)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  // The rail is the one element that survives every route change, so it must answer
  // "where am I" with the mode itself, not with the generic More modes opener. When the
  // active mode is not already a pinned shortcut, it gets its own slot — including
  // Calculators and Favourites, which cannot be pinned. Favourites has no standing
  // rail item (owner request, 15 Oct 2026: core items only); the open sidebar keeps
  // it under Your library. Exactly one rail item is ever marked current.
  const currentModeItem = pinnedModeIds.includes(activeMode)
    ? undefined
    : activeMode === "favourites"
      ? sidebarAccountLibraryItems[0]
      : sidebarModeItem(activeMode);

  function openModeEditor() {
    modeEditorReturnFocusRef.current = moreModesTriggerRef.current;
    setModeEditorOpen(true);
  }

  return (
    <aside
      aria-label="PsychSift collapsed sidebar"
      className={cn(
        // 64px of icons on a hairline, no drop shadow: the original rail's
        // look (owner request, 15 Oct 2026: slimmer and quieter). One 4px gap
        // owns every step in the column, with the two rules marking the groups.
        "hidden min-h-0 w-16 shrink-0 flex-col items-center gap-1 border-r border-[color:var(--border)] bg-[color:var(--surface-lux)] py-3 md:flex",
        hiddenOnDesktop && "lg:hidden",
      )}
    >
      <div className="grid w-full shrink-0 justify-items-center gap-2 px-2 pb-1">
        {collapseLocked ? (
          <span className={collapsedSidebarButton} aria-hidden="true">
            <BrandMark tone="emphasis" optical="chrome" className="h-7 w-7" />
          </span>
        ) : (
          <>
            {/* Tablet: the expanded panel does not exist below lg, so show a
                static brand mark instead of a dead expand control. */}
            <span className={cn("hidden md:grid lg:hidden", collapsedSidebarControl)} aria-hidden="true">
              <BrandMark tone="emphasis" optical="chrome" className="h-7 w-7" />
            </span>
            <Button
              variant="ghost"
              className={cn("hidden px-0 lg:grid", collapsedSidebarControl, "group")}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              onClick={() => onCollapsedChange(false)}
            >
              <BrandMark
                tone="emphasis"
                optical="chrome"
                className="h-7 w-7 group-hover:hidden group-focus-visible:hidden"
              />
              <PanelLeftOpen
                aria-hidden="true"
                className="hidden size-icon-lg group-hover:block group-focus-visible:block"
              />
            </Button>
          </>
        )}
        <span className={cn(collapsedSidebarDivider, "my-0")} aria-hidden="true" />
      </div>

      <button type="button" className={railItem} aria-label="New chat" title="New chat" onClick={onNewChat}>
        <RailItemBody icon={MessageSquarePlus} label="New chat" />
      </button>
      <button
        type="button"
        className={railItem}
        aria-label="Search PsychSift"
        aria-keyshortcuts="Control+K Meta+K"
        title="Search (Ctrl K)"
        onClick={onOpenSearch}
      >
        <RailItemBody icon={Search} label="Search" />
      </button>
      <span className={cn(collapsedSidebarDivider, "my-1")} aria-hidden="true" />
      <div
        data-testid="collapsed-sidebar-scroll-region"
        /* No scrollbar gutter: the labelled items are as wide as the rail
           allows, and a gutter would push them off its centre line. The column
           still scrolls, with the bar hidden as the work rail's is. */
        className="grid min-h-0 w-full flex-1 content-start justify-items-center gap-1 overflow-y-auto overscroll-contain pb-1 [scrollbar-width:none]"
      >
        <nav aria-label="Pinned shortcuts" className="grid justify-items-center gap-1">
          {pinnedModeItems.map((item) => {
            const Icon = item.icon;
            const active = activeMode === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                prefetch={item.id === "tools" ? true : undefined}
                onFocus={item.id === "tools" ? onPrefetchApplications : undefined}
                onPointerEnter={item.id === "tools" ? onPrefetchApplications : undefined}
                onClick={(event) => selectModeFromLinkClick(event, item, onSelectMode)}
                className={railItem}
                aria-label={item.label}
                title={item.label}
                aria-current={active ? "page" : undefined}
              >
                <RailItemBody icon={Icon} label={railLabel(item.id, item.label)} />
              </Link>
            );
          })}
        </nav>
        {currentModeItem ? (
          <nav aria-label="Current mode" className="grid justify-items-center gap-1">
            <Link
              href={currentModeItem.href}
              onClick={(event) => selectModeFromLinkClick(event, currentModeItem, onSelectMode)}
              className={railItem}
              aria-label={currentModeItem.label}
              title={currentModeItem.label}
              aria-current="page"
              data-testid="collapsed-sidebar-current-mode"
            >
              <RailItemBody icon={currentModeItem.icon} label={railLabel(currentModeItem.id, currentModeItem.label)} />
            </Link>
          </nav>
        ) : null}
        <SidebarModesTrigger
          variant="collapsed"
          active={false}
          open={modeEditorOpen}
          onOpen={openModeEditor}
          triggerRef={moreModesTriggerRef}
        />
      </div>
      {/* The foot, as on the original rail: Appearance, Settings, then the
          account initial at the very bottom, under a rule that mirrors the
          one beneath the brand mark. */}
      <span className={cn(collapsedSidebarDivider, "my-1")} aria-hidden="true" />
      <SidebarAppearanceMenu railClassName={railItem} />
      <button
        type="button"
        className={railItem}
        aria-label="Settings"
        title="Settings"
        onClick={onOpenSettings}
        onPointerEnter={onPrefetchSettings}
        onFocus={onPrefetchSettings}
      >
        <RailItemBody icon={SettingsIcon} label="Settings" />
      </button>
      <button
        type="button"
        onClick={onOpenAccount}
        onPointerEnter={onPrefetchAccount}
        onFocus={onPrefetchAccount}
        data-testid="collapsed-account-settings"
        className={cn(railItem, "group")}
        title={identity.signedIn ? identity.detail : "Set up workspace"}
        aria-label={accountLabel}
      >
        <span
          aria-hidden="true"
          className="grid size-9 place-items-center rounded-full border border-[color:var(--clinical-accent-border)]/60 bg-[color:var(--clinical-accent-soft)] text-xs font-bold text-[color:var(--clinical-accent)] transition group-hover:border-[color:var(--clinical-accent-border)]"
        >
          {identity.initials}
        </span>
      </button>
      <SidebarModesEditorSheet
        open={modeEditorOpen}
        onClose={() => setModeEditorOpen(false)}
        activeMode={activeMode}
        pinnedModeIds={pinnedModeIds}
        onTogglePinnedMode={togglePinnedMode}
        onMovePinnedMode={movePinnedMode}
        onSelectMode={onSelectMode}
        onPrefetchApplications={onPrefetchApplications}
        returnFocusRef={modeEditorReturnFocusRef}
      />
    </aside>
  );
}

export function ClinicalDesktopSidebar({
  collapsed,
  collapseLocked = false,
  recentQueries,
  identity,
  activeMode,
  showAccountLibrary = false,
  onCollapsedChange,
  onNewChat,
  onPickRecent,
  onOpenSettings,
  onOpenAccount,
  onPrefetchSettings,
  onPrefetchAccount,
  onPrefetchApplications,
  onOpenSearch,
  onSelectMode,
}: {
  collapsed: boolean;
  collapseLocked?: boolean;
  recentQueries: string[];
  identity: SidebarIdentity;
  activeMode: AppModeId;
  showAccountLibrary?: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onNewChat: () => void;
  onPickRecent: (query: string) => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onPrefetchSettings?: () => void;
  onPrefetchAccount?: () => void;
  onPrefetchApplications: () => void;
  onOpenSearch: () => void;
  onSelectMode?: (mode: AppModeId) => void;
}) {
  return (
    <>
      {/* The icon rail covers tablets (md up); from lg the collapse toggle
          decides between rail and full panel. */}
      <ClinicalCollapsedRail
        hiddenOnDesktop={!collapsed}
        collapseLocked={collapseLocked}
        identity={identity}
        activeMode={activeMode}
        showAccountLibrary={showAccountLibrary}
        onCollapsedChange={onCollapsedChange}
        onNewChat={onNewChat}
        onOpenSettings={onOpenSettings}
        onOpenAccount={onOpenAccount}
        onPrefetchSettings={onPrefetchSettings}
        onPrefetchAccount={onPrefetchAccount}
        onPrefetchApplications={onPrefetchApplications}
        onSelectMode={onSelectMode}
        onOpenSearch={onOpenSearch}
      />
      {!collapsed ? (
        <aside
          id="clinical-tools-sidebar"
          aria-label="PsychSift sidebar"
          className="hidden min-h-0 w-[16.5rem] max-w-[16.5rem] shrink-0 border-r border-[color:var(--border)] bg-[color:var(--surface-lux)] px-3 py-4 lg:flex lg:flex-col"
        >
          <ClinicalSidebarContent
            recentQueries={recentQueries}
            identity={identity}
            activeMode={activeMode}
            showAccountLibrary={showAccountLibrary}
            onCollapsedChange={onCollapsedChange}
            onNewChat={onNewChat}
            onPickRecent={onPickRecent}
            onOpenSettings={onOpenSettings}
            onOpenAccount={onOpenAccount}
            onPrefetchSettings={onPrefetchSettings}
            onPrefetchAccount={onPrefetchAccount}
            onPrefetchApplications={onPrefetchApplications}
            onOpenSearch={onOpenSearch}
            onSelectMode={onSelectMode}
          />
        </aside>
      ) : null}
    </>
  );
}

/**
 * The phone side menu (owner pick "variant C", 11 Oct 2026).
 *
 * The brand band keeps the lockup, and for readers with the work areas it also
 * carries an alerts bell beside the close cross and Clinical | Work tabs along
 * its foot. The menu opens on the side the page belongs to: Clinical on
 * clinical pages, Work in the work areas.
 *
 * Clinical is the restored classic menu (New chat, Search, Recent chats,
 * Shortcuts) followed by every clinical page under its group. Work is the
 * seven work areas with what is waiting in each. Appearance, Settings and the
 * account card stay at the foot of both.
 *
 * The bell, the area counts and the overdue dot all read the one notification
 * feed, and only once the menu has first opened. Unknown or empty shows
 * nothing: no badge, no dot, never a stand-in number.
 */
export function ClinicalMobileSidebar({
  open,
  recentQueries,
  identity,
  activeMode,
  showAccountLibrary = false,
  onOpenChange,
  onNewChat,
  onPickRecent,
  onOpenSettings,
  onOpenAccount,
  onPrefetchSettings,
  onPrefetchAccount,
  onPrefetchApplications,
  onOpenSearch,
  onSelectMode,
  hiddenFrom = "md",
  startSide = "clinical",
  currentArea = null,
}: {
  open: boolean;
  recentQueries: string[];
  identity: SidebarIdentity;
  activeMode: AppModeId;
  showAccountLibrary?: boolean;
  onOpenChange: (open: boolean) => void;
  onNewChat: () => void;
  onPickRecent: (query: string) => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onPrefetchSettings?: () => void;
  onPrefetchAccount?: () => void;
  onPrefetchApplications: () => void;
  onOpenSearch: () => void;
  onSelectMode?: (mode: AppModeId) => void;
  /** Breakpoint the drawer disappears at; workflow routes keep it until lg. */
  hiddenFrom?: "md" | "lg";
  /** The tab the menu opens on: the side the current page belongs to. */
  startSide?: ModeMenuSideId;
  /** The work area on screen, already rolled up from an inner area, for the Work tab's current row. */
  currentArea?: WorkAreaId | null;
}) {
  // The work areas, their counts and the bell exist only for readers on the new work mode.
  const workAvailable = useNewWorkMode();
  const { status: authStatus } = useAuthSession();
  const alertsAvailable = workAvailable && needsYouBellVisibleForAuth(authStatus);
  const [side, setSide] = useState<ModeMenuSideId>(startSide);
  const [wasOpen, setWasOpen] = useState(open);
  const [opened, setOpened] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSide(startSide);
  }
  if (open && !opened) setOpened(true);
  const counts = useWorkSideCounts();
  const close = () => onOpenChange(false);
  const shownSide: ModeMenuSideId = workAvailable ? side : "clinical";

  const content = (
    <ClinicalSidebarContent
      showHeader={false}
      drawer
      recentQueries={recentQueries}
      identity={identity}
      activeMode={activeMode}
      showAccountLibrary={showAccountLibrary}
      onNewChat={onNewChat}
      onPickRecent={onPickRecent}
      onOpenSettings={onOpenSettings}
      onOpenAccount={onOpenAccount}
      onPrefetchSettings={onPrefetchSettings}
      onPrefetchAccount={onPrefetchAccount}
      onPrefetchApplications={onPrefetchApplications}
      onOpenSearch={onOpenSearch}
      onSelectMode={onSelectMode}
      onNavigate={close}
      workPane={
        shownSide === "work" ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
            <ClinicalMenuWorkAreas
              counts={alertsAvailable ? counts : null}
              currentArea={currentArea}
              onNavigate={close}
            />
          </div>
        ) : undefined
      }
    />
  );

  // The counts reader sits beside the Sheet, not inside it: the Sheet renders
  // nothing while closed, so a reader inside it would refetch on every open.
  return (
    <>
      {workAvailable ? <LazyWorkSideCounts active={opened && alertsAvailable} /> : null}
      <Sheet
        open={open}
        onClose={close}
        title={BRAND_NAME}
        closeLabel="Close PsychSift menu"
        placement="left"
        testId="clinical-mobile-menu"
        contentClassName={hiddenFrom === "lg" ? "lg:hidden" : "md:hidden"}
        headerLeading={<BrandMark tone="emphasis" optical="chrome" className="h-8 w-8" />}
        headerClassName={workAvailable ? drawerHeaderWithTabs : drawerHeader}
        titleClassName={drawerHeaderTitle}
        closeButtonClassName={drawerHeaderClose}
        headerActions={
          alertsAvailable ? <ClinicalMenuBell counts={counts} className={drawerHeaderClose} onNavigate={close} /> : null
        }
        headerBottom={
          workAvailable ? <ClinicalMenuTabs side={shownSide} onChange={setSide} overdue={counts?.overdue ?? 0} /> : null
        }
        descriptionContent={
          <>
            {/* The functional sentence still reaches assistive technology, where
              "what does this dialog contain" is the useful answer. The visible
              line is the strapline, which is identity — the two audiences want
              different sentences, so they get different sentences rather than one
              compromise that serves neither. On a phone it gives way to the
              bell, so the wordmark keeps its room beside two 48px controls. */}
            <span className="sr-only">{BRAND_MENU_DESCRIPTION}</span>
            <span aria-hidden="true" className={cn(brandStrapline, alertsAvailable && "max-sm:hidden")}>
              {BRAND_CATCHPHRASE_BARE}
            </span>
          </>
        }
      >
        {workAvailable ? (
          <div
            id={CLINICAL_MENU_PANEL_ID}
            role="tabpanel"
            aria-labelledby={clinicalMenuTabId(shownSide)}
            className="flex min-h-full min-w-0 flex-col"
          >
            {content}
          </div>
        ) : (
          content
        )}
      </Sheet>
    </>
  );
}
