"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ModeNotice } from "@/components/mode-kit/notice";
import { TeachingAccountPage, TeachingDepthPage } from "@/components/teaching/teaching-depth-page";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { modeNumberText } from "@/components/mode-kit/type";
import { perthDateKey, shortDayLabel } from "@/components/teaching/teaching-dates";
import { withUnit } from "@/components/teaching/teaching-number";
import { TeachingUndoBar } from "@/components/teaching/teaching-row";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/chip";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
import { teachingErrorMessage, teachingPost } from "@/lib/teaching/client";
import { demoSupervision } from "@/lib/teaching/depth-demo";
import {
  correctionReasons,
  correctionReasonLabels,
  SUPERVISION_UNDO_MS,
  supervisionTopics,
  supervisionTopicLabels,
  supervisionTypeLabels,
  supervisionTypes,
  teachingDepthActionSchema,
  teachingDepthUrl,
  type CorrectionReason,
  type SupervisionPairingView,
  type SupervisionTopic,
  type TeachingDepthInput,
} from "@/lib/teaching/depth-model";

const MAX_TOPICS = 5;
const TYPE_OPTIONS = supervisionTypes.map((value) => ({ value, label: supervisionTypeLabels[value] }));
const STATUS_LABELS = { pending: "Awaiting confirmation", confirmed: "Confirmed" } as const;

/** Minutes as hours, to one decimal place: "2.5 h". */
function hours(minutes: number): string {
  return withUnit(Math.round((minutes / 60) * 10) / 10, "h");
}

/** Topics as a wrap of tap chips: several at once, never more than five. */
function TopicChips({
  legend,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  value: readonly SupervisionTopic[];
  onChange: (next: SupervisionTopic[]) => void;
  disabled: boolean;
}) {
  const full = value.length >= MAX_TOPICS;
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-1.5">
      <legend className="mb-1 text-sm font-medium text-[color:var(--text-heading)]">{legend}</legend>
      <div className="flex flex-wrap gap-1">
        {supervisionTopics.map((topic) => {
          const pressed = value.includes(topic);
          return (
            <ChoiceChip
              key={topic}
              pressed={pressed}
              disabled={disabled || (full && !pressed)}
              onPressedChange={(next) =>
                onChange(
                  next
                    ? value.length < MAX_TOPICS
                      ? [...value, topic]
                      : [...value]
                    : value.filter((item) => item !== topic),
                )
              }
            >
              {supervisionTopicLabels[topic]}
            </ChoiceChip>
          );
        })}
      </div>
    </fieldset>
  );
}

function Pairing({
  pairing,
  demoMode,
  today,
  refresh,
  locked,
  setLocked,
}: {
  pairing: SupervisionPairingView;
  demoMode: boolean;
  today: string;
  refresh: () => void;
  locked: boolean;
  setLocked: (value: boolean) => void;
}) {
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState("60");
  const [type, setType] = useState<"individual" | "group">("individual");
  const [topics, setTopics] = useState<SupervisionTopic[]>([]);
  const [target, setTarget] = useState(pairing.targetHours === null ? "" : String(pairing.targetHours));
  const [reason, setReason] = useState<CorrectionReason>("entered_in_error");
  const [correctionId, setCorrectionId] = useState("");
  const [correctedDate, setCorrectedDate] = useState(today);
  const [correctedMinutes, setCorrectedMinutes] = useState("60");
  const [correctedType, setCorrectedType] = useState<"individual" | "group">("individual");
  const [correctedTopics, setCorrectedTopics] = useState<SupervisionTopic[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const held = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (held.current) clearTimeout(held.current);
    };
  }, []);
  const editable = !pairing.readOnlyUntil;

  async function send(input: TeachingDepthInput) {
    held.current = null;
    setPending(null);
    setBusy(true);
    try {
      if (!demoMode) await teachingPost(teachingDepthUrl(pairing.serviceId), input);
      if (mounted.current) {
        setMessage(demoMode ? "Demo only — no record was sent." : "Saved.");
        if (!demoMode) refresh();
      }
    } catch (cause) {
      if (mounted.current) setMessage(teachingErrorMessage(cause));
    } finally {
      if (mounted.current) setBusy(false);
      setLocked(false);
    }
  }
  function save(input: TeachingDepthInput, delayed = false) {
    if (locked || busy || held.current || !editable) return;
    const parsed = teachingDepthActionSchema.safeParse(input);
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setMessage(null);
    setLocked(true);
    if (delayed) {
      setPending("Waiting 10 seconds before sending. Leaving this page cancels the unsent change.");
      held.current = setTimeout(() => void send(parsed.data), SUPERVISION_UNDO_MS);
    } else void send(parsed.data);
  }
  const inert = locked || busy || pending !== null;
  return (
    <section className={cn(modeModuleSurface, "grid gap-3 p-3")}>
      <div className="grid gap-0.5">
        <h2 className="text-base-minus font-medium text-[color:var(--text-heading)]">
          {pairing.registrarName} · {pairing.supervisorName}
        </h2>
        <p className={cn("text-sm", textMuted)}>
          {pairing.serviceName} · {shortDayLabel(pairing.startsOn)} to {shortDayLabel(pairing.endsOn)}
        </p>
      </div>
      <p className={cn(modeNumberText, "text-sm text-[color:var(--text-heading)]")}>
        Confirmed: {hours(pairing.confirmedMinutes)} · Pending: {hours(pairing.pendingMinutes)}
      </p>
      {!editable ? (
        <ModeNotice>
          Read-only records from a service you left. Available until{" "}
          {pairing.readOnlyUntil ? shortDayLabel(perthDateKey(pairing.readOnlyUntil)) : ""}.
        </ModeNotice>
      ) : null}
      {pairing.access === "organiser" ? (
        <ModeNotice>
          Organisers see totals and status only. Supervision topics and personal targets are private.
        </ModeNotice>
      ) : null}
      {pairing.access === "registrar" && editable ? (
        <>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save(
                {
                  action: "supervision.log",
                  pairingId: pairing.pairingId,
                  date,
                  minutes: Number(minutes),
                  type,
                  topics,
                },
                true,
              );
            }}
          >
            <h3 className="text-sm font-medium text-[color:var(--text-heading)]">Log supervision</h3>
            <TextField
              label="Date"
              type="date"
              value={date}
              min={pairing.startsOn}
              max={today < pairing.endsOn ? today : pairing.endsOn}
              required
              disabled={inert}
              onChange={(event) => setDate(event.target.value)}
            />
            <TextField
              label="Minutes"
              type="number"
              inputMode="numeric"
              value={minutes}
              min="15"
              max="240"
              step="15"
              required
              disabled={inert}
              onChange={(event) => setMinutes(event.target.value)}
            />
            <Select
              label="Type"
              value={type}
              disabled={inert}
              onChange={(event) => setType(event.target.value as typeof type)}
              options={TYPE_OPTIONS}
            />
            <TopicChips
              legend="Topics (optional, up to five, no patient details)"
              value={topics}
              onChange={setTopics}
              disabled={inert}
            />
            <Button type="submit" variant="primary" disabled={inert}>
              Send for supervisor confirmation
            </Button>
          </form>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save({
                action: "supervision.target.set",
                pairingId: pairing.pairingId,
                targetHours: target === "" ? null : Number(target),
              });
            }}
          >
            <TextField
              label="Your personal target (hours, optional)"
              type="number"
              inputMode="decimal"
              min="1"
              max="500"
              step="0.1"
              value={target}
              disabled={inert}
              onChange={(event) => setTarget(event.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={inert}>
              Save my target
            </Button>
          </form>
        </>
      ) : null}
      {pairing.entries?.map((entry) => (
        <div key={entry.entryId} className="grid gap-2 border-t border-[color:var(--border)] pt-3">
          <p className="text-sm text-[color:var(--text-heading)]">
            {shortDayLabel(entry.date)} · <span className={modeNumberText}>{withUnit(entry.minutes, "min")}</span> ·{" "}
            {supervisionTypeLabels[entry.type]} · {STATUS_LABELS[entry.status]}
          </p>
          {entry.topics.length > 0 ? (
            <p className={cn("text-sm", textMuted)}>
              {entry.topics.map((topic) => supervisionTopicLabels[topic]).join(", ")}
            </p>
          ) : null}
          {entry.confirmedByName ? (
            <p className={cn("text-sm", textMuted)}>Confirmed by {entry.confirmedByName}</p>
          ) : null}
          {pairing.access === "supervisor" && editable && entry.status === "pending" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={inert}
              onClick={() => save({ action: "supervision.confirm", entryIds: [entry.entryId] }, true)}
            >
              Confirm <span className="sr-only">{shortDayLabel(entry.date)}</span>
            </Button>
          ) : null}
          {entry.notes.map((note) => (
            <div key={note.noteId}>
              <p>
                {correctionReasonLabels[note.reason]} ·{" "}
                {note.confirmedAt ? "Correction confirmed" : "Correction awaiting confirmation"}
              </p>
              <p>
                Proposed correction:{" "}
                {note.reason === "entered_in_error"
                  ? "Mark this entry as entered in error."
                  : Object.entries(note.correctedValue)
                      .map(
                        ([key, value]) =>
                          `${key === "minutes" ? "Minutes" : key === "date" ? "Date" : key === "type" ? "Type" : "Topics"}: ${Array.isArray(value) ? value.map((topic) => supervisionTopicLabels[topic as SupervisionTopic] ?? topic).join(", ") : String(value)}`,
                      )
                      .join(" · ")}
              </p>
              {pairing.access === "supervisor" && editable && !note.confirmedAt ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={inert}
                  onClick={() => save({ action: "supervision.note.confirm", noteId: note.noteId }, true)}
                >
                  Confirm correction
                </Button>
              ) : null}
            </div>
          ))}
          {pairing.access === "registrar" && editable ? (
            <Button
              type="button"
              variant="secondary"
              disabled={inert}
              onClick={() => {
                setCorrectionId(entry.entryId);
                setCorrectedDate(entry.date);
                setCorrectedMinutes(String(entry.minutes));
                setCorrectedType(entry.type);
                setCorrectedTopics(entry.topics);
              }}
            >
              Correct <span className="sr-only">{shortDayLabel(entry.date)}</span>
            </Button>
          ) : null}
        </div>
      ))}
      {correctionId ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const values =
              reason === "wrong_date"
                ? { date: correctedDate }
                : reason === "wrong_length"
                  ? { minutes: Number(correctedMinutes) }
                  : reason === "wrong_type"
                    ? { type: correctedType }
                    : reason === "wrong_topics"
                      ? { topics: correctedTopics }
                      : {};
            save({ action: "supervision.note", entryId: correctionId, reason, correctedValue: values }, true);
          }}
        >
          <Select
            label="Correction reason"
            value={reason}
            disabled={inert}
            onChange={(event) => setReason(event.target.value as CorrectionReason)}
            options={correctionReasons.map((value) => ({ value, label: correctionReasonLabels[value] }))}
          />
          {reason === "wrong_date" ? (
            <TextField
              label="Corrected date"
              type="date"
              required
              min={pairing.startsOn}
              max={today < pairing.endsOn ? today : pairing.endsOn}
              value={correctedDate}
              disabled={inert}
              onChange={(event) => setCorrectedDate(event.target.value)}
            />
          ) : null}
          {reason === "wrong_length" ? (
            <TextField
              label="Corrected minutes"
              type="number"
              inputMode="numeric"
              required
              min="15"
              max="240"
              step="15"
              value={correctedMinutes}
              disabled={inert}
              onChange={(event) => setCorrectedMinutes(event.target.value)}
            />
          ) : null}
          {reason === "wrong_type" ? (
            <Select
              label="Corrected type"
              value={correctedType}
              disabled={inert}
              onChange={(event) => setCorrectedType(event.target.value as typeof correctedType)}
              options={TYPE_OPTIONS}
            />
          ) : null}
          {reason === "wrong_topics" ? (
            <TopicChips
              legend="Corrected topics (up to five)"
              value={correctedTopics}
              onChange={setCorrectedTopics}
              disabled={inert}
            />
          ) : null}
          <p>The original record is retained.</p>
          <Button type="submit" variant="secondary" disabled={inert}>
            Send correction for confirmation
          </Button>
          <Button type="button" variant="secondary" disabled={inert} onClick={() => setCorrectionId("")}>
            Cancel correction
          </Button>
        </form>
      ) : null}
      {pending ? (
        <TeachingUndoBar
          testId="teaching-supervision-pending"
          onUndo={() => {
            if (held.current) clearTimeout(held.current);
            held.current = null;
            setPending(null);
            setLocked(false);
            setMessage("Cancelled before sending.");
          }}
        >
          {pending}
        </TeachingUndoBar>
      ) : null}
      {busy ? <p role="status">Sending…</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
function SupervisionPage({ demoMode }: { demoMode: boolean }) {
  const [locked, setLocked] = useState(false);
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const resource = useTeachingResource<{ pairings: SupervisionPairingView[] }>(
    demoMode ? null : "/api/teaching/depth?view=supervision",
  );
  const pairings = useMemo(
    () => (demoMode && today ? demoSupervision(today) : resource.data?.pairings),
    [demoMode, today, resource.data],
  );
  return (
    <TeachingDepthPage title="Supervision" demoMode={demoMode} resource={resource} ready={!!pairings && !!today}>
      <p>
        Log teaching topics only, never patient details. Confirmation records the supervisor&apos;s acknowledgement. It
        does not award CPD credit.
      </p>
      {pairings?.length === 0 ? (
        <ModeNotice>
          No supervision pairing yet. Ask your service organiser to set up a registrar and supervisor pairing.
        </ModeNotice>
      ) : null}
      {locked ? <p role="status">Finish or undo the current change before starting another.</p> : null}
      {today
        ? pairings?.map((pairing) => (
            <Pairing
              key={pairing.pairingId}
              pairing={pairing}
              today={today}
              demoMode={demoMode}
              refresh={resource.retry}
              locked={locked}
              setLocked={setLocked}
            />
          ))
        : null}
    </TeachingDepthPage>
  );
}
export function TeachingSupervision(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={SupervisionPage} {...props} />;
}
