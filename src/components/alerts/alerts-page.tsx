"use client";

import { useState } from "react";

import { AlertsDeviceSection } from "@/components/alerts/alerts-device-section";
import { AlertsButtonRow, AlertsQuietRow, AreaDot } from "@/components/alerts/alerts-rows";
import { AlertsAreaSheet, AlertsDailyLimitSheet, AlertsQuietHoursSheet } from "@/components/alerts/alerts-sheets";
import { RemindMeSheet, YourRemindersSheet } from "@/components/alerts/remind-me-sheet";
import { usePhoneAlerts } from "@/components/alerts/use-phone-alerts";
import { useRemindMe } from "@/components/alerts/use-remind-me";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeStateLabel } from "@/components/mode-kit/state-label";
import { MyDayFrame } from "@/components/my-day/my-day-frame";
import { useRosterSettings } from "@/components/roster/use-roster-settings";
import { ALERT_AREA_IDS, ALERT_AREAS, areaSummary, type AlertAreaId } from "@/lib/alerts/areas";
import { useSharedDevice } from "@/lib/alerts/shared-device";
import { perthDateKey, type ReminderSettings } from "@/lib/reminders/settings";

/**
 * My Day › Alerts: one place for every alert the app can send, built from the
 * "PsychSift Alerts" mock-up (screens 8 to 13). It is used by a tired doctor
 * on a phone, often at 3 am and on poor wifi, to answer two questions: "will
 * this buzz me?" and "why didn't it?". So every line says what the app will
 * actually do today; what is not built yet is shown greyed with the reason.
 */
export function AlertsPage({ now }: { now?: Date } = {}) {
  return (
    <MyDayFrame
      title="Alerts"
      testId="my-day-alerts"
      now={now}
      wide
      subtitle={() => "What can reach your phone, and when"}
      signedOut={{
        title: "Sign in to get alerts",
        body: "Alerts come from your own roster and records, so they need your account. Nothing is sent to this device while you're signed out.",
      }}
    >
      {(at) => <AlertsBody now={at} />}
    </MyDayFrame>
  );
}

type OpenSheet =
  | { kind: "area"; area: AlertAreaId }
  | { kind: "quiet" }
  | { kind: "limit" }
  | { kind: "reminders" }
  | { kind: "remind-me" }
  | null;

function AlertsBody({ now }: { now: Date }) {
  const { preferences, setPreference } = useAppPreferences();
  const reminders = preferences.reminders;
  const roster = useRosterSettings();
  const alerts = usePhoneAlerts();
  const shared = useSharedDevice();
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
        <AlertsQuietRow
          title="Morning brief"
          reason="One alert instead of many · arrives with the next update"
          testId="alerts-brief-row"
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
              subtitle={
                <>
                  <AreaDot mode={ALERT_AREAS[id].mode} />
                  {areaSummary(id, reminders, today, rosterChoices)}
                </>
              }
              onSelect={() => setSheet({ kind: "area", area: id })}
              testId={`alerts-area-${id}`}
            />
          ))}
          <AlertsButtonRow
            title="Your reminders"
            subtitle={
              openNotes ? `${openNotes} listed here · kept on this device` : "Listed here · kept on this device"
            }
            onSelect={() => setSheet({ kind: "reminders" })}
            testId="alerts-your-reminders"
          />
          <AlertsQuietRow title="Open shifts" reason="Arrives with Open shifts" testId="alerts-area-open-shifts" />
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
          testId="alerts-quiet-row"
        />
        <ModeRow
          title="Quiet while on a night"
          subtitle="Swap and open-shift requests don't buzz during a night shift"
          trailing={
            <span className="pr-3">
              <ModeStateLabel>Always on</ModeStateLabel>
            </span>
          }
        />
        <ModeRow
          title="Roster changes come through"
          subtitle="Even during a night shift, so a changed shift is never missed"
          trailing={
            <span className="pr-3">
              <ModeStateLabel>Always on</ModeStateLabel>
            </span>
          }
        />
      </ModeGroupedList>

      <div className="min-w-0 lg:col-start-1 lg:row-start-3">
        <AlertsDeviceSection alerts={alerts} shared={shared} />
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
      <AlertsDailyLimitSheet
        open={sheet?.kind === "limit"}
        onClose={() => setSheet(null)}
        reminders={reminders}
        onChange={setReminders}
      />
    </div>
  );
}
