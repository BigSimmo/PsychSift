"use client";

import { Suspense, useCallback, useState } from "react";
import { InformationPageShell } from "@/components/information-page-shell";
import { Button } from "@/components/ui/button";
import { useRosterNow } from "@/components/roster/roster-format";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import type { RosterTeam } from "@/lib/roster/team/model";
import { TeamCalendar } from "@/components/roster/team/calendar/team-calendar";
import { RosterSampleNotice } from "@/components/roster/team/roster-sample-notice";
import { RosterManageNavHeader } from "./roster-manage-nav-header";
import { RosterApproveTab } from "./roster-approve-tab";
import { RosterCoverTab } from "./roster-cover-tab";
import { RosterPeopleList } from "./roster-people-list";
import { RosterTeamSettings } from "./roster-team-settings";
import { RosterPublishTab } from "./publish/roster-publish-tab";
import { ClipboardList } from "lucide-react";
import { RosterPageHeader, rosterField } from "@/components/roster/roster-ui";

function ManagerTeam({ team, actorId }: { team: RosterTeam; actorId: string | null }) {
  const { serviceId } = team;
  const now = useRosterNow();
  const overview = useRosterRead(serviceId, "overview");
  const [section, setSection] = useState("approve");
  // Waiting swaps and taken shifts are decided in one place: the calendar's
  // Needs you strip, inline and rechecked live. The Approve tab lists them
  // itself only while the strip is not showing (loading, or a manager read failed).
  const [stripShown, setStripShown] = useState(false);
  // One shared reload for the manager's swaps and open shifts: a decision in
  // the Approve tab or in the calendar's strip refreshes the other too. Each
  // side reloads itself and skips the round it started.
  const [manageRound, setManageRound] = useState({ round: 0, changedBy: "" });
  const manageChanged = useCallback(
    (changedBy: string) => setManageRound((current) => ({ round: current.round + 1, changedBy })),
    [],
  );
  if (overview.status === "error")
    return (
      <div role="alert">
        <p>{overview.message}</p>
        <Button onClick={overview.reload}>Try again</Button>
      </div>
    );
  if (!overview.data) return <p role="status">Loading your team…</p>;
  if (overview.data.me.role !== "manager") return <p>Only your team&apos;s roster manager can see this page.</p>;
  // Phones keep one column with the tabs first and the calendar below; from
  // `lg` the calendar sits on the left and the tabs on the right.
  return (
    <div className="mx-auto grid w-full max-w-reading gap-6 lg:max-w-none lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <div className="order-1 grid min-w-0 gap-6 lg:order-2">
        <RosterManageNavHeader activeId={section} onSelect={setSection} />
        {section === "approve" ? (
          <RosterApproveTab
            serviceId={serviceId}
            shared={{ ...manageRound, onChanged: manageChanged }}
            decisionsInStrip={stripShown}
            actorId={actorId}
            overview={overview.data}
          />
        ) : section === "cover" ? (
          <RosterCoverTab serviceId={serviceId} overview={overview.data} />
        ) : (
          <>
            <RosterPublishTab serviceId={serviceId} overview={overview.data} />
            <RosterPeopleList
              team={{
                serviceId,
                name: overview.data.service.name,
                enabled: true,
                role: "manager",
                grade: overview.data.me.grade,
              }}
            />
            <RosterTeamSettings serviceId={serviceId} overview={overview.data} />
          </>
        )}
      </div>
      <div
        data-testid="roster-manage-calendar"
        data-roster-print
        className="order-2 grid min-w-0 content-start gap-4 lg:order-1"
      >
        <Suspense fallback={<p role="status">Loading the team roster…</p>}>
          <TeamCalendar
            team={team}
            actorId={actorId}
            now={now}
            shared={{ ...manageRound, onChanged: manageChanged }}
            onManagerLayer={setStripShown}
          />
        </Suspense>
      </div>
    </div>
  );
}

export function RosterManagePage() {
  const teams = useRosterTeams();
  // A link from My Day names the team it is about (`?team=`); it only selects among the teams the reader may use.
  const [selected, setSelected] = useState(() =>
    typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("team") ?? ""),
  );
  const available = teams.data?.teams.filter((team) => team.enabled && team.role === "manager") ?? [];
  const team = available.find((item) => item.serviceId === selected) ?? available[0];
  return (
    <InformationPageShell>
      <div className="grid gap-4" data-mode-identity="roster">
        <RosterPageHeader
          icon={ClipboardList}
          eyebrow="Roster"
          title="Manage"
          subtitle={
            team ? `${team.name} · Cover, publishing and team settings.` : "Cover, publishing and team settings."
          }
          ask={false}
        />
        {teams.status === "loading" ? (
          <p role="status">Loading your teams…</p>
        ) : teams.status !== "ready" ? (
          <div role="alert">
            <p>{teams.message}</p>
            <Button onClick={teams.reload}>Try again</Button>
          </div>
        ) : !team ? (
          <p>Only your team&apos;s roster manager can see this page.</p>
        ) : (
          <>
            <RosterSampleNotice sample={teams.data?.sample} />
            {available.length > 1 ? (
              <label className="grid gap-1">
                Team
                <select
                  className={rosterField}
                  value={team.serviceId}
                  onChange={(event) => setSelected(event.target.value)}
                >
                  {available.map((team) => (
                    <option value={team.serviceId} key={team.serviceId}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <ManagerTeam key={team.serviceId} team={team} actorId={teams.data?.actorId ?? null} />
          </>
        )}
      </div>
    </InformationPageShell>
  );
}
