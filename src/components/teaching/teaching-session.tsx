"use client";

import { ClipboardList, Clock, QrCode } from "lucide-react";
import { useId, useState } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { ModeStateLabel } from "@/components/mode-kit/state-label";
import { CheckinRecorded, wasAlreadyCheckedIn } from "@/components/teaching/checkin/checkin-recorded";
import { LogToCpdSheet } from "@/components/teaching/log-to-cpd-sheet";
import { sessionPhase } from "@/components/teaching/session-phase";
import {
  changeLine,
  checkinCloses,
  checkinOpens,
  isOccurrenceId,
  sessionWhen,
  typedCodeDigits,
} from "@/components/teaching/session-view-model";
import { ActionStrip, type TeachingAction } from "@/components/teaching/teaching-actions";
import { AttendanceTileRow, TeachingModule, TeachingSwitch } from "@/components/teaching/teaching-modules";
import { TeachingNavHeader } from "@/components/teaching/teaching-nav-header";
import type { SessionDetailRead } from "@/components/teaching/teaching-reads";
import { SessionMaterials } from "@/components/teaching/teaching-resource-list";
import { TeachingRow } from "@/components/teaching/teaching-row";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { joinLabel, joinPlatform } from "@/components/teaching/teaching-view-model";
import { attendanceTiles, type AttendanceCounts } from "@/components/teaching/use-checkin-code";
import { useSessionDetail } from "@/components/teaching/use-session-detail";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useDelayedPost } from "@/components/teaching/use-delayed-post";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { teachingErrorMessage, teachingPostTimed, teachingServiceUrl } from "@/lib/teaching/client";
import {
  attendanceLabels,
  memberLabel,
  type AttendanceMethod,
  type CheckinStream,
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
/** A check-in made on this visit, with whether the server already had it (decided once, from its answer). */
type Recorded = Mark & { already: boolean };
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
  if (!valid || resource.code === "teaching_not_found") body = <ModeNotice>{GONE}</ModeNotice>;
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
        back={{ href: "/teaching/week", label: "This week" }}
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
  // A check-in made on this visit gets the "Attendance recorded" card (feature 9); an earlier one keeps its label.
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const recordedNow = (saved: Recorded) => {
    setMark({ method: saved.method, recordedAt: saved.recordedAt });
    setRecorded(saved);
    announce("Attendance recorded");
  };
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
      const { data: saved, serverTime } = visitor
        ? await teachingPostTimed<Mark>("/api/teaching/whats-on", {
            action: "whats_on.attend",
            occurrenceId: detail.occurrenceId,
          })
        : await teachingPostTimed<Mark>(teachingServiceUrl(detail.serviceId), {
            action: "attendance.self",
            occurrenceId: detail.occurrenceId,
          });
      recordedNow({
        method: saved.method,
        recordedAt: saved.recordedAt,
        already: wasAlreadyCheckedIn(saved.recordedAt, serverTime),
      });
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
  // With the recorded card on screen, its own Log to CPD button is the one to use.
  if (mark && ended && live && !logged && !recorded)
    actions.push({ id: "cpd", label: "Log to CPD", onClick: () => setSheet("cpd"), emphasis: "text" });

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
  const hasBody =
    mark !== null || logged || actions.length > 0 || staffActions.length > 0 || error !== null || registerFailed;

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

  return (
    <>
      <div className="grid gap-1">
        <Title className="text-xl font-semibold text-[color:var(--text-heading)]">{detail.title}</Title>
        <p className="nums text-sm font-normal text-[color:var(--text-muted)]">{sessionWhen(detail)}</p>
      </div>
      {change ? <ModeNotice tone="warning">{change}</ModeNotice> : null}
      {recorded ? (
        <CheckinRecorded
          title={null}
          startsAt={detail.startsAt}
          endsAt={detail.endsAt}
          venue={detail.venue}
          method={recorded.method}
          recordedAt={recorded.recordedAt}
          alreadyCheckedIn={recorded.already}
          now={now}
          logged={logged}
          live={live}
          showMethod={false}
          onLogToCpd={ended && live ? () => setSheet("cpd") : undefined}
        />
      ) : null}
      {!cancelled ? (
        <TeachingModule
          testId="teaching-session-phase"
          title={moduleTitle}
          icon={Clock}
          live={moduleTitle === "On now"}
          freshKey={moduleTitle}
          aside={aside}
        >
          {hasBody ? (
            <div className="grid gap-2 p-3">
              {mark || logged ? (
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  {mark ? <ModeStateLabel tone="muted">{attendanceLabels[mark.method]}</ModeStateLabel> : null}
                  {logged ? <ModeStateLabel tone="muted">Logged to CPD</ModeStateLabel> : null}
                </p>
              ) : null}
              <ActionStrip actions={actions} layout="stack" />
              {staffActions.length > 0 ? (
                <div data-testid="teaching-session-staff-actions">
                  <ActionStrip actions={staffActions} />
                </div>
              ) : null}
              {error ? (
                <div role="alert">
                  <ModeNotice tone="warning">{error}</ModeNotice>
                </div>
              ) : null}
              {registerFailed ? <ModeNotice tone="warning">The register couldn&apos;t load.</ModeNotice> : null}
            </div>
          ) : (
            <div className="pb-3" />
          )}
        </TeachingModule>
      ) : null}
      <ModeGroupedList mode="teaching" eyebrow="Details" testId="teaching-session-details">
        {detail.venue ? <ModeRow title="Where" subtitle={detail.venue} /> : null}
        {detail.hasJoinLink ? (
          detail.joinUrl && !cancelled ? (
            <TeachingRow title="Online" subtitle={onlineLine} externalHref={detail.joinUrl} />
          ) : (
            <ModeRow title="Online" subtitle={onlineLine} />
          )
        ) : null}
        {detail.presenterName ? <ModeRow title="Presenter" subtitle={detail.presenterName} /> : null}
      </ModeGroupedList>
      <SessionMaterials detail={detail} />
      {staff && detail.counts ? (
        <AttendanceTileRow
          label="Attendance"
          tiles={attendanceTiles(sessionCounts(detail.counts), detail.counts.expected)}
        />
      ) : null}
      {canScan ? (
        <ScanSheet
          open={sheet === "scan"}
          onClose={() => setSheet(null)}
          detail={detail}
          live={live}
          onDone={recordedNow}
        />
      ) : null}
      {mark && ended ? (
        <LogToCpdSheet
          open={sheet === "cpd"}
          onClose={() => setSheet(null)}
          occurrenceId={detail.occurrenceId}
          startsAt={detail.startsAt}
          endsAt={detail.endsAt}
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

function ScanSheet({
  open,
  onClose,
  detail,
  live,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  detail: SessionDetailRead;
  live: boolean;
  onDone: (mark: Recorded) => void;
}) {
  const [stream, setStream] = useState<CheckinStream>("room");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const code = typedCodeDigits(typed);
    if (!code) {
      setError("Enter the 6-digit code.");
      return;
    }
    if (!live) {
      setError("The demo doesn't save check-ins.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: saved, serverTime } = await teachingPostTimed<Mark>(teachingServiceUrl(detail.serviceId), {
        action: "checkin.typed",
        occurrenceId: detail.occurrenceId,
        stream,
        code,
      });
      onDone({
        method: saved.method,
        recordedAt: saved.recordedAt,
        already: wasAlreadyCheckedIn(saved.recordedAt, serverTime),
      });
      onClose();
    } catch (cause) {
      setError(teachingErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const formId = useId();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Check in with code"
      footer={
        <Button type="submit" form={formId} variant="primary" block busy={busy} busyLabel="Checking in">
          Check in
        </Button>
      }
    >
      <form
        id={formId}
        className="grid gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submit();
        }}
      >
        <p className="text-sm text-[color:var(--text-heading)]">
          Open your phone&apos;s camera and point it at the code on screen.
        </p>
        {detail.hasJoinLink ? (
          <TeachingSwitch
            value={stream}
            onChange={setStream}
            label="Where you are"
            options={[
              { value: "room", label: "Room" },
              { value: "teams", label: "Teams" },
            ]}
          />
        ) : null}
        <TextField
          label="Or type the six digits"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={typed}
          onChange={(event) => setTyped(event.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          error={error ?? undefined}
        />
      </form>
    </Sheet>
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
                      <Button
                        variant="ghost"
                        aria-label={`Remove ${name}`}
                        busy={removing === userId}
                        busyLabel="Removing"
                        disabled={removing !== null}
                        onClick={() => remove(userId, name)}
                      >
                        Remove
                      </Button>
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
            <Button variant="ghost" onClick={undo}>
              Undo
            </Button>
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
