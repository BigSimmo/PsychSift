"use client";

import { Award, Bell, CalendarDays, Phone, Presentation, ShieldCheck, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { AlertsBellPhoneSection } from "@/components/alerts/alerts-bell-phone-section";
import { AlertsDeviceSection } from "@/components/alerts/alerts-device-section";
import { AlertsButtonRow, AlertsQuietRow } from "@/components/alerts/alerts-rows";
import {
  AlertsAreaSheet,
  AlertsBriefSheet,
  AlertsDailyLimitSheet,
  AlertsQuietHoursSheet,
} from "@/components/alerts/alerts-sheets";
import { RemindMeSheet, YourRemindersSheet } from "@/components/alerts/remind-me-sheet";
import { usePhoneAlerts } from "@/components/alerts/use-phone-alerts";
import { useRemindMe } from "@/components/alerts/use-remind-me";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { WorkTag } from "@/components/mode-kit/work";
import { MyDayFrame } from "@/components/my-day/my-day-frame";
import { useRosterSettings } from "@/components/roster/use-roster-settings";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { ALERT_AREA_IDS, ALERT_AREAS, areaSummary, type AlertAreaId } from "@/lib/alerts/areas";
import { AFTER_NIGHT_TIME } from "@/lib/alerts/morning-brief";
import { useSharedDevice } from "@/lib/alerts/shared-device";
import { perthDateKey, type ReminderSettings } from "@/lib/reminders/settings";

/** The last 7 days of alerts on this phone: a new work mode screen. */
const EARLIER_ALERTS_HREF = "/my-day/alerts/earlier";

/**
 * My Day › Alerts: one place for every alert the app can send, built from the
 * "PsychSift Alerts" mock-up (screens 8 to 13). It is used by a tired doctor
 * on a phone, often at 3 am and on poor wifi, to answer two questions: "will
 * this buzz me?" and "why didn't it?". So every line says what the app will
 * actually do today; what is not built yet is shown greyed with the reason.
 */
export function AlertsPage({
  now,
  inFrame = false,
}: {
  now?: Date;
  /**
   * Drawn as the Settings tab of My Day › Notifications, whose Earlier tab sits
   * in the band, so the page leaves out its own Earlier alerts row.
   */
  inFrame?: boolean;
} = {}) {
  return (
    <MyDayFrame
      title={inFrame ? "Settings" : "Alerts"}
      testId="my-day-alerts"
      now={now}
      wide
      subtitle={() => "What reaches your phone, and when"}
      signedOut={{
        title: "Sign in to get alerts",
        body: "Alerts come from your own roster and records, so they need your account. Nothing is sent to this device while you're signed out.",
      }}
    >
      {(at) => <AlertsBody now={at} inFrame={inFrame} />}
    </MyDayFrame>
  );
}

/** Each area's icon, as the notification centre draws it. */
const AREA_ICONS: Readonly<Record<AlertAreaId, LucideIcon>> = {
  roster: CalendarDays,
  renewals: ShieldCheck,
  cpd: Award,
  teaching: Presentation,
  "on-call": Phone,
};

/** A setting that cannot be turned off, as a small grey pill. */
const ALWAYS_ON = (
  <span className="pr-3">
    <WorkTag tone="neutral">Always on</WorkTag>
  </span>
);

type OpenSheet =
  | { kind: "area"; area: AlertAreaId }
  | { kind: "quiet" }
  | { kind: "limit" }
  | { kind: "brief" }
  | { kind: "reminders" }
  | { kind: "remind-me" }
  | null;

function AlertsBody({ now, inFrame }: { now: Date; inFrame: boolean }) {
  const { preferences, setPreference } = useAppPreferences();
  const reminders = preferences.reminders;
  const roster = useRosterSettings();
  const alerts = usePhoneAlerts();
  const shared = useSharedDevice();
  const routeVisible = useWorkModeRouteVisible();
  const { reminders: notes } = useRemindMe();
  const openNotes = notes.filter((item) => !item.doneAt).length;
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const today = perthDateKey(now);

  const rosterChoices = {
    phoneOn: alerts.state === "on",
    changes: roster.status === "ready" ? roster.settings.alerts.changes : null,
    requests: roster.status === "ready" ? roster.settings.alerts.requests : null,
    failed: roster.status === "error",
    calendarShifts: roster.status === "ready" ? roster.settings.calendarShifts : null,
  };
  const setReminders = (next: ReminderSettings) => setPreference("reminders", next);
  const changeRoster = async (which: "changes" | "requests") => {
    const alertsNow = roster.settings.alerts;
    setRosterError(await roster.update({ alerts: { ...alertsNow, [which]: !alertsNow[which] } }));
  };
  const quiet = reminders.quietHours;

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-2 lg:gap-x-8" data-testid="my-day-alerts-ready">
      <ModeGroupedList eyebrow="Morning brief" testId="alerts-brief" className="lg:col-start-1 lg:row-start-1">
        <AlertsButtonRow
          title="Morning brief"
          subtitle={
            !reminders.brief.enabled
              ? "Off"
              : alerts.state === "on"
                ? "On · one alert instead of many"
                : "On · turn on phone alerts below to get it"
          }
          onSelect={() => setSheet({ kind: "brief" })}
          toggle={{
            enabled: reminders.brief.enabled,
            label: "Morning brief",
            onToggle: () =>
              setReminders({ ...reminders, brief: { ...reminders.brief, enabled: !reminders.brief.enabled } }),
          }}
          testId="alerts-brief-row"
        />
        <AlertsButtonRow
          title="Time"
          subtitle={`Workdays ${reminders.brief.workday} · days off ${reminders.brief.dayOff}`}
          onSelect={() => setSheet({ kind: "brief" })}
          testId="alerts-brief-time-row"
        />
        <ModeRow
          title="After a night shift"
          subtitle={`Held until ${AFTER_NIGHT_TIME}`}
          trailing={ALWAYS_ON}
          testId="alerts-brief-night-row"
        />
        <AlertsButtonRow
          title="Alerts a day"
          subtitle={`Up to ${reminders.maxAlertsPerDay} calendar ${reminders.maxAlertsPerDay === 1 ? "alert" : "alerts"}`}
          onSelect={() => setSheet({ kind: "limit" })}
          testId="alerts-limit-row"
        />
      </ModeGroupedList>

      <div className="grid min-w-0 content-start gap-2 lg:col-start-2 lg:row-span-3 lg:row-start-1">
        <ModeGroupedList eyebrow="By area" testId="alerts-areas">
          {ALERT_AREA_IDS.map((id) => (
            <AlertsButtonRow
              key={id}
              title={ALERT_AREAS[id].title}
              subtitle={areaSummary(id, reminders, today, rosterChoices)}
              icon={AREA_ICONS[id]}
              mode={ALERT_AREAS[id].mode}
              onSelect={() => setSheet({ kind: "area", area: id })}
              testId={`alerts-area-${id}`}
            />
          ))}
          <AlertsButtonRow
            title="Your reminders"
            subtitle={
              openNotes ? `${openNotes} listed here · kept on this device` : "Listed here · kept on this device"
            }
            icon={Bell}
            mode="my-day"
            onSelect={() => setSheet({ kind: "reminders" })}
            testId="alerts-your-reminders"
          />
        </ModeGroupedList>
        <AlertsBellPhoneSection reminders={reminders} onChange={setReminders} phone={alerts.state} shared={shared} />
        {/* What is locked sits in its own card, apart from what can be changed. */}
        <ModeGroupedList testId="alerts-locked">
          <AlertsQuietRow title="Mental Health Act timers" reason="Locked until clinical sign-off" />
          <AlertsQuietRow title="Rest-break warnings" reason="Locked until clinical sign-off" />
          <AlertsQuietRow title="CPD coaching" reason="Locked until clinical sign-off" />
          <AlertsQuietRow title="Medicine supply notices" reason="Locked until clinical sign-off" />
        </ModeGroupedList>
        {rosterError ? (
          <p role="status" className="px-3 text-sm text-[color:var(--text-muted)]">
            {rosterError}
          </p>
        ) : null}
      </div>

      <ModeGroupedList eyebrow="Quiet hours" testId="alerts-quiet" className="lg:col-start-1 lg:row-start-2">
        <AlertsButtonRow
          title="Quiet hours"
          subtitle={quiet.enabled ? `${quiet.start} to ${quiet.end}, Perth time` : "Off"}
          onSelect={() => setSheet({ kind: "quiet" })}
          toggle={{
            enabled: quiet.enabled,
            label: "Quiet hours",
            onToggle: () => setReminders({ ...reminders, quietHours: { ...quiet, enabled: !quiet.enabled } }),
          }}
          testId="alerts-quiet-row"
        />
        <ModeRow
          title="Quiet while on a night"
          subtitle="Swap and open-shift requests don't buzz during a night shift"
          trailing={ALWAYS_ON}
        />
        {reminders.bellPhone.enabled ? (
          <ModeRow
            title="Bell reminders wait"
            subtitle="One due in quiet hours buzzes when they end"
            trailing={ALWAYS_ON}
          />
        ) : null}
        <ModeRow
          title="Your own reminders come through"
          subtitle="At the exact time you set, even in quiet hours"
          trailing={ALWAYS_ON}
        />
        <ModeRow
          title="Roster changes come through"
          subtitle="Even during a night shift, so a changed shift is never missed"
          trailing={ALWAYS_ON}
        />
      </ModeGroupedList>

      <div className="min-w-0 lg:col-start-1 lg:row-start-3">
        <AlertsDeviceSection alerts={alerts} shared={shared} />
        {!inFrame && routeVisible(EARLIER_ALERTS_HREF) ? (
          <ModeGroupedList testId="alerts-earlier" className="mt-2">
            <ModeRow
              title="Earlier alerts"
              subtitle="What buzzed this phone, last 7 days"
              href={EARLIER_ALERTS_HREF}
              testId="alerts-earlier-row"
            />
          </ModeGroupedList>
        ) : null}
      </div>

      <AlertsAreaSheet
        area={sheet?.kind === "area" ? sheet.area : null}
        open={sheet?.kind === "area"}
        onClose={() => setSheet(null)}
        reminders={reminders}
        onRemindersChange={setReminders}
        roster={rosterChoices}
        rosterReady={roster.status === "ready"}
        rosterMessage={rosterError}
        onRosterChange={(which) => void changeRoster(which)}
        device={alerts.device}
        today={today}
      />
      <AlertsQuietHoursSheet
        open={sheet?.kind === "quiet"}
        onClose={() => setSheet(null)}
        reminders={reminders}
        onChange={setReminders}
      />
      <YourRemindersSheet
        open={sheet?.kind === "reminders"}
        onClose={() => setSheet(null)}
        now={now}
        onAdd={() => setSheet({ kind: "remind-me" })}
      />
      {/* The Alerts page reads no roster, so "End of shift" is not offered here; My Day will offer it once it shows reminders. */}
      <RemindMeSheet
        open={sheet?.kind === "remind-me"}
        onClose={() => setSheet({ kind: "reminders" })}
        now={now}
        shiftEndsAt={null}
      />
      <AlertsBriefSheet
        open={sheet?.kind === "brief"}
        onClose={() => setSheet(null)}
        reminders={reminders}
        onChange={setReminders}
        phoneOn={alerts.state === "on"}
      />
      <AlertsDailyLimitSheet
        open={sheet?.kind === "limit"}
        onClose={() => setSheet(null)}
        reminders={reminders}
        onChange={setReminders}
      />
    </div>
  );
}
