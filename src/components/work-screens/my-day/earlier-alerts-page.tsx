"use client";

import {
  AlarmClock,
  Bell,
  BellOff,
  BellRing,
  CalendarDays,
  Inbox,
  Lock,
  RotateCcw,
  Sun,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

import { IconButton } from "@/components/primitive-recipes/feedback";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import {
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkEmpty,
  WorkIconCircle,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
  useWorkUndoToast,
} from "@/components/mode-kit/work";
import { MyDayFrame } from "@/components/my-day/my-day-frame";
import { useEarlierAlerts } from "@/components/work-screens/my-day/use-earlier-alerts";
import type { AppModeId } from "@/lib/app-modes";
import { MY_DAY_ALL_VIEW_HREF, withMyDayReturn } from "@/lib/my-day/return-link";
import { useOnlineStatus } from "@/lib/use-online-status";
import {
  ALERT_CODES,
  alertRowSub,
  alertRowTitle,
  areaChips,
  filterAlerts,
  groupAlertsByDay,
  isAreaFilter,
  sampleEarlierAlerts,
  type AreaFilter,
  type EarlierAlert,
  type EarlierAlertArea,
} from "@/lib/work-screens/my-day/earlier-alerts";

/**
 * My Day › Earlier alerts (mock-up `P.day_earlier`): what buzzed this phone in
 * the last 7 days, grouped by day, each opening the page the alert was for,
 * filtered by area. The list is the phone's own (there is no server history
 * of sent alerts), so the page says plainly what it can and cannot know.
 */

const ALERTS_SETTINGS_HREF = "/my-day/alerts";
const UNDO_MS = 10_000;

const AREA_ICON: Readonly<Record<EarlierAlertArea, LucideIcon>> = {
  roster: CalendarDays,
  brief: Sun,
  reminder: AlarmClock,
  test: BellRing,
};
const AREA_LEADS_TO: Readonly<Partial<Record<EarlierAlertArea, AppModeId>>> = { roster: "roster" };

function subscribeNever() {
  return () => undefined;
}
function readPermission(): string {
  try {
    return typeof window.Notification === "function" ? window.Notification.permission : "unsupported";
  } catch {
    return "unsupported";
  }
}

export function EarlierAlertsPage({ now }: { now?: Date } = {}) {
  return (
    <MyDayFrame
      title="Earlier alerts"
      testId="my-day-earlier-alerts"
      now={now}
      subtitle={() => "Everything that buzzed this phone, last 7 days"}
      signedOutSample={{
        notice:
          "These alerts are invented. Signed in, this lists the alerts that reached this phone, kept on the phone for 7 days.",
        render: (at) => <SampleList now={at} />,
      }}
    >
      {(at) => <EarlierAlertsBody now={at} />}
    </MyDayFrame>
  );
}

function SampleList({ now }: { now: Date }) {
  const alerts = useMemo(() => sampleEarlierAlerts(now.getTime()), [now]);
  return <AlertDays alerts={alerts} now={now} />;
}

function EarlierAlertsBody({ now }: { now: Date }) {
  const state = useEarlierAlerts();
  const online = useOnlineStatus();
  const permission = useSyncExternalStore(subscribeNever, readPermission, () => "default");
  const undo = useWorkUndoToast();
  const router = useRouter();
  const pathname = usePathname() ?? "/my-day/alerts/earlier";
  const searchParams = useSearchParams();
  const requested = searchParams?.get("area");
  const chips = areaChips(state.alerts);
  // A remembered area with nothing left in it falls back to All, never to an empty filter.
  const filter: AreaFilter =
    isAreaFilter(requested) && requested !== "all" && chips.some((chip) => chip.area === requested) ? requested : "all";
  const shown = filterAlerts(state.alerts, filter);

  const chooseArea = (area: AreaFilter) => {
    // Kept in the address, so Back from an opened alert returns to the same filter.
    router.replace(area === "all" ? pathname : `${pathname}?area=${area}`, { scroll: false });
  };

  const removeOne = (alert: EarlierAlert) => {
    const previous = state.remove(alert.id);
    if (undo) undo(`${alertRowTitle(alert.code)} removed from this list`, () => state.restore(previous), UNDO_MS);
  };
  const clearAll = () => {
    const previous = state.clear();
    if (undo) undo("Alert list cleared", () => state.restore(previous), UNDO_MS);
  };

  return (
    <div className="grid min-w-0 gap-4" data-testid="earlier-alerts-ready">
      {!online ? (
        <ModeNotice testId="earlier-alerts-offline">
          You&apos;re offline. This list is kept on this phone, so it still shows. The page an alert opens may need a
          connection.
        </ModeNotice>
      ) : null}

      {state.shared ? (
        <WorkEmpty
          icon={Users}
          testId="earlier-alerts-shared"
          title="This is marked as a shared device"
          body="So it keeps no list of alerts, and phone alerts stay off here."
          action={
            <WorkButton variant="secondary" href={ALERTS_SETTINGS_HREF}>
              Alert settings
            </WorkButton>
          }
        />
      ) : !state.loaded ? (
        <>
          <span role="status" className="sr-only">
            Loading earlier alerts
          </span>
          <ModeModuleSkeleton rows={4} twoLine eyebrow testId="earlier-alerts-loading" />
        </>
      ) : (
        <>
          {state.tray === "error" ? (
            <div className="grid gap-2" data-testid="earlier-alerts-error">
              <ModeNotice tone="warning">
                Couldn&apos;t read the alerts on this phone&apos;s lock screen. The list shows what was already kept.
              </ModeNotice>
              <div>
                <WorkButton variant="secondary" icon={RotateCcw} onClick={state.refresh} testId="earlier-alerts-retry">
                  Try again
                </WorkButton>
              </div>
            </div>
          ) : null}

          {state.alerts.length === 0 ? (
            permission === "granted" ? (
              <WorkEmpty
                icon={Bell}
                testId="earlier-alerts-empty"
                title="Nothing has buzzed this phone in the last 7 days"
                body="Alerts that reach this phone are listed here for 7 days."
                action={
                  <WorkButton variant="secondary" href={ALERTS_SETTINGS_HREF}>
                    Alert settings
                  </WorkButton>
                }
              />
            ) : (
              <WorkEmpty
                icon={BellOff}
                testId="earlier-alerts-empty-off"
                title="Phone alerts aren't on for this device"
                body="Turn them on in Alerts, and anything that buzzes this phone will be listed here for 7 days."
                action={
                  <WorkButton variant="primary" href={ALERTS_SETTINGS_HREF}>
                    Turn on phone alerts
                  </WorkButton>
                }
              />
            )
          ) : (
            <>
              {chips.length > 1 ? (
                <div data-no-tab-swipe="">
                  <WorkChips scroll label="Filter by area">
                    <WorkChip
                      selected={filter === "all"}
                      onClick={() => chooseArea("all")}
                      count={state.alerts.length}
                      testId="earlier-alerts-chip-all"
                    >
                      All
                    </WorkChip>
                    {chips.map((chip) => (
                      <WorkChip
                        key={chip.area}
                        selected={filter === chip.area}
                        onClick={() => chooseArea(chip.area)}
                        count={chip.count}
                        testId={`earlier-alerts-chip-${chip.area}`}
                      >
                        {chip.label}
                      </WorkChip>
                    ))}
                  </WorkChips>
                </div>
              ) : null}
              <AlertDays alerts={shown} now={now} onOpen={state.open} onRemove={removeOne} />
              <div>
                <WorkButton variant="quiet" onClick={clearAll} testId="earlier-alerts-clear">
                  Clear list
                </WorkButton>
              </div>
            </>
          )}

          <FootNote unsupported={state.tray === "unsupported"} />
        </>
      )}

      <section aria-labelledby="earlier-alerts-related" className="grid gap-2">
        <WorkSectionLabel id="earlier-alerts-related">Related</WorkSectionLabel>
        <WorkCard>
          <WorkIconRow
            icon={Bell}
            title="Alert settings"
            sub="Morning brief, quiet hours and this phone"
            href={ALERTS_SETTINGS_HREF}
            testId="earlier-alerts-settings-link"
          />
          <WorkIconRow
            icon={Inbox}
            title="Needs you"
            sub="What is waiting for you, overdue first"
            href={MY_DAY_ALL_VIEW_HREF}
            testId="earlier-alerts-needs-you-link"
          />
        </WorkCard>
      </section>
    </div>
  );
}

function FootNote({ unsupported }: { unsupported: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-2 px-1 text-sm text-[color:var(--text-muted)]">
      <Lock aria-hidden="true" strokeWidth={1.5} className="mt-0.5 size-icon-sm shrink-0" />
      <p className="m-0 min-w-0 break-words" data-testid="earlier-alerts-foot">
        Each row shows only what the lock screen said. Open one for the details. Kept on this phone for 7 days, for your
        account only.{" "}
        {unsupported
          ? "This browser can't show what is on the lock screen, so only alerts that arrive while PsychSift is open are listed."
          : "An alert cleared from the lock screen before PsychSift was opened isn't listed."}
      </p>
    </div>
  );
}

function AlertDays({
  alerts,
  now,
  onOpen,
  onRemove,
}: {
  readonly alerts: readonly EarlierAlert[];
  readonly now: Date;
  readonly onOpen?: (alert: EarlierAlert) => void;
  readonly onRemove?: (alert: EarlierAlert) => void;
}) {
  const days = groupAlertsByDay(alerts, now.getTime());
  return (
    <div className="grid min-w-0 gap-4" data-testid="earlier-alerts-days">
      {days.map((day) => (
        <section key={day.date} aria-labelledby={`earlier-alerts-day-${day.date}`} className="grid gap-2">
          <WorkSectionLabel id={`earlier-alerts-day-${day.date}`} count={day.alerts.length}>
            {day.label}
          </WorkSectionLabel>
          <WorkCard as="ul" testId={`earlier-alerts-day-${day.date}`}>
            {day.alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} onOpen={onOpen} onRemove={onRemove} />
            ))}
          </WorkCard>
        </section>
      ))}
    </div>
  );
}

function AlertRow({
  alert,
  onOpen,
  onRemove,
}: {
  readonly alert: EarlierAlert;
  readonly onOpen?: (alert: EarlierAlert) => void;
  readonly onRemove?: (alert: EarlierAlert) => void;
}) {
  const info = ALERT_CODES[alert.code];
  const title = alertRowTitle(alert.code);
  return (
    <li className="flex min-w-0 items-center" data-testid={`earlier-alert-${alert.code}`}>
      {/* The row is a link to the page the alert was for; Remove sits beside it, never inside. */}
      <Link
        href={withMyDayReturn(info.path)}
        onClick={() => onOpen?.(alert)}
        className="work-row min-w-0 flex-1"
        data-testid="earlier-alert-open"
      >
        <WorkIconCircle icon={AREA_ICON[info.area]} leadsTo={AREA_LEADS_TO[info.area]} />
        <span className="work-row__text">
          <span className="work-row__title break-words">{title}</span>
          <span className="work-row__sub">{alertRowSub(alert)}</span>
        </span>
        <span className="work-row__end">
          {alert.openedAt ? <WorkTag tone="neutral">Opened</WorkTag> : <WorkTag>New</WorkTag>}
        </span>
      </Link>
      {onRemove ? (
        <IconButton
          icon={X}
          label={`Remove ${title} from this list`}
          onClick={() => onRemove(alert)}
          className="mr-1 text-[color:var(--text-muted)]"
          data-testid="earlier-alert-remove"
        />
      ) : null}
    </li>
  );
}
