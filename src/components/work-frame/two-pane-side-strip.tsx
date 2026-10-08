"use client";

import "@/components/work-frame/two-pane-side-strip.css";

import {
  AlarmClock,
  BriefcaseMedical,
  Contrast,
  Heart,
  Moon,
  SlidersHorizontal,
  Stethoscope,
  Sun,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import type { SidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import { BrandMark } from "@/components/clinical-dashboard/brand";
import { useTheme } from "@/components/clinical-dashboard/use-theme";
import {
  requestWorkFrameAction,
  useWorkSideCounts,
  workFrameActionHandler,
} from "@/components/work-frame/work-frame-store";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { appModeIcons } from "@/lib/app-mode-icons";
import { BRAND_NAME } from "@/lib/brand";
import type { ModeMenuSideId } from "@/lib/phone-mode-groups";
import type { ThemePreference } from "@/lib/theme";

/**
 * The strip shared by the two-pane side menu and its tablet rail (Live version
 * switch). On a phone the strip lives inside the menu. From 768 px the same
 * strip stays on screen down the left edge, and Clinical, Work or the
 * reader's initials open the menu on that pane, its own strip landing exactly
 * over this one so only the pane appears to slide in.
 */

/** The pane the two-pane menu shows: a side, or the reader's own account. */
export type TwoPaneMenuPane = ModeMenuSideId | "you";

/** Appearance cycles in this order, one tap at a time. */
const themeCycle: readonly { readonly id: ThemePreference; readonly label: string; readonly icon: LucideIcon }[] = [
  { id: "system", label: "Auto", icon: Contrast },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

/** The current appearance, the next one in the cycle, and a tap that moves to it. */
export function useThemeCycle() {
  const { preference, setPreference } = useTheme();
  const index = Math.max(
    0,
    themeCycle.findIndex((choice) => choice.id === preference),
  );
  const theme = themeCycle[index] ?? themeCycle[0];
  const next = themeCycle[(index + 1) % themeCycle.length] ?? themeCycle[0];
  return { theme, next, cycle: () => setPreference(next.id) };
}

/** Opens Reminders. Only a page that offers it can open it; anywhere else goes to My Day first. */
export function useOpenReminders(): () => void {
  const router = useRouter();
  return () => {
    if (!workFrameActionHandler("my-day-reminders")) router.push("/my-day");
    requestWorkFrameAction("my-day-reminders");
  };
}

export const DayIcon = appModeIcons["my-day"];

/** One strip button: an icon in a soft pill over a short label. */
export function RailButton({
  label,
  icon: Icon,
  pressed,
  current,
  opensMenu,
  onClick,
  onPrefetch,
  pip,
  testId,
}: {
  readonly label: string;
  readonly icon: LucideIcon;
  /** Set for the Clinical and Work switch inside the menu only; the other strip buttons are plain actions. */
  readonly pressed?: boolean;
  /** On the tablet rail, lights the page's own side without making the button a toggle. */
  readonly current?: boolean;
  /** On the tablet rail, the button opens the menu. */
  readonly opensMenu?: boolean;
  readonly onClick: () => void;
  readonly onPrefetch?: () => void;
  /** A small dot on the icon: red for overdue work, blue for a reminder due today. Spoken with the button. */
  readonly pip?: { readonly tone: "overdue" | "due"; readonly spoken: string };
  readonly testId: string;
}) {
  return (
    <button
      type="button"
      className="two-pane-menu__rail-item"
      aria-pressed={pressed}
      aria-haspopup={opensMenu ? "dialog" : undefined}
      aria-label={opensMenu ? `${label} menu${pip ? `, ${pip.spoken}` : ""}` : undefined}
      data-current={current ? "true" : undefined}
      onClick={onClick}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      data-testid={testId}
    >
      <span className="two-pane-menu__indicator">
        <Icon aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
        {pip ? <span className="two-pane-menu__pip" data-tone={pip.tone} aria-hidden="true" /> : null}
      </span>
      {label}
      {pip && !opensMenu ? <span className="sr-only">, {pip.spoken}</span> : null}
    </button>
  );
}

/**
 * The tablet rail: the menu's strip, kept on screen from 768 px in place of the
 * work rail and, on clinical pages, the clinical icon rail (the full clinical
 * sidebar still owns 1024 px up when the page offers it).
 */
export function TwoPaneSideRail({
  identity,
  side,
  workAvailable,
  showAccountLibrary,
  hideOnDesktop = false,
  onOpenMenu,
  onPrefetchMenu,
  onOpenSettings,
}: {
  readonly identity: SidebarIdentity;
  /** The page's own side, lit in the strip. */
  readonly side: ModeMenuSideId;
  /** The new work mode is on for this reader, so the Work side exists. */
  readonly workAvailable: boolean;
  /** Account-scoped pages (Favourites) are open to this reader. */
  readonly showAccountLibrary: boolean;
  /** The page shows the full clinical sidebar from 1024 px, so the rail stands down there. */
  readonly hideOnDesktop?: boolean;
  readonly onOpenMenu: (pane: TwoPaneMenuPane) => void;
  readonly onPrefetchMenu?: () => void;
  readonly onOpenSettings: () => void;
}) {
  const pathname = usePathname();
  const counts = useWorkSideCounts();
  const routeVisible = useWorkModeRouteVisible();
  const { theme, next, cycle } = useThemeCycle();
  const openReminders = useOpenReminders();
  const pageSide: ModeMenuSideId = workAvailable ? side : "clinical";
  const overdue = counts?.overdue ?? 0;
  const remindersDue = counts?.reminders ?? 0;
  const myDayShown = workAvailable && routeVisible("/my-day");
  const savedHref = pageSide === "work" ? "/my-day/favourites" : "/favourites";
  const savedShown = pageSide === "work" ? routeVisible(savedHref) : showAccountLibrary;
  const ThemeIcon = theme.icon;

  return (
    <nav
      className="two-pane-menu__rail two-pane-rail"
      aria-label="Menu"
      data-hide-desktop={hideOnDesktop ? "true" : undefined}
      data-testid="two-pane-rail"
    >
      <span className="two-pane-menu__logo">
        <BrandMark tone="emphasis" optical="chrome" className="h-8 w-8 shrink-0" />
        <span>{BRAND_NAME}</span>
      </span>
      <div className="two-pane-menu__modes" role="group" aria-label="Mode">
        <RailButton
          label="Clinical"
          icon={Stethoscope}
          current={pageSide === "clinical"}
          opensMenu
          onClick={() => onOpenMenu("clinical")}
          onPrefetch={onPrefetchMenu}
          testId="two-pane-rail-clinical"
        />
        {workAvailable ? (
          <RailButton
            label="Work"
            icon={BriefcaseMedical}
            current={pageSide === "work"}
            opensMenu
            onClick={() => onOpenMenu("work")}
            onPrefetch={onPrefetchMenu}
            pip={overdue > 0 ? { tone: "overdue", spoken: `${overdue} overdue` } : undefined}
            testId="two-pane-rail-work"
          />
        ) : null}
      </div>
      <span className="two-pane-menu__rule" aria-hidden="true" />
      {myDayShown ? (
        <Link
          href="/my-day"
          aria-current={pathname === "/my-day" ? "page" : undefined}
          className="two-pane-menu__rail-item"
          data-testid="two-pane-rail-my-day"
        >
          <span className="two-pane-menu__indicator">
            <DayIcon aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
          </span>
          My Day
        </Link>
      ) : null}
      {savedShown ? (
        <Link
          href={savedHref}
          aria-current={pathname === savedHref ? "page" : undefined}
          className="two-pane-menu__rail-item"
          data-testid="two-pane-rail-saved"
        >
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
          testId="two-pane-rail-reminders"
        />
      ) : null}
      <span className="two-pane-menu__spacer" aria-hidden="true" />
      <button
        type="button"
        className="two-pane-menu__rail-item"
        aria-label={`Appearance, ${theme.label}. Change to ${next.label}`}
        onClick={cycle}
        data-testid="two-pane-rail-appearance"
      >
        <span className="two-pane-menu__indicator">
          <ThemeIcon aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
        </span>
        {theme.label}
      </button>
      <button
        type="button"
        className="two-pane-menu__rail-item"
        onClick={onOpenSettings}
        data-testid="two-pane-rail-settings"
      >
        <span className="two-pane-menu__indicator">
          <SlidersHorizontal aria-hidden="true" className="size-icon-lg" strokeWidth={1.9} />
        </span>
        Settings
      </button>
      <button
        type="button"
        className="two-pane-menu__me"
        aria-haspopup="dialog"
        aria-label={`${identity.displayName}, account`}
        onClick={() => onOpenMenu("you")}
        onPointerEnter={onPrefetchMenu}
        onFocus={onPrefetchMenu}
        data-testid="two-pane-rail-you"
      >
        {identity.initials}
      </button>
    </nav>
  );
}
