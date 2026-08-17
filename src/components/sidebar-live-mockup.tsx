"use client";

import {
  ArrowDown,
  ArrowUp,
  BookMarked,
  BookOpenText,
  BrainCircuit,
  Calculator,
  Check,
  ChevronRight,
  ClipboardCheck,
  Compass,
  FileText,
  Grid2X2,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  Moon,
  MoreHorizontal,
  NotebookText,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  PencilLine,
  Pill,
  Pin,
  PinOff,
  Search,
  Settings,
  Sparkles,
  SunMedium,
  Trash2,
  UserRound,
  Waypoints,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { BrandMark } from "@/components/clinical-dashboard/brand";
import { useTheme } from "@/components/clinical-dashboard/use-theme";
import { Sheet } from "@/components/ui/sheet";
import {
  cn,
  eyebrowText,
  fieldControlWithIcon,
  fieldIcon,
  iconTilePremium,
  panelSubtle,
  primaryControl,
  sidebarItem,
  toolbarButton,
} from "@/components/ui-primitives";
import type { ThemePreference } from "@/lib/theme";
import styles from "./sidebar-live-shell.module.css";

type ModeId =
  | "answer"
  | "documents"
  | "medication"
  | "services"
  | "factsheets"
  | "tools"
  | "guidelines"
  | "calculators"
  | "forms"
  | "therapy"
  | "differentials"
  | "dsm";

type Mode = {
  id: ModeId;
  label: string;
  description: string;
  group: "Core" | "Reference" | "Clinical workflows";
  icon: LucideIcon;
};

type Chat = {
  id: string;
  title: string;
  time: string;
  pinned: boolean;
};

const modes: Mode[] = [
  {
    id: "answer",
    label: "Answer",
    description: "Evidence-backed clinical guidance",
    group: "Core",
    icon: Sparkles,
  },
  {
    id: "documents",
    label: "Documents",
    description: "Search trusted source documents",
    group: "Core",
    icon: FileText,
  },
  {
    id: "medication",
    label: "Medication",
    description: "Medicines, dosing, and safety",
    group: "Core",
    icon: Pill,
  },
  {
    id: "factsheets",
    label: "Factsheets",
    description: "Concise information for clinical conversations",
    group: "Reference",
    icon: NotebookText,
  },
  {
    id: "guidelines",
    label: "Guidelines",
    description: "Current clinical recommendations",
    group: "Reference",
    icon: BookOpenText,
  },
  {
    id: "calculators",
    label: "Calculators",
    description: "Validated bedside calculations",
    group: "Reference",
    icon: Calculator,
  },
  {
    id: "dsm",
    label: "DSM reference",
    description: "Diagnostic criteria and specifiers",
    group: "Reference",
    icon: BookMarked,
  },
  {
    id: "forms",
    label: "Forms",
    description: "Assessments and clinical forms",
    group: "Clinical workflows",
    icon: ClipboardCheck,
  },
  {
    id: "therapy",
    label: "Therapy Compass",
    description: "Treatment planning support",
    group: "Clinical workflows",
    icon: Compass,
  },
  {
    id: "differentials",
    label: "Differential diagnosis",
    description: "Structured diagnostic reasoning",
    group: "Clinical workflows",
    icon: BrainCircuit,
  },
  {
    id: "services",
    label: "Services",
    description: "Referral pathways and service navigation",
    group: "Clinical workflows",
    icon: Waypoints,
  },
  {
    id: "tools",
    label: "Tools",
    description: "Clinical utilities and structured workflows",
    group: "Clinical workflows",
    icon: Wrench,
  },
];

const initialChats: Chat[] = [
  { id: "medication-interaction", title: "Medication interaction check", time: "2h", pinned: false },
  { id: "adhd-referral", title: "Referral options for ADHD", time: "Yesterday", pinned: false },
  { id: "bipolar-maintenance", title: "Bipolar maintenance guidance", time: "Mon", pinned: false },
  { id: "sleep-assessment", title: "Sleep assessment options", time: "Fri", pinned: false },
  { id: "metabolic-monitoring", title: "Antipsychotic metabolic monitoring", time: "12 Aug", pinned: false },
];

const answerCards = [
  {
    title: "Quick answer",
    description: "Get concise, evidence-backed clinical guidance.",
    detail: "Guidelines, journals, and trusted databases.",
    icon: Sparkles,
  },
  {
    title: "Summary",
    description: "Condense guidance from multiple sources.",
    detail: "Key actions and clinical caveats stay visible.",
    icon: FileText,
  },
  {
    title: "Guidelines",
    description: "Find current recommendations.",
    detail: "Prioritised by authority and relevance.",
    icon: BookOpenText,
  },
  {
    title: "Patient context",
    description: "Consider the individual clinical picture.",
    detail: "Keep context separate from source evidence.",
    icon: UserRound,
  },
];

const appearanceOptions: Array<{
  value: ThemePreference;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { value: "light", label: "Light", description: "Always use the light palette", icon: SunMedium },
  { value: "dark", label: "Dark", description: "Always use the dark palette", icon: Moon },
  { value: "system", label: "Auto", description: "Follow this device", icon: Monitor },
];

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

function modeById(id: ModeId) {
  return modes.find((mode) => mode.id === id) ?? modes[0]!;
}

function appearanceLabel(preference: ThemePreference) {
  return preference === "system" ? "Auto" : preference === "dark" ? "Dark" : "Light";
}

function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'),
  ).filter((item) => item.getAttribute("aria-disabled") !== "true" && !item.hasAttribute("disabled"));
  if (!items.length) return;

  event.preventDefault();
  const currentIndex = items.indexOf(document.activeElement as HTMLElement);
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowUp"
          ? currentIndex <= 0
            ? items.length - 1
            : currentIndex - 1
          : currentIndex < 0 || currentIndex === items.length - 1
            ? 0
            : currentIndex + 1;
  items[nextIndex]?.focus();
}

export function SidebarLiveMockupPage() {
  const { preference, setPreference } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(true);
  const [activeMode, setActiveMode] = useState<ModeId>("answer");
  const [pinnedModeIds, setPinnedModeIds] = useState<ModeId[]>([
    "answer",
    "documents",
    "services",
    "medication",
    "factsheets",
    "tools",
  ]);
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [showAllChats, setShowAllChats] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>("medication-interaction");
  const [chatMenuId, setChatMenuId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [moreModesOpen, setMoreModesOpen] = useState(false);
  const [modeQuery, setModeQuery] = useState("");
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [composerValue, setComposerValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const modeInputRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const collapseTriggerRef = useRef<HTMLButtonElement>(null);
  const expandTriggerRef = useRef<HTMLButtonElement>(null);
  const editModesTriggerRef = useRef<HTMLButtonElement>(null);
  const moreModesTriggerRef = useRef<HTMLButtonElement>(null);
  const collapsedMoreModesTriggerRef = useRef<HTMLButtonElement>(null);
  const appearanceTriggerRef = useRef<HTMLButtonElement>(null);
  const appearanceFirstItemRef = useRef<HTMLButtonElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const accountFirstItemRef = useRef<HTMLButtonElement>(null);
  const collapsedAccountTriggerRef = useRef<HTMLButtonElement>(null);
  const collapsedAccountFirstItemRef = useRef<HTMLButtonElement>(null);
  const chatMenuFirstItemRef = useRef<HTMLButtonElement>(null);
  const chatMenuTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [modeEditorTrigger, setModeEditorTrigger] = useState<"edit" | "more" | "collapsed">("more");

  const pinnedModes = pinnedModeIds.map(modeById);
  const orderedChats = useMemo(
    () => [...chats.filter((chat) => chat.pinned), ...chats.filter((chat) => !chat.pinned)],
    [chats],
  );
  const visibleChats = showAllChats ? orderedChats : orderedChats.slice(0, 3);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const matchingModes = modes.filter((mode) =>
    `${mode.label} ${mode.description}`.toLowerCase().includes(normalizedSearchQuery),
  );
  const matchingChats = orderedChats.filter((chat) => chat.title.toLowerCase().includes(normalizedSearchQuery));
  const normalizedModeQuery = modeQuery.trim().toLowerCase();
  const activeModeData = modeById(activeMode);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        setAppearanceOpen(false);
        setAccountOpen(false);
        setChatMenuId(null);
      }
      if (event.key === "Escape") {
        if (chatMenuId) {
          const trigger = chatMenuTriggerRefs.current.get(chatMenuId);
          setChatMenuId(null);
          window.requestAnimationFrame(() => trigger?.focus());
        } else if (appearanceOpen) {
          setAppearanceOpen(false);
          window.requestAnimationFrame(() => appearanceTriggerRef.current?.focus());
        } else if (accountOpen) {
          setAccountOpen(false);
          window.requestAnimationFrame(() =>
            (collapsed ? collapsedAccountTriggerRef.current : accountTriggerRef.current)?.focus(),
          );
        }
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [accountOpen, appearanceOpen, chatMenuId, collapsed]);

  useEffect(() => {
    if (!chatMenuId && !appearanceOpen && !accountOpen) return undefined;

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-sidebar-popup-root]")) return;
      setChatMenuId(null);
      setAppearanceOpen(false);
      setAccountOpen(false);
    }

    window.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [accountOpen, appearanceOpen, chatMenuId]);

  useEffect(() => {
    if (!chatMenuId) return;
    const frame = window.requestAnimationFrame(() => chatMenuFirstItemRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [chatMenuId]);

  useEffect(() => {
    if (!appearanceOpen) return;
    const frame = window.requestAnimationFrame(() => appearanceFirstItemRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [appearanceOpen]);

  useEffect(() => {
    if (!accountOpen) return;
    const frame = window.requestAnimationFrame(() =>
      (collapsed ? collapsedAccountFirstItemRef.current : accountFirstItemRef.current)?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [accountOpen, collapsed]);

  useEffect(() => {
    if (!status) return undefined;
    const timeout = window.setTimeout(() => setStatus(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [status]);

  function selectMode(id: ModeId) {
    const mode = modeById(id);
    setActiveMode(id);
    setSelectedChatId(null);
    setStatus(`${mode.label} selected.`);
  }

  function togglePinnedMode(id: ModeId) {
    setPinnedModeIds((current) =>
      current.includes(id) ? current.filter((modeId) => modeId !== id) : [...current, id],
    );
    setStatus(`${modeById(id).label} ${pinnedModeIds.includes(id) ? "unpinned" : "pinned"}.`);
  }

  function movePinnedMode(id: ModeId, direction: -1 | 1) {
    setStatus(`${modeById(id).label} moved ${direction < 0 ? "up" : "down"}.`);
    setPinnedModeIds((current) => {
      const from = current.indexOf(id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  function updateChat(id: string, action: "pin" | "rename" | "delete") {
    const chat = chats.find((item) => item.id === id);
    if (!chat) return;
    const chatIndex = orderedChats.findIndex((item) => item.id === id);
    const fallbackChatId = orderedChats[chatIndex + 1]?.id ?? orderedChats[chatIndex - 1]?.id;

    if (action === "delete") {
      setChats((current) => current.filter((item) => item.id !== id));
      if (selectedChatId === id) setSelectedChatId(null);
      setStatus(`${chat.title} deleted from this preview.`);
    } else if (action === "rename") {
      setChats((current) =>
        current.map((item) => (item.id === id ? { ...item, title: "Medication safety review" } : item)),
      );
      setStatus("Chat renamed to Medication safety review.");
    } else {
      setChats((current) => current.map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item)));
      setStatus(`${chat.title} ${chat.pinned ? "unpinned" : "pinned"}.`);
    }
    setChatMenuId(null);
    window.requestAnimationFrame(() =>
      (action === "delete"
        ? fallbackChatId
          ? chatMenuTriggerRefs.current.get(fallbackChatId)
          : searchTriggerRef.current
        : chatMenuTriggerRefs.current.get(id)
      )?.focus(),
    );
  }

  function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = composerValue.trim();
    if (!question) return;
    setStatus(`Preview question submitted: ${question}`);
    setComposerValue("");
  }

  return (
    <div
      data-testid="sidebar-live-mockup"
      data-collapsed={collapsed}
      data-mobile-open={mobileOpen}
      className={cn(styles.shell, "bg-[color:var(--surface-wash)] text-[color:var(--text)]")}
    >
      {mobileOpen ? (
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          className={styles.backdrop}
        />
      ) : null}
      <aside
        data-testid="sidebar-live-rail"
        aria-label="Clinical Guide sidebar mockup"
        className={cn(
          styles.rail,
          "flex flex-col border-r border-[color:var(--border)] bg-[color:var(--surface-lux)] p-4 shadow-[var(--shadow-soft)]",
        )}
      >
        <div className={cn(styles.expandedContent, styles.contentEntrance, "min-h-0 flex-1 flex-col gap-4")}>
          <header className="flex shrink-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <BrandMark className="h-10 w-10" />
              <span className="truncate text-base font-semibold tracking-tight text-[color:var(--text-heading)]">
                Clinical Guide
              </span>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className={cn(styles.mobileOnly, toolbarButton)}
                aria-label="Close sidebar"
                title="Close sidebar"
              >
                <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                ref={collapseTriggerRef}
                type="button"
                onClick={(event) => {
                  const activatedByKeyboard = event.detail === 0;
                  setAppearanceOpen(false);
                  setAccountOpen(false);
                  setCollapsed(true);
                  if (activatedByKeyboard) {
                    window.requestAnimationFrame(() => expandTriggerRef.current?.focus());
                  }
                }}
                className={cn(styles.desktopOnly, toolbarButton)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </header>

          <button
            type="button"
            onClick={() => {
              setSelectedChatId(null);
              setComposerValue("");
              setStatus("New chat started.");
            }}
            className={cn(primaryControl, "w-full shrink-0 px-3")}
          >
            <MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
            New chat
          </button>

          <div
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]"
            data-testid="sidebar-sections"
          >
            <button
              ref={searchTriggerRef}
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={searchOpen}
              aria-controls="sidebar-universal-search"
              className={cn(
                styles.pressable,
                "flex min-h-tap w-full shrink-0 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-left text-sm font-medium text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition-colors hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]",
                focusRing,
              )}
            >
              <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)]" />
              <span className="min-w-0 flex-1 truncate">Search Clinical Guide</span>
              <kbd className="hidden rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-1.5 py-0.5 font-sans text-2xs font-semibold text-[color:var(--text-muted)] sm:inline">
                Ctrl K
              </kbd>
            </button>

            <section aria-label="Recent chats" className="min-w-0 shrink-0" data-testid="recent-chats">
              {visibleChats.length ? (
                <div className="grid gap-0.5">
                  {visibleChats.map((chat) => {
                    const selected = selectedChatId === chat.id;
                    const menuOpen = chatMenuId === chat.id;
                    return (
                      <div
                        key={chat.id}
                        data-sidebar-popup-root
                        className={cn(
                          styles.chatRow,
                          "group relative flex min-w-0 rounded-lg border border-transparent",
                          selected &&
                            "border-[color:var(--border)] bg-[color:var(--surface-subtle)] shadow-[var(--shadow-inset)]",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedChatId(chat.id);
                            setStatus(`${chat.title} opened.`);
                          }}
                          className={cn(
                            styles.pressable,
                            "flex min-h-tap min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium text-[color:var(--text)] transition-colors hover:bg-[color:var(--surface-subtle)]",
                            focusRing,
                          )}
                          title={chat.title}
                        >
                          {chat.pinned ? (
                            <Pin aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" />
                          ) : (
                            <MessageSquare
                              aria-hidden="true"
                              className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]"
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                          <span className="shrink-0 text-2xs tabular-nums text-[color:var(--text-soft)]">
                            {chat.time}
                          </span>
                        </button>
                        <button
                          ref={(node) => {
                            if (node) chatMenuTriggerRefs.current.set(chat.id, node);
                            else chatMenuTriggerRefs.current.delete(chat.id);
                          }}
                          type="button"
                          onClick={() => {
                            setChatMenuId(menuOpen ? null : chat.id);
                            setAppearanceOpen(false);
                            setAccountOpen(false);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "ArrowDown") return;
                            event.preventDefault();
                            setChatMenuId(chat.id);
                            setAppearanceOpen(false);
                            setAccountOpen(false);
                          }}
                          className={cn(
                            styles.pressable,
                            "grid min-h-tap w-tap shrink-0 place-items-center rounded-lg text-[color:var(--text-muted)] transition-colors hover:bg-[color:var(--surface-inset)] hover:text-[color:var(--text)]",
                            focusRing,
                          )}
                          aria-label={`More options for ${chat.title}`}
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          aria-controls={`chat-menu-${chat.id}`}
                        >
                          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                        </button>
                        {menuOpen ? (
                          <div
                            id={`chat-menu-${chat.id}`}
                            role="menu"
                            aria-label={`Options for ${chat.title}`}
                            onKeyDown={handleMenuKeyDown}
                            className={cn(
                              styles.popupMenu,
                              "absolute right-0 top-[calc(100%+0.25rem)] z-30 w-48 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-1 shadow-[var(--shadow-overlay)]",
                            )}
                          >
                            <button
                              ref={chatMenuFirstItemRef}
                              type="button"
                              role="menuitem"
                              onClick={() => updateChat(chat.id, "pin")}
                              className={sidebarItem}
                            >
                              {chat.pinned ? (
                                <PinOff aria-hidden="true" className="h-4 w-4" />
                              ) : (
                                <Pin aria-hidden="true" className="h-4 w-4" />
                              )}
                              {chat.pinned ? "Unpin chat" : "Pin chat"}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => updateChat(chat.id, "rename")}
                              className={sidebarItem}
                            >
                              <PencilLine aria-hidden="true" className="h-4 w-4" />
                              Rename
                            </button>
                            <div aria-hidden="true" className="mx-2 my-1 border-t border-[color:var(--border)]" />
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => updateChat(chat.id, "delete")}
                              className={cn(
                                sidebarItem,
                                "text-[color:var(--danger)] hover:bg-[color:var(--danger-soft)] hover:text-[color:var(--danger)]",
                              )}
                            >
                              <Trash2 aria-hidden="true" className="h-4 w-4" />
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {orderedChats.length > 3 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllChats((current) => !current)}
                      className={cn(
                        styles.pressable,
                        "flex min-h-tap items-center justify-between rounded-lg px-2.5 text-sm font-semibold text-[color:var(--text-muted)] transition-colors hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
                        focusRing,
                      )}
                    >
                      {showAllChats ? "Show fewer chats" : "View all chats"}
                      <ChevronRight
                        aria-hidden="true"
                        className={cn("h-4 w-4 transition-transform", showAllChats && "rotate-90")}
                      />
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-[color:var(--border)] px-3 py-2 text-sm text-[color:var(--text-muted)]">
                  Recent chats will appear here.
                </div>
              )}
            </section>

            <section aria-labelledby="sidebar-shortcuts-heading" className="min-w-0 shrink-0">
              <div className="mb-2 flex items-center gap-2 px-1">
                <h2 id="sidebar-shortcuts-heading" className={eyebrowText}>
                  Shortcuts
                </h2>
                <button
                  ref={editModesTriggerRef}
                  type="button"
                  onClick={() => {
                    setModeEditorTrigger("edit");
                    setMoreModesOpen(true);
                  }}
                  aria-label="Edit shortcuts"
                  aria-haspopup="dialog"
                  aria-expanded={moreModesOpen}
                  aria-controls="sidebar-more-modes"
                  className={cn(
                    "ml-auto min-h-8 rounded-md px-2 text-2xs font-semibold text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
                    focusRing,
                  )}
                >
                  Edit
                </button>
              </div>
              <nav aria-label="Pinned shortcuts" className="grid gap-0.5" data-testid="pinned-modes">
                {pinnedModes.length ? (
                  pinnedModes.map((mode) => {
                    const Icon = mode.icon;
                    const active = mode.id === activeMode;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => selectMode(mode.id)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          sidebarItem,
                          styles.pressable,
                          "border-l-2 border-transparent",
                          active &&
                            "border-l-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--text-heading)] hover:bg-[color:var(--clinical-accent-soft)]",
                        )}
                      >
                        <span className={cn(styles.iconWell, active && styles.iconWellActive)}>
                          <Icon aria-hidden="true" className="h-4 w-4" />
                        </span>
                        <span className="truncate">{mode.label}</span>
                      </button>
                    );
                  })
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setModeEditorTrigger("edit");
                      setMoreModesOpen(true);
                    }}
                    className={cn(
                      "min-h-tap w-full rounded-lg border border-dashed border-[color:var(--border)] px-3 text-left text-sm font-medium text-[color:var(--text-muted)] hover:border-[color:var(--clinical-accent-border)]",
                      focusRing,
                    )}
                  >
                    Pin your most-used modes
                  </button>
                )}
                <button
                  ref={moreModesTriggerRef}
                  type="button"
                  onClick={() => {
                    setModeEditorTrigger("more");
                    setMoreModesOpen(true);
                  }}
                  className={cn(sidebarItem, styles.pressable, styles.moreModesRow)}
                  aria-haspopup="dialog"
                  aria-expanded={moreModesOpen}
                  aria-controls="sidebar-more-modes"
                >
                  <span className={styles.iconWell}>
                    <Grid2X2 aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">More modes</span>
                  <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
                </button>
              </nav>
            </section>
          </div>

          <footer className="relative mt-auto grid shrink-0 gap-1 border-t border-[color:var(--border)] pt-3">
            <div className="relative" data-sidebar-popup-root>
              <button
                ref={appearanceTriggerRef}
                type="button"
                onClick={() => {
                  setAppearanceOpen((current) => !current);
                  setAccountOpen(false);
                  setChatMenuId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown") return;
                  event.preventDefault();
                  setAppearanceOpen(true);
                  setAccountOpen(false);
                  setChatMenuId(null);
                }}
                className={cn(sidebarItem, styles.pressable)}
                aria-haspopup="menu"
                aria-expanded={appearanceOpen}
                aria-controls="sidebar-appearance-menu"
              >
                <SunMedium aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 text-left">Appearance</span>
                <span className="text-xs font-medium text-[color:var(--text-soft)]">{appearanceLabel(preference)}</span>
                <ChevronRight
                  aria-hidden="true"
                  className={cn(styles.disclosureIcon, "h-4 w-4 shrink-0", appearanceOpen && "-rotate-90")}
                />
              </button>
              {appearanceOpen && !collapsed ? (
                <div
                  id="sidebar-appearance-menu"
                  role="menu"
                  aria-label="Appearance"
                  onKeyDown={handleMenuKeyDown}
                  className={cn(
                    styles.popupMenu,
                    styles.popupMenuBottom,
                    "absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-1.5 shadow-[var(--shadow-overlay)]",
                  )}
                >
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-semibold text-[color:var(--text-heading)]">Appearance</p>
                    <p className="text-xs text-[color:var(--text-muted)]">Uses the live application theme.</p>
                  </div>
                  {appearanceOptions.map((option) => {
                    const Icon = option.icon;
                    const checked = preference === option.value;
                    return (
                      <button
                        ref={option.value === "light" ? appearanceFirstItemRef : undefined}
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={checked}
                        onClick={() => {
                          setPreference(option.value);
                          setAppearanceOpen(false);
                          setStatus(`${option.label} appearance selected.`);
                          window.requestAnimationFrame(() => appearanceTriggerRef.current?.focus());
                        }}
                        className={cn(sidebarItem, "h-auto py-2")}
                      >
                        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-sm font-semibold text-[color:var(--text)]">{option.label}</span>
                          <span className="block text-xs font-normal text-[color:var(--text-muted)]">
                            {option.description}
                          </span>
                        </span>
                        {checked ? (
                          <Check aria-hidden="true" className="h-4 w-4 text-[color:var(--clinical-accent)]" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setStatus("Settings opened in this preview.")}
              className={cn(sidebarItem, styles.pressable)}
            >
              <Settings aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 text-left">Settings</span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
            </button>

            <div className="relative mt-2" data-sidebar-popup-root>
              <button
                ref={accountTriggerRef}
                type="button"
                onClick={() => {
                  setAccountOpen((current) => !current);
                  setAppearanceOpen(false);
                  setChatMenuId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown") return;
                  event.preventDefault();
                  setAccountOpen(true);
                  setAppearanceOpen(false);
                  setChatMenuId(null);
                }}
                className={cn(
                  styles.pressable,
                  "flex w-full items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-2 text-left shadow-[var(--shadow-inset)] transition-colors hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--clinical-accent-soft)]/40",
                  focusRing,
                )}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-controls="sidebar-account-menu"
              >
                <span className="grid size-tap shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] text-xs font-bold text-[color:var(--clinical-accent)]">
                  G
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[color:var(--text)]">Guest</span>
                  <span className="block truncate text-xs text-[color:var(--text-muted)]">Sign in to sync</span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    styles.disclosureIcon,
                    "h-4 w-4 shrink-0 text-[color:var(--text-muted)]",
                    accountOpen && "-rotate-90",
                  )}
                />
              </button>
              {accountOpen && !collapsed ? (
                <div
                  id="sidebar-account-menu"
                  role="menu"
                  aria-label="Guest account"
                  onKeyDown={handleMenuKeyDown}
                  className={cn(
                    styles.popupMenu,
                    styles.popupMenuBottom,
                    "absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-2 shadow-[var(--shadow-overlay)]",
                  )}
                >
                  <p className="px-2 py-1 text-sm font-semibold text-[color:var(--text-heading)]">
                    Save your workspace
                  </p>
                  <p className="px-2 pb-2 text-xs text-[color:var(--text-muted)]">
                    Sign in to sync chats, pins, and appearance.
                  </p>
                  <button
                    ref={accountFirstItemRef}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      setStatus("Sign-in flow opened in this preview.");
                      window.requestAnimationFrame(() => accountTriggerRef.current?.focus());
                    }}
                    className={cn(primaryControl, "w-full")}
                  >
                    Sign in
                  </button>
                </div>
              ) : null}
            </div>
          </footer>
        </div>

        <div className={cn(styles.collapsedContent, styles.contentEntrance, "min-h-0 flex-1 flex-col items-center")}>
          <button
            ref={expandTriggerRef}
            type="button"
            onClick={(event) => {
              const activatedByKeyboard = event.detail === 0;
              setCollapsed(false);
              if (activatedByKeyboard) {
                window.requestAnimationFrame(() => collapseTriggerRef.current?.focus());
              }
            }}
            className={cn(toolbarButton, styles.railAction)}
            aria-label="Expand sidebar"
            data-tooltip="Expand sidebar"
          >
            <BrandMark className="h-7 w-7" />
          </button>

          <div className={styles.railDivider} />

          <div className={styles.collapsedScroller}>
            <button
              type="button"
              onClick={() => setStatus("New chat started.")}
              className={cn(toolbarButton, styles.railAction, styles.railPlain)}
              aria-label="New chat"
              data-tooltip="New chat"
            >
              <MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
            </button>

            <nav aria-label="Collapsed shortcuts" className="grid w-full justify-items-center gap-2">
              {pinnedModes.map((mode) => {
                const Icon = mode.icon;
                const active = mode.id === activeMode;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => selectMode(mode.id)}
                    aria-label={mode.label}
                    aria-current={active ? "page" : undefined}
                    data-tooltip={mode.label}
                    className={cn(toolbarButton, styles.railAction, styles.railPlain, active && styles.railPlainActive)}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </button>
                );
              })}

              <span aria-hidden="true" className={styles.railDivider} />

              <button
                ref={collapsedMoreModesTriggerRef}
                type="button"
                onClick={() => {
                  setModeEditorTrigger("collapsed");
                  setMoreModesOpen(true);
                }}
                className={cn(toolbarButton, styles.railAction, styles.railLauncher)}
                aria-label="More modes"
                aria-haspopup="dialog"
                aria-expanded={moreModesOpen}
                aria-controls="sidebar-more-modes"
                data-tooltip="More modes"
              >
                <Grid2X2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </nav>
          </div>

          <div className={styles.collapsedUtilities}>
            <button
              type="button"
              onClick={() => setStatus("Settings opened in this preview.")}
              className={cn(toolbarButton, styles.railAction, styles.railPlain)}
              aria-label="Settings"
              data-tooltip="Settings"
            >
              <Settings aria-hidden="true" className="h-4 w-4" />
            </button>

            <div className="relative mt-1" data-sidebar-popup-root>
              <button
                ref={collapsedAccountTriggerRef}
                type="button"
                onClick={() => {
                  setAccountOpen((current) => !current);
                  setAppearanceOpen(false);
                  setChatMenuId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown") return;
                  event.preventDefault();
                  setAccountOpen(true);
                  setAppearanceOpen(false);
                  setChatMenuId(null);
                }}
                className={cn(styles.railAccount, styles.railAction)}
                aria-label="Guest, sign in to sync"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                data-tooltip="Guest · Sign in to sync"
              >
                G
              </button>
              {accountOpen && collapsed ? (
                <div
                  role="menu"
                  aria-label="Guest account"
                  onKeyDown={handleMenuKeyDown}
                  className={cn(styles.railFlyout, styles.popupMenu, styles.popupMenuBottom)}
                >
                  <p className="px-2 py-1 text-sm font-semibold text-[color:var(--text-heading)]">
                    Save your workspace
                  </p>
                  <p className="px-2 pb-2 text-xs text-[color:var(--text-muted)]">
                    Sign in to sync chats, pins, and appearance.
                  </p>
                  <button
                    ref={collapsedAccountFirstItemRef}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      setStatus("Sign-in flow opened in this preview.");
                      window.requestAnimationFrame(() => collapsedAccountTriggerRef.current?.focus());
                    }}
                    className={cn(primaryControl, "w-full")}
                  >
                    Sign in
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      <main
        aria-hidden={mobileOpen || undefined}
        className={cn(
          styles.mobileMain,
          "min-h-dvh bg-[color:var(--surface)] px-4 py-[max(1rem,var(--safe-area-top))]",
        )}
      >
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className={eyebrowText}>Clinical Guide</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--text-heading)]">Answer</h1>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className={toolbarButton}
            aria-label="Open navigation"
          >
            <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>
        <div className={cn(panelSubtle, "mt-6 p-5")}>
          <span className={iconTilePremium}>
            <Sparkles aria-hidden="true" className="h-4 w-4" />
          </span>
          <h2 className="mt-4 text-base font-semibold text-[color:var(--text-heading)]">Quick answer</h2>
          <p className="mt-2 text-sm leading-6 text-[color:var(--text-muted)]">
            Get concise, evidence-backed clinical guidance.
          </p>
        </div>
      </main>

      <main className={cn(styles.desktopMain, "h-dvh flex-col overflow-y-auto bg-[color:var(--surface)]")}>
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-8 py-8 xl:px-12 xl:py-10">
          <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className={eyebrowText}>Clinical Guide</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-[color:var(--text-heading)]">
                {activeModeData.label}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--text-muted)]">
                {activeModeData.description}. The rail uses the current application tokens and shared theme owner.
              </p>
            </div>
            <span className="rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2.5 py-1 text-2xs font-semibold text-[color:var(--clinical-accent)]">
              Live design system
            </span>
          </header>

          <section aria-label="Answer modes" className="grid gap-4 xl:grid-cols-2">
            {answerCards.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.title}
                  type="button"
                  onClick={() => setStatus(`${card.title} selected.`)}
                  className={cn(
                    panelSubtle,
                    "group min-h-44 p-5 text-left transition hover:border-[color:var(--clinical-accent-border)] hover:shadow-[var(--shadow-hover)]",
                    focusRing,
                  )}
                >
                  <span className={iconTilePremium}>
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <span className="mt-4 block text-base font-semibold text-[color:var(--text-heading)]">
                    {card.title}
                  </span>
                  <span className="mt-2 block max-w-[34ch] text-sm leading-6 text-[color:var(--text-muted)]">
                    {card.description}
                  </span>
                  <span className="mt-3 block text-xs leading-5 text-[color:var(--text-soft)]">{card.detail}</span>
                </button>
              );
            })}
          </section>

          <div className="mt-auto pt-8">
            <form
              onSubmit={submitComposer}
              className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] p-2 shadow-[var(--shadow-overlay)]"
            >
              <button
                type="button"
                onClick={() => setStatus("Attachment picker opened in this preview.")}
                className={cn(toolbarButton, "border-transparent bg-transparent shadow-none")}
                aria-label="Attach a document"
              >
                <Paperclip aria-hidden="true" className="h-4 w-4" />
              </button>
              <label className="sr-only" htmlFor="sidebar-preview-question">
                Ask a clinical question
              </label>
              <input
                id="sidebar-preview-question"
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
                placeholder="Ask a clinical question…"
                className="min-h-tap min-w-0 flex-1 bg-transparent px-2 text-sm text-[color:var(--text)] outline-none placeholder:text-[color:var(--text-placeholder)]"
              />
              <button type="submit" className={cn(primaryControl, "shrink-0 px-4")}>
                Ask
              </button>
            </form>
          </div>
        </div>
      </main>

      <div
        className={cn(
          "pointer-events-none fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-1.5 text-xs font-medium text-[color:var(--text-muted)] shadow-[var(--shadow-overlay)] transition motion-reduce:transition-none",
          status ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
        aria-live="polite"
      >
        {status}
      </div>

      <Sheet
        id="sidebar-universal-search"
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        title="Search Clinical Guide"
        description="Search chats, modes, documents, and tools from one place."
        closeLabel="Close search"
        initialFocusRef={searchInputRef}
        returnFocusRef={collapsed ? expandTriggerRef : searchTriggerRef}
        mobilePlacement="fullscreen"
        contentClassName="sm:max-w-2xl"
        bodyClassName="p-3 sm:p-4"
      >
        <label className="relative block">
          <Search aria-hidden="true" className={fieldIcon} />
          <input
            ref={searchInputRef}
            data-sheet-autofocus="true"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search everything…"
            aria-label="Search everything"
            className={fieldControlWithIcon}
          />
        </label>
        <div className="mt-4 grid gap-5">
          {matchingModes.length ? (
            <section aria-labelledby="search-modes-heading">
              <h2 id="search-modes-heading" className={cn(eyebrowText, "mb-2 px-1")}>
                Modes
              </h2>
              <div className="grid gap-1 sm:grid-cols-2">
                {matchingModes.slice(0, 6).map((mode) => {
                  const Icon = mode.icon;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        selectMode(mode.id);
                        setSearchOpen(false);
                        setSearchQuery("");
                      }}
                      className={cn(sidebarItem, "h-auto border border-transparent py-2.5")}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" />
                      <span className="min-w-0 text-left">
                        <span className="block text-sm font-semibold text-[color:var(--text)]">{mode.label}</span>
                        <span className="block truncate text-xs font-normal text-[color:var(--text-muted)]">
                          {mode.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
          {matchingChats.length ? (
            <section aria-labelledby="search-chats-heading">
              <h2 id="search-chats-heading" className={cn(eyebrowText, "mb-2 px-1")}>
                Chats
              </h2>
              <div className="grid gap-1">
                {matchingChats.slice(0, 4).map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => {
                      setSelectedChatId(chat.id);
                      setStatus(`${chat.title} opened.`);
                      setSearchOpen(false);
                      setSearchQuery("");
                    }}
                    className={sidebarItem}
                  >
                    <MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">{chat.title}</span>
                    <span className="text-2xs tabular-nums text-[color:var(--text-soft)]">{chat.time}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {!matchingModes.length && !matchingChats.length ? (
            <div className="rounded-lg border border-dashed border-[color:var(--border)] p-5 text-center">
              <p className="text-sm font-semibold text-[color:var(--text)]">No matches</p>
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">Try a mode, topic, or recent chat title.</p>
            </div>
          ) : null}
        </div>
      </Sheet>

      <Sheet
        id="sidebar-more-modes"
        open={moreModesOpen}
        onClose={() => setMoreModesOpen(false)}
        title="More modes"
        description="Search every clinical mode, then pin the ones you use most."
        closeLabel="Close more modes"
        initialFocusRef={modeInputRef}
        returnFocusRef={
          modeEditorTrigger === "edit"
            ? editModesTriggerRef
            : modeEditorTrigger === "collapsed"
              ? collapsedMoreModesTriggerRef
              : moreModesTriggerRef
        }
        mobilePlacement="bottom"
        mobileSize="viewport"
        contentClassName="sm:max-w-xl"
        bodyClassName="p-3 sm:p-4"
      >
        <label className="relative block">
          <Search aria-hidden="true" className={fieldIcon} />
          <input
            ref={modeInputRef}
            data-sheet-autofocus="true"
            type="search"
            value={modeQuery}
            onChange={(event) => setModeQuery(event.target.value)}
            placeholder="Find a mode…"
            aria-label="Find a mode"
            className={fieldControlWithIcon}
          />
        </label>
        <div className="mt-4 grid gap-5">
          {(["Core", "Reference", "Clinical workflows"] as const).map((group) => {
            const groupModes = modes.filter(
              (mode) =>
                mode.group === group && `${mode.label} ${mode.description}`.toLowerCase().includes(normalizedModeQuery),
            );
            if (!groupModes.length) return null;
            return (
              <section key={group} aria-labelledby={`mode-group-${group.replace(" ", "-")}`}>
                <h2 id={`mode-group-${group.replace(" ", "-")}`} className={cn(eyebrowText, "mb-2 px-1")}>
                  {group}
                </h2>
                <div className="grid gap-1">
                  {groupModes.map((mode) => {
                    const Icon = mode.icon;
                    const pinnedIndex = pinnedModeIds.indexOf(mode.id);
                    const pinned = pinnedIndex >= 0;
                    return (
                      <div
                        key={mode.id}
                        className="flex min-w-0 items-center gap-1 rounded-lg border border-transparent p-1 hover:border-[color:var(--border)] hover:bg-[color:var(--surface-subtle)]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            selectMode(mode.id);
                            setMoreModesOpen(false);
                          }}
                          className={cn(sidebarItem, styles.pressable, "h-auto flex-1 py-2")}
                        >
                          <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" />
                          <span className="min-w-0 text-left">
                            <span className="block text-sm font-semibold text-[color:var(--text)]">{mode.label}</span>
                            <span className="block truncate text-xs font-normal text-[color:var(--text-muted)]">
                              {mode.description}
                            </span>
                          </span>
                        </button>
                        {pinned ? (
                          <>
                            <button
                              type="button"
                              onClick={() => movePinnedMode(mode.id, -1)}
                              disabled={pinnedIndex === 0}
                              className={toolbarButton}
                              aria-label={`Move ${mode.label} up`}
                              title={`Move ${mode.label} up`}
                            >
                              <ArrowUp aria-hidden="true" className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => movePinnedMode(mode.id, 1)}
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
                          onClick={() => togglePinnedMode(mode.id)}
                          className={cn(
                            toolbarButton,
                            styles.pressable,
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
                </div>
              </section>
            );
          })}
          {!modes.some((mode) => `${mode.label} ${mode.description}`.toLowerCase().includes(normalizedModeQuery)) ? (
            <div className="rounded-lg border border-dashed border-[color:var(--border)] p-5 text-center text-sm text-[color:var(--text-muted)]">
              No modes match “{modeQuery}”.
            </div>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}
