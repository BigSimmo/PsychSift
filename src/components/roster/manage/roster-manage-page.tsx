"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { WithoutModeBand } from "@/components/mode-band/mode-band";
import { InformationPageShell } from "@/components/information-page-shell";
import { Button } from "@/components/ui/button";
import { WorkStateLoading } from "@/components/mode-kit/work-state";
import { useRosterNow } from "@/components/roster/roster-format";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import type { RosterTeam } from "@/lib/roster/team/model";
import { TeamCalendar } from "@/components/roster/team/calendar/team-calendar";
import { RosterManageNavHeader } from "./roster-manage-nav-header";
import { RosterApproveTab } from "./roster-approve-tab";
import { RosterCoverTab } from "./roster-cover-tab";
import { RosterPeopleList } from "./roster-people-list";
import { RosterTeamSettings } from "./roster-team-settings";
import { RosterPublishTab } from "./publish/roster-publish-tab";
import { ClipboardList, Lock, Users } from "lucide-react";
import { WorkButton, WorkCard, WorkEmpty } from "@/components/mode-kit/work";
import { RosterPageHeader, rosterField } from "@/components/roster/roster-ui";

/**
 * The page's three views follow the address (`?view=cover`, `?view=team`), so
 * the work frame's tabs for Manage team (Inbox, Cover, Team) pick them
 * (navigation follow-up, owner request 7 Oct 2026). The page's own section
 * menu shows only where the frame is not drawn, and moves the address too.
 */
function sectionFor(view: string | null): string {
  return view === "cover" ? "cover" : view === "team" ? "roster" : "approve";
}

const viewForSection: Readonly<Record<string, string | null>> = { approve: null, cover: "cover", roster: "team" };

function useManageSection(): [string, (id: string) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const section = sectionFor(params?.get("view") ?? null);
  const select = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params?.toString() ?? "");
      const view = viewForSection[id] ?? null;
      if (view) next.set("view", view);
      else next.delete("view");
      const query = next.toString();
      router.replace(query ? `/roster/manage?${query}` : "/roster/manage", { scroll: false });
    },
    [params, router],
  );
  return [section, select];
}

/** Not a roster manager here: say so, and offer the doctor's own way on instead of a blank page. */
function NotManager() {
  return (
    <WorkCard testId="roster-manage-not-manager">
      <WorkEmpty
        icon={Lock}
        title="For roster managers"
        body="Only your team's roster manager can see this page."
        action={
          <WorkButton icon={Users} href="/roster/team">
            Go to Team
          </WorkButton>
        }
      />
    </WorkCard>
  );
}

function ManagerTeam({ team, actorId }: { team: RosterTeam; actorId: string | null }) {
  const { serviceId } = team;
  const now = useRosterNow();
  const overview = useRosterRead(serviceId, "overview");
  const [section, setSection] = useManageSection();
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
  if (!overview.data) return <WorkStateLoading label="Loading your team…" />;
  if (overview.data.me.role !== "manager") return <NotManager />;
  // Phones keep one column with the tabs first and the calendar below; from
  // `lg` the calendar sits on the left and the tabs on the right.
  return (
    <div className="mx-auto grid w-full max-w-reading grid-cols-[minmax(0,1fr)] gap-6 lg:max-w-none lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <div className="order-1 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:order-2">
        <WithoutModeBand>
          <RosterManageNavHeader activeId={section} onSelect={setSection} />
        </WithoutModeBand>
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
        className="order-2 grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 lg:order-1"
      >
        <Suspense fallback={<WorkStateLoading label="Loading the team roster…" />}>
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
  // A named team the reader does not manage says so, rather than quietly opening another team they do.
  const team = selected ? available.find((item) => item.serviceId === selected) : available[0];
  return (
    <InformationPageShell>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4" data-mode-identity="roster">
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
          <WorkStateLoading label="Loading your teams…" />
        ) : teams.status !== "ready" ? (
          <div role="alert">
            <p>{teams.message}</p>
            <Button onClick={teams.reload}>Try again</Button>
          </div>
        ) : !team && available.length > 0 ? (
          <WorkCard testId="roster-manage-not-your-team">
            <WorkEmpty
              icon={Lock}
              title="That team isn't one you manage"
              body="Pick one of your own teams instead."
              action={
                <WorkButton icon={Users} onClick={() => setSelected(available[0]!.serviceId)}>
                  {`Open ${available[0]!.name}`}
                </WorkButton>
              }
            />
          </WorkCard>
        ) : !team ? (
          <NotManager />
        ) : (
          <>
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
            <Suspense fallback={<WorkStateLoading label="Loading your team…" />}>
              <ManagerTeam key={team.serviceId} team={team} actorId={teams.data?.actorId ?? null} />
            </Suspense>
          </>
        )}
      </div>
    </InformationPageShell>
  );
}
