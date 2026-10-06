"use client";

import { ArrowLeftRight, Bell, ShieldCheck, Smartphone, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import { managerWaiting, RosterWaitingBadge } from "@/components/roster/manage/roster-manage-waiting";
import {
  RosterFootnote,
  RosterIconLead,
  RosterLinkWord,
  RosterList,
  RosterRow,
  RosterSectionHead,
} from "@/components/roster/roster-list";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { useRosterSettings } from "@/components/roster/use-roster-settings";
import { formatPerthDay } from "@/lib/roster/shifts/perth-time";
import type { RosterTeam } from "@/lib/roster/team/model";
import { usePhoneAlerts } from "@/components/alerts/use-phone-alerts";

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
  const sub = subtitle || (team.enabled ? "Confirmed team" : "Not confirmed yet");
  return (
    <>
      {team.enabled ? (
        <RosterRow lead={<RosterIconLead icon={Users} />} title={team.name} sub={sub} href="/roster/team" />
      ) : (
        <RosterRow lead={<RosterIconLead icon={Users} />} title={team.name} sub={sub} />
      )}
      {isManager ? (
        <RosterRow
          lead={<RosterIconLead icon={ShieldCheck} />}
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

/**
 * Settings: "Reminders and alerts", as the Roster mock-up draws it. The page
 * passes its evening-before reminder row in `reminder`, so it sits first in
 * the same list. The phone row is the push subscription itself; the two rows
 * after it choose which alerts that subscription carries.
 */
export function RosterAlertsSection({ reminder }: { readonly reminder?: ReactNode } = {}) {
  const alerts = usePhoneAlerts();
  const settings = useRosterSettings();
  const [error, setError] = useState<string | null>(null);
  const preferences = settings.settings.alerts;

  async function change(which: "changes" | "requests") {
    const failure = await settings.update({ alerts: { ...preferences, [which]: !preferences[which] } });
    setError(failure);
  }

  return (
    <section aria-labelledby="roster-settings-alerts-title" className="grid gap-3" data-testid="roster-settings-alerts">
      <RosterSectionHead id="roster-settings-alerts-title" title="Reminders and alerts" />
      <RosterList label="Reminders and alerts">
        {reminder}
        {alerts.configured ? (
          <>
            <RosterRow
              lead={<RosterIconLead icon={Smartphone} />}
              title="Alerts on this phone"
              sub="Turn on to get the alerts below"
              action={
                <ToggleSwitch
                  enabled={alerts.enabled}
                  disabled={alerts.busy}
                  onToggle={() => void alerts.toggle()}
                  aria-label="Alerts on this phone"
                />
              }
            />
            <RosterRow
              lead={<RosterIconLead icon={Bell} />}
              title="Roster changes"
              sub="Alert on this phone"
              action={
                <ToggleSwitch
                  enabled={preferences.changes}
                  disabled={settings.status !== "ready"}
                  onToggle={() => void change("changes")}
                  aria-label="Roster changes"
                />
              }
            />
            <RosterRow
              lead={<RosterIconLead icon={ArrowLeftRight} />}
              title="Swap and open-shift requests"
              sub="Alert on this phone"
              action={
                <ToggleSwitch
                  enabled={preferences.requests}
                  disabled={settings.status !== "ready"}
                  onToggle={() => void change("requests")}
                  aria-label="Swap and open-shift requests"
                />
              }
            />
          </>
        ) : null}
      </RosterList>
      {alerts.message || error ? (
        <p role="status" className="mx-1 text-sm text-[color:var(--text)]">
          {alerts.message ?? error}
        </p>
      ) : null}
      {alerts.configured ? (
        <RosterFootnote testId="roster-settings-alerts-note">
          Lock screen alerts say only that something changed, never who or which shift. On iPhone, add PsychSift to your
          home screen first.
        </RosterFootnote>
      ) : null}
    </section>
  );
}

/** Settings: the teams you belong to, and Manage for a rostering manager. */
export function RosterTeamsSection() {
  const teams = useRosterTeams();
  return (
    <section aria-labelledby="roster-settings-teams-title" className="grid gap-3" data-testid="roster-settings-teams">
      <RosterSectionHead id="roster-settings-teams-title" title="Your team" />
      <RosterList label="Your team">
        {teams.data?.teams?.length ? (
          teams.data.teams.map((team) => (
            <TeamRow key={team.serviceId} team={team} actorId={teams.data?.actorId ?? null} />
          ))
        ) : (
          <RosterRow
            lead={<RosterIconLead icon={Users} />}
            title={
              teams.status === "loading"
                ? "Checking your teams…"
                : teams.status === "error"
                  ? "Your teams could not be checked"
                  : "No team yet"
            }
            action={
              teams.status === "error" ? (
                <RosterLinkWord onClick={teams.reload} label="Try again, check your teams">
                  Try again
                </RosterLinkWord>
              ) : undefined
            }
          />
        )}
      </RosterList>
    </section>
  );
}
