"use client";

import {
  Award,
  CircleCheck,
  ClipboardList,
  Clock,
  FileText,
  Inbox,
  LayoutGrid,
  PenLine,
  Send,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";

import { clockNow } from "@/components/teaching/assessments/assessments-extras";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkEmpty,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
  useWorkUndoToast,
  type WorkTone,
} from "@/components/mode-kit/work";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { cn, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import { AssessmentsSampleLine } from "@/components/work-screens/assessments/assessments-sample-gate";
import { SUPERVISION_LEVELS, epa as epaInfo, type SupervisionLevel } from "@/lib/teaching/assessments/content";
import {
  CANT_REASONS,
  FEEDBACK_MAX_CHARS,
  LATER_WHEN,
  SUGGESTED_COLLEAGUES,
  inboxRowStatus,
  type CantReason,
  type InboxRequest,
} from "@/lib/teaching/assessments/inbox";
import { initialAssessmentsState } from "@/lib/teaching/assessments/model";
import { CELL_WORDS, type CellStatus } from "@/lib/teaching/assessments/overview";
import { SAMPLE_DOCTOR } from "@/lib/teaching/assessments/sample";
import { useOnlineStatus } from "@/lib/use-online-status";
import { patientDetailProblem } from "@/lib/work-screens/assessments/patient-check";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import {
  ASK_FIELDS,
  hoursWords,
  initialTraineeState,
  sessionLine,
  sessionStatus,
  traineeReducer,
  traineeView,
  waitingCount,
  type SampleSession,
} from "@/lib/work-screens/assessments/trainee";

/** Ten seconds to take a send back, as everywhere else in Assessments. */
export const TRAINEE_UNDO_MS = 10_000;

const CELL_TONE: Record<CellStatus, WorkTone> = { done: "green", due: "mode", overdue: "red", not_yet: "neutral" };
const ROW_TONE: Record<ReturnType<typeof inboxRowStatus>["tone"], WorkTone> = {
  bad: "red",
  warm: "amber",
  accent: "mode",
  neutral: "neutral",
};

type SheetState =
  | { kind: "answer"; id: string }
  | { kind: "cant"; id: string }
  | { kind: "status"; id: string }
  | { kind: "ask"; id: string }
  | { kind: "correction" }
  | null;

type Draft = { level: SupervisionLevel | null; text: string };

function PatientNote({
  problem,
  onUse,
}: {
  problem: ReturnType<typeof patientDetailProblem>;
  onUse: (text: string) => void;
}) {
  if (!problem) return null;
  return (
    <div
      role="alert"
      data-testid="assessments-trainee-patient-detail"
      className="flex min-w-0 items-start gap-2.5 rounded-lg border border-[color:var(--warning)] bg-[color:var(--surface-raised)] p-3"
    >
      <TriangleAlert
        aria-hidden="true"
        strokeWidth={1.5}
        className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--warning)]"
      />
      <span className="grid min-w-0 gap-1">
        <span className="text-sm font-semibold text-[color:var(--text-heading)]">{problem.title}</span>
        <span className="text-sm text-[color:var(--text)]">{problem.body}</span>
        {problem.suggestion !== null ? (
          <span>
            <WorkButton
              variant="secondary"
              onClick={() => onUse(problem.suggestion ?? "")}
              testId="assessments-trainee-remove-detail"
            >
              Remove it
            </WorkButton>
          </span>
        ) : null}
      </span>
    </div>
  );
}

function NoteField({
  label,
  value,
  onChange,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
}) {
  const id = useId();
  const hint = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="flex justify-between px-1 text-sm font-semibold text-[color:var(--text-heading)]">
        <span>{label}</span>
        <span className="font-normal text-[color:var(--text-muted)]">Optional</span>
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={FEEDBACK_MAX_CHARS}
        value={value}
        placeholder={placeholder}
        aria-describedby={hint}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.currentTarget.scrollIntoView({ block: "center", behavior: resolveScrollBehavior() })}
        className={cn(fieldControlPlain, "h-auto min-h-24 resize-y scroll-mb-24 py-2 leading-6")}
        data-testid={testId}
      />
      <p id={hint} className="flex justify-between gap-2 px-1 text-xs text-[color:var(--text-muted)]">
        <span>No names, initials, record or bed numbers.</span>
        <span className="nums">{`${value.length} of ${FEEDBACK_MAX_CHARS}`}</span>
      </p>
    </div>
  );
}

/**
 * One doctor as their supervisor sees them (`/teaching/assessments/trainee/[id]`, mock-ups assess_sup
 * and assess_correct). Review what the doctor asked for and answer it, confirm supervision sessions
 * (your sign-off), review a correction the doctor proposed, or ask the doctor to correct a record.
 * Every send waits 10 seconds with Undo, and waits as To send while offline. Made-up records only.
 */
export function AssessmentsTraineePage({ doctorId }: { readonly doctorId: string }) {
  const s = useMemo(() => initialAssessmentsState(), []);
  const [state, dispatch] = useReducer(traineeReducer, initialTraineeState);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [cant, setCant] = useState<{ reason: CantReason | null; suggestion: string | null }>({
    reason: null,
    suggestion: null,
  });
  const [ask, setAsk] = useState<{ field: string; note: string }>({ field: "", note: "" });
  const [note, setNote] = useState<string | null>(null);
  const online = useOnlineStatus();
  const toast = useWorkUndoToast();
  const timers = useRef(new Map<string, number>());
  const view = useMemo(() => traineeView(s, state, doctorId), [s, state, doctorId]);
  useModeBandHeading(
    view
      ? { eyebrow: `${view.row.grade} · ${view.row.unit}`, title: view.row.name }
      : { eyebrow: "Assessments", title: "Doctor" },
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer);
      map.clear();
    };
  }, []);

  const tell = useCallback(
    (message: string, undo?: () => void) => {
      if (toast) toast(message, undo, TRAINEE_UNDO_MS);
      else setNote(message);
    },
    [toast],
  );

  const hold = useCallback((key: string, commit: () => void) => {
    const existing = timers.current.get(key);
    if (existing) window.clearTimeout(existing);
    timers.current.set(
      key,
      window.setTimeout(() => {
        timers.current.delete(key);
        commit();
      }, TRAINEE_UNDO_MS),
    );
  }, []);

  const cancel = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(key);
  }, []);

  // Back online: anything kept as To send goes, still with its 10 second Undo.
  useEffect(() => {
    if (!online) return;
    for (const [id, status] of Object.entries(state.sessions))
      if (status === "queued") dispatch({ type: "confirm-commit", id });
    for (const [id, answer] of Object.entries(state.extras.answers))
      if (answer.status === "queued" && answer.level) {
        dispatch({
          type: "extras",
          action: { type: "inbox-send", id, level: answer.level, text: answer.text, at: clockNow() },
        });
        hold(`answer:${id}`, () => dispatch({ type: "extras", action: { type: "inbox-commit", id } }));
      }
  }, [online, state.sessions, state.extras.answers, hold]);

  if (!view) {
    return (
      <main className="min-w-0" data-testid="assessments-trainee-unknown">
        <WorkBody>
          <AssessmentsSampleLine />
          <WorkEmpty
            icon={UserRound}
            title="No doctor with this link in the sample"
            body="Open a request from your inbox to see that doctor."
            action={<WorkButton href="/teaching/assessments?view=inbox&as=supervisor">Open the inbox</WorkButton>}
          />
        </WorkBody>
      </main>
    );
  }

  const { row } = view;
  const first = row.name.replace(/^Dr /, "").split(" ")[0] ?? row.name;
  const waiting = waitingCount(view, state);
  const openItem = (id: string) => view.waiting.find((item) => item.id === id) ?? null;

  function openRequest(item: InboxRequest) {
    setNote(null);
    if (item.open.kind === "feedback") setSheet({ kind: "answer", id: item.id });
    else if (item.open.kind === "status") setSheet({ kind: "status", id: item.id });
  }

  function sendAnswer(item: InboxRequest) {
    const draft = drafts[item.id];
    if (!draft?.level) return;
    const text = draft.text.trim();
    setSheet(null);
    if (!online) {
      dispatch({ type: "extras", action: { type: "inbox-queue", id: item.id, level: draft.level, text } });
      tell(`Kept to send to ${item.doctor.name} when you are back online`, () =>
        dispatch({ type: "extras", action: { type: "inbox-undo", id: item.id } }),
      );
      return;
    }
    dispatch({ type: "extras", action: { type: "inbox-send", id: item.id, level: draft.level, text, at: clockNow() } });
    hold(`answer:${item.id}`, () => dispatch({ type: "extras", action: { type: "inbox-commit", id: item.id } }));
    tell(`Sending to ${item.doctor.name} in 10 s`, () => {
      cancel(`answer:${item.id}`);
      dispatch({ type: "extras", action: { type: "inbox-undo", id: item.id } });
    });
  }

  function passOn(item: InboxRequest, reason: CantReason, suggestion: string | null) {
    setSheet(null);
    dispatch({ type: "extras", action: { type: "inbox-cant", id: item.id, reason, suggestion } });
    tell(reason === "not_this_week" ? `Moved to Later, back ${LATER_WHEN}` : "Passed on", () =>
      dispatch({ type: "extras", action: { type: "inbox-restore", id: item.id } }),
    );
  }

  function confirmSession(session: SampleSession) {
    setNote(null);
    dispatch({ type: "confirm", id: session.id, offline: !online });
    if (!online) {
      tell("Kept to confirm when you are back online", () => dispatch({ type: "confirm-undo", id: session.id }));
      return;
    }
    hold(`session:${session.id}`, () => dispatch({ type: "confirm-commit", id: session.id }));
    tell(`Confirming ${session.date} in 10 s`, () => {
      cancel(`session:${session.id}`);
      dispatch({ type: "confirm-undo", id: session.id });
    });
  }

  function sendAsk(id: string) {
    if (!ask.field) return;
    setSheet(null);
    dispatch({ type: "ask", id, ask: { field: ask.field, note: ask.note.trim() } });
    setAsk({ field: "", note: "" });
    tell(`Correction asked of ${row.name}`, () => dispatch({ type: "ask-undo", id }));
  }

  function settleCorrection(to: "confirmed" | "later") {
    if (!view?.correction) return;
    const id = view.correction.id;
    setSheet(null);
    dispatch({ type: "correction", id, to });
    tell(to === "confirmed" ? "Correction confirmed. The original is kept beside it." : "Left for later", () =>
      dispatch({ type: "correction-undo", id }),
    );
  }

  const answerItem = sheet?.kind === "answer" ? openItem(sheet.id) : null;
  const cantItem = sheet?.kind === "cant" ? openItem(sheet.id) : null;
  const statusItem = sheet?.kind === "status" ? openItem(sheet.id) : null;
  const askSession = sheet?.kind === "ask" ? (view.toConfirm.find((x) => x.id === sheet.id) ?? null) : null;
  const draft = answerItem ? (drafts[answerItem.id] ?? { level: null, text: "" }) : null;
  const draftProblem = draft ? patientDetailProblem(draft.text) : null;
  const askProblem = patientDetailProblem(ask.note);
  const answerBlocker = !draft
    ? null
    : !draft.level
      ? "Choose the supervision the doctor needed."
      : draftProblem
        ? "Take out the patient details to send."
        : null;

  return (
    <main className="min-w-0" data-testid="assessments-trainee-page">
      <WorkBody>
        <h1 className="sr-only">{row.name}</h1>
        <AssessmentsSampleLine>Made-up example doctor and records. Nothing is saved or sent.</AssessmentsSampleLine>
        {!online ? (
          <WorkCard padded testId="assessments-trainee-offline">
            <p className="flex items-start gap-2 text-sm text-[color:var(--text)]">
              <WifiOff aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" strokeWidth={1.8} />
              <span>You&apos;re offline. What you send waits here as To send and goes when you are back online.</span>
            </p>
          </WorkCard>
        ) : null}
        {note ? (
          <p role="status" className="px-1 text-sm text-[color:var(--text)]" data-testid="assessments-trainee-note">
            {note}
          </p>
        ) : null}

        <WorkCard padded testId="assessments-trainee-summary" className="grid gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="text-base font-semibold text-[color:var(--text-heading)]">{row.name}</b>
            <WorkTag tone={row.bucket === "overdue" ? "red" : row.bucket === "due" ? "mode" : "green"}>
              {row.bucket === "overdue" ? "Overdue" : row.bucket === "due" ? "Due" : "On track"}
            </WorkTag>
          </div>
          <span className={cn(textMuted, "text-sm")}>
            {row.grade} · {row.unit} · supervised by {view.yours ? "you" : row.supervisor}
          </span>
          {view.yours ? (
            <span className={cn(textMuted, "text-sm")} data-testid="assessments-trainee-waiting-count">
              {waiting ? `${waiting} waiting for you` : "Nothing waiting for you"}
            </span>
          ) : null}
        </WorkCard>

        <WorkSectionLabel>This term</WorkSectionLabel>
        <WorkCard as="ul" testId="assessments-trainee-timeline">
          {view.timeline.map((step) => (
            <li key={step.id} className="min-w-0">
              <WorkIconRow
                icon={step.id === "epas" ? Award : FileText}
                tone="neutral"
                title={step.title}
                sub={step.detail}
                end={<WorkTag tone={CELL_TONE[step.status]}>{CELL_WORDS[step.status]}</WorkTag>}
              />
            </li>
          ))}
        </WorkCard>

        {!view.yours ? (
          <WorkCard padded testId="assessments-trainee-not-yours">
            <p className="text-sm text-[color:var(--text)]">
              {row.name} is supervised by {row.supervisor}. Only their term supervisor reviews, confirms and signs. You
              can see status only.
            </p>
          </WorkCard>
        ) : (
          <>
            <WorkSectionLabel count={view.waiting.length}>Asked of you</WorkSectionLabel>
            {view.waiting.length ? (
              <WorkCard as="ul" testId="assessments-trainee-requests">
                {view.waiting.map((item) => {
                  const tag = inboxRowStatus(item);
                  const opens = item.open.kind === "feedback" || item.open.kind === "status";
                  return (
                    <li key={item.id} className="min-w-0">
                      {opens ? (
                        <WorkIconRow
                          icon={item.kind === "epa" ? Award : FileText}
                          title={item.title}
                          sub={`Asked ${item.askedOn}${item.due ? ` · ${item.due}` : ""}`}
                          end={<WorkTag tone={ROW_TONE[tag.tone]}>{tag.tag}</WorkTag>}
                          onClick={() => openRequest(item)}
                          testId={`assessments-trainee-request-${item.id}`}
                        />
                      ) : (
                        <WorkIconRow
                          icon={FileText}
                          title={item.title}
                          sub="Opens in the end-of-term form"
                          href={`/teaching/assessments?view=${item.open.kind === "href" ? item.open.view : "inbox"}&as=supervisor`}
                          testId={`assessments-trainee-request-${item.id}`}
                        />
                      )}
                    </li>
                  );
                })}
              </WorkCard>
            ) : (
              <WorkEmpty
                icon={CircleCheck}
                title={`Nothing asked of you by ${first}`}
                testId="assessments-trainee-no-requests"
              />
            )}

            <WorkSectionLabel count={view.toConfirm.length}>Supervision to confirm</WorkSectionLabel>
            {view.toConfirm.length ? (
              <WorkCard as="ul" testId="assessments-trainee-sessions">
                {view.toConfirm.map((session) => {
                  const status = sessionStatus(state, session);
                  return (
                    <li
                      key={session.id}
                      className="grid min-w-0 gap-2 border-t border-[color:var(--border)] px-3.5 py-3 first:border-t-0"
                    >
                      <div className="grid gap-0.5">
                        <span className="text-sm font-semibold text-[color:var(--text-heading)]">
                          {sessionLine(session)}
                        </span>
                        <span className={cn(textMuted, "text-xs")}>Topics: {session.topics.join(", ")}</span>
                      </div>
                      {status === "waiting" ? (
                        <div className="flex flex-wrap gap-2">
                          <WorkButton
                            icon={CircleCheck}
                            onClick={() => confirmSession(session)}
                            testId={`assessments-trainee-confirm-${session.id}`}
                            aria-label={`Confirm ${session.date}`}
                          >
                            Confirm
                          </WorkButton>
                          <WorkButton
                            variant="secondary"
                            icon={PenLine}
                            onClick={() => {
                              setAsk({ field: "", note: "" });
                              setSheet({ kind: "ask", id: session.id });
                            }}
                            testId={`assessments-trainee-ask-${session.id}`}
                            aria-label={`Ask for a correction to ${session.date}`}
                          >
                            Ask for a correction
                          </WorkButton>
                        </div>
                      ) : (
                        <WorkTag tone={status === "asked" ? "amber" : "mode"}>
                          {status === "sending"
                            ? "Sending"
                            : status === "queued"
                              ? "To send"
                              : `Correction asked · ${ASK_FIELDS.find((f) => f.id === state.asks[session.id]?.field)?.label ?? ""}`}
                        </WorkTag>
                      )}
                    </li>
                  );
                })}
              </WorkCard>
            ) : (
              <WorkEmpty
                icon={ShieldCheck}
                title="No supervision waiting to confirm"
                testId="assessments-trainee-no-sessions"
              />
            )}

            {view.correction ? (
              <>
                <WorkSectionLabel>Correction from {first}</WorkSectionLabel>
                <WorkCard as="ul" testId="assessments-trainee-correction">
                  <li className="min-w-0">
                    {view.correctionStatus !== "confirmed" ? (
                      <WorkIconRow
                        icon={PenLine}
                        tone={view.correctionStatus === "later" ? "neutral" : "amber"}
                        title={`${view.correction.date} · ${view.correction.field.toLowerCase()}`}
                        sub={`${view.correction.was} to ${view.correction.proposed}`}
                        end={
                          <WorkTag tone={view.correctionStatus === "later" ? "neutral" : "amber"}>
                            {view.correctionStatus === "later" ? "Later" : "Review"}
                          </WorkTag>
                        }
                        onClick={() => setSheet({ kind: "correction" })}
                        testId="assessments-trainee-correction-open"
                      />
                    ) : (
                      <WorkIconRow
                        icon={PenLine}
                        tone="neutral"
                        title={`${view.correction.date} · ${view.correction.field.toLowerCase()}`}
                        sub={`Now ${view.correction.proposed}. The original is kept.`}
                        end={<WorkTag tone="green">Confirmed</WorkTag>}
                      />
                    )}
                  </li>
                </WorkCard>
              </>
            ) : null}

            {view.recent.length ? (
              <>
                <WorkSectionLabel count={`${hoursWords(view.confirmedMinutes)} confirmed`}>
                  Recently confirmed
                </WorkSectionLabel>
                <WorkCard as="ul" testId="assessments-trainee-recent">
                  {view.recent.map((session) => (
                    <li key={session.id} className="min-w-0">
                      <WorkIconRow
                        icon={CircleCheck}
                        tone="green"
                        title={sessionLine(session)}
                        sub={`Topics: ${session.topics.join(", ")}`}
                        end={<WorkTag tone="green">Confirmed</WorkTag>}
                      />
                    </li>
                  ))}
                </WorkCard>
              </>
            ) : null}

            {view.answered.length ? (
              <>
                <WorkSectionLabel count={view.answered.length}>Done</WorkSectionLabel>
                <WorkCard as="ul" testId="assessments-trainee-done">
                  {view.answered.map((item) => (
                    <li key={item.id} className="min-w-0">
                      <WorkIconRow icon={Send} tone="neutral" title={item.title} sub={item.doneLine ?? "Answered"} />
                    </li>
                  ))}
                </WorkCard>
              </>
            ) : null}
          </>
        )}

        <WorkSectionLabel>Related</WorkSectionLabel>
        <WorkCard as="ul">
          <li className="min-w-0">
            <WorkIconRow
              icon={Inbox}
              title="Inbox"
              sub="Every request waiting for you"
              href="/teaching/assessments?view=inbox&as=supervisor"
            />
          </li>
          <li className="min-w-0">
            <WorkIconRow
              icon={LayoutGrid}
              title="Term overview"
              sub="Every doctor as status only"
              href="/teaching/assessments?view=overview&as=supervisor"
            />
          </li>
          {row.id === "sam" ? (
            <li className="min-w-0">
              <WorkIconRow
                icon={UserRound}
                title={`${SAMPLE_DOCTOR.name}'s record`}
                sub="Year targets and history"
                href="/teaching/assessments?view=record&as=supervisor"
              />
            </li>
          ) : null}
          <li className="min-w-0">
            <WorkIconRow
              icon={ClipboardList}
              title="Help and words"
              sub="How to rate, and the terms used"
              href="/teaching/assessments?view=words&as=supervisor"
            />
          </li>
        </WorkCard>
        <p className={cn(textMuted, "flex items-center justify-center gap-1.5 text-center text-xs")}>
          <ShieldCheck aria-hidden="true" className="size-icon-xs shrink-0" strokeWidth={1.8} />
          Topics only, never patient details. Not CPD credit.
        </p>
      </WorkBody>

      <Sheet
        open={answerItem !== null}
        onClose={() => setSheet(null)}
        title={answerItem ? answerItem.title : "Answer"}
        description={answerItem ? `${answerItem.doctor.name} · asked ${answerItem.askedOn}` : undefined}
        testId="assessments-trainee-answer-sheet"
      >
        {answerItem && draft ? (
          <div className="grid gap-3">
            {answerItem.epa ? <p className={cn(textMuted, "text-sm")}>{epaInfo(answerItem.epa).detail}</p> : null}
            <SegmentedControl
              label={`Supervision ${first} needed`}
              layout="equal"
              value={draft.level ?? ""}
              onChange={(level) =>
                setDrafts({ ...drafts, [answerItem.id]: { ...draft, level: level as SupervisionLevel } })
              }
              options={SUPERVISION_LEVELS.map((l) => ({ value: l.id, label: l.title.replace(" supervision", "") }))}
            />
            {draft.level ? (
              <p className={cn(textMuted, "px-1 text-sm")}>
                {SUPERVISION_LEVELS.find((l) => l.id === draft.level)?.detail}
              </p>
            ) : null}
            <NoteField
              label="A few lines"
              value={draft.text}
              onChange={(text) => setDrafts({ ...drafts, [answerItem.id]: { ...draft, text } })}
              placeholder="What went well, and one thing to try next time."
              testId="assessments-trainee-answer-text"
            />
            <PatientNote
              problem={draftProblem}
              onUse={(text) => setDrafts({ ...drafts, [answerItem.id]: { ...draft, text } })}
            />
            <WorkButton
              size="wide"
              icon={Send}
              onClick={() => sendAnswer(answerItem)}
              disabled={answerBlocker !== null}
              testId="assessments-trainee-answer-send"
            >
              {online ? `Send to ${answerItem.doctor.name}` : "Keep to send"}
            </WorkButton>
            {answerBlocker ? <p className={cn(textMuted, "text-center text-sm")}>{answerBlocker}</p> : null}
            <p className={cn(textMuted, "text-center text-xs")}>
              Sends after 10 seconds, with Undo. Made-up: nothing reaches anyone.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <WorkButton
                variant="secondary"
                icon={Clock}
                onClick={() => passOn(answerItem, "not_this_week", null)}
                testId="assessments-trainee-later"
              >
                Later
              </WorkButton>
              <WorkButton
                variant="secondary"
                icon={X}
                onClick={() => {
                  setCant({ reason: null, suggestion: null });
                  setSheet({ kind: "cant", id: answerItem.id });
                }}
                testId="assessments-trainee-cant"
              >
                Can&apos;t do this one
              </WorkButton>
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={cantItem !== null}
        onClose={() => setSheet(null)}
        title="Can't do this one"
        testId="assessments-trainee-cant-sheet"
      >
        {cantItem ? (
          <div className="grid gap-3">
            <ul role="list" className="grid gap-2">
              {CANT_REASONS.map((r) => (
                <li key={r.id}>
                  <WorkChip
                    selected={cant.reason === r.id}
                    onClick={() => setCant({ ...cant, reason: r.id })}
                    testId={`assessments-trainee-reason-${r.id}`}
                  >
                    {r.title}
                  </WorkChip>
                  <span className={cn(textMuted, "block px-1 pt-0.5 text-xs")}>{r.detail}</span>
                </li>
              ))}
            </ul>
            {cant.reason === "other_consultant" ? (
              <WorkChips label="Suggest who">
                {SUGGESTED_COLLEAGUES.map((name) => (
                  <WorkChip
                    key={name}
                    selected={cant.suggestion === name}
                    onClick={() => setCant({ ...cant, suggestion: cant.suggestion === name ? null : name })}
                  >
                    {name}
                  </WorkChip>
                ))}
              </WorkChips>
            ) : null}
            <WorkButton
              size="wide"
              onClick={() => (cant.reason ? passOn(cantItem, cant.reason, cant.suggestion) : undefined)}
              disabled={!cant.reason}
              testId="assessments-trainee-cant-send"
            >
              Tell {first}
            </WorkButton>
            {!cant.reason ? <p className={cn(textMuted, "text-center text-sm")}>Choose a reason first.</p> : null}
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={statusItem !== null}
        onClose={() => setSheet(null)}
        title={statusItem?.title ?? "Request"}
        testId="assessments-trainee-status-sheet"
      >
        {statusItem ? (
          <div className="grid gap-3">
            <p className="text-sm text-[color:var(--text)]">
              This form is not built into the sample, so it can be moved to Later or passed on, not filled in here.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <WorkButton variant="secondary" icon={Clock} onClick={() => passOn(statusItem, "not_this_week", null)}>
                Later
              </WorkButton>
              <WorkButton
                variant="secondary"
                icon={X}
                onClick={() => {
                  setCant({ reason: null, suggestion: null });
                  setSheet({ kind: "cant", id: statusItem.id });
                }}
              >
                Pass it on
              </WorkButton>
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={askSession !== null}
        onClose={() => setSheet(null)}
        title="Ask for a correction"
        description={askSession ? sessionLine(askSession) : undefined}
        testId="assessments-trainee-ask-sheet"
      >
        {askSession ? (
          <div className="grid gap-3">
            <p className={cn(textMuted, "px-1 text-sm")}>What looks wrong? {first} corrects it, then you confirm.</p>
            <WorkChips label="What looks wrong">
              {ASK_FIELDS.map((f) => (
                <WorkChip
                  key={f.id}
                  selected={ask.field === f.id}
                  onClick={() => setAsk({ ...ask, field: f.id })}
                  testId={`assessments-trainee-ask-field-${f.id}`}
                >
                  {f.label}
                </WorkChip>
              ))}
            </WorkChips>
            <NoteField
              label="A note for the doctor"
              value={ask.note}
              onChange={(value) => setAsk({ ...ask, note: value })}
              placeholder="It ran to 90 minutes, I think."
              testId="assessments-trainee-ask-note"
            />
            <PatientNote problem={askProblem} onUse={(value) => setAsk({ ...ask, note: value })} />
            <WorkButton
              size="wide"
              icon={Send}
              onClick={() => sendAsk(askSession.id)}
              disabled={!ask.field || askProblem !== null}
              testId="assessments-trainee-ask-send"
            >
              Ask {first}
            </WorkButton>
            {!ask.field ? <p className={cn(textMuted, "text-center text-sm")}>Choose what looks wrong.</p> : null}
            {ask.field && askProblem ? (
              <p className={cn(textMuted, "text-center text-sm")}>Take out the patient details to send.</p>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={sheet?.kind === "correction" && view.correction !== null}
        onClose={() => setSheet(null)}
        title={`Correction from ${row.name}`}
        description={view.correction ? `${view.correction.date} · ${view.correction.kind.toLowerCase()}` : undefined}
        testId="assessments-trainee-correction-sheet"
      >
        {view.correction ? (
          <div className="grid gap-3">
            <p className="text-2xs font-semibold uppercase tracking-label text-[color:var(--text-muted)]">
              {view.correction.field}
            </p>
            <div className="grid grid-cols-2 gap-2" data-testid="assessments-trainee-diff">
              <div className="grid gap-0.5 rounded-xl border border-[color:var(--border)] p-3">
                <small className={cn(textMuted, "text-xs")}>Recorded</small>
                <b className="nums text-base font-semibold text-[color:var(--text-heading)]">{view.correction.was}</b>
              </div>
              <div className="grid gap-0.5 rounded-xl border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] p-3">
                <small className={cn(textMuted, "text-xs")}>Proposed</small>
                <b className="nums text-base font-semibold text-[color:var(--text-heading)]">
                  {view.correction.proposed}
                </b>
              </div>
            </div>
            <dl className="grid gap-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className={textMuted}>Topics</dt>
                <dd className="text-[color:var(--text-heading)]">{view.correction.topics.join(", ")}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className={textMuted}>Confirmed by you</dt>
                <dd className="text-[color:var(--text-heading)]">{view.correction.confirmedOn}</dd>
              </div>
            </dl>
            <p className="flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
              <ShieldCheck aria-hidden="true" className="size-icon-xs shrink-0" /> The original record is kept beside
              the correction.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <WorkButton
                variant="secondary"
                onClick={() => settleCorrection("later")}
                testId="assessments-trainee-correction-later"
              >
                Not now
              </WorkButton>
              <WorkButton onClick={() => settleCorrection("confirmed")} testId="assessments-trainee-correction-confirm">
                Confirm correction
              </WorkButton>
            </div>
          </div>
        ) : null}
      </Sheet>
    </main>
  );
}
