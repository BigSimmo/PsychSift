"use client";

import { CalendarX, Check, ClipboardList, MapPin, QrCode, UserRound, Video } from "lucide-react";
import { useState } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { WorkButton } from "@/components/mode-kit/work";
import { LogToCpdSheet } from "@/components/teaching/log-to-cpd-sheet";
import { sessionPhase } from "@/components/teaching/session-phase";
import {
  changeLine,
  checkinCloses,
  checkinOpens,
  isOccurrenceId,
  sessionWhen,
} from "@/components/teaching/session-view-model";
import { ActionStrip, type TeachingAction } from "@/components/teaching/teaching-actions";
import { T5Icon, T5Kicker, T5List, T5Note, T5Panel, T5Row, T5Section, T5Button } from "@/components/teaching/t5-kit";
import { TeachingCodeSheet } from "@/components/teaching/teaching-code-sheet";
import { AttendanceTileRow } from "@/components/teaching/teaching-modules";
import { TeachingNavHeader } from "@/components/teaching/teaching-nav-header";
import type { SessionDetailRead } from "@/components/teaching/teaching-reads";
import { SessionMaterials } from "@/components/teaching/teaching-resource-list";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { joinLabel, joinPlatform } from "@/components/teaching/teaching-view-model";
import { attendanceTiles, type AttendanceCounts } from "@/components/teaching/use-checkin-code";
import { useSessionDetail } from "@/components/teaching/use-session-detail";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useDelayedPost } from "@/components/teaching/use-delayed-post";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Sheet } from "@/components/ui/sheet";
import { teachingErrorMessage, teachingPost, teachingServiceUrl } from "@/lib/teaching/client";
import {
  attendanceLabels,
  memberLabel,
  type AttendanceMethod,
  type RegisterResult,
  type RegisterRow,
} from "@/lib/teaching/model";
import { useTeachingDemoMode } from "@/components/teaching/use-teaching-sample";

/*
 * One session (spec §9, review focus 5): the phase module (Coming up; On now
 * with Check in with code and Check in without code; then a quiet Log to CPD;
 * for the presenter and organisers, Show check-in code and Register, in thumb
 * reach at session time), Details, Materials, and the staff's counts. In the
 * named register an organiser can remove a self-reported mark, held 10 seconds
 * under Undo. A cancelled, moved or removed session says so in words
 * and offers no Join and no check-in. A health-service visitor (master plan
 * R5 and R15) gets the read-only view and says "I was there" through What's
 * on, never through this service.
 */
const GONE = "This session is no longer in the programme.";

type Mark = { method: AttendanceMethod; recordedAt: string };
type Props = { occurrenceId: string; demoMode: boolean; initialSheet?: "scan"; embedded?: boolean };

export function TeachingSessionScreen({
  occurrenceId,
  demoMode: serverDemoMode,
  initialSheet,
  embedded = false,
}: Props) {
  const demoMode = useTeachingDemoMode(serverDemoMode);
  const now = useTeachingNow();
  const valid = isOccurrenceId(occurrenceId);
  const resource = useSessionDetail(valid ? occurrenceId : null, demoMode, now);
  const detail = resource.data;

  let body;
  let ready = false;
  if (!valid || resource.code === "teaching_not_found")
    body = (
      <section
        data-testid="teaching-session-gone"
        className="work-card grid justify-items-center gap-1.5 px-4.5 pt-6.5 pb-4 text-center"
      >
        <span aria-hidden="true" className="work-ic work-ic--lg" data-tone="neutral">
          <CalendarX aria-hidden="true" strokeWidth={2} />
        </span>
        <h2 className="mt-1 text-base-minus font-bold text-[color:var(--text-heading)]">No longer in the programme</h2>
        <p className="max-w-72 text-xs leading-snug text-[color:var(--text-muted)]">{GONE}</p>
        <div className="mt-2 w-full max-w-68">
          <WorkButton variant="secondary" size="wide" href="/teaching/week">
            Back to this week
          </WorkButton>
        </div>
      </section>
    );
  else if (resource.status === "signed-out") body = <TeachingSignInNotice />;
  else if (resource.status === "offline" || resource.status === "error" || resource.status === "setup")
    body = <TeachingStateNotice state={resource.status} onRetry={resource.retry} />;
  else if (!now || !detail) body = <ModeModuleSkeleton rows={4} eyebrow />;
  else {
    ready = true;
    body = (
      <SessionBody
        key={detail.occurrenceId}
        detail={detail}
        now={now}
        live={!demoMode}
        initialSheet={initialSheet}
        embedded={embedded}
      />
    );
  }

  const content = (
    <div className="grid gap-3">
      {/* Until the session's own title is the heading, the page still has one. */}
      {!ready && !embedded ? <h1 className="sr-only">Session</h1> : null}
      {body}
    </div>
  );
  if (embedded) return content;
  return (
    <>
      {/* The body carries the session's full title as the h1 (it wraps; the header row truncates). */}
      <TeachingNavHeader
        title="Session"
        testIdPrefix="teaching-session"
        back={{ href: "/teaching/week", label: "Week" }}
      />
      <InformationPageShell width="narrow" gap={false} testId="teaching-session">
        {content}
      </InformationPageShell>
    </>
  );
}

function sessionCounts(counts: NonNullable<SessionDetailRead["counts"]>): AttendanceCounts {
  return { code: counts.code, self: counts.self, visitors: counts.visitors ?? 0 };
}

function SessionBody({
  detail,
  now,
  live,
  initialSheet,
  embedded,
}: {
  detail: SessionDetailRead;
  now: Date;
  live: boolean;
  initialSheet?: "scan";
  embedded: boolean;
}) {
  // Beside Week the page already has its heading, so the session's title is a section heading there.
  const Title = embedded ? "h2" : "h1";
  const visitor = detail.visitor === true;
  const cancelled = detail.status === "cancelled";
  const staff = detail.canShowCode && !cancelled && !visitor;
  const [mark, setMark] = useState<Mark | null>(detail.myAttendance ?? null);
  // `?check-in=scan` (Today's hero) opens the scan sheet on arrival; it only shows while a code can be scanned.
  const [sheet, setSheet] = useState<"scan" | "cpd" | "register" | null>(initialSheet ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState(false);
  // `register.read` answers an organiser with names and a presenter with counts only (plan-contracts §4).
  const register = useTeachingResource<RegisterResult>(
    live && staff
      ? teachingServiceUrl(detail.serviceId, { action: "register.read", occurrenceId: detail.occurrenceId })
      : null,
  );
  const phase = sessionPhase(detail, now);
  const change = changeLine(detail);
  const started = now.getTime() >= Date.parse(detail.startsAt);
  const ended = now.getTime() >= Date.parse(detail.endsAt);
  // The server's windows: a code from 15 minutes before the start, without a code from the start to 7 days after the end.
  const canSelfReport = !mark && started && (phase === "checkin" || phase === "self");
  const canScan = !mark && !visitor && phase === "checkin";
  const rows = register.data && "rows" in register.data ? register.data.rows : null;
  const registerFailed = register.status === "error" || register.status === "offline" || register.status === "setup";

  async function selfCheckIn() {
    if (!live) {
      setError("The demo doesn't save check-ins.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // A visitor is not a member of this service, so What's on records it (master plan R15).
      const saved = visitor
        ? await teachingPost<Mark>("/api/teaching/whats-on", {
            action: "whats_on.attend",
            occurrenceId: detail.occurrenceId,
          })
        : await teachingPost<Mark>(teachingServiceUrl(detail.serviceId), {
            action: "attendance.self",
            occurrenceId: detail.occurrenceId,
          });
      setMark({ method: saved.method, recordedAt: saved.recordedAt });
    } catch (cause) {
      setError(teachingErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const actions: TeachingAction[] = [];
  if (canScan)
    actions.push({
      id: "scan",
      label: "Check in with code",
      icon: QrCode,
      onClick: () => setSheet("scan"),
      emphasis: "primary",
    });
  if (canSelfReport)
    actions.push({
      id: "self",
      label: visitor ? "I was there" : "Check in without code",
      onClick: () => void selfCheckIn(),
      busy,
      busyLabel: "Saving",
      emphasis: canScan ? "text" : "secondary",
    });
  if (detail.joinUrl && !ended)
    actions.push({
      id: "join",
      label: joinLabel(detail.joinUrl),
      href: detail.joinUrl,
      external: true,
      emphasis: actions.some((action) => action.emphasis === "primary") ? "secondary" : "primary",
    });
  if (mark && ended && live && !logged)
    actions.push({
      id: "cpd",
      label: "Log to CPD",
      onClick: () => setSheet("cpd"),
      emphasis: actions.some((action) => action.emphasis === "primary") ? "secondary" : "primary",
    });

  // The presenter's and organisers' controls sit in the phase module, in thumb reach at session time.
  const staffActions: TeachingAction[] = [];
  if (staff && phase === "checkin")
    staffActions.push({
      id: "code",
      label: "Show check-in code",
      icon: QrCode,
      href: `/teaching/session/${detail.occurrenceId}/check-in`,
      emphasis: actions.some((action) => action.emphasis === "primary") ? "secondary" : "primary",
      testId: "teaching-session-show-code",
    });
  if (staff && rows)
    staffActions.push({
      id: "register",
      label: "Register",
      icon: ClipboardList,
      onClick: () => setSheet("register"),
      emphasis: "secondary",
      testId: "teaching-session-register",
    });
  const moduleTitle =
    phase === "checkin" && started && !ended
      ? "On now"
      : ended
        ? "Finished"
        : phase === "checkin"
          ? "Check-in open"
          : "Coming up";
  const aside =
    phase === "checkin"
      ? `Check-in open until ${checkinCloses(detail)}`
      : phase === "upcoming"
        ? `Check-in opens ${checkinOpens(detail)}`
        : null;
  const platform = detail.joinUrl ? (joinPlatform(detail.joinUrl) ?? "Online") : "Online";
  const onlineLine = visitor ? platform : `${platform} · Members only`;

  const kicker = [moduleTitle, aside].filter(Boolean).join(" · ");
  const heading = (
    <Title className="text-lg-minus leading-tight font-bold tracking-tight text-[color:var(--text-heading)]">
      {detail.title}
    </Title>
  );
  const when = <p className="nums text-xs font-normal text-[color:var(--text-muted)]">{sessionWhen(detail)}</p>;

  return (
    <>
      {cancelled ? (
        <T5Panel label="Session">
          {heading}
          {when}
        </T5Panel>
      ) : (
        <T5Panel hero label={moduleTitle} testId="teaching-session-phase">
          <T5Kicker live={moduleTitle === "On now"}>{kicker}</T5Kicker>
          {heading}
          {when}
          {mark || logged ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold">
              {mark ? (
                <span className="inline-flex items-center gap-1.5">
                  <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
                  {attendanceLabels[mark.method]}
                </span>
              ) : null}
              {logged ? <span>Logged to CPD</span> : null}
            </p>
          ) : null}
          {actions.length > 0 ? <ActionStrip surface="hero" actions={actions} layout="stack" className="mt-1" /> : null}
          {staffActions.length > 0 ? (
            <div data-testid="teaching-session-staff-actions">
              <ActionStrip surface="hero" actions={staffActions} />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs font-bold">
              {error}
            </p>
          ) : null}
          {registerFailed ? <p className="text-xs font-bold">The register couldn&apos;t load.</p> : null}
        </T5Panel>
      )}
      {change ? (
        <T5Note tone="warning" icon="alert">
          {change}
        </T5Note>
      ) : null}
      <T5Section label="Details" testId="teaching-session-details">
        <T5List>
          {detail.venue ? <T5Row lead={<T5Icon icon={MapPin} />} title="Where" meta={detail.venue} /> : null}
          {detail.hasJoinLink ? (
            <T5Row
              lead={<T5Icon icon={Video} />}
              title="Online"
              meta={onlineLine}
              href={detail.joinUrl && !cancelled ? detail.joinUrl : undefined}
              external
            />
          ) : null}
          {detail.presenterName ? (
            <T5Row lead={<T5Icon icon={UserRound} />} title="Presenter" meta={detail.presenterName} />
          ) : null}
        </T5List>
      </T5Section>
      <SessionMaterials detail={detail} />
      {staff && detail.counts ? (
        <AttendanceTileRow
          label="Attendance"
          tiles={attendanceTiles(sessionCounts(detail.counts), detail.counts.expected)}
        />
      ) : null}
      {canScan ? (
        <TeachingCodeSheet
          open={sheet === "scan"}
          onClose={() => setSheet(null)}
          session={{ serviceId: detail.serviceId, occurrenceId: detail.occurrenceId, hasJoinLink: detail.hasJoinLink }}
          subtitle={`${detail.title} · ${sessionWhen(detail)}`}
          live={live}
          onDone={setMark}
        />
      ) : null}
      {mark && ended ? (
        <LogToCpdSheet
          open={sheet === "cpd"}
          onClose={() => setSheet(null)}
          occurrenceId={detail.occurrenceId}
          startsAt={detail.startsAt}
          endsAt={detail.endsAt}
          subtitle={`${detail.title} · ${sessionWhen(detail)}`}
          checkIn={mark}
          demo={!live}
          onLogged={() => setLogged(true)}
        />
      ) : null}
      {rows ? (
        <RegisterSheet
          open={sheet === "register"}
          onClose={() => setSheet(null)}
          detail={detail}
          rows={rows}
          onChanged={register.retry}
        />
      ) : null}
    </>
  );
}

function RegisterSheet({
  open,
  onClose,
  detail,
  rows,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  detail: SessionDetailRead;
  rows: readonly RegisterRow[];
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // Held for 10 seconds under Undo (the Organise pattern), then sent; `removing` covers the send itself.
  const delayed = useDelayedPost();
  const [removing, setRemoving] = useState<string | null>(null);

  function remove(userId: string, name: string) {
    setError(null);
    setRemoving(userId);
    delayed.schedule({
      label: `Removing ${name}`,
      url: teachingServiceUrl(detail.serviceId),
      body: { action: "attendance.remove", occurrenceId: detail.occurrenceId, userId },
      onPosted: () => {
        setRemoving(null);
        onChanged();
      },
      onFailed: (cause) => {
        setRemoving(null);
        setError(teachingErrorMessage(cause));
      },
    });
  }

  function undo() {
    delayed.undo();
    setRemoving(null);
  }

  // The Undo bar lives in the sheet, so closing it cancels a held removal rather than sending it unseen.
  function close() {
    if (delayed.pending) undo();
    onClose();
  }

  return (
    <Sheet open={open} onClose={close} title="Register">
      <div className="grid gap-3">
        {rows.length === 0 ? (
          <ModeNotice>No one has checked in yet.</ModeNotice>
        ) : (
          <ModeGroupedList mode="teaching">
            {rows.map((row) => {
              const name = memberLabel(row);
              // Only a self-reported mark can be removed; part 1's `attendance.remove` refuses a code mark.
              const userId = row.method === "self" ? row.userId : null;
              return (
                <ModeRow
                  key={`${row.userId ?? "former"}-${row.recordedAt}`}
                  title={name}
                  subtitle={attendanceLabels[row.method]}
                  trailing={
                    userId ? (
                      <T5Button
                        variant="ghost"
                        aria-label={`Remove ${name}`}
                        busy={removing === userId}
                        busyLabel="Removing"
                        disabled={removing !== null}
                        onClick={() => remove(userId, name)}
                      >
                        Remove
                      </T5Button>
                    ) : undefined
                  }
                />
              );
            })}
          </ModeGroupedList>
        )}
        {delayed.pending ? (
          <div
            role="status"
            data-testid="teaching-register-pending"
            className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] py-1 pr-1 pl-3"
          >
            <span className="text-sm text-[color:var(--text-heading)]">{`${delayed.pending}.`}</span>
            <T5Button variant="ghost" onClick={undo}>
              Undo
            </T5Button>
          </div>
        ) : null}
        {error ? (
          <div role="alert">
            <ModeNotice tone="warning">{error}</ModeNotice>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
