"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
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
import {
  cn,
  fieldControlWithIcon,
  fieldIcon,
  sidebarItem,
  statusDotReady,
  textMuted,
  toolbarButton,
} from "@/components/ui-primitives";

import { Sheet } from "@/components/ui/sheet";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
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
  // Documents and Medication now have real homes, like every other mode.
  { id: "documents", label: "Documents", icon: FileText, href: "/documents" },
  { id: "services", label: "Services", icon: appModeIcons.services, href: "/services" },
  { id: "prescribing", label: appModeDefinition("prescribing").label, icon: Pill, href: "/medications" },
  { id: "factsheets", label: "Factsheets", icon: appModeIcons.factsheets, href: "/factsheets" },
  // PT-11: standalone /tools is the canonical entry; /?mode=tools remains a dashboard-mode alias.
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
  "therapy-compass",
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

// Display-free base so callers can compose `grid` / `hidden lg:grid` without
// conflicting display utilities (cn does not de-duplicate classes).
const collapsedSidebarControl =
  "h-tap w-tap shrink-0 place-items-center rounded-xl border border-transparent text-[color:var(--text-muted)] transition hover:border-[color:var(--border)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";
const collapsedSidebarButton = `grid ${collapsedSidebarControl}`;
const collapsedSidebarActiveButton =
  "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]";

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
      <button
        ref={triggerRef}
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="min-h-9 rounded-md px-2 text-xs font-semibold text-[color:var(--clinical-accent)] transition-colors hover:bg-[color:var(--clinical-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      >
        Edit
      </button>
    );
  }

  if (variant === "collapsed") {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="More modes"
        title="More modes"
        data-testid="sidebar-more-modes"
        className={cn(collapsedSidebarButton, active && collapsedSidebarActiveButton)}
      >
        <LayoutGrid aria-hidden="true" className="h-4 w-4" />
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
      className={cn(
        sidebarItem,
        "border-l-2 border-transparent",
        active &&
          "border-l-[color:var(--clinical-accent)] bg-[color:var(--surface-chrome)] text-[color:var(--text)] hover:bg-[color:var(--surface-chrome)]",
      )}
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
                onClick={() => {
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
        <span className="text-xs font-medium text-[color:var(--text-soft)]">{appearanceLabel(preference)}</span>
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
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark className="h-10 w-10" />
            <p className="truncate text-base font-semibold tracking-tight text-[color:var(--text-heading)]">
              Clinical Guide
            </p>
          </div>
          <button
            type="button"
            onClick={() => onCollapsedChange?.(true)}
            className="grid h-tap w-tap shrink-0 place-items-center rounded-lg border border-transparent text-[color:var(--text-muted)] transition hover:border-[color:var(--border)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          onNewChat();
          onNavigate?.();
        }}
        className="inline-flex min-h-tap w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-[color:var(--command)] px-3 text-sm font-semibold text-[color:var(--command-contrast)] shadow-[var(--e1)] hover:bg-[color:var(--command-hover)]"
      >
        <MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
        New chat
      </button>

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
          aria-label="Search Clinical Guide"
          aria-keyshortcuts="Control+K Meta+K"
          className="focus-ring-contained flex min-h-tap w-full shrink-0 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-medium text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition-colors hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
        >
          <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Search Clinical Guide</span>
          <kbd className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-1.5 py-0.5 text-2xs font-semibold text-[color:var(--text-soft)] shadow-[var(--shadow-inset)]">
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
                  className={cn(
                    sidebarItem,
                    index === 0 &&
                      "border-l-2 border-l-[color:var(--clinical-accent)] bg-[color:var(--surface-chrome)] text-[color:var(--text)] hover:bg-[color:var(--surface-chrome)]",
                  )}
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
              <button
                type="button"
                onClick={() => setShowAllRecent((current) => !current)}
                className="min-h-9 rounded-lg px-2.5 text-left text-sm font-semibold text-[color:var(--text-muted)] transition-colors hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              >
                {showAllRecent ? "Show less" : "View all chats"}
              </button>
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
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    sidebarItem,
                    "border-l-2 border-transparent",
                    active &&
                      "border-l-[color:var(--clinical-accent)] bg-[color:var(--surface-chrome)] text-[color:var(--text)] hover:bg-[color:var(--surface-chrome)]",
                  )}
                >
                  <Icon
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
            <span className="my-1 h-px w-full bg-[color:var(--border)]" aria-hidden="true" />
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
                    className={cn(
                      sidebarItem,
                      "border-l-2 border-transparent",
                      active &&
                        "border-l-[color:var(--clinical-accent)] bg-[color:var(--surface-chrome)] text-[color:var(--text)] hover:bg-[color:var(--surface-chrome)]",
                    )}
                  >
                    <Icon
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
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            window.requestAnimationFrame(onOpenSettings);
          }}
          onPointerEnter={onPrefetchSettings}
          onFocus={onPrefetchSettings}
          className={sidebarItem}
        >
          <SettingsIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 text-left">Settings</span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
        </button>
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
}) {
  const accountLabel = accountProfileLabel(identity);
  const [modeEditorOpen, setModeEditorOpen] = useState(false);
  const moreModesTriggerRef = useRef<HTMLButtonElement>(null);
  const modeEditorReturnFocusRef = useRef<HTMLElement>(null);
  const { pinnedModeIds, togglePinnedMode, movePinnedMode } = useSidebarPins();
  const pinnedModeItems = pinnedModeIds
    .map(sidebarModeItem)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const moreModesActive =
    (pinnableSidebarModeIds as readonly AppModeId[]).includes(activeMode) && !pinnedModeIds.includes(activeMode);

  function openModeEditor() {
    modeEditorReturnFocusRef.current = moreModesTriggerRef.current;
    setModeEditorOpen(true);
  }

  return (
    <aside
      aria-label="Clinical Guide collapsed sidebar"
      className={cn(
        "hidden min-h-0 w-[5.25rem] shrink-0 flex-col items-center border-r border-[color:var(--border)] bg-[color:var(--surface-lux)] py-4 shadow-[var(--shadow-soft)] md:flex",
        hiddenOnDesktop && "lg:hidden",
      )}
    >
      <div className="grid w-full shrink-0 justify-items-center gap-2 px-3">
        {collapseLocked ? (
          <span className={collapsedSidebarButton} aria-hidden="true">
            <BrandMark className="h-7 w-7" />
          </span>
        ) : (
          <>
            {/* Tablet: the expanded panel does not exist below lg, so show a
                static brand mark instead of a dead expand control. */}
            <span className={cn("hidden md:grid lg:hidden", collapsedSidebarControl)} aria-hidden="true">
              <BrandMark className="h-7 w-7" />
            </span>
            <button
              type="button"
              onClick={() => onCollapsedChange(false)}
              className={cn("hidden lg:grid", collapsedSidebarControl, "group")}
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <BrandMark className="h-7 w-7 group-hover:hidden group-focus-visible:hidden" />
              <PanelLeftOpen
                aria-hidden="true"
                className="hidden size-icon-lg group-hover:block group-focus-visible:block"
              />
            </button>
          </>
        )}
        <span className="h-px w-8 bg-[color:var(--border)]" aria-hidden="true" />
      </div>

      <button
        type="button"
        onClick={onNewChat}
        className={cn("mt-3", collapsedSidebarButton)}
        aria-label="New chat"
        title="New chat"
      >
        <MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
      </button>
      <div
        data-testid="collapsed-sidebar-scroll-region"
        className="mt-3 grid min-h-0 w-full flex-1 content-start justify-items-center gap-1.5 overflow-y-auto overscroll-contain px-3 pb-1 [scrollbar-gutter:stable]"
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
                className={cn(collapsedSidebarButton, active && collapsedSidebarActiveButton)}
                aria-label={item.label}
                title={item.label}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4 w-4" />
              </Link>
            );
          })}
        </nav>
        <span className="my-1 h-px w-8 bg-[color:var(--border)]" aria-hidden="true" />
        <SidebarModesTrigger
          variant="collapsed"
          active={moreModesActive}
          open={modeEditorOpen}
          onOpen={openModeEditor}
          triggerRef={moreModesTriggerRef}
        />
        {showAccountLibrary ? (
          <>
            <span className="my-1 h-px w-8 bg-[color:var(--border)]" aria-hidden="true" />
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
                    <Icon className="h-4 w-4" />
                  </Link>
                );
              })}
            </nav>
          </>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        onPointerEnter={onPrefetchSettings}
        onFocus={onPrefetchSettings}
        className={cn("mt-3", collapsedSidebarButton)}
        aria-label="Settings"
        title="Settings"
      >
        <SettingsIcon aria-hidden="true" className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onOpenAccount}
        onPointerEnter={onPrefetchAccount}
        onFocus={onPrefetchAccount}
        data-testid="collapsed-account-settings"
        className="mt-3 grid h-tap w-tap shrink-0 place-items-center rounded-full border border-[color:var(--clinical-accent-border)]/60 bg-[color:var(--clinical-accent-soft)] text-xs font-bold text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--clinical-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
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
      />
      {!collapsed ? (
        <aside
          id="clinical-tools-sidebar"
          aria-label="Clinical Guide sidebar"
          className="hidden min-h-0 w-[20rem] max-w-[20rem] shrink-0 border-r border-[color:var(--border)] bg-[color:var(--surface-lux)] p-4 shadow-[var(--shadow-soft)] lg:flex lg:flex-col"
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
  /** Breakpoint the drawer disappears at; workflow routes keep it until lg. */
  hiddenFrom?: "md" | "lg";
}) {
  return (
    <Sheet
      open={open}
      onClose={() => onOpenChange(false)}
      title="Clinical Guide"
      description="Recent chats, navigation, and settings."
      closeLabel="Close Clinical Guide menu"
      placement="left"
      contentClassName={hiddenFrom === "lg" ? "lg:hidden" : "md:hidden"}
      headerLeading={<BrandMark className="h-8 w-8" />}
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
        onNavigate={() => onOpenChange(false)}
      />
    </Sheet>
  );
}
