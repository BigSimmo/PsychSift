"use client";

import { currentCover } from "@/lib/on-call/service-availability";
import { useHospitalClock } from "@/components/on-call/use-hospital-clock";
import Link from "next/link";
import { CalendarDays, ChevronRight, Users } from "lucide-react";
import { useMemo } from "react";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { OnCallDialRow } from "@/components/on-call/kit/dial-row";
import { OnCallGroupedList } from "@/components/on-call/kit/grouped-list";
import { OnCallHandbookState } from "@/components/on-call/kit/handbook-state";
import { OnCallHospitalLine } from "@/components/on-call/kit/hospital-line";
import { OnCallHubPageFrame } from "@/components/on-call/kit/hub-page-frame";
import { OnCallStateLabel } from "@/components/on-call/kit/state-label";
import { allocateOnCallGroupSlug, onCallGroupAnchorId } from "@/components/on-call/on-call-page-anchors";
import { onCallWhosOnSections } from "@/components/on-call/on-call-page-sections";
import { useHospitalHandbook } from "@/components/on-call/use-hospital-handbook";
import { Select } from "@/components/ui/select";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import { compareOnCallTeams, ON_CALL_TEAMS, type OnCallTeam } from "@/lib/on-call/handbook-title";
import { saveOnCallMyTeam, useOnCallMyTeam } from "@/lib/on-call/my-team-storage";
import { ON_CALL_AFTER_HOURS_MANAGER } from "@/lib/on-call/now-rows";

const NO_TEAM = "";

type TeamGroup = { readonly team: OnCallTeam; readonly rows: readonly HandbookItem[] };

/** The hospital's contacts that name a team, grouped by team: the reader's first, then the usual order. */
function teamGroups(items: readonly HandbookItem[], myTeam: OnCallTeam | null): TeamGroup[] {
  const contacts = items.filter((item) => item.section === "cover");
  return [...new Set(contacts.flatMap((item) => (item.parsed.team ? [item.parsed.team] : [])))]
    .map((team) => ({ team, rows: contacts.filter((item) => item.parsed.team === team) }))
    .filter((group) => group.rows.length > 0)
    .sort((a, b) => Number(b.team === myTeam) - Number(a.team === myTeam) || compareOnCallTeams(a.team, b.team));
}

/**
 * Who's on (hidden from the pages sheet while `ON_CALL_WHOS_ON_ENABLED` is off;
 * reachable by URL). The hospital's roles by team, under the hospital's name,
 * with the reader's own team first. Roles only: the handbook holds no names.
 *
 * Contacts with no team and no prefix go in a last "Other" group, only when
 * there are any. A team with no rows is not drawn; when it is the reader's own,
 * the page says it is not set up for this hospital instead of an empty list.
 */
export function OnCallWhosOnPage({ now: pinned }: { now?: Date } = {}) {
  const now = useHospitalClock(pinned);
  const handbook = useHospitalHandbook();
  const myTeam = useOnCallMyTeam();
  const ready = handbook.status === "ready";
  const items = useMemo(() => (ready ? currentCover(handbook.items, now) : []), [ready, handbook.items, now]);
  const hospitalName = handbook.siteName ?? handbook.serviceName;

  const groups = useMemo(() => teamGroups(items, myTeam), [items, myTeam]);
  const other = useMemo(
    () => items.filter((item) => item.section === "cover" && !item.parsed.team && !item.parsed.prefix),
    [items],
  );
  const sections = useMemo(
    () =>
      onCallWhosOnSections(
        groups.map((group) => ({ team: group.team, count: group.rows.length })),
        myTeam,
      ),
    [groups, myTeam],
  );
  // The anchors in the order `onCallWhosOnSections` allocates them, so the
  // section bar's links land on these groups.
  const anchors = useMemo(() => {
    const taken = new Set<string>();
    const byTeam = new Map(
      groups.map((group) => [group.team, onCallGroupAnchorId(allocateOnCallGroupSlug(group.team, taken))]),
    );
    return { byTeam, other: onCallGroupAnchorId(allocateOnCallGroupSlug("Other", taken)) };
  }, [groups]);

  const teamOptions = useMemo(() => {
    const names = new Set<OnCallTeam>([
      ...ON_CALL_TEAMS,
      ...items.flatMap((item) => (item.parsed.team ? [item.parsed.team] : [])),
    ]);
    names.delete(ON_CALL_AFTER_HOURS_MANAGER);
    return [...names].sort(compareOnCallTeams);
  }, [items]);
  const myTeamMissing = ready && myTeam !== null && !groups.some((group) => group.team === myTeam);

  return (
    <OnCallHubPageFrame
      page="whos-on"
      sections={sections}
      lead={<OnCallHospitalLine handbook={handbook} testId="on-call-hub-hospital" />}
    >
      <OnCallHandbookState handbook={handbook} page="whos-on" />
      {/* Names come from the team roster on its own page (a new work mode screen); this page lists hospital roles. */}
      <NewWorkModeOnly>
        <Link
          href="/on-call/whos-on/roster"
          className={cn(
            focusRing,
            "mx-3 flex min-h-12 items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-2 text-sm font-medium text-[color:var(--text-heading)]",
          )}
          data-testid="on-call-whos-on-roster-link"
        >
          <CalendarDays
            aria-hidden="true"
            strokeWidth={1.5}
            className="size-icon-sm shrink-0 text-[color:var(--text-muted)]"
          />
          <span className="min-w-0 flex-1">Names from your team roster</span>
          <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
        </Link>
      </NewWorkModeOnly>
      {ready ? null : <OnCallCrisisLines />}
      {ready ? (
        <>
          {!items.length ? (
            <p className="px-3 text-sm">No published cover for this time. Cover is unknown; check with switchboard.</p>
          ) : null}
          <div className="px-3">
            <Select
              label="My team"
              value={myTeam ?? NO_TEAM}
              onChange={(event) => saveOnCallMyTeam(event.target.value === NO_TEAM ? null : event.target.value)}
              options={[
                ...teamOptions.map((team) => ({ value: team, label: team })),
                { value: NO_TEAM, label: "No team" },
              ]}
              className="min-h-12"
              data-testid="on-call-whos-on-my-team"
            />
          </div>
          {myTeamMissing ? (
            <OnCallGroupedList eyebrow={myTeam ?? undefined} headerIcon={Users} testId="on-call-whos-on-my-team-empty">
              <li className="flex min-h-12 items-center px-3">
                <OnCallStateLabel state={{ kind: "not-set-up" }} />
              </li>
            </OnCallGroupedList>
          ) : null}
          {groups.map((group) => (
            <OnCallGroupedList
              key={group.team}
              eyebrow={group.team}
              headerIcon={Users}
              id={anchors.byTeam.get(group.team)}
              testId={`on-call-whos-on-team-${group.team}`}
            >
              {group.rows.map((item) => (
                <OnCallDialRow
                  key={item.id}
                  id={item.id}
                  source="handbook"
                  title={item.parsed.label}
                  subtitle={
                    item.cover
                      ? `${item.cover.window.start}–${item.cover.window.end} · roles near changeover may overlap`
                      : undefined
                  }
                  dial={item.dial}
                  mobileDial={item.mobileDial}
                  updatedAt={item.updatedAt}
                  lastConfirmedAt={item.lastConfirmedAt}
                  sources={item.sources}
                  hospitalName={hospitalName}
                  testId={`on-call-whos-on-row-${item.id}`}
                />
              ))}
            </OnCallGroupedList>
          ))}
          {other.length > 0 ? (
            <OnCallGroupedList eyebrow="Other" headerIcon={Users} id={anchors.other} testId="on-call-whos-on-other">
              {other.map((item) => (
                <OnCallDialRow
                  key={item.id}
                  id={item.id}
                  source="handbook"
                  title={item.parsed.label}
                  subtitle={
                    item.cover
                      ? `${item.cover.window.start}–${item.cover.window.end} · roles near changeover may overlap`
                      : undefined
                  }
                  dial={item.dial}
                  mobileDial={item.mobileDial}
                  updatedAt={item.updatedAt}
                  lastConfirmedAt={item.lastConfirmedAt}
                  sources={item.sources}
                  hospitalName={hospitalName}
                  testId={`on-call-whos-on-row-${item.id}`}
                />
              ))}
            </OnCallGroupedList>
          ) : null}
        </>
      ) : null}
    </OnCallHubPageFrame>
  );
}
