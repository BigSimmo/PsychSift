"use client";

import { Minus, Plus, Send, ShieldCheck, TriangleAlert, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useModeBandCount } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { WorkBody, WorkButton, WorkEmpty, WorkTag } from "@/components/mode-kit/work";
import {
  AssessAvatar,
  AssessCallout,
  AssessHeader,
  AssessNote,
  AssessPair,
  AssessSample,
  AssessSegmented,
  AssessUndoBar,
  CorrectionDiff,
} from "@/components/teaching/assessments/assess-kit";
import { SectionLabel, SectionNote } from "@/components/teaching/assessments/assessments-parts";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { perthDateKey, shortDayLabel } from "@/components/teaching/teaching-dates";
import { withUnit } from "@/components/teaching/teaching-number";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { teachingErrorMessage, teachingPost } from "@/lib/teaching/client";
import { demoSupervision } from "@/lib/teaching/depth-demo";
import {
  correctionReasons,
  correctionReasonLabels,
  pendingConfirmations,
  SUPERVISION_UNDO_MS,
  supervisionTopics,
  supervisionTopicLabels,
  supervisionTypeLabels,
  teachingDepthActionSchema,
  teachingDepthUrl,
  type CorrectionReason,
  type PendingConfirmation,
  type SupervisionEntry,
  type SupervisionNote,
  type SupervisionPairingView,
  type SupervisionTopic,
  type TeachingDepthInput,
} from "@/lib/teaching/depth-model";

const MAX_TOPICS = 5;
const STATUS_LABELS = { pending: "Awaiting confirmation", confirmed: "Confirmed" } as const;
const RECENT = 5;
const MIN_MINUTES = 15;
const MAX_MINUTES = 240;
type SessionType = "individual" | "group";
const TYPE_OPTIONS = [
  { value: "individual", label: supervisionTypeLabels.individual },
  { value: "group", label: supervisionTypeLabels.group },
] as const;

/** Minutes as hours, to one decimal place: "2.5 h". */
function hours(minutes: number): string {
  return withUnit(Math.round((minutes / 60) * 10) / 10, "h");
}

function initials(name: string): string {
  const words = name
    .replace(/^Dr\.?\s+/, "")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

function topicList(topics: readonly SupervisionTopic[]): string {
  return topics.map((topic) => supervisionTopicLabels[topic]).join(", ");
}

/** What a correction proposes, in the words the confirm step has always used. */
function proposedText(note: SupervisionNote): string {
  if (note.reason === "entered_in_error") return "Mark this entry as entered in error.";
  return Object.entries(note.correctedValue)
    .map(
      ([key, value]) =>
        `${key === "minutes" ? "Minutes" : key === "date" ? "Date" : key === "type" ? "Type" : "Topics"}: ${Array.isArray(value) ? value.map((topic) => supervisionTopicLabels[topic as SupervisionTopic] ?? topic).join(", ") : String(value)}`,
    )
    .join(" · ");
}

/** Recorded against proposed, for the field the correction changes. */
function correctionSides(entry: SupervisionEntry, note: SupervisionNote): { was: string; now: string } {
  const value = note.correctedValue as Record<string, unknown>;
  if (note.reason === "wrong_length" && typeof value.minutes === "number")
    return { was: withUnit(entry.minutes, "min"), now: withUnit(value.minutes, "min") };
  if (note.reason === "wrong_date" && typeof value.date === "string")
    return { was: shortDayLabel(entry.date), now: shortDayLabel(value.date) };
  if (note.reason === "wrong_type" && (value.type === "individual" || value.type === "group"))
    return { was: supervisionTypeLabels[entry.type], now: supervisionTypeLabels[value.type] };
  if (note.reason === "wrong_topics" && Array.isArray(value.topics))
    return { was: topicList(entry.topics) || "None", now: topicList(value.topics as SupervisionTopic[]) || "None" };
  return { was: "Kept", now: "Entered in error" };
}

/* ------------------------------------------------------------- sending */

/**
 * One sender for the whole page, so only one change is in flight or held at a
 * time, across every pairing. A held change waits ten seconds with Undo;
 * leaving the page cancels it.
 */
function useSupervisionSender(demoMode: boolean, refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const held = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (held.current) clearTimeout(held.current);
    };
  }, []);

  const send = useCallback(
    async (serviceId: string, input: TeachingDepthInput) => {
      held.current = null;
      setHolding(null);
      setBusy(true);
      try {
        if (!demoMode) await teachingPost(teachingDepthUrl(serviceId), input);
        if (mounted.current) {
          setMessage({ text: demoMode ? "Demo only — no record was sent." : "Saved.", failed: false });
          if (!demoMode) refresh();
        }
      } catch (cause) {
        if (mounted.current) setMessage({ text: teachingErrorMessage(cause), failed: true });
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [demoMode, refresh],
  );

  const inert = busy || holding !== null;
  const save = (serviceId: string, input: TeachingDepthInput, holdFor: string | null = null): boolean => {
    if (inert || held.current) return false;
    const parsed = teachingDepthActionSchema.safeParse(input);
    if (!parsed.success) {
      setMessage({ text: parsed.error.issues[0]?.message ?? "Check the form.", failed: true });
      return false;
    }
    setMessage(null);
    if (holdFor !== null) {
      setHolding(holdFor);
      held.current = setTimeout(() => void send(serviceId, parsed.data), SUPERVISION_UNDO_MS);
    } else void send(serviceId, parsed.data);
    return true;
  };
  const undo = () => {
    if (held.current) clearTimeout(held.current);
    held.current = null;
    setHolding(null);
    setMessage({ text: "Cancelled before sending.", failed: false });
  };
  return { busy, holding, inert, message, save, undo };
}

type Sender = ReturnType<typeof useSupervisionSender>;

/* -------------------------------------------------------------- topics */

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
    <fieldset disabled={disabled} className="assess-field m-0 min-w-0 border-0 p-0">
      <legend className="assess-field__label">
        <span>{legend}</span>
        <em>{`${value.length} of ${MAX_TOPICS}`}</em>
      </legend>
      <div className="work-chips">
        {supervisionTopics.map((topic) => {
          const pressed = value.includes(topic);
          return (
            <button
              key={topic}
              type="button"
              className="work-chip"
              aria-pressed={pressed}
              disabled={disabled || (full && !pressed)}
              onClick={() =>
                onChange(
                  pressed
                    ? value.filter((item) => item !== topic)
                    : value.length < MAX_TOPICS
                      ? [...value, topic]
                      : [...value],
                )
              }
            >
              {supervisionTopicLabels[topic]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function MinutesField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const n = Number(value) || 0;
  const step = (by: number) =>
    onChange(String(Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round((n + by) / 15) * 15))));
  return (
    <div className="assess-field">
      <label htmlFor={id} className="assess-field__label">
        <span>{label}</span>
      </label>
      <div className="flex items-center gap-2">
        <WorkButton
          variant="secondary"
          icon={Minus}
          aria-label="15 minutes less"
          disabled={disabled || n <= MIN_MINUTES}
          onClick={() => step(-15)}
        >
          <span className="sr-only">15 minutes less</span>
        </WorkButton>
        <input
          id={id}
          className="assess-txt min-w-0 flex-1 text-center tabular-nums"
          type="number"
          inputMode="numeric"
          value={value}
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          step="15"
          required
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <WorkButton
          variant="secondary"
          icon={Plus}
          aria-label="15 minutes more"
          disabled={disabled || n >= MAX_MINUTES}
          onClick={() => step(15)}
        >
          <span className="sr-only">15 minutes more</span>
        </WorkButton>
      </div>
    </div>
  );
}

function DateField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: string;
  max: string;
  disabled: boolean;
}) {
  return (
    <div className="assess-field">
      <label htmlFor={id} className="assess-field__label">
        <span>{label}</span>
      </label>
      <input
        id={id}
        className="assess-txt"
        type="date"
        value={value}
        min={min}
        max={max}
        required
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/* --------------------------------------------------------- waiting for you */

function WaitingItem({ item, sender }: { item: PendingConfirmation; sender: Sender }) {
  const { entry, note } = item;
  const date = shortDayLabel(entry.date);
  if (note) {
    const sides = correctionSides(entry, note);
    return (
      <div className="assess-pair">
        <div className="assess-pair__top">
          <AssessAvatar initials={initials(item.registrarName)} />
          <span className="work-row__text">
            <span className="work-row__title">{`${item.registrarName} · correction`}</span>
            <span className="work-row__sub">{`${date} · ${correctionReasonLabels[note.reason]}`}</span>
          </span>
          {sender.holding === item.id ? <WorkTag tone="neutral">Sending</WorkTag> : null}
        </div>
        <CorrectionDiff was={sides.was} now={sides.now} />
        <p className="m-0 text-sm text-[color:var(--text-muted)]">Proposed correction: {proposedText(note)}</p>
        <AssessNote icon={ShieldCheck}>The original record is kept beside the correction.</AssessNote>
        <div className="flex justify-end">
          <WorkButton
            variant="secondary"
            disabled={sender.inert}
            onClick={() =>
              sender.save(item.serviceId, { action: "supervision.note.confirm", noteId: note.noteId }, item.id)
            }
          >
            Confirm correction
          </WorkButton>
        </div>
      </div>
    );
  }
  return (
    <div className="assess-pair">
      <div className="assess-pair__top">
        <AssessAvatar initials={initials(item.registrarName)} />
        <span className="work-row__text">
          <span className="work-row__title">{`${item.registrarName} · ${date}`}</span>
          <span className="work-row__sub">
            {withUnit(entry.minutes, "min")} · {supervisionTypeLabels[entry.type]}
            {entry.topics.length ? ` · ${topicList(entry.topics)}` : ""}
          </span>
        </span>
        {sender.holding === item.id ? (
          <WorkTag tone="neutral">Sending</WorkTag>
        ) : (
          <WorkButton
            variant="tinted"
            disabled={sender.inert}
            onClick={() =>
              sender.save(item.serviceId, { action: "supervision.confirm", entryIds: [entry.entryId] }, item.id)
            }
          >
            Confirm <span className="sr-only">{date}</span>
          </WorkButton>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- one pairing */

function PairingCard({ pairing }: { pairing: SupervisionPairingView }) {
  const registrar = pairing.access === "registrar";
  const other = registrar ? pairing.supervisorName : pairing.registrarName;
  const target = pairing.targetHours;
  const confirmedHours = pairing.confirmedMinutes / 60;
  return (
    <div className="work-card">
      <AssessPair
        initials={initials(other)}
        name={other}
        sub={`${pairing.serviceName} · ${shortDayLabel(pairing.startsOn)} to ${shortDayLabel(pairing.endsOn)}`}
        tag={
          <WorkTag tone="neutral">
            {pairing.access === "organiser" ? "Totals only" : registrar ? "Your supervisor" : "You supervise"}
          </WorkTag>
        }
        lines={
          target !== null
            ? [
                {
                  label: "Confirmed",
                  value: `${hours(pairing.confirmedMinutes)} of ${withUnit(target, "h")}`,
                  fraction: Math.min(1, confirmedHours / target),
                },
              ]
            : undefined
        }
      >
        <p className="m-0 text-sm text-[color:var(--text-heading)] tabular-nums">
          Confirmed: {hours(pairing.confirmedMinutes)} · Pending: {hours(pairing.pendingMinutes)}
        </p>
      </AssessPair>
      {pairing.readOnlyUntil ? (
        <ModeNotice>
          Read-only records from a service you left. Available until{" "}
          {shortDayLabel(perthDateKey(pairing.readOnlyUntil))}.
        </ModeNotice>
      ) : null}
      {pairing.access === "organiser" ? (
        <ModeNotice>
          Organisers see totals and status only. Supervision topics and personal targets are private.
        </ModeNotice>
      ) : null}
    </div>
  );
}

function RecentList({
  pairing,
  sender,
  waitingIds,
  onCorrect,
}: {
  pairing: SupervisionPairingView;
  sender: Sender;
  waitingIds: ReadonlySet<string>;
  onCorrect: (entry: SupervisionEntry) => void;
}) {
  const [all, setAll] = useState(false);
  const entries = pairing.entries ?? [];
  if (!entries.length) return null;
  const shown = all ? entries : entries.slice(0, RECENT);
  const canCorrect = pairing.access === "registrar" && !pairing.readOnlyUntil;
  const other = pairing.access === "registrar" ? pairing.supervisorName : pairing.registrarName;
  return (
    <>
      <SectionLabel
        end={entries.length > RECENT ? <SectionNote>{`${shown.length} of ${entries.length}`}</SectionNote> : undefined}
      >{`Recent · ${other}`}</SectionLabel>
      <ul className="work-card work-rows m-0 list-none p-0" aria-label={`Recent sessions with ${other}`}>
        {shown.map((entry) => {
          const [weekday, day, month] = shortDayLabel(entry.date).split(" ");
          const sending = sender.holding === entry.entryId;
          return (
            <li key={entry.entryId} className="work-row items-start">
              <span className="work-date" aria-hidden="true">
                <span className="work-date__month">{month ?? weekday}</span>
                <span className="work-date__day">{day}</span>
              </span>
              <div className="work-row__text">
                <p className="work-row__title m-0">
                  {shortDayLabel(entry.date)} · <span className="tabular-nums">{withUnit(entry.minutes, "min")}</span> ·{" "}
                  {supervisionTypeLabels[entry.type]} · {STATUS_LABELS[entry.status]}
                </p>
                {entry.topics.length > 0 ? <span className="work-row__sub">{topicList(entry.topics)}</span> : null}
                {entry.confirmedByName ? (
                  <span className="work-row__sub">{`Confirmed by ${entry.confirmedByName}`}</span>
                ) : null}
                {entry.notes.map((note) => (
                  <span key={note.noteId} className="work-row__sub">
                    {`${correctionReasonLabels[note.reason]} · ${note.confirmedAt ? "Correction confirmed" : "Correction awaiting confirmation"}`}
                    {waitingIds.has(note.noteId) ? null : (
                      <>
                        <br />
                        Proposed correction: {proposedText(note)}
                      </>
                    )}
                  </span>
                ))}
              </div>
              <span className="work-row__end flex-col items-end gap-1">
                {sending ? (
                  <WorkTag tone="neutral">Sending</WorkTag>
                ) : (
                  <WorkTag tone="neutral">{entry.status === "confirmed" ? "Confirmed" : "Awaiting"}</WorkTag>
                )}
                {canCorrect ? (
                  <WorkButton variant="quiet" disabled={sender.inert} onClick={() => onCorrect(entry)}>
                    Correct <span className="sr-only">{shortDayLabel(entry.date)}</span>
                  </WorkButton>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {entries.length > RECENT ? (
        <WorkButton variant="quiet" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${entries.length}`}
        </WorkButton>
      ) : null}
    </>
  );
}

function LogForm({ pairing, today, sender }: { pairing: SupervisionPairingView; today: string; sender: Sender }) {
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState("60");
  const [type, setType] = useState<SessionType>("individual");
  const [topics, setTopics] = useState<SupervisionTopic[]>([]);
  const [target, setTarget] = useState(pairing.targetHours === null ? "" : String(pairing.targetHours));
  const inert = sender.inert;
  const max = today < pairing.endsOn ? today : pairing.endsOn;
  const id = pairing.pairingId;
  return (
    <>
      <SectionLabel>{`Log supervision · ${pairing.supervisorName}`}</SectionLabel>
      <form
        className="work-card work-card--pad grid gap-3"
        aria-label="Log supervision"
        onSubmit={(event) => {
          event.preventDefault();
          sender.save(
            pairing.serviceId,
            { action: "supervision.log", pairingId: id, date, minutes: Number(minutes), type, topics },
            `log-${id}`,
          );
        }}
      >
        <DateField
          id={`sup-date-${id}`}
          label="Date"
          value={date}
          onChange={setDate}
          min={pairing.startsOn}
          max={max}
          disabled={inert}
        />
        <MinutesField id={`sup-minutes-${id}`} label="Minutes" value={minutes} onChange={setMinutes} disabled={inert} />
        <AssessSegmented label="Type" value={type} onChange={setType} options={TYPE_OPTIONS} />
        <TopicChips
          legend="Topics (optional, up to five; no patient details)"
          value={topics}
          onChange={setTopics}
          disabled={inert}
        />
        <WorkButton type="submit" icon={Send} size="wide" disabled={inert}>
          Send for supervisor confirmation
        </WorkButton>
        <AssessNote center>Sends after 10 seconds, with Undo.</AssessNote>
      </form>
      <form
        className="work-card work-card--pad grid gap-3"
        aria-label="Your personal target"
        onSubmit={(event) => {
          event.preventDefault();
          sender.save(pairing.serviceId, {
            action: "supervision.target.set",
            pairingId: id,
            targetHours: target === "" ? null : Number(target),
          });
        }}
      >
        <div className="assess-field">
          <label htmlFor={`sup-target-${id}`} className="assess-field__label">
            <span>Your personal target (hours, optional)</span>
          </label>
          <input
            id={`sup-target-${id}`}
            className="assess-txt"
            type="number"
            inputMode="decimal"
            min="1"
            max="500"
            step="0.1"
            value={target}
            disabled={inert}
            onChange={(event) => setTarget(event.target.value)}
          />
        </div>
        <AssessNote>Only you see your target.</AssessNote>
        <WorkButton type="submit" variant="secondary" size="wide" disabled={inert}>
          Save my target
        </WorkButton>
      </form>
    </>
  );
}

function CorrectionForm({
  pairing,
  entry,
  today,
  sender,
  onClose,
}: {
  pairing: SupervisionPairingView;
  entry: SupervisionEntry;
  today: string;
  sender: Sender;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<CorrectionReason>("entered_in_error");
  const [date, setDate] = useState(entry.date);
  const [minutes, setMinutes] = useState(String(entry.minutes));
  const [type, setType] = useState<SessionType>(entry.type);
  const [topics, setTopics] = useState<SupervisionTopic[]>(entry.topics);
  const inert = sender.inert;
  const id = entry.entryId;
  return (
    <form
      className="work-card work-card--pad grid gap-3"
      aria-label={`Correct ${shortDayLabel(entry.date)}`}
      onSubmit={(event) => {
        event.preventDefault();
        const values =
          reason === "wrong_date"
            ? { date }
            : reason === "wrong_length"
              ? { minutes: Number(minutes) }
              : reason === "wrong_type"
                ? { type }
                : reason === "wrong_topics"
                  ? { topics }
                  : {};
        if (
          sender.save(
            pairing.serviceId,
            { action: "supervision.note", entryId: id, reason, correctedValue: values },
            `note-${id}`,
          )
        )
          onClose();
      }}
    >
      <div className="work-label">
        <span>{`Correct ${shortDayLabel(entry.date)}`}</span>
      </div>
      <div className="assess-field">
        <label htmlFor={`sup-reason-${id}`} className="assess-field__label">
          <span>Correction reason</span>
        </label>
        <select
          id={`sup-reason-${id}`}
          className="assess-txt"
          value={reason}
          disabled={inert}
          onChange={(event) => setReason(event.target.value as CorrectionReason)}
        >
          {correctionReasons.map((value) => (
            <option key={value} value={value}>
              {correctionReasonLabels[value]}
            </option>
          ))}
        </select>
      </div>
      {reason === "wrong_date" ? (
        <DateField
          id={`sup-cdate-${id}`}
          label="Corrected date"
          value={date}
          onChange={setDate}
          min={pairing.startsOn}
          max={today < pairing.endsOn ? today : pairing.endsOn}
          disabled={inert}
        />
      ) : null}
      {reason === "wrong_length" ? (
        <MinutesField
          id={`sup-cminutes-${id}`}
          label="Corrected minutes"
          value={minutes}
          onChange={setMinutes}
          disabled={inert}
        />
      ) : null}
      {reason === "wrong_type" ? (
        <AssessSegmented label="Corrected type" value={type} onChange={setType} options={TYPE_OPTIONS} />
      ) : null}
      {reason === "wrong_topics" ? (
        <TopicChips legend="Corrected topics (up to five)" value={topics} onChange={setTopics} disabled={inert} />
      ) : null}
      <AssessNote icon={ShieldCheck}>The original record is retained.</AssessNote>
      <WorkButton type="submit" size="wide" disabled={inert}>
        Send correction for confirmation
      </WorkButton>
      <WorkButton variant="secondary" disabled={inert} onClick={onClose}>
        Cancel correction
      </WorkButton>
    </form>
  );
}

/* ---------------------------------------------------------------- page */

function SupervisionBody({
  pairings,
  today,
  sender,
}: {
  pairings: SupervisionPairingView[];
  today: string;
  sender: Sender;
}) {
  const [correcting, setCorrecting] = useState<{ pairingId: string; entry: SupervisionEntry } | null>(null);
  const waiting = useMemo(() => pendingConfirmations(pairings), [pairings]);
  const waitingIds = useMemo(() => new Set(waiting.map((item) => item.id)), [waiting]);
  const supervising = pairings.some((p) => p.access === "supervisor" && !p.readOnlyUntil);
  useModeBandCount("assess-supervision", supervising ? waiting.length : null);
  if (!pairings.length)
    return (
      <WorkEmpty
        icon={Users}
        title="No supervision pairing yet"
        body="Ask your service organiser to pair you with your supervisor, or with the doctors you supervise."
      />
    );
  return (
    <>
      {supervising ? (
        <>
          <SectionLabel end={<SectionNote>{waiting.length}</SectionNote>}>Waiting for you</SectionLabel>
          {waiting.length ? (
            <div className="work-card" aria-label="Waiting for you" role="group">
              {waiting.map((item) => (
                <WaitingItem key={item.id} item={item} sender={sender} />
              ))}
            </div>
          ) : (
            <AssessNote center>Nothing is waiting for you to confirm.</AssessNote>
          )}
        </>
      ) : null}
      <SectionLabel>This term</SectionLabel>
      {pairings.map((pairing) => (
        <PairingCard key={pairing.pairingId} pairing={pairing} />
      ))}
      {pairings.map((pairing) =>
        pairing.access === "registrar" && !pairing.readOnlyUntil ? (
          <LogForm key={`log-${pairing.pairingId}`} pairing={pairing} today={today} sender={sender} />
        ) : null,
      )}
      {pairings.map((pairing) => (
        <div key={`recent-${pairing.pairingId}`} className="contents">
          <RecentList
            pairing={pairing}
            sender={sender}
            waitingIds={waitingIds}
            onCorrect={(entry) => setCorrecting({ pairingId: pairing.pairingId, entry })}
          />
          {correcting?.pairingId === pairing.pairingId ? (
            <CorrectionForm
              key={correcting.entry.entryId}
              pairing={pairing}
              entry={correcting.entry}
              today={today}
              sender={sender}
              onClose={() => setCorrecting(null)}
            />
          ) : null}
        </div>
      ))}
    </>
  );
}

function SupervisionPage({ demoMode }: { demoMode: boolean }) {
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const resource = useTeachingResource<{ pairings: SupervisionPairingView[] }>(
    demoMode ? null : "/api/teaching/depth?view=supervision",
  );
  const pairings = useMemo(
    () => (demoMode && today ? demoSupervision(today) : resource.data?.pairings),
    [demoMode, today, resource.data],
  );
  const sender = useSupervisionSender(demoMode, resource.retry);
  let body;
  if (!demoMode && resource.status === "signed-out") body = <TeachingSignInNotice />;
  else if (!demoMode && (resource.status === "offline" || resource.status === "error" || resource.status === "setup"))
    body = <TeachingStateNotice state={resource.status} onRetry={resource.retry} />;
  else if (!pairings || !today) body = <ModeModuleSkeleton rows={3} />;
  else body = <SupervisionBody pairings={pairings} today={today} sender={sender} />;
  return (
    <WorkBody testId="teaching-supervision">
      <AssessHeader eyebrow="Confirmed hours" title="Supervision" />
      {demoMode ? <AssessSample>Made-up demo. Changes stay on this page and are not saved.</AssessSample> : null}
      {body}
      {sender.busy ? (
        <p role="status" className="assess-note" data-center="">
          <span>Sending…</span>
        </p>
      ) : null}
      {sender.message ? (
        sender.message.failed ? (
          <AssessCallout icon={TriangleAlert} tone="amber" title="Not saved" role="alert">
            {`${sender.message.text} Your entries are still here, so you can send again.`}
          </AssessCallout>
        ) : (
          <p role="status" className="assess-note" data-center="">
            <span>{sender.message.text}</span>
          </p>
        )
      ) : null}
      <AssessNote icon={ShieldCheck} center>
        Topics only, never patient details. Confirming records the supervisor&apos;s acknowledgement. Not CPD credit.
      </AssessNote>
      {sender.holding ? (
        <AssessUndoBar
          testId="teaching-supervision-pending"
          durationMs={SUPERVISION_UNDO_MS}
          srText="Waiting 10 seconds before sending. Leaving this page cancels the unsent change."
          onUndo={sender.undo}
        >
          Sending in 10 s
        </AssessUndoBar>
      ) : null}
    </WorkBody>
  );
}

export function TeachingSupervision(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={SupervisionPage} {...props} />;
}
