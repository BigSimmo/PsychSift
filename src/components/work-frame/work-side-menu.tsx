"use client";

import { AlarmClock, Bell, BookOpen, ChevronRight, Heart, LogOut, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import type { SidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import { ModePickerSideToggle } from "@/components/mode-picker/mode-picker-row";
import { Sheet } from "@/components/ui/sheet";
import {
  rememberedWorkAreaPage,
  requestWorkFrameAction,
  useWorkSideCounts,
} from "@/components/work-frame/work-frame-store";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { appModeIcons } from "@/lib/app-mode-icons";
import { BRAND_NAME } from "@/lib/brand";
import type { ModeSide } from "@/lib/phone-mode-groups";
import { WORK_AREAS, type WorkAreaId } from "@/lib/work-frame/areas";
import { WORK_SIDE_AREAS, workSideBadgeText, workSideCountLabel, type WorkSideCount } from "@/lib/work-frame/side-nav";

/**
 * The work side menu (owner pick "Burger and rail", 7 Oct 2026). On a phone
 * the header's menu button opens this on work pages instead of the clinical
 * sidebar: who you are, the Clinical and Work switch, the seven work areas
 * with what is waiting in each, your own pages, then Settings, Help and Sign
 * out. Choosing Clinical shows the clinical sidebar's own contents in the same
 * drawer, so nothing about the clinical side is copied here.
 */
export type WorkSideMenuProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly identity: SidebarIdentity;
  /** The row to light, already rolled up from an inner area. */
  readonly currentArea: WorkAreaId | null;
  /** The clinical sidebar's contents, shown when the reader picks Clinical. */
  readonly clinical: ReactNode;
  readonly onOpenSettings: () => void;
  readonly onSignOut: () => Promise<void> | void;
};

export function WorkSideMenu(props: WorkSideMenuProps) {
  // Mounted only while open, so the side and the sign-out check start fresh each time.
  return props.open ? <WorkSideMenuOpen {...props} /> : null;
}

function WorkSideMenuOpen({
  onOpenChange,
  identity,
  currentArea,
  clinical,
  onOpenSettings,
  onSignOut,
}: WorkSideMenuProps) {
  const router = useRouter();
  const counts = useWorkSideCounts();
  const routeVisible = useWorkModeRouteVisible();
  const [side, setSide] = useState<ModeSide>("work");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const close = () => onOpenChange(false);

  const openReminders = () => {
    close();
    if (currentArea !== "day") router.push("/my-day");
    requestWorkFrameAction("my-day-reminders");
  };

  return (
    <Sheet
      open
      onClose={close}
      title={BRAND_NAME}
      closeLabel="Close PsychSift menu"
      placement="left"
      testId="work-side-menu"
      contentClassName="work-side-menu md:hidden"
      headerClassName="work-side-menu__header"
      titleClassName="work-side-menu__brand"
      bodyClassName="work-side-menu__body"
    >
      <Link
        href="/my-day/profile"
        onClick={close}
        className="work-side-menu__account"
        data-testid="work-side-menu-profile"
      >
        <span className="work-side-menu__avatar" aria-hidden="true">
          {identity.signedIn ? identity.initials : "?"}
        </span>
        <span className="work-side-menu__account-text">
          <b>{identity.signedIn ? identity.displayName : "Not signed in"}</b>
          <small>Work profile and sign-in</small>
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
      </Link>

      <ModePickerSideToggle side={side} onChange={setSide} phone={false} />

      {side === "clinical" ? (
        <div className="work-side-menu__clinical" data-testid="work-side-menu-clinical">
          {clinical}
        </div>
      ) : (
        <>
          <nav aria-label="Work areas" className="work-side-menu__group">
            <h3 className="work-side-menu__label">Work areas</h3>
            <ul>
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
                      data-testid={`work-side-menu-area-${entry.id}`}
                      className="work-side-menu__row"
                    >
                      <span className="work-side-menu__tile" aria-hidden="true">
                        <Icon aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
                      </span>
                      <span className="work-side-menu__name">{entry.label}</span>
                      <SideCount count={counts?.areas[entry.id]} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <nav aria-label="Yours" className="work-side-menu__group">
            <h3 className="work-side-menu__label">Yours</h3>
            <ul>
              {routeVisible("/my-day/alerts") ? (
                <li>
                  <Link
                    href="/my-day/alerts"
                    onClick={close}
                    data-mode-identity="my-day"
                    className="work-side-menu__row"
                    data-testid="work-side-menu-notifications"
                  >
                    <span className="work-side-menu__tile" aria-hidden="true">
                      <Bell aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
                    </span>
                    <span className="work-side-menu__name">Notifications</span>
                    <SideCount count={counts ? { total: counts.total, overdue: 0 } : undefined} />
                  </Link>
                </li>
              ) : null}
              <li>
                <Link
                  href="/my-day/favourites"
                  onClick={close}
                  data-mode-identity="my-day"
                  className="work-side-menu__row"
                  data-testid="work-side-menu-favourites"
                >
                  <span className="work-side-menu__tile" aria-hidden="true">
                    <Heart aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
                  </span>
                  <span className="work-side-menu__name">Favourites</span>
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  onClick={openReminders}
                  data-mode-identity="my-day"
                  className="work-side-menu__row"
                  data-testid="work-side-menu-reminders"
                >
                  <span className="work-side-menu__tile" aria-hidden="true">
                    <AlarmClock aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
                  </span>
                  <span className="work-side-menu__name">Reminders</span>
                  <SideCount count={counts ? { total: counts.reminders, overdue: 0 } : undefined} />
                </button>
              </li>
            </ul>
          </nav>
        </>
      )}

      {confirmSignOut ? (
        <div className="work-side-menu__confirm" role="group" aria-labelledby="work-side-menu-sign-out-question">
          <p id="work-side-menu-sign-out-question">
            Sign out? This clears everything kept on this phone for your account, including patient labels.
          </p>
          <div className="work-side-menu__confirm-actions">
            <button type="button" className="work-side-menu__cancel" onClick={() => setConfirmSignOut(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="work-side-menu__sign-out"
              data-testid="work-side-menu-sign-out-confirm"
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
        <div className="work-side-menu__foot">
          <button
            type="button"
            onClick={() => {
              close();
              onOpenSettings();
            }}
            data-testid="work-side-menu-settings"
          >
            <SlidersHorizontal aria-hidden="true" className="size-icon-md" strokeWidth={2} />
            Settings
          </button>
          <Link href="/my-day/help" onClick={close} data-testid="work-side-menu-help">
            <BookOpen aria-hidden="true" className="size-icon-md" strokeWidth={2} />
            Help
          </Link>
          {identity.signedIn ? (
            <button type="button" onClick={() => setConfirmSignOut(true)} data-testid="work-side-menu-sign-out">
              <LogOut aria-hidden="true" className="size-icon-md" strokeWidth={2} />
              Sign out
            </button>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function SideCount({ count }: { readonly count: WorkSideCount | undefined }) {
  if (!count || count.total === 0) return null;
  return (
    <>
      <span className="work-side-menu__count" data-overdue={count.overdue > 0 ? "true" : undefined} aria-hidden="true">
        {workSideBadgeText(count.total)}
      </span>
      <span className="sr-only">, {workSideCountLabel(count)}</span>
    </>
  );
}
