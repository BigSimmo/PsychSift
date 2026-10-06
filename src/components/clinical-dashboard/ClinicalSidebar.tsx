"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Check,
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
  Pin,
  Pill,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  SunMedium,
  Wrench,
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
import { isDashboardModeHref } from "@/lib/search-route-ownership";
import { useSidebarPins, pinnableSidebarModeIds } from "@/components/clinical-dashboard/use-sidebar-pins";
import { useTheme } from "@/components/clinical-dashboard/use-theme";
import type { ThemePreference } from "@/lib/theme";

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
  // PT-11: standalone /tools is the canonical entry; /?mode=tools redirects to it.
  { id: "tools", label: "Tools", icon: Wrench, href: "/tools" },
] as const;

const sidebarAccountLibraryItems = [
  { id: "favourites" as const, label: "Favourites", icon: Heart, href: "/favourites" },
] as const;

const visibleSidebarToolItems = sidebarToolItems;

/** Specialist modes that are available from More modes but are not first-run pins. */
const sidebarMoreModeIds = [
  "forms",
  "differentials",
  "dsm",
  "specifiers",
  "formulation",
  "calculators",
  "therapy-compass",
  "dictionary",
  "sources",
  "on-call",
  "cme",
  "teaching",
  "psychiatry",
  "my-work",
  "roster",
  "open-shifts",
  "first-nations",
  "my-day",
  "medicines",
] as const satisfies readonly AppModeId[];

const sidebarModeItems = [
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

function sidebarModeItem(modeId: AppModeId) {
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
function selectModeFromLinkClick(
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
const collapsedSidebarActiveButton =
  "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]";
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
  "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--text-heading)] hover:bg-[color:var(--clinical-accent-soft)]";
/* One divider for the whole rail. Every group separator is the same 32px rule
   with the same 12px of air on both sides, so the rail reads as one column of
   48px controls broken into groups rather than four rules with three spacings. */
const collapsedSidebarDivider = "my-1.5 h-px w-8 shrink-0 bg-[color:var(--border)]";

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
 * The setting is not a new one: it is the `shared-home-brand` lockup from
 * `master-search-header`, matched line for line, because that is the same two
 * lines on the same product and the reasoning behind every value there was
 * measured rather than chosen — 18px/800 on the display tracking step for the
 * name, 12px/500 in --text-muted for the strapline. In particular the strapline
 * may not drop to --text-soft (3.07:1 on this ground, under the 4.5:1 floor) or
 * to an 11px step (bottom-light for no gain); see the note at that call site
 * before changing either.
 *
 * The strapline is the bare catchphrase: under a wordmark it is an identity
 * label rather than a sentence, and `@/lib/brand` keeps the unpunctuated variant
 * for exactly this position. */
const brandWordmark =
  "truncate text-lg font-extrabold leading-5 tracking-[var(--tracking-display)] text-[color:var(--text-heading)]";
const brandStrapline = "block truncate text-xs font-medium leading-5 text-[color:var(--text-muted)]";
const drawerHeader = `-mt-[var(--safe-area-top)] gap-x-3 border-[color:var(--border-lux)] px-4 pb-3 pt-[calc(0.75rem+var(--safe-area-top))] sm:px-5 sm:pb-3.5 sm:pt-[calc(0.875rem+var(--safe-area-top))] ${brandHeaderGround}`;
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
        className="min-h-11 min-w-11 px-3 py-2 text-xs text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)]"
        onClick={onOpen}
      >
        Edit
      </Button>
    );
  }

  if (variant === "collapsed") {
    return (
      <Button
        ref={triggerRef}
        variant="ghost"
        icon={LayoutGrid}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="More modes"
        title="More modes"
        testId="sidebar-more-modes"
        className={cn("gap-0 px-0 [&>span]:hidden", collapsedSidebarButton, active && collapsedSidebarActiveButton)}
        onClick={onOpen}
      >
        <span className="sr-only">More modes</span>
      </Button>
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

function SidebarModesEditorSheet({
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
  const orderedModes = [
    ...pinnedModeIds.map(sidebarModeItem).filter((mode): mode is NonNullable<typeof mode> => Boolean(mode)),
    ...sidebarModeItems.filter((mode) => !pinnedModeIds.includes(mode.id)),
  ].filter((mode) => `${mode.label} ${mode.description}`.toLowerCase().includes(normalizedQuery));

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

      <nav aria-label="More modes" className="mt-4 grid gap-1">
        {orderedModes.map((mode) => {
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

function SidebarAppearanceMenu() {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
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
          setOpen(true);
          focusMenuEdge("first");
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
          focusMenuEdge(event.key === "ArrowUp" ? "last" : "first");
        }}
        className={sidebarItem}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "sidebar-appearance-menu" : undefined}
      >
        <SunMedium aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 text-left">Appearance</span>
        <span className="text-xs font-medium text-[color:var(--text-muted)]">{appearanceLabel(preference)}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "-rotate-90")}
        />
      </button>

      {open ? (
        <div
          id="sidebar-appearance-menu"
          role="menu"
          aria-label="Appearance"
          onKeyDown={handleMenuKeyDown}
          className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-1.5 shadow-[var(--shadow-overlay)]"
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
                className={cn(sidebarItem, "h-auto py-2")}
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
}: {
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
  const moreModesActive =
    (pinnableSidebarModeIds as readonly AppModeId[]).includes(activeMode) && !pinnedModeIds.includes(activeMode);
  const accountLabel = accountProfileLabel(identity);

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
        <div
          className={cn(
            "-mx-4 -mt-4 flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--border-lux)] px-4 pb-3.5 pt-4",
            brandHeaderGround,
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark tone="emphasis" className="h-10 w-10" />
            <div className="min-w-0">
              <p className={brandWordmark}>{BRAND_NAME}</p>
              <p className={brandStrapline}>{BRAND_CATCHPHRASE_BARE}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            icon={PanelLeftClose}
            className="h-tap w-tap shrink-0 gap-0 rounded-full px-0 [&>span]:hidden"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            onClick={() => onCollapsedChange?.(true)}
          >
            <span className="sr-only">Collapse sidebar</span>
          </Button>
        </div>
      ) : null}

      <Button
        variant="primary"
        icon={MessageSquarePlus}
        className="w-full shrink-0 px-3"
        onClick={() => {
          onNewChat();
          onNavigate?.();
        }}
      >
        New chat
      </Button>

      {/* Scroll region: search, recent chats, and shortcuts scroll together on
          short viewports while the header, New chat, and account footer stay
          pinned. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            window.requestAnimationFrame(onOpenSearch);
          }}
          aria-label="Search PsychSift"
          aria-keyshortcuts="Control+K Meta+K"
          className="focus-ring-contained flex min-h-tap w-full shrink-0 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-medium text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition-colors hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
        >
          <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Search PsychSift</span>
          <kbd className="hidden rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-1.5 py-0.5 text-2xs pointer-fine:inline-block font-semibold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]">
            Ctrl K
          </kbd>
        </button>

        <section className="min-w-0 shrink-0">
          <div className="grid gap-1">
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
                  className={cn(sidebarItem, "border border-transparent", index === 0 && sidebarItemActive)}
                >
                  <MessageSquare
                    aria-hidden="true"
                    className={cn("h-4 w-4 shrink-0", index === 0 && "text-[color:var(--clinical-accent)]")}
                  />
                  <span className="min-w-0 flex-1 truncate text-left">{recent}</span>
                </button>
              ))
            ) : (
              <p
                className={cn(
                  "rounded-lg border border-dashed border-[color:var(--border)] px-3 py-2 text-sm",
                  textMuted,
                )}
              >
                Recent chats will appear here.
              </p>
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

        <section className="min-w-0 shrink-0">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <p className="text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">Shortcuts</p>
            <SidebarModesTrigger
              variant="edit"
              active={false}
              open={modeEditorOpen}
              onOpen={() => openModeEditor(editModesTriggerRef)}
              triggerRef={editModesTriggerRef}
            />
          </div>
          <nav aria-label="Pinned shortcuts" className="grid gap-0.5">
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
                  onClick={(event) => {
                    selectModeFromLinkClick(event, item, onSelectMode);
                    onNavigate?.();
                  }}
                  aria-current={active ? "page" : undefined}
                  className={cn(sidebarItem, "border border-transparent", active && sidebarItemActive)}
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
            {!pinnedModeItems.length ? (
              <p className="rounded-lg border border-dashed border-[color:var(--border)] px-3 py-2 text-sm text-[color:var(--text-muted)]">
                Pin your most-used modes.
              </p>
            ) : null}
            <SidebarModesTrigger
              variant="expanded"
              active={moreModesActive}
              open={modeEditorOpen}
              onOpen={() => openModeEditor(moreModesTriggerRef)}
              triggerRef={moreModesTriggerRef}
            />
          </nav>
        </section>

        {showAccountLibrary ? (
          <section className="min-w-0 shrink-0">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <p className="text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                Your library
              </p>
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
                    className={cn(sidebarItem, "border border-transparent", active && sidebarItemActive)}
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

      <div className="mt-auto grid shrink-0 gap-1 border-t border-[color:var(--border)] pt-3">
        <SidebarAppearanceMenu />
        <Button
          variant="ghost"
          icon={SettingsIcon}
          trailingIcon={ChevronRight}
          className={cn(sidebarItem, "justify-start [&>span]:min-w-0 [&>span]:flex-1 [&>span]:text-left")}
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
          className="mt-2 flex w-full items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-left shadow-[var(--shadow-inset)] transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--clinical-accent-soft)]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          aria-label={accountLabel}
        >
          <span className="grid size-tap shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] text-xs font-bold text-[color:var(--clinical-accent)]">
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

function ClinicalCollapsedRail({
  hiddenOnDesktop,
  collapseLocked,
  identity,
  activeMode,
  showAccountLibrary = false,
  onCollapsedChange,
  onNewChat,
  onOpenSettings,
  onOpenAccount,
  onPrefetchSettings,
  onPrefetchAccount,
  onPrefetchApplications,
  onSelectMode,
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
  // active mode is not already a pinned shortcut (or the library's Favourites link), it
  // gets its own slot — including Calculators and Favourites, which cannot be pinned.
  // Exactly one rail item is ever marked current.
  const activeModeInLibrary = showAccountLibrary && sidebarAccountLibraryItems.some((item) => item.id === activeMode);
  // The "favourites" branch is reachable only when the library nav is hidden
  // (showAccountLibrary false); otherwise Favourites is already lit there.
  const currentModeItem =
    pinnedModeIds.includes(activeMode) || activeModeInLibrary
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
        // One 12px gap owns every step in the column, so the brand, the rule
        // beneath it, New chat, the scrolling groups and the footer all sit on
        // the same rhythm instead of each carrying its own `mt-3`.
        "hidden min-h-0 w-[5.25rem] shrink-0 flex-col items-center gap-3 border-r border-[color:var(--border)] bg-[color:var(--surface-lux)] py-4 shadow-[var(--e2)] md:flex",
        hiddenOnDesktop && "lg:hidden",
      )}
    >
      <div className="grid w-full shrink-0 justify-items-center gap-3 px-3">
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

      <Button
        variant="ghost"
        icon={MessageSquarePlus}
        className={cn("gap-0 px-0 [&>span]:hidden", collapsedSidebarButton)}
        aria-label="New chat"
        title="New chat"
        onClick={onNewChat}
      >
        <span className="sr-only">New chat</span>
      </Button>
      <div
        data-testid="collapsed-sidebar-scroll-region"
        /* `both-edges`, not a bare `stable`: a one-sided gutter takes its width
           off the right of this box only, so the centred column of icons sat
           ~6px left of the brand, New chat, Settings and the account button —
           the misalignment that runs the length of the rail. Reserving the
           gutter on both edges keeps the column on the rail's centre line
           whether or not a scrollbar is showing. The horizontal padding goes
           with it: two 15px gutters plus `px-3` left less than a 48px control's
           width of content box. */
        className="grid min-h-0 w-full flex-1 content-start justify-items-center gap-1.5 overflow-y-auto overscroll-contain pb-1 [scrollbar-gutter:stable_both-edges]"
      >
        <nav aria-label="Pinned shortcuts" className="grid justify-items-center gap-1.5">
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
                className={cn(collapsedSidebarButton, active && collapsedSidebarActiveButton)}
                aria-label={item.label}
                title={item.label}
                aria-current={active ? "page" : undefined}
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
              </Link>
            );
          })}
        </nav>
        <span className={collapsedSidebarDivider} aria-hidden="true" />
        {currentModeItem ? (
          <nav aria-label="Current mode" className="grid justify-items-center gap-1.5">
            <Link
              href={currentModeItem.href}
              onClick={(event) => selectModeFromLinkClick(event, currentModeItem, onSelectMode)}
              className={cn(collapsedSidebarButton, collapsedSidebarActiveButton)}
              aria-label={currentModeItem.label}
              title={currentModeItem.label}
              aria-current="page"
              data-testid="collapsed-sidebar-current-mode"
            >
              <currentModeItem.icon aria-hidden="true" className="h-4 w-4" />
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
        {showAccountLibrary ? (
          <>
            <span className={collapsedSidebarDivider} aria-hidden="true" />
            <nav aria-label="Your library" className="grid justify-items-center gap-1.5">
              {sidebarAccountLibraryItems.map((item) => {
                const Icon = item.icon;
                const active = activeMode === item.id;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={cn(collapsedSidebarButton, active && collapsedSidebarActiveButton)}
                    aria-label={item.label}
                    title={item.label}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </Link>
                );
              })}
            </nav>
          </>
        ) : null}
      </div>
      {/* Mirrors the rule under the brand mark, so the rail is bracketed the
          same way at both ends and the two footer controls read as one group. */}
      <span className={cn(collapsedSidebarDivider, "my-0")} aria-hidden="true" />
      <Button
        variant="ghost"
        icon={SettingsIcon}
        className={cn("gap-0 px-0 [&>span]:hidden", collapsedSidebarButton)}
        aria-label="Settings"
        title="Settings"
        onClick={onOpenSettings}
        onPointerEnter={onPrefetchSettings}
        onFocus={onPrefetchSettings}
      >
        <span className="sr-only">Settings</span>
      </Button>
      <button
        type="button"
        onClick={onOpenAccount}
        onPointerEnter={onPrefetchAccount}
        onFocus={onPrefetchAccount}
        data-testid="collapsed-account-settings"
        className="grid h-tap w-tap shrink-0 place-items-center rounded-full border border-[color:var(--clinical-accent-border)]/60 bg-[color:var(--clinical-accent-soft)] text-xs font-bold text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--clinical-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        title={identity.signedIn ? identity.detail : "Set up workspace"}
        aria-label={accountLabel}
      >
        {identity.initials}
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
      />
      {!collapsed ? (
        <aside
          id="clinical-tools-sidebar"
          aria-label="PsychSift sidebar"
          className="hidden min-h-0 w-[20rem] max-w-[20rem] shrink-0 border-r border-[color:var(--border)] bg-[color:var(--surface-lux)] p-4 shadow-[var(--e2)] lg:flex lg:flex-col"
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
}) {
  return (
    <Sheet
      open={open}
      onClose={() => onOpenChange(false)}
      title={BRAND_NAME}
      closeLabel="Close PsychSift menu"
      placement="left"
      contentClassName={hiddenFrom === "lg" ? "lg:hidden" : "md:hidden"}
      headerLeading={<BrandMark tone="emphasis" optical="chrome" className="h-8 w-8" />}
      headerClassName={drawerHeader}
      titleClassName={drawerHeaderTitle}
      closeButtonClassName={drawerHeaderClose}
      descriptionContent={
        <>
          {/* The functional sentence still reaches assistive technology, where
              "what does this dialog contain" is the useful answer. The visible
              line is the strapline, which is identity — the two audiences want
              different sentences, so they get different sentences rather than one
              compromise that serves neither. */}
          <span className="sr-only">{BRAND_MENU_DESCRIPTION}</span>
          <span aria-hidden="true" className={brandStrapline}>
            {BRAND_CATCHPHRASE_BARE}
          </span>
        </>
      }
    >
      <ClinicalSidebarContent
        showHeader={false}
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
        onNavigate={() => onOpenChange(false)}
      />
    </Sheet>
  );
}
