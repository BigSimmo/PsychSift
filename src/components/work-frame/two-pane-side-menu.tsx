"use client";

import "@/components/work-frame/two-pane-side-menu.css";

import {
  AlarmClock,
  Bell,
  BookOpen,
  BriefcaseMedical,
  ChevronRight,
  Contrast,
  Heart,
  Lock,
  LogOut,
  Moon,
  PenLine,
  Search,
  SlidersHorizontal,
  Stethoscope,
  Sun,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import {
  SidebarModesEditorSheet,
  selectModeFromLinkClick,
  sidebarModeItem,
  type SidebarIdentity,
} from "@/components/clinical-dashboard/ClinicalSidebar";
import { BrandMark } from "@/components/clinical-dashboard/brand";
import { useSidebarPins } from "@/components/clinical-dashboard/use-sidebar-pins";
import { useTheme } from "@/components/clinical-dashboard/use-theme";
import { Sheet } from "@/components/ui/sheet";
import {
  rememberedWorkAreaPage,
  requestWorkFrameAction,
  workFrameActionHandler,
  useWorkSideCounts,
} from "@/components/work-frame/work-frame-store";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { appModeIds, type AppModeId } from "@/lib/app-modes";
import { appModeIcons } from "@/lib/app-mode-icons";
import { BRAND_NAME } from "@/lib/brand";
import type { ModeMenuSideId } from "@/lib/phone-mode-groups";
import { clearRecentQueries, removeRecentQuery } from "@/lib/recent-query-storage";
import type { ThemePreference } from "@/lib/theme";
import { WORK_AREAS, type WorkAreaId } from "@/lib/work-frame/areas";
import {
  WORK_SIDE_AREAS,
  WORK_SIDE_NOTIFICATIONS_HREF,
  workSideBadgeText,
  workSideCountLabel,
  type WorkSideCount,
} from "@/lib/work-frame/side-nav";
import { formatZonedDay, zonedToday } from "@/lib/work-time/format";

/**
 * The two-pane side menu, behind the Live version switch. Owner picks, 8 Oct
 * 2026: "1. Quiet strip", then "B. Today on top" as the base with option C's
 * Clinical side, then the round 9 improvements. A strip down the left holds
 * the logo, the Clinical and Work switch, My Day, Saved and Reminders, then
 * Appearance, Settings and the reader's initials at the foot. The pane beside
 * it shows the chosen side. Clinical leads with a find box, New question,
 * recent questions (swipe one left to remove it) and the reader's shortcuts.
 * Work leads with a Today card, then the work areas as tiles with their counts.
 * Swiping the menu left closes it.
 *
 * Mockup: https://claude.ai/artifact/VxACfqrnbmN91yJcasF123 (version 10).
 */
export type TwoPaneSideMenuProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly identity: SidebarIdentity;
  /** The side each opening starts on: the page's own side. */
  readonly startSide: ModeMenuSideId;
  /** The new work mode is on for this reader, so the Work side exists. */
  readonly workAvailable: boolean;
  /** The work tile to light, already rolled up from an inner area. */
  readonly currentArea: WorkAreaId | null;
  readonly activeMode: AppModeId;
  readonly recentQueries: readonly string[];
  /** Account-scoped pages (Favourites) are open to this reader. */
  readonly showAccountLibrary: boolean;
  readonly onNewChat: () => void;
  /** Runs a question: a recent one, or what the reader typed in the find box. */
  readonly onPickRecent: (query: string) => void;
  readonly onSelectMode?: (mode: AppModeId) => void;
  readonly onPrefetchApplications?: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenAccount: () => void;
  readonly onSignOut: () => Promise<void> | void;
};

type Pane = ModeMenuSideId | "you";

/** Shortcut rows shown under Clinical. Edit holds the rest. */
const SHORTCUTS_SHOWN = 5;

/** Matches shown per group while finding, so the groups stay scannable. */
const FIND_QUESTIONS_SHOWN = 4;
const FIND_PAGES_SHOWN = 5;

/** A horizontal drag this far left closes the menu. */
const CLOSE_SWIPE_PX = 56;

/** Appearance cycles in this order, one tap at a time. */
const themeCycle: readonly { readonly id: ThemePreference; readonly label: string; readonly icon: LucideIcon }[] = [
  { id: "system", label: "Auto", icon: Contrast },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

const workAreaModeIds = new Set<AppModeId>(WORK_SIDE_AREAS.map((entry) => entry.modeId));

/** "Thu 8 Oct" in the reader's work time zone. Kept out of render so the clock read is not a render side effect. */
function todayLabel(zone: string): string {
  return formatZonedDay(zonedToday(zone));
}

export function TwoPaneSideMenu({
  open,
  onOpenChange,
  identity,
  startSide,
  workAvailable,
  currentArea,
  activeMode,
  recentQueries,
  showAccountLibrary,
  onNewChat,
  onPickRecent,
  onSelectMode,
  onPrefetchApplications,
  onOpenSettings,
  onOpenAccount,
  onSignOut,
}: TwoPaneSideMenuProps) {
  const router = useRouter();
  const titleId = useId();
  const counts = useWorkSideCounts();
  const routeVisible = useWorkModeRouteVisible();
  const { zone } = useWorkTimeZone();
  const { pinnedModeIds, togglePinnedMode, movePinnedMode } = useSidebarPins();
  const { preference, setPreference } = useTheme();
  const firstSide: ModeMenuSideId = workAvailable ? startSide : "clinical";
  const [pane, setPane] = useState<Pane>(firstSide);
  const [find, setFind] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [today, setToday] = useState(() => todayLabel(zone));
  const closeRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const editorReturnRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const signOutRef = useRef<HTMLButtonElement>(null);
  const clearCancelRef = useRef<HTMLButtonElement>(null);
  const checkShown = useRef(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  // Focus follows the sign-out check: into Cancel when it opens, back to Sign out when it closes.
  useEffect(() => {
    if (confirmSignOut) cancelRef.current?.focus();
    else if (checkShown.current) signOutRef.current?.focus();
    checkShown.current = confirmSignOut;
  }, [confirmSignOut]);

  useEffect(() => {
    if (confirmClear) clearCancelRef.current?.focus();
  }, [confirmClear]);

  // The Sheet stays mounted so it can hand focus back to the menu button on
  // close; each opening starts on the page's own side, with everything put away.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPane(firstSide);
      setScrolled(false);
      setFind("");
      setConfirmClear(false);
      setConfirmSignOut(false);
      setToday(todayLabel(zone));
    }
  }

  const close = () => onOpenChange(false);
  /** Closes the menu, then runs something that opens over the page (a dialog). */
  const closeThen = (action: () => void) => {
    close();
    window.requestAnimationFrame(action);
  };
  const choosePane = (next: Pane) => {
    setPane(next);
    setScrolled(false);
    setFind("");
    setConfirmClear(false);
    setConfirmSignOut(false);
  };
  const runQuestion = (query: string) => {
    onPickRecent(query);
    close();
  };

  // Swipe left anywhere on the menu closes it. A recent row's own swipe and
  // the find box keep their gestures; a vertical scroll cancels the pointer.
  const swipeStart = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    swipe.current = target.closest("input, [data-swipe-row]") ? null : { x: event.clientX, y: event.clientY };
  };
  const swipeEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dx < -CLOSE_SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) close();
  };
  const swipeHandlers = {
    onPointerDown: swipeStart,
    onPointerUp: swipeEnd,
    onPointerCancel: () => {
      swipe.current = null;
    },
  };

  const overdue = counts?.overdue ?? 0;
  const remindersDue = counts?.reminders ?? 0;
  const bellShown = workAvailable && routeVisible(WORK_SIDE_NOTIFICATIONS_HREF);
  const myDayShown = workAvailable && routeVisible("/my-day");
  const savedHref = pane === "work" ? "/my-day/favourites" : "/favourites";
  const savedShown = pane === "work" ? routeVisible(savedHref) : showAccountLibrary;
  const title = pane === "clinical" ? "Clinical" : pane === "work" ? "Work" : "You";
  const themeIndex = Math.max(
    0,
    themeCycle.findIndex((choice) => choice.id === preference),
  );
  const theme = themeCycle[themeIndex] ?? themeCycle[0];
  const nextTheme = themeCycle[(themeIndex + 1) % themeCycle.length] ?? themeCycle[0];
  const ThemeIcon = theme.icon;

  const shortcutItems = pinnedModeIds
    .filter((id) => id !== "answer")
    .map(sidebarModeItem)
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, SHORTCUTS_SHOWN);
  const visibleAreas = workAvailable ? WORK_SIDE_AREAS.filter((entry) => routeVisible(entry.href)) : [];

  const openReminders = () => {
    close();
    // Only a page that offers Reminders can open it; anywhere else goes to My Day first.
    if (!workFrameActionHandler("my-day-reminders")) router.push("/my-day");
    requestWorkFrameAction("my-day-reminders");
  };

  const needle = find.trim().toLowerCase();
  const findResults = needle
    ? {
        questions: recentQueries.filter((query) => query.toLowerCase().includes(needle)).slice(0, FIND_QUESTIONS_SHOWN),
        pages: appModeIds
          .filter((id) => id !== "answer" && !(workAvailable && workAreaModeIds.has(id)))
          .filter((id) => id !== "favourites" || showAccountLibrary)
          .map(sidebarModeItem)
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .filter((item) => item.label.toLowerCase().includes(needle))
          .slice(0, FIND_PAGES_SHOWN),
        areas: visibleAreas.filter((entry) => entry.label.toLowerCase().includes(needle)),
      }
    : null;

  const findBox = (
    <div className="two-pane-menu__find">
      <Search aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
      <input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        aria-label="Find questions, pages and areas"
        placeholder="Find questions, pages and areas"
        value={find}
        onChange={(event) => {
          setFind(event.target.value);
          setConfirmClear(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && find.trim()) {
            event.preventDefault();
            runQuestion(find.trim());
          }
        }}
        data-testid="two-pane-menu-find"
      />
      {find ? (
        <button type="button" className="two-pane-menu__find-clear" aria-label="Clear" onClick={() => setFind("")}>
          <span>
            <X aria-hidden="true" className="size-icon-xs" strokeWidth={2.4} />
          </span>
        </button>
      ) : null}
    </div>
  );

  const findPane = findResults ? (
    <>
      <button
        type="button"
        className="two-pane-menu__row two-pane-menu__row--ask"
        onClick={() => runQuestion(find.trim())}
        data-testid="two-pane-menu-find-ask"
      >
        <PenLine aria-hidden="true" className="size-icon-md" strokeWidth={2} />
        <span className="two-pane-menu__name">Ask “{find.trim()}”</span>
      </button>
      {findResults.questions.length ? (
        <section aria-labelledby={`${titleId}-find-questions`}>
          <div className="two-pane-menu__label">
            <h3 id={`${titleId}-find-questions`}>Questions</h3>
          </div>
          <ul className="two-pane-menu__list">
            {findResults.questions.map((query, index) => (
              <li key={`${query}:${index}`}>
                <button
                  type="button"
                  className="two-pane-menu__recent"
                  title={query}
                  onClick={() => runQuestion(query)}
                >
                  <span>
                    <Highlight text={query} needle={needle} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {findResults.pages.length ? (
        <section aria-labelledby={`${titleId}-find-pages`}>
          <div className="two-pane-menu__label">
            <h3 id={`${titleId}-find-pages`}>Pages</h3>
          </div>
          <ul className="two-pane-menu__list">
            {findResults.pages.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={(event) => {
                      selectModeFromLinkClick(event, item, onSelectMode);
                      close();
                    }}
                    className="two-pane-menu__row"
                  >
                    <Icon aria-hidden="true" className="size-icon-md" strokeWidth={2} />
                    <span className="two-pane-menu__name">
                      <Highlight text={item.label} needle={needle} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {findResults.areas.length ? (
        <section aria-labelledby={`${titleId}-find-areas`}>
          <div className="two-pane-menu__label">
            <h3 id={`${titleId}-find-areas`}>Work areas</h3>
          </div>
          <ul className="two-pane-menu__list">
            {findResults.areas.map((entry) => {
              const Icon = appModeIcons[entry.modeId];
              return (
                <li key={entry.id}>
                  <Link
                    href={rememberedWorkAreaPage(entry.id) ?? entry.href}
                    onClick={close}
                    data-mode-identity={WORK_AREAS[entry.id].identity}
                    className="two-pane-menu__row"
                  >
                    <Icon aria-hidden="true" className="two-pane-menu__area-icon size-icon-md" strokeWidth={2} />
                    <span className="two-pane-menu__name">
                      <Highlight text={entry.label} needle={needle} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {!findResults.questions.length && !findResults.pages.length && !findResults.areas.length ? (
        <p className="two-pane-menu__empty">No questions, pages or areas match.</p>
      ) : null}
      <p className="two-pane-menu__privacy">
        <Lock aria-hidden="true" className="size-icon-xs" strokeWidth={2} />
        Finds on this phone only. Nothing you type here is saved.
      </p>
    </>
  ) : null;

  const clinicalPane = (
    <>
      {findBox}
      {findPane ?? (
        <>
          <div className="two-pane-menu__ask">
            <button
              type="button"
              className="two-pane-menu__new"
              onClick={() => {
                onNewChat();
                close();
              }}
              data-testid="two-pane-menu-new-question"
            >
              <PenLine aria-hidden="true" className="size-icon-md" strokeWidth={2} />
              New question
            </button>
          </div>

          <section aria-labelledby={`${titleId}-recent`}>
            <div className="two-pane-menu__label">
              <h3 id={`${titleId}-recent`}>Recent</h3>
              {recentQueries.length && !confirmClear ? (
                <button
                  type="button"
                  className="two-pane-menu__label-action"
                  aria-label="Clear recent questions"
                  onClick={() => setConfirmClear(true)}
                  data-testid="two-pane-menu-clear-recent"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {confirmClear ? (
              <div className="two-pane-menu__confirm" role="group" aria-labelledby={`${titleId}-clear-question`}>
                <p id={`${titleId}-clear-question`}>Clear your recent questions from this phone?</p>
                <div className="two-pane-menu__confirm-actions">
                  <button ref={clearCancelRef} type="button" onClick={() => setConfirmClear(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="two-pane-menu__danger"
                    data-testid="two-pane-menu-clear-recent-confirm"
                    onClick={() => {
                      clearRecentQueries();
                      setConfirmClear(false);
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : null}
            {recentQueries.length ? (
              <ul className="two-pane-menu__list">
                {recentQueries.map((query, index) => (
                  <li key={`${query}:${index}`}>
                    <RecentRow
                      query={query}
                      onPick={() => runQuestion(query)}
                      onRemove={() => removeRecentQuery(query)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="two-pane-menu__empty">Your questions will appear here.</p>
            )}
          </section>

          <section aria-labelledby={`${titleId}-shortcuts`}>
            <div className="two-pane-menu__label">
              <h3 id={`${titleId}-shortcuts`}>Shortcuts</h3>
              <button
                ref={editRef}
                type="button"
                className="two-pane-menu__label-action"
                aria-label="Edit shortcuts"
                onClick={() => {
                  editorReturnRef.current = editRef.current;
                  setEditorOpen(true);
                }}
              >
                Edit
              </button>
            </div>
            <ul className="two-pane-menu__list">
              {shortcutItems.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      prefetch={item.id === "tools" ? true : undefined}
                      onFocus={item.id === "tools" ? onPrefetchApplications : undefined}
                      onPointerEnter={item.id === "tools" ? onPrefetchApplications : undefined}
                      onClick={(event) => {
                        selectModeFromLinkClick(event, item, onSelectMode);
                        close();
                      }}
                      aria-current={activeMode === item.id ? "page" : undefined}
                      className="two-pane-menu__row two-pane-menu__row--shortcut"
                    >
                      <Icon aria-hidden="true" className="size-icon-md" strokeWidth={2} />
                      <span className="two-pane-menu__name">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </>
  );

  const DayIcon = appModeIcons["my-day"];
  const todayCardBody = (
    <>
      <span className="two-pane-menu__today-top">
        <span>Today, {today}</span>
        {myDayShown ? (
          <span className="two-pane-menu__today-link">
            My Day
            <ChevronRight aria-hidden="true" className="size-icon-xs" strokeWidth={2.2} />
          </span>
        ) : null}
      </span>
      <span className="two-pane-menu__today-main">
        <span className="two-pane-menu__today-badge" data-mode-identity="my-day" aria-hidden="true">
          <DayIcon aria-hidden="true" className="size-icon-md" strokeWidth={2} />
        </span>
        <span className="two-pane-menu__today-text">
          <b>{todayHeadline(counts)}</b>
          <small>{todayDetail(counts)}</small>
        </span>
      </span>
      {counts && (overdue > 0 || remindersDue > 0) ? (
        <span className="two-pane-menu__chips">
          {overdue > 0 ? (
            <span className="two-pane-menu__chip" data-overdue="true">
              <span className="two-pane-menu__chip-dot" aria-hidden="true" />
              {overdue} overdue
            </span>
          ) : null}
          {remindersDue > 0 ? (
            <span className="two-pane-menu__chip">
              {remindersDue} {remindersDue === 1 ? "reminder" : "reminders"} due today
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );

  const workPane = (
    <>
      {myDayShown ? (
        <Link href="/my-day" onClick={close} className="two-pane-menu__today" data-testid="two-pane-menu-today">
          {todayCardBody}
        </Link>
      ) : (
        <div className="two-pane-menu__today" data-testid="two-pane-menu-today">
          {todayCardBody}
        </div>
      )}

      <nav aria-labelledby={`${titleId}-areas`}>
        <div className="two-pane-menu__label">
          <h3 id={`${titleId}-areas`}>Areas</h3>
        </div>
        <ul className="two-pane-menu__tiles">
          {visibleAreas.map((entry) => {
            const current = entry.id === currentArea;
            const Icon = appModeIcons[entry.modeId];
            const href = current ? entry.href : (rememberedWorkAreaPage(entry.id) ?? entry.href);
            const count = counts ? (counts.areas[entry.id] ?? { total: 0, overdue: 0 }) : undefined;
            return (
              <li key={entry.id}>
                <Link
                  href={href}
                  onClick={close}
                  aria-current={current ? "true" : undefined}
                  data-mode-identity={WORK_AREAS[entry.id].identity}
                  data-testid={`two-pane-menu-area-${entry.id}`}
                  className="two-pane-menu__tile"
                >
                  <span className="two-pane-menu__tile-top">
                    <Icon aria-hidden="true" className="two-pane-menu__area-icon size-icon-lg" strokeWidth={1.9} />
                    <SideCount count={count} />
                  </span>
                  <span className="two-pane-menu__tile-name">{entry.label}</span>
                  <TileLine count={count} />
                </Link>
              </li>
            );
          })}
          {workAvailable ? (
            <li>
              <button
                type="button"
                onClick={openReminders}
                className="two-pane-menu__tile"
                data-testid="two-pane-menu-area-reminders"
              >
                <span className="two-pane-menu__tile-top">
                  <AlarmClock aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
                </span>
                <span className="two-pane-menu__tile-name">Reminders</span>
                {counts ? (
                  <span className="two-pane-menu__tile-line">
                    {remindersDue > 0 ? `${remindersDue} due today` : "None today"}
                  </span>
                ) : (
                  <span className="two-pane-menu__tile-line">On this phone</span>
                )}
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
    </>
  );

  const youPane = (
    <>
      <button
        type="button"
        className="two-pane-menu__account"
        onClick={() => closeThen(onOpenAccount)}
        data-testid="two-pane-menu-account"
      >
        <span className="two-pane-menu__avatar" aria-hidden="true">
          {identity.initials}
        </span>
        <span className="two-pane-menu__account-text">
          <b>{identity.displayName}</b>
          <small>{identity.signedIn ? identity.detail : "Set up your workspace"}</small>
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
      </button>

      <ul className="two-pane-menu__list">
        {workAvailable && routeVisible("/my-day/profile") ? (
          <li>
            <Link href="/my-day/profile" onClick={close} className="two-pane-menu__row">
              <UserRound aria-hidden="true" className="size-icon-md" strokeWidth={2} />
              <span className="two-pane-menu__name">Work profile</span>
              <ChevronRight aria-hidden="true" className="two-pane-menu__chev size-icon-sm" strokeWidth={2} />
            </Link>
          </li>
        ) : null}
        {workAvailable && routeVisible("/my-day/help") ? (
          <li>
            <Link href="/my-day/help" onClick={close} className="two-pane-menu__row">
              <BookOpen aria-hidden="true" className="size-icon-md" strokeWidth={2} />
              <span className="two-pane-menu__name">Help</span>
              <ChevronRight aria-hidden="true" className="two-pane-menu__chev size-icon-sm" strokeWidth={2} />
            </Link>
          </li>
        ) : null}
      </ul>

      {identity.signedIn ? (
        confirmSignOut ? (
          <div className="two-pane-menu__confirm" role="group" aria-labelledby={`${titleId}-sign-out-question`}>
            <p id={`${titleId}-sign-out-question`}>
              Sign out? This clears everything kept on this phone for your account, including patient labels.
            </p>
            <div className="two-pane-menu__confirm-actions">
              <button ref={cancelRef} type="button" onClick={() => setConfirmSignOut(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="two-pane-menu__danger"
                data-testid="two-pane-menu-sign-out-confirm"
                onClick={() => {
                  close();
                  void onSignOut();
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <ul className="two-pane-menu__list">
            <li>
              <button
                ref={signOutRef}
                type="button"
                className="two-pane-menu__row two-pane-menu__row--danger"
                onClick={() => setConfirmSignOut(true)}
                data-testid="two-pane-menu-sign-out"
              >
                <LogOut aria-hidden="true" className="size-icon-md" strokeWidth={2} />
                <span className="two-pane-menu__name">Sign out</span>
              </button>
            </li>
          </ul>
        )
      ) : null}
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={close}
      ariaLabel={`${BRAND_NAME} menu`}
      closeLabel="Close menu"
      placement="left"
      testId="two-pane-side-menu"
      contentClassName="two-pane-menu md:hidden"
      bodyClassName="two-pane-menu__body"
      initialFocusRef={closeRef}
    >
      <nav className="two-pane-menu__rail" aria-label="Menu" {...swipeHandlers}>
        <span className="two-pane-menu__logo">
          <BrandMark tone="emphasis" optical="chrome" className="h-8 w-8 shrink-0" />
          <span>{BRAND_NAME}</span>
        </span>
        {/* Clinical stays in the strip without Work too: it is the only way
            back from the You pane. */}
        <div className="two-pane-menu__modes" role="group" aria-label="Mode">
          <RailButton
            label="Clinical"
            icon={Stethoscope}
            pressed={pane === "clinical"}
            onClick={() => choosePane("clinical")}
            testId="two-pane-menu-clinical"
          />
          {workAvailable ? (
            <RailButton
              label="Work"
              icon={BriefcaseMedical}
              pressed={pane === "work"}
              onClick={() => choosePane("work")}
              pip={overdue > 0 ? { tone: "overdue", spoken: `${overdue} overdue` } : undefined}
              testId="two-pane-menu-work"
            />
          ) : null}
        </div>
        <span className="two-pane-menu__rule" aria-hidden="true" />
        {myDayShown ? (
          <Link href="/my-day" onClick={close} className="two-pane-menu__rail-item" data-testid="two-pane-menu-my-day">
            <span className="two-pane-menu__indicator">
              <DayIcon aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
            </span>
            My Day
          </Link>
        ) : null}
        {savedShown ? (
          <Link href={savedHref} onClick={close} className="two-pane-menu__rail-item" data-testid="two-pane-menu-saved">
            <span className="two-pane-menu__indicator">
              <Heart aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
            </span>
            Saved
          </Link>
        ) : null}
        {workAvailable ? (
          <RailButton
            label="Reminders"
            icon={AlarmClock}
            onClick={openReminders}
            pip={remindersDue > 0 ? { tone: "due", spoken: `${remindersDue} due today` } : undefined}
            testId="two-pane-menu-reminders"
          />
        ) : null}
        <span className="two-pane-menu__spacer" aria-hidden="true" />
        <button
          type="button"
          className="two-pane-menu__rail-item"
          aria-label={`Appearance, ${theme.label}. Change to ${nextTheme.label}`}
          onClick={() => setPreference(nextTheme.id)}
          data-testid="two-pane-menu-appearance"
        >
          <span className="two-pane-menu__indicator">
            <ThemeIcon aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
          </span>
          {theme.label}
        </button>
        <button
          type="button"
          className="two-pane-menu__rail-item"
          onClick={() => closeThen(onOpenSettings)}
          data-testid="two-pane-menu-settings"
        >
          <span className="two-pane-menu__indicator">
            <SlidersHorizontal aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
          </span>
          Settings
        </button>
        <button
          type="button"
          className="two-pane-menu__me"
          aria-pressed={pane === "you"}
          aria-label={`${identity.displayName}, account`}
          onClick={() => choosePane("you")}
          data-testid="two-pane-menu-you"
        >
          {identity.initials}
        </button>
      </nav>

      <section className="two-pane-menu__pane" aria-labelledby={titleId} {...swipeHandlers}>
        <header className="two-pane-menu__head" data-scrolled={scrolled ? "true" : undefined}>
          <h2 id={titleId}>{title}</h2>
          {bellShown ? (
            <Link
              href={WORK_SIDE_NOTIFICATIONS_HREF}
              onClick={close}
              className="two-pane-menu__icon"
              aria-label={counts ? `Notifications, ${workSideCountLabel(counts) || "none waiting"}` : "Notifications"}
              data-testid="two-pane-menu-bell"
            >
              <Bell aria-hidden="true" className="size-icon-md" strokeWidth={2} />
              {counts && counts.total > 0 ? (
                <span
                  className="two-pane-menu__bell-count"
                  data-overdue={counts.overdue > 0 ? "true" : undefined}
                  aria-hidden="true"
                >
                  {workSideBadgeText(counts.total)}
                </span>
              ) : null}
            </Link>
          ) : null}
          <button ref={closeRef} type="button" className="two-pane-menu__icon" aria-label="Close menu" onClick={close}>
            <X aria-hidden="true" className="size-icon-md" strokeWidth={2} />
          </button>
        </header>
        <div
          key={pane}
          className="two-pane-menu__scroll"
          data-pane={pane}
          onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 2)}
        >
          {pane === "clinical" ? clinicalPane : pane === "work" ? workPane : youPane}
        </div>
      </section>

      <SidebarModesEditorSheet
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        activeMode={activeMode}
        pinnedModeIds={pinnedModeIds}
        onTogglePinnedMode={togglePinnedMode}
        onMovePinnedMode={movePinnedMode}
        onNavigate={close}
        onSelectMode={onSelectMode}
        onPrefetchApplications={onPrefetchApplications}
        returnFocusRef={editorReturnRef}
      />
    </Sheet>
  );
}

function RailButton({
  label,
  icon: Icon,
  pressed,
  onClick,
  pip,
  testId,
}: {
  readonly label: string;
  readonly icon: LucideIcon;
  /** Set for the Clinical and Work switch only; the other strip buttons are plain actions. */
  readonly pressed?: boolean;
  readonly onClick: () => void;
  /** A small dot on the icon: red for overdue work, blue for a reminder due today. Spoken with the button. */
  readonly pip?: { readonly tone: "overdue" | "due"; readonly spoken: string };
  readonly testId: string;
}) {
  return (
    <button
      type="button"
      className="two-pane-menu__rail-item"
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="two-pane-menu__indicator">
        <Icon aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
        {pip ? <span className="two-pane-menu__pip" data-tone={pip.tone} aria-hidden="true" /> : null}
      </span>
      {label}
      {pip ? <span className="sr-only">, {pip.spoken}</span> : null}
    </button>
  );
}

/**
 * One recent question. Swipe it left to show Remove; tap it to ask again. The
 * Remove button is always in the tab order, and focusing it slides the row
 * open, so a keyboard or screen reader reaches it without the swipe.
 */
function RecentRow({
  query,
  onPick,
  onRemove,
}: {
  readonly query: string;
  readonly onPick: () => void;
  readonly onRemove: () => void;
}) {
  const removeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; base: number; active: boolean } | null>(null);
  const dragged = useRef(false);
  const [openRow, setOpenRow] = useState(false);
  const [offset, setOffset] = useState<number | null>(null);
  const reveal = () => removeRef.current?.offsetWidth ?? 0;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Pointer capture can send the click that ends a drag to the wrapper rather
    // than the row, so the flag is reset here and only ever covers this gesture.
    dragged.current = false;
    drag.current = { x: event.clientX, y: event.clientY, base: openRow ? -reveal() : 0, active: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.active) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      state.active = true;
      dragged.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    setOffset(Math.max(-reveal() * 1.25, Math.min(0, state.base + dx)));
  };
  const onPointerEnd = () => {
    const state = drag.current;
    drag.current = null;
    if (!state?.active) return;
    setOpenRow((offset ?? 0) < -reveal() / 2);
    setOffset(null);
  };

  return (
    <div
      className="two-pane-menu__swipe"
      data-swipe-row=""
      data-dragging={offset !== null ? "true" : undefined}
      data-open={openRow ? "true" : undefined}
      style={offset !== null ? ({ "--swipe-x": `${offset}px` } as CSSProperties) : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <button
        ref={removeRef}
        type="button"
        className="two-pane-menu__swipe-remove"
        aria-label={`Remove “${query}” from recent questions`}
        onFocus={() => setOpenRow(true)}
        onBlur={() => setOpenRow(false)}
        onClick={onRemove}
      >
        Remove
      </button>
      <button
        type="button"
        className="two-pane-menu__recent"
        title={query}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          if (openRow) {
            setOpenRow(false);
            return;
          }
          onPick();
        }}
      >
        <span>{query}</span>
      </button>
    </div>
  );
}

function Highlight({ text, needle }: { readonly text: string; readonly needle: string }) {
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="two-pane-menu__match">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function todayHeadline(counts: ReturnType<typeof useWorkSideCounts>): string {
  if (!counts) return "Your day";
  if (counts.total === 0) return "Nothing waiting";
  return `${counts.total} waiting`;
}

function todayDetail(counts: ReturnType<typeof useWorkSideCounts>): string {
  if (!counts) return "Open My Day for shifts and tasks";
  if (counts.total === 0) return "You are all caught up";
  return "Across your work areas";
}

function SideCount({ count }: { readonly count: WorkSideCount | undefined }) {
  if (!count || count.total === 0) return null;
  return (
    <span className="two-pane-menu__count" data-overdue={count.overdue > 0 ? "true" : undefined} aria-hidden="true">
      {workSideBadgeText(count.total)}
    </span>
  );
}

/** The line under a tile's name: what is waiting there, spoken in full. Blank while counts are unknown. */
function TileLine({ count }: { readonly count: WorkSideCount | undefined }) {
  if (!count) return <span className="two-pane-menu__tile-line" aria-hidden="true" />;
  if (count.total === 0) return <span className="two-pane-menu__tile-line">All clear</span>;
  if (count.overdue > 0) {
    return (
      <span className="two-pane-menu__tile-line" data-overdue="true">
        {workSideCountLabel(count)}
      </span>
    );
  }
  return <span className="two-pane-menu__tile-line">{workSideCountLabel(count)}</span>;
}
