"use client";

import { CalendarDays, Clock, Download, Network, Plus, Upload, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { TeachingSupervisionAdmin } from "@/components/teaching/teaching-supervision-admin";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { WorkButton } from "@/components/mode-kit/work";
import {
  changeBody,
  csvHref,
  csvText,
  expectedMemberCount,
  riskPhrase,
  sentChangeLines,
  sentChanges,
  seriesMeta,
  sessionRisks,
  type GroupRow,
  type OrganiseRead,
  type SentChange,
  type SeriesRow,
} from "@/components/teaching/organise-model";
import {
  AttendanceGapsSheet,
  ChangeSheet,
  GroupSheet,
  InviteSheet,
  MembersSheet,
  membersWord,
  PickSessionSheet,
  SeriesSheet,
} from "@/components/teaching/organise-sheets";
import {
  T5Done,
  T5Empty,
  T5Icon,
  T5LiveDot,
  T5Link,
  T5List,
  T5Meta,
  T5Note,
  T5Page,
  T5Row,
  T5Section,
  T5Time,
} from "@/components/teaching/t5-kit";
import { addDays, dayParts, perthDateKey, perthTime } from "@/components/teaching/teaching-dates";
import { TeachingUndoBar } from "@/components/teaching/teaching-row";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { useDelayedPost } from "@/components/teaching/use-delayed-post";
import { useSessionDetail } from "@/components/teaching/use-session-detail";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { useTeachingWeek } from "@/components/teaching/use-teaching-week";
import { Select } from "@/components/ui/select";
import { teachingErrorMessage, teachingGet, teachingServiceUrl } from "@/lib/teaching/client";
import { demoOrganise } from "@/lib/teaching/demo-organise";
import {
  attendanceLabels,
  memberLabel,
  type ExportRow,
  type SessionSummary,
  type TeamSummary,
} from "@/lib/teaching/model";

/*
 * Organise, for a service's organisers and admins (the server refuses anyone
 * else regardless). Only services the reader organises are offered, and
 * `organise.read` is asked only for the chosen one of those, so an organiser
 * at one hospital never opens an editor against another (review focus 4).
 * A posted change waits 10 seconds under Undo, then goes with `keepalive`.
 */
type Open =
  | { kind: "change"; session: SessionSummary }
  | { kind: "series"; series: SeriesRow | null }
  | { kind: "group"; group: GroupRow | null }
  | { kind: "members" }
  | { kind: "invite" }
  | { kind: "pick" }
  | { kind: "attendance-gaps" }
  | null;

const HOUR = 3_600_000;
const organises = (team: TeamSummary) => team.role === "organiser" || team.role === "admin";

/** The service row: the one you organise, or a select for two or more. Never "All services". */
function ServicePicker({
  teams,
  value,
  onChange,
}: {
  teams: readonly Pick<TeamSummary, "id" | "name">[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <T5List ruled testId="teaching-organise-service">
      {teams.length === 1 ? (
        <T5Row
          title={teams[0].name}
          meta="You organise · only organisers see this page"
          lead={<T5Icon icon={Network} />}
        />
      ) : (
        <li className="flex min-h-12 items-center gap-3 py-2">
          <T5Icon icon={Network} />
          <Select
            label="Service you organise"
            hideLabel
            value={value}
            onChange={(event) => onChange(event.target.value)}
            options={teams.map((team) => ({ value: team.id, label: team.name }))}
            fieldClassName="min-w-0 max-w-full flex-1"
          />
        </li>
      )}
    </T5List>
  );
}

const dayWord = (iso: string, today: string) => {
  const key = perthDateKey(iso);
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  return dayParts(key).weekday;
};

type SoonSession = SessionSummary & { checkedIn?: number };

/** What the organiser screen draws: the real service's reads, or the made-up demo service. */
type OrganiserScreen = {
  demo: boolean;
  serviceId: string;
  /** This service's own sessions in the coming week. */
  mine: SessionSummary[];
  soon: SoonSession[];
  data: OrganiseRead;
  changes: SentChange[];
};

const DEMO_NOT_SAVED = "Demo only. Nothing was saved or sent.";

function TeachingOrganiseContent({ demoMode }: { demoMode: boolean }) {
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const range = useMemo(() => (today ? { from: today, to: addDays(today, 6) } : null), [today]);
  const view = useTeachingWeek(range, { demoMode }, now);
  const teams = useMemo(() => (view.week?.teams ?? []).filter(organises), [view.week]);
  const [chosen, setChosen] = useState<string | null>(null);
  const serviceId = teams.some((t) => t.id === chosen) ? chosen : (teams[0]?.id ?? null);
  const organise = useTeachingResource<OrganiseRead>(
    serviceId && !demoMode ? teachingServiceUrl(serviceId, { action: "organise.read" }) : null,
  );
  const demo = useMemo(() => (demoMode && now ? demoOrganise(now) : null), [demoMode, now]);
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const delayed = useDelayedPost();
  // R9: the change reaches the session's series' groups, and the occurrence read names its series.
  const changing = open?.kind === "change" ? open.session : null;
  const changingDetail = useSessionDetail(demoMode ? null : (changing?.occurrenceId ?? null), demoMode, now);

  let screen: OrganiserScreen | null = null;
  let body;
  if (view.status === "signed-out") body = <TeachingSignInNotice />;
  else if (view.status === "offline" || view.status === "error" || view.status === "setup")
    body = <TeachingStateNotice state={view.status} onRetry={view.retry} />;
  else if (!now || !view.week) body = <ModeModuleSkeleton rows={4} eyebrow />;
  else if (demoMode && demo)
    screen = {
      demo: true,
      serviceId: demo.service.id,
      mine: demo.soon,
      soon: demo.soon,
      data: demo.read,
      changes: demo.changes,
    };
  else if (teams.length === 0 || !serviceId)
    body = <T5Note className="mt-0">Organise is for your service&apos;s organisers.</T5Note>;
  else if (organise.status === "loading" || organise.status === "idle") body = <ModeModuleSkeleton rows={4} eyebrow />;
  else if (organise.status !== "ready" || !organise.data)
    body = (
      <TeachingStateNotice
        state={organise.status === "offline" || organise.status === "setup" ? organise.status : "error"}
        onRetry={organise.retry}
      />
    );
  else {
    const mine = view.week.sessions.filter((s) => s.serviceId === serviceId);
    screen = {
      demo: false,
      serviceId,
      mine,
      soon: mine.filter(
        (s) => Date.parse(s.startsAt) < now.getTime() + 48 * HOUR && Date.parse(s.endsAt) > now.getTime(),
      ),
      data: organise.data,
      changes: sentChanges(mine),
    };
  }

  if (screen && now) {
    const { data, mine, soon, changes } = screen;
    const isDemo = screen.demo;
    const service = screen.serviceId;
    const todayKey = perthDateKey(now);
    const soonIds = new Set(soon.map((s) => s.occurrenceId));
    const risks = sessionRisks(mine).filter((r) => soonIds.has(r.occurrenceId));
    // At most one amber mark in the list: the first risk, in time order.
    const firstRisk = soon.flatMap((s) => risks.filter((r) => r.occurrenceId === s.occurrenceId))[0] ?? null;
    const changeable = mine.filter(
      (s) => s.status !== "cancelled" && s.source === "teaching" && Date.parse(s.endsAt) > now.getTime(),
    );
    const refresh = () => {
      view.retry();
      organise.retry();
    };
    const saved = () => {
      setOpen(null);
      if (isDemo) setNotice(DEMO_NOT_SAVED);
      else refresh();
    };
    const reach =
      !isDemo && changing && changingDetail.status === "ready"
        ? expectedMemberCount(data, changingDetail.data?.seriesId ?? null)
        : data.members.length;

    async function download() {
      if (downloading) return;
      if (isDemo) {
        setNotice("Example only. The example service has no attendance to download.");
        return;
      }
      const to = perthDateKey(now!);
      const from = addDays(to, -83);
      setNotice(null);
      setDownloading(true);
      try {
        const result = await teachingGet<{ rows: ExportRow[] }>(
          teachingServiceUrl(service, { action: "export.attendance", from, to }),
        );
        const link = document.createElement("a");
        link.href = csvHref(
          csvText(
            ["Date", "Time", "Session", "Name", "How"],
            result.rows.map((r) => [
              perthDateKey(r.startsAt),
              perthTime(r.startsAt),
              r.title,
              memberLabel(r),
              attendanceLabels[r.method],
            ]),
          ),
        );
        link.download = "teaching-attendance-export.csv";
        link.click();
      } catch (cause) {
        setNotice(teachingErrorMessage(cause));
      } finally {
        setDownloading(false);
      }
    }

    // Phone order follows the mock-up: 48 hours, series, groups, changes, tools. On a computer the
    // left column keeps what needs checking and what changed; series, groups and tools sit right.
    const left = "min-w-0 lg:col-start-1";
    const right = "min-w-0 lg:col-start-2";
    body = (
      <>
        <div className="grid gap-x-8 lg:grid-flow-dense lg:grid-cols-2 lg:items-start">
          <div className={left}>
            {/* Work-mode redesign, owner request 6 Oct 2026: a labelled list like every other section,
                not a list boxed inside a second card. */}
            <T5Section
              className="mt-3"
              testId="teaching-organise-soon"
              label={`Next 48 hours · ${soon.length}`}
              right={
                risks.length ? (
                  <span className="text-[color:var(--warning-text)]">
                    <span className="sr-only"> · </span>
                    {`${risks.length} to check`}
                  </span>
                ) : undefined
              }
            >
              {soon.length > 0 ? (
                <T5List>
                  {soon.map((s) => {
                    const risk = firstRisk?.occurrenceId === s.occurrenceId ? firstRisk : null;
                    const live = Date.parse(s.startsAt) <= now.getTime();
                    const day = dayWord(s.startsAt, todayKey);
                    const change =
                      delayed.pending || s.status === "cancelled" || s.source !== "teaching"
                        ? undefined
                        : () => setOpen({ kind: "change", session: s });
                    const ready =
                      !live && s.status !== "cancelled" && !risks.some((r) => r.occurrenceId === s.occurrenceId);
                    const meta = risk ? (
                      <span className="font-medium text-[color:var(--warning-text)]">
                        {day} · {riskPhrase(risk)}
                      </span>
                    ) : live ? (
                      <span className="inline-flex items-center">
                        <T5LiveDot />
                        {[
                          "On now",
                          s.checkedIn !== undefined ? `${s.checkedIn} checked in` : null,
                          s.checkedIn === undefined ? (s.venue ?? (s.hasJoinLink ? "Online" : null)) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : (
                      [
                        day,
                        s.status === "cancelled" ? "Cancelled" : s.status === "moved" ? "Moved" : null,
                        s.venue ?? (s.hasJoinLink ? "Online" : null),
                        ready ? "ready" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    );
                    return (
                      <T5Row
                        key={s.occurrenceId}
                        testId={`teaching-row-${s.occurrenceId}`}
                        title={s.title}
                        meta={meta}
                        lead={<T5Time time={perthTime(s.startsAt)} />}
                        onClick={risk ? undefined : change}
                        end={
                          risk && change ? (
                            <WorkButton variant={risk.rule === "room" ? "primary" : "quiet"} onClick={change}>
                              {risk.rule === "room" ? "Set room" : "Fix"}
                            </WorkButton>
                          ) : ready ? (
                            <T5Done label="Ready" />
                          ) : undefined
                        }
                      />
                    );
                  })}
                </T5List>
              ) : (
                <T5Empty>Nothing in the next 48 hours.</T5Empty>
              )}
            </T5Section>
            {notice ? (
              <T5Note tone={isDemo ? "notice" : "warning"} icon={isDemo ? "info" : "alert"} className="mt-3">
                {notice}
              </T5Note>
            ) : null}
          </div>
          <div className={right}>
            <T5Section
              label={`Series · ${data.series.length}`}
              right={<T5Link onClick={() => setOpen({ kind: "series", series: null })}>New series</T5Link>}
            >
              <T5List ruled testId="teaching-organise-series">
                {data.series.map((s) => (
                  <T5Row
                    key={s.seriesId}
                    title={s.title}
                    meta={seriesMeta(s)}
                    lead={<T5Icon icon={CalendarDays} />}
                    onClick={() => setOpen({ kind: "series", series: s })}
                  />
                ))}
                {data.series.length === 0 ? (
                  <li className="py-2.5">
                    <T5Meta>No series yet. Add one, or import a timetable.</T5Meta>
                  </li>
                ) : null}
              </T5List>
            </T5Section>
          </div>
          <div className={right}>
            <T5Section
              label="Groups and members"
              right={<T5Link onClick={() => setOpen({ kind: "group", group: null })}>New group</T5Link>}
            >
              <T5List ruled testId="teaching-organise-people">
                {data.groups.map((g) => (
                  <T5Row
                    key={g.groupId}
                    title={g.name}
                    meta={membersWord(g.userIds.length)}
                    lead={<T5Icon icon={Users} />}
                    onClick={() => setOpen({ kind: "group", group: g })}
                  />
                ))}
                <T5Row
                  title="Members"
                  meta={membersWord(data.members.length)}
                  lead={<T5Icon icon={Users} />}
                  onClick={() => setOpen({ kind: "members" })}
                />
                <T5Row
                  title="Invite a member"
                  meta="By work email, with a one-time code"
                  lead={<T5Icon icon={Plus} />}
                  onClick={() => setOpen({ kind: "invite" })}
                />
              </T5List>
            </T5Section>
          </div>
          <div className={left}>
            <T5Section
              label={`Changes sent · ${changes.length}`}
              right={
                <T5Link onClick={() => (delayed.pending ? undefined : setOpen({ kind: "pick" }))}>New change</T5Link>
              }
            >
              <T5List ruled testId="teaching-organise-changes">
                {changes.map((change) => {
                  const lines = sentChangeLines(change);
                  return (
                    <T5Row
                      key={change.id}
                      title={lines.title}
                      meta={lines.meta}
                      lead={<T5Icon icon={change.status === "cancelled" ? X : Clock} />}
                      end={<span className="shrink-0 text-sm text-[color:var(--text-muted)]">Sent</span>}
                    />
                  );
                })}
                {changes.length === 0 ? (
                  <li className="py-2.5">
                    <T5Meta>Moves and cancellations for the coming week show here.</T5Meta>
                  </li>
                ) : null}
              </T5List>
            </T5Section>
          </div>
          <div className={right}>
            <T5Section label="Tools">
              <T5List ruled>
                <T5Row
                  title="Download attendance"
                  meta={downloading ? "Preparing the spreadsheet…" : "Spreadsheet for this service"}
                  lead={<T5Icon icon={Download} />}
                  onClick={() => void download()}
                  busy={downloading}
                  testId="teaching-organise-download"
                />
                <T5Row
                  title="Attendance gaps"
                  meta="Enrolled doctors with no check-ins recorded this term"
                  lead={<T5Icon icon={Users} />}
                  onClick={() => setOpen({ kind: "attendance-gaps" })}
                  testId="teaching-organise-attendance-gaps"
                />
                <T5Row
                  title="Import a timetable"
                  meta="CSV or XLSX, up to 1 MB. You see a preview before anything saves."
                  lead={<T5Icon icon={Upload} />}
                  href="/teaching/import"
                />
              </T5List>
            </T5Section>
          </div>
        </div>
        {isDemo ? null : (
          <TeachingSupervisionAdmin
            key={service}
            serviceId={service}
            data={data}
            today={todayKey}
            isAdmin={teams.find((team) => team.id === service)?.role === "admin"}
            onSaved={refresh}
          />
        )}
        {open?.kind === "pick" ? (
          <PickSessionSheet
            sessions={changeable}
            onClose={() => setOpen(null)}
            onPick={(session) => setOpen({ kind: "change", session })}
          />
        ) : null}
        {open?.kind === "change" ? (
          <ChangeSheet
            session={open.session}
            others={mine}
            memberCount={reach}
            now={now}
            onClose={() => setOpen(null)}
            onPost={(draft, count) => {
              const session = open.session;
              setOpen(null);
              if (isDemo) {
                setNotice(`Demo only. Nothing was sent. In a real service this goes to ${membersWord(count)}.`);
                return;
              }
              setNotice(null);
              delayed.schedule({
                label: `Posting to ${membersWord(count)}`,
                url: teachingServiceUrl(service),
                body: changeBody(session, draft),
                onPosted: refresh,
                onFailed: (cause) => setNotice(teachingErrorMessage(cause)),
              });
            }}
          />
        ) : null}
        {open?.kind === "series" ? (
          <SeriesSheet
            serviceId={service}
            series={open.series}
            organise={data}
            demo={isDemo}
            onClose={() => setOpen(null)}
            onSaved={saved}
          />
        ) : null}
        {open?.kind === "group" ? (
          <GroupSheet
            serviceId={service}
            group={open.group}
            organise={data}
            demo={isDemo}
            onClose={() => setOpen(null)}
            onSaved={saved}
          />
        ) : null}
        {open?.kind === "members" ? <MembersSheet organise={data} onClose={() => setOpen(null)} /> : null}
        {open?.kind === "attendance-gaps" ? (
          <AttendanceGapsSheet organise={data} onClose={() => setOpen(null)} />
        ) : null}
        {open?.kind === "invite" ? (
          <InviteSheet serviceId={service} demo={isDemo} onClose={() => setOpen(null)} />
        ) : null}
      </>
    );
  }

  const demoTeams = demo ? [demo.service] : [];
  return (
    <InformationPageShell gap={false} testId="teaching-organise">
      <div className="mx-auto w-full max-w-reading lg:max-w-5xl">
        <T5Page>
          <h1 className="sr-only">Organise</h1>
          {demoMode && demo && view.status !== "signed-out" ? (
            <>
              <T5Note className="mt-0" testId="teaching-organise-demo">
                Example service. Try any action here. No real invitations, membership changes or records are sent.
              </T5Note>
              <ServicePicker teams={demoTeams} value={demo.service.id} onChange={() => {}} />
            </>
          ) : null}
          {teams.length > 0 && serviceId && !demoMode ? (
            <ServicePicker teams={teams} value={serviceId} onChange={setChosen} />
          ) : null}
          {body}
        </T5Page>
      </div>
      {delayed.pending ? (
        <TeachingUndoBar testId="teaching-organise-pending" onUndo={delayed.undo}>
          {delayed.pending}. Leaving this page cancels the unsent change.
        </TeachingUndoBar>
      ) : null}
    </InformationPageShell>
  );
}

export function TeachingOrganise(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={TeachingOrganiseContent} {...props} />;
}
