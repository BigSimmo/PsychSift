"use client";

import { managerWaiting, RosterWaitingBadge } from "@/components/roster/manage/roster-manage-waiting";
import { useState } from "react";

import { usePhoneAlerts } from "@/components/alerts/use-phone-alerts";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { useRosterSettings } from "@/components/roster/use-roster-settings";
import { formatPerthDay } from "@/lib/roster/shifts/perth-time";
import type { RosterTeam } from "@/lib/roster/team/model";

/** Can appear on the join screen as well as Settings. */
export function RosterAlertsSwitch() {
  const alerts = usePhoneAlerts();
  if (!alerts.configured) return null;
  return (
    <span className="grid justify-items-end gap-1">
      <ToggleSwitch
        enabled={alerts.enabled}
        disabled={alerts.busy}
        onToggle={() => void alerts.toggle()}
        aria-label="Alerts on this phone"
      />
      {alerts.message ? (
        <span role="status" className="max-w-48 text-right text-xs text-[color:var(--text-muted)]">
          {alerts.message}
        </span>
      ) : null}
    </span>
  );
}

function TeamRow({ team, actorId }: { team: RosterTeam; actorId: string | null }) {
  const overview = useRosterRead(team.enabled ? team.serviceId : null, "overview");
  const manager = overview.data?.managers
    ?.map((person) => person.name)
    .filter(Boolean)
    .join(", ");
  const ends = overview.data?.me.rotationEndsOn;
  const isManager = team.role === "manager" && team.enabled;
  const manage = useRosterRead(isManager ? team.serviceId : null, "manage");
  // Counted as Manage shows them: the manager's own swaps are left out, because the server refuses them.
  const waiting = manage.data ? managerWaiting(manage.data, { decisionsInStrip: true, actorId }).count : 0;
  const subtitle = [manager ? `manager ${manager}` : null, ends ? `to ${formatPerthDay(ends)}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <ModeRow
        title={team.name}
        subtitle={subtitle || (team.enabled ? "Confirmed team" : "Not confirmed yet")}
        href={team.enabled ? "/roster/team" : undefined}
      />
      {isManager ? (
        <ModeRow
          title={
            <>
              Manage
              <RosterWaitingBadge count={waiting} />
            </>
          }
          href="/roster/manage"
          testId="roster-settings-manage"
        />
      ) : null}
    </>
  );
}

/** Settings: phone switch, category choices and confirmed teams in words. */
export function RosterAlertsSection() {
  const alerts = usePhoneAlerts();
  const settings = useRosterSettings();
  const teams = useRosterTeams();
  const [error, setError] = useState<string | null>(null);
  const preferences = settings.settings.alerts;

  async function change(which: "changes" | "requests") {
    const failure = await settings.update({ alerts: { ...preferences, [which]: !preferences[which] } });
    setError(failure);
  }

  return (
    <div className="grid gap-5">
      {alerts.configured ? (
        <ModeGroupedList eyebrow="Alerts">
          <ModeRow
            title="Alerts on this phone"
            trailing={
              <ToggleSwitch
                enabled={alerts.enabled}
                disabled={alerts.busy}
                onToggle={() => void alerts.toggle()}
                aria-label="Alerts on this phone"
              />
            }
          />
          <ModeRow
            title="Roster changes"
            trailing={
              <ToggleSwitch
                enabled={preferences.changes}
                disabled={settings.status !== "ready"}
                onToggle={() => void change("changes")}
                aria-label="Roster changes"
              />
            }
          />
          <ModeRow
            title="Swap and open-shift requests"
            trailing={
              <ToggleSwitch
                enabled={preferences.requests}
                disabled={settings.status !== "ready"}
                onToggle={() => void change("requests")}
                aria-label="Swap and open-shift requests"
              />
            }
          />
          <ModeRow
            title="All alerts"
            subtitle="Every area, quiet hours and this phone"
            href="/my-day/alerts"
            testId="roster-settings-all-alerts"
          />
        </ModeGroupedList>
      ) : null}
      {alerts.message || error ? (
        <p role="status" className="text-sm text-[color:var(--text-muted)]">
          {alerts.message ?? error}
        </p>
      ) : null}
      <ModeGroupedList eyebrow="Your team">
        {teams.data?.teams?.length ? (
          teams.data.teams.map((team) => (
            <TeamRow key={team.serviceId} team={team} actorId={teams.data?.actorId ?? null} />
          ))
        ) : (
          <ModeRow title={teams.status === "loading" ? "Checking your teams…" : "No team yet"} />
        )}
      </ModeGroupedList>
    </div>
  );
}
