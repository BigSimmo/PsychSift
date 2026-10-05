"use client";

import { CalendarDays, Download, GraduationCap, Network, Plus, Presentation, Upload, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { TeachingSupervisionAdmin } from "@/components/teaching/teaching-supervision-admin";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import {
  AUDIENCE_LABELS,
  changeBody,
  csvHref,
  csvText,
  expectedMemberCount,
  sessionRisks,
  type GroupRow,
  type OrganiseRead,
  type SeriesRow,
} from "@/components/teaching/organise-model";
import {
  ChangeSheet,
  CheckedLine,
  GroupSheet,
  InviteSheet,
  MembersSheet,
  membersWord,
  REPEAT_LABELS,
  SeriesSheet,
} from "@/components/teaching/organise-sheets";
import {
  T5Icon,
  T5Kicker,
  T5Link,
  T5List,
  T5Meta,
  T5Note,
  T5Page,
  T5Panel,
  T5Row,
  T5Section,
  T5Time,
} from "@/components/teaching/t5-kit";
import { addDays, dayParts, perthDateKey, perthTime } from "@/components/teaching/teaching-dates";
import { withUnit } from "@/components/teaching/teaching-number";
import { TeachingUndoBar } from "@/components/teaching/teaching-row";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { useDelayedPost } from "@/components/teaching/use-delayed-post";
import { useSessionDetail } from "@/components/teaching/use-session-detail";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { useTeachingWeek } from "@/components/teaching/use-teaching-week";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { teachingErrorMessage, teachingGet, teachingServiceUrl } from "@/lib/teaching/client";
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
  | null;

const HOUR = 3_600_000;
const organises = (team: TeamSummary) => team.role === "organiser" || team.role === "admin";

/** The service row: the one you organise, or a select for two or more. Never "All services". */
function ServicePicker({
  teams,
  value,
  onChange,
}: {
  teams: readonly TeamSummary[];
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
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const delayed = useDelayedPost();
  // R9: the change reaches the session's series' groups, and the occurrence read names its series.
  const changing = open?.kind === "change" ? open.session : null;
  const changingDetail = useSessionDetail(changing?.occurrenceId ?? null, demoMode, now);

  let body;
  if (view.status === "signed-out") body = <TeachingSignInNotice />;
  else if (view.status === "offline" || view.status === "error" || view.status === "setup")
    body = <TeachingStateNotice state={view.status} onRetry={view.retry} />;
  else if (!now || !view.week) body = <ModeModuleSkeleton rows={4} eyebrow />;
  else if (demoMode)
    body = (
      <>
        <T5Note className="mt-0">
          Made-up demo service. Explore the programme and roles; no real invitations, membership changes or records are
          sent.
        </T5Note>
        <T5Section label={`Demo programme · ${view.week.sessions.length}`}>
          <T5List ruled testId="teaching-organise-demo">
            {view.week.sessions.map((session) => (
              <T5Row
                key={session.occurrenceId}
                title={session.title}
                meta={[dayWord(session.startsAt, perthDateKey(now)), session.venue ?? "Room not set"].join(" · ")}
                lead={<T5Time time={perthTime(session.startsAt)} />}
                href={`/teaching/session/${session.occurrenceId}`}
              />
            ))}
          </T5List>
        </T5Section>
        <T5Section label="Explore the roles">
          <T5List ruled>
            <T5Row
              title="Learner"
              meta="Choose attendance and personal CPD actions"
              lead={<T5Icon icon={GraduationCap} />}
              href="/teaching/logbook"
            />
            <T5Row
              title="Presenter"
              meta="Readiness, de-identification and feedback"
              lead={<T5Icon icon={Presentation} />}
              href="/teaching/teach"
            />
            <T5Row
              title="Registrar and supervisor"
              meta="Log, review and confirm synthetic supervision"
              lead={<T5Icon icon={Users} />}
              href="/teaching/supervision"
            />
            <T5Row
              title="Organiser"
              meta="Preview a timetable without saving it"
              lead={<T5Icon icon={Upload} />}
              href="/teaching/import"
            />
          </T5List>
        </T5Section>
        <T5Note className="mt-3" icon="shield">
          In an approved service, organisers manage series, groups, invitations and supervision pairings. Service admins
          manage programme access. Neither role can read a doctor&apos;s private CPD figures.
        </T5Note>
      </>
    );
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
    const data = organise.data;
    const service = serviceId;
    const mine = view.week.sessions.filter((s) => s.serviceId === service);
    const soon = mine.filter(
      (s) => Date.parse(s.startsAt) < now.getTime() + 48 * HOUR && Date.parse(s.endsAt) > now.getTime(),
    );
    const soonIds = new Set(soon.map((s) => s.occurrenceId));
    const risks = sessionRisks(mine).filter((r) => soonIds.has(r.occurrenceId));
    // At most one amber mark in the list: the first risk, in time order.
    const firstRisk = soon.flatMap((s) => risks.filter((r) => r.occurrenceId === s.occurrenceId))[0] ?? null;
    const refresh = () => {
      view.retry();
      organise.retry();
    };
    const saved = () => {
      setOpen(null);
      refresh();
    };
    const reach =
      changing && changingDetail.status === "ready"
        ? expectedMemberCount(data, changingDetail.data?.seriesId ?? null)
        : data.members.length;

    async function download() {
      if (downloading) return;
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

    body = (
      <>
        <div className="grid gap-x-8 lg:grid-cols-2 lg:items-start">
          <div className="grid min-w-0 content-start">
            <T5Panel className="mt-3" testId="teaching-organise-soon">
              <T5Kicker>
                {`Next 48 hours · ${soon.length}${risks.length ? ` · ${risks.length} to check` : ""}`}
              </T5Kicker>
              {soon.length > 0 ? (
                <T5List ruled={false}>
                  {soon.map((s) => {
                    const risk = firstRisk?.occurrenceId === s.occurrenceId ? firstRisk : null;
                    const live = Date.parse(s.startsAt) <= now.getTime();
                    const change =
                      delayed.pending || s.status === "cancelled" || s.source !== "teaching"
                        ? undefined
                        : () => setOpen({ kind: "change", session: s });
                    const meta = risk ? (
                      <span className="text-[color:var(--warning-text)]">
                        {dayWord(s.startsAt, perthDateKey(now))} · {risk.text}
                      </span>
                    ) : (
                      [
                        live ? "On now" : dayWord(s.startsAt, perthDateKey(now)),
                        s.status === "cancelled" ? "Cancelled" : s.status === "moved" ? "Moved" : null,
                        s.venue ?? (s.hasJoinLink ? "Online" : null),
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
                            <Button type="button" variant="primary" size="sm" onClick={change}>
                              {risk.rule === "room" ? "Set room" : "Fix"}
                            </Button>
                          ) : undefined
                        }
                      />
                    );
                  })}
                </T5List>
              ) : (
                <T5Meta>Nothing in the next 48 hours.</T5Meta>
              )}
              <CheckedLine at={now} count={risks.length} />
            </T5Panel>
            {notice ? (
              <T5Note tone="warning" icon="alert" className="mt-3">
                {notice}
              </T5Note>
            ) : null}
            <T5Section label="Tools">
              <T5List ruled>
                <T5Row
                  title="Download attendance"
                  meta={downloading ? "Preparing the spreadsheet…" : `Last ${withUnit(12, "weeks")}, as a spreadsheet`}
                  lead={<T5Icon icon={Download} />}
                  onClick={() => void download()}
                  busy={downloading}
                  testId="teaching-organise-download"
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
          <div className="grid min-w-0 content-start">
            <T5Section
              label={`Series · ${data.series.length}`}
              right={<T5Link onClick={() => setOpen({ kind: "series", series: null })}>New series</T5Link>}
            >
              <T5List ruled testId="teaching-organise-series">
                {data.series.map((s) => (
                  <T5Row
                    key={s.seriesId}
                    title={s.title}
                    meta={[
                      REPEAT_LABELS[s.repeat as keyof typeof REPEAT_LABELS] ?? null,
                      s.startTime,
                      s.venue ?? "Room not set",
                      s.audience ? AUDIENCE_LABELS[s.audience] : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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
        </div>
        <TeachingSupervisionAdmin
          key={service}
          serviceId={service}
          data={data}
          today={perthDateKey(now)}
          isAdmin={teams.find((team) => team.id === service)?.role === "admin"}
          onSaved={refresh}
        />
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
            onClose={() => setOpen(null)}
            onSaved={saved}
          />
        ) : null}
        {open?.kind === "group" ? (
          <GroupSheet
            serviceId={service}
            group={open.group}
            organise={data}
            onClose={() => setOpen(null)}
            onSaved={saved}
          />
        ) : null}
        {open?.kind === "members" ? <MembersSheet organise={data} onClose={() => setOpen(null)} /> : null}
        {open?.kind === "invite" ? <InviteSheet serviceId={service} onClose={() => setOpen(null)} /> : null}
      </>
    );
  }

  return (
    <InformationPageShell gap={false} testId="teaching-organise">
      <div className="mx-auto w-full max-w-reading lg:max-w-5xl">
        <T5Page>
          <h1 className="sr-only">Organise</h1>
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
