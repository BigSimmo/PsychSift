"use client";

import "@/components/work-frame/two-pane-side-menu.css";

import {
  AlarmClock,
  Bell,
  BookOpen,
  BriefcaseMedical,
  ChevronRight,
  Heart,
  LayoutGrid,
  LogOut,
  Monitor,
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
import { useEffect, useId, useRef, useState } from "react";

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
import type { AppModeId } from "@/lib/app-modes";
import { appModeIcons } from "@/lib/app-mode-icons";
import { BRAND_NAME } from "@/lib/brand";
import type { ModeMenuSideId } from "@/lib/phone-mode-groups";
import type { ThemePreference } from "@/lib/theme";
import { WORK_AREAS, type WorkAreaId } from "@/lib/work-frame/areas";
import {
  WORK_SIDE_AREAS,
  WORK_SIDE_NOTIFICATIONS_HREF,
  workSideBadgeText,
  workSideCountLabel,
  type WorkSideCount,
} from "@/lib/work-frame/side-nav";

/**
 * The two-pane side menu (owner pick "1. Quiet strip", 8 Oct 2026), behind the
 * Live version switch. A strip down the left holds the logo, the Clinical and
 * Work switch, Saved, Settings and the reader's initials; the pane beside it
 * shows the chosen side. Clinical leads with New question and recent
 * questions, then the reader's own look-up shortcuts. Work leads with what
 * needs them, then the seven areas with their counts.
 *
 * Mockup: https://claude.ai/artifact/VxACfqrnbmN91yJcasF123 (version 6).
 */
export type TwoPaneSideMenuProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly identity: SidebarIdentity;
  /** The side each opening starts on: the page's own side. */
  readonly startSide: ModeMenuSideId;
  /** The new work mode is on for this reader, so the Work side exists. */
  readonly workAvailable: boolean;
  /** The work row to light, already rolled up from an inner area. */
  readonly currentArea: WorkAreaId | null;
  readonly activeMode: AppModeId;
  readonly recentQueries: readonly string[];
  /** Account-scoped pages (Favourites) are open to this reader. */
  readonly showAccountLibrary: boolean;
  readonly onNewChat: () => void;
  readonly onPickRecent: (query: string) => void;
  readonly onOpenSearch: () => void;
  readonly onSelectMode?: (mode: AppModeId) => void;
  readonly onPrefetchApplications?: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenAccount: () => void;
  readonly onSignOut: () => Promise<void> | void;
};

type Pane = ModeMenuSideId | "you";

/** Recent questions shown before Show all. */
const RECENT_SHOWN = 5;

const themeChoices: readonly { readonly id: ThemePreference; readonly label: string; readonly icon: LucideIcon }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "Auto", icon: Monitor },
];

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
  onOpenSearch,
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
  const { pinnedModeIds, togglePinnedMode, movePinnedMode } = useSidebarPins();
  const { preference, setPreference } = useTheme();
  const firstSide: ModeMenuSideId = workAvailable ? startSide : "clinical";
  const [pane, setPane] = useState<Pane>(firstSide);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const editorReturnRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const signOutRef = useRef<HTMLButtonElement>(null);
  const checkShown = useRef(false);

  // Focus follows the sign-out check: into Cancel when it opens, back to Sign out when it closes.
  useEffect(() => {
    if (confirmSignOut) cancelRef.current?.focus();
    else if (checkShown.current) signOutRef.current?.focus();
    checkShown.current = confirmSignOut;
  }, [confirmSignOut]);

  // The Sheet stays mounted so it can hand focus back to the menu button on
  // close; each opening starts on the page's own side, with everything put away.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPane(firstSide);
      setShowAllRecent(false);
      setConfirmSignOut(false);
    }
  }

  const close = () => onOpenChange(false);
  /** Closes the menu, then runs something that opens over the page (a dialog or search). */
  const closeThen = (action: () => void) => {
    close();
    window.requestAnimationFrame(action);
  };
  const choosePane = (next: Pane) => {
    setPane(next);
    setConfirmSignOut(false);
  };

  const overdue = counts?.overdue ?? 0;
  const bellShown = workAvailable && routeVisible(WORK_SIDE_NOTIFICATIONS_HREF);
  const savedHref = pane === "work" ? "/my-day/favourites" : "/favourites";
  const savedShown = pane === "work" ? routeVisible(savedHref) : showAccountLibrary;
  const title = pane === "clinical" ? "Clinical" : pane === "work" ? "Work" : "You";

  const lookUpItems = pinnedModeIds
    .filter((id) => id !== "answer")
    .map(sidebarModeItem)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const recent = recentQueries.slice(0, showAllRecent ? recentQueries.length : RECENT_SHOWN);

  const openReminders = () => {
    close();
    // Only a page that offers Reminders can open it; anywhere else goes to My Day first.
    if (!workFrameActionHandler("my-day-reminders")) router.push("/my-day");
    requestWorkFrameAction("my-day-reminders");
  };

  const clinicalPane = (
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
          <button
            type="button"
            className="two-pane-menu__label-icon"
            aria-label="Search PsychSift"
            onClick={() => closeThen(onOpenSearch)}
          >
            <Search aria-hidden="true" className="size-icon-md" strokeWidth={2} />
          </button>
        </div>
        {recent.length ? (
          <ul className="two-pane-menu__list">
            {recent.map((query, index) => (
              <li key={`${query}:${index}`}>
                <button
                  type="button"
                  className="two-pane-menu__recent"
                  title={query}
                  onClick={() => {
                    onPickRecent(query);
                    close();
                  }}
                >
                  <span>{query}</span>
                </button>
              </li>
            ))}
            {recentQueries.length > RECENT_SHOWN ? (
              <li>
                <button
                  type="button"
                  className="two-pane-menu__more"
                  aria-expanded={showAllRecent}
                  onClick={() => setShowAllRecent((current) => !current)}
                >
                  {showAllRecent ? "Show fewer" : "All questions"}
                  <ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
                </button>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="two-pane-menu__empty">Your questions will appear here.</p>
        )}
      </section>

      <section aria-labelledby={`${titleId}-look-up`}>
        <div className="two-pane-menu__label">
          <h3 id={`${titleId}-look-up`}>Look up</h3>
          <button
            ref={editRef}
            type="button"
            className="two-pane-menu__label-action"
            aria-label="Edit look-up shortcuts"
            onClick={() => {
              editorReturnRef.current = editRef.current;
              setEditorOpen(true);
            }}
          >
            Edit
          </button>
        </div>
        <ul className="two-pane-menu__tiles">
          {lookUpItems.map((item) => {
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
                  className="two-pane-menu__tile"
                >
                  <Icon aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              className="two-pane-menu__tile"
              onClick={(event) => {
                editorReturnRef.current = event.currentTarget;
                setEditorOpen(true);
              }}
            >
              <LayoutGrid aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
              <span>More</span>
            </button>
          </li>
        </ul>
      </section>
    </>
  );

  const workPane = (
    <>
      {bellShown ? (
        <Link
          href={WORK_SIDE_NOTIFICATIONS_HREF}
          onClick={close}
          className="two-pane-menu__needs"
          data-testid="two-pane-menu-needs-you"
        >
          <span className="two-pane-menu__needs-text">
            <b>Needs you</b>
            <small>{needsYouLine(counts)}</small>
          </span>
          <ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
        </Link>
      ) : null}

      <nav aria-labelledby={`${titleId}-areas`}>
        <div className="two-pane-menu__label">
          <h3 id={`${titleId}-areas`}>Areas</h3>
        </div>
        <ul className="two-pane-menu__list">
          {WORK_SIDE_AREAS.filter((entry) => routeVisible(entry.href)).map((entry) => {
            const current = entry.id === currentArea;
            const Icon = appModeIcons[entry.modeId];
            const href = current ? entry.href : (rememberedWorkAreaPage(entry.id) ?? entry.href);
            return (
              <li key={entry.id}>
                <Link
                  href={href}
                  onClick={close}
                  aria-current={current ? "true" : undefined}
                  data-mode-identity={WORK_AREAS[entry.id].identity}
                  data-testid={`two-pane-menu-area-${entry.id}`}
                  className="two-pane-menu__row"
                >
                  <Icon aria-hidden="true" className="two-pane-menu__area-icon size-icon-md" strokeWidth={2} />
                  <span className="two-pane-menu__name">{entry.label}</span>
                  <SideCount count={counts?.areas[entry.id]} />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-labelledby={`${titleId}-phone`}>
        <div className="two-pane-menu__label">
          <h3 id={`${titleId}-phone`}>On this phone</h3>
        </div>
        <ul className="two-pane-menu__list">
          <li>
            <button type="button" onClick={openReminders} className="two-pane-menu__row">
              <AlarmClock aria-hidden="true" className="size-icon-md" strokeWidth={2} />
              <span className="two-pane-menu__name">Reminders</span>
              <SideCount count={counts ? { total: counts.reminders, overdue: 0 } : undefined} />
            </button>
          </li>
        </ul>
      </section>
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
        <li>
          <button type="button" onClick={() => closeThen(onOpenSettings)} className="two-pane-menu__row">
            <SlidersHorizontal aria-hidden="true" className="size-icon-md" strokeWidth={2} />
            <span className="two-pane-menu__name">Settings</span>
            <ChevronRight aria-hidden="true" className="two-pane-menu__chev size-icon-sm" strokeWidth={2} />
          </button>
        </li>
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

      <div className="two-pane-menu__appearance" role="group" aria-labelledby={`${titleId}-appearance`}>
        <h3 id={`${titleId}-appearance`}>Appearance</h3>
        <div className="two-pane-menu__segments">
          {themeChoices.map((choice) => {
            const Icon = choice.icon;
            return (
              <button
                key={choice.id}
                type="button"
                aria-pressed={preference === choice.id}
                onClick={() => setPreference(choice.id)}
              >
                <Icon aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
                {choice.label}
              </button>
            );
          })}
        </div>
      </div>

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
                className="two-pane-menu__sign-out"
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
      <nav className="two-pane-menu__rail" aria-label="Menu">
        <span className="two-pane-menu__logo">
          <BrandMark tone="emphasis" optical="chrome" className="two-pane-menu__mark" />
          <span>{BRAND_NAME}</span>
        </span>
        {workAvailable ? (
          <div className="two-pane-menu__modes" role="group" aria-label="Mode">
            <RailButton
              label="Clinical"
              icon={Stethoscope}
              pressed={pane === "clinical"}
              onClick={() => choosePane("clinical")}
              testId="two-pane-menu-clinical"
            />
            <RailButton
              label="Work"
              icon={BriefcaseMedical}
              pressed={pane === "work"}
              onClick={() => choosePane("work")}
              pip={overdue > 0 ? `${overdue} overdue` : undefined}
              testId="two-pane-menu-work"
            />
          </div>
        ) : null}
        <span className="two-pane-menu__rule" aria-hidden="true" />
        {savedShown ? (
          <Link href={savedHref} onClick={close} className="two-pane-menu__rail-item" data-testid="two-pane-menu-saved">
            <span className="two-pane-menu__indicator">
              <Heart aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
            </span>
            Saved
          </Link>
        ) : null}
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
        <span className="two-pane-menu__spacer" aria-hidden="true" />
        <button
          type="button"
          className="two-pane-menu__me"
          aria-pressed={pane === "you"}
          aria-label={`${identity.displayName}, account and appearance`}
          onClick={() => choosePane("you")}
          data-testid="two-pane-menu-you"
        >
          {identity.initials}
        </button>
      </nav>

      <section className="two-pane-menu__pane" aria-labelledby={titleId}>
        <header className="two-pane-menu__head">
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
        <div className="two-pane-menu__scroll" data-pane={pane}>
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
  readonly pressed: boolean;
  readonly onClick: () => void;
  /** Spoken with the button when something on that side is overdue. */
  readonly pip?: string;
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
        {pip ? <span className="two-pane-menu__pip" aria-hidden="true" /> : null}
      </span>
      {label}
      {pip ? <span className="sr-only">, {pip}</span> : null}
    </button>
  );
}

function needsYouLine(counts: ReturnType<typeof useWorkSideCounts>): string {
  if (!counts) return "Your notifications";
  if (counts.total === 0) return "Nothing waiting";
  return workSideCountLabel(counts);
}

function SideCount({ count }: { readonly count: WorkSideCount | undefined }) {
  if (!count || count.total === 0) return null;
  return (
    <>
      <span className="two-pane-menu__count" data-overdue={count.overdue > 0 ? "true" : undefined} aria-hidden="true">
        {workSideBadgeText(count.total)}
      </span>
      <span className="sr-only">, {workSideCountLabel(count)}</span>
    </>
  );
}
