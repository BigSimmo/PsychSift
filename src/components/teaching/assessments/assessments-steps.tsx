"use client";

import { Bell, CalendarDays, Check, Clock, Eye, EyeOff, FileText, Lock, Send, Users } from "lucide-react";
import { useState } from "react";

import { WorkButton, WorkDock } from "@/components/mode-kit/work";
import { AssessButton } from "@/components/teaching/assessments/assess-kit";

import { focusRing } from "@/components/card-recipes";
import { modePressable } from "@/components/mode-kit/recipes";
import {
  Eyebrow,
  Inset,
  List,
  NoteField,
  Panel,
  Row,
  ScreenHeader,
  SectionLabel,
  SectionNote,
  SmallPrint,
  StepRow,
  TickRow,
  WhyNot,
  secondaryText,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { cn } from "@/components/ui-primitives";
import {
  bookableDay,
  bookingLabel,
  currentStepNumber,
  dayLabel,
  dayStatus,
  endOfTermLine,
  endOfTermSteps,
  meetingHeld,
  meetingDate,
  selfDone,
  stage,
  supReady,
  supervisorLate,
  windowOpen,
} from "@/lib/teaching/assessments/model";
import { NIGHT_DAYS, SAMPLE_REGISTRAR, SAMPLE_SUPERVISOR, WINDOW_DAYS } from "@/lib/teaching/assessments/sample";

const SUP = SAMPLE_SUPERVISOR.short;

/** A link drawn as a button: navigation stays a link. */
function LinkButton({
  href,
  primary,
  icon,
  children,
}: {
  href: string;
  primary?: boolean;
  icon?: typeof Send;
  children: string;
}) {
  return (
    <WorkButton href={href} variant={primary ? "primary" : "secondary"} size="wide" icon={icon}>
      {children}
    </WorkButton>
  );
}

/** "Remind Dr Wattle": the made-up records send nothing, so the button says what happened instead. */
function SampleOnlyButton({ children }: { children: string }) {
  const [said, setSaid] = useState(false);
  return (
    <>
      <AssessButton variant="secondary" block onClick={() => setSaid(true)}>
        {children}
      </AssessButton>
      {said ? (
        <p role="status" className="px-1 text-center text-xs text-[color:var(--text-muted)]">
          Made-up records: nothing was sent.
        </p>
      ) : null}
    </>
  );
}

export function EndOfTermSteps({ s }: ScreenProps) {
  const st = stage(s);
  const steps = endOfTermSteps(s);
  const late = supervisorLate(s);
  let primary: React.ReactNode = null;
  if (!s.request.sent)
    primary = (
      <WorkButton href={viewHref("request")} icon={Send}>
        {`Ask ${SUP}`}
      </WorkButton>
    );
  else if (st === "sup-signed")
    primary = (
      <WorkButton href={viewHref("report", { of: "eot" })} icon={FileText}>
        Read and sign your report
      </WorkButton>
    );
  else if (st === "doc-signed" && !s.sentToMeu)
    primary = (
      <WorkButton href={viewHref("pdf", { of: "eot" })} icon={Send}>
        Email the PDF to your MEU
      </WorkButton>
    );
  else if (windowOpen(s) && !s.booking && !meetingHeld(s))
    primary = (
      <WorkButton href={viewHref("book")} icon={CalendarDays}>
        Book the meeting
      </WorkButton>
    );
  return (
    <>
      <ScreenHeader
        back={viewHref("home")}
        backLabel="Assessments"
        title="End-of-term"
        subtitle="Psychiatry · term 4"
      />
      <Panel>
        <Eyebrow accent>{`Step ${currentStepNumber(steps)} of ${steps.length}`}</Eyebrow>
        <h2 className="text-xl leading-tight font-semibold text-[color:var(--text-heading)]">{endOfTermLine(s)}</h2>
        <p className={secondaryText}>Due to your MEU by Fri 20 Nov, within 10 working days of the end of term.</p>
      </Panel>
      {late ? (
        <Inset tone="warm" title={`${SUP} hasn't finished her draft`} role="status">
          Booking closes Fri 6 Nov. Send a reminder, or ask your MEU for another assessor or more time.
        </Inset>
      ) : null}
      <List label="End-of-term steps">
        {steps.map((step) => (
          <StepRow key={step.title} state={step.state} title={step.title} detail={step.detail} />
        ))}
      </List>
      {primary || (!s.request.sent && !selfDone(s)) ? (
        <WorkDock>
          {primary}
          {!s.request.sent && !selfDone(s) ? (
            <WorkButton variant="secondary" href={viewHref("form")}>
              Rate first
            </WorkButton>
          ) : null}
        </WorkDock>
      ) : null}
      {s.request.sent && !supReady(s) ? <SampleOnlyButton>{`Remind ${SUP}`}</SampleOnlyButton> : null}
      {st === "met" ? <SampleOnlyButton>{`Remind ${SUP} to sign`}</SampleOnlyButton> : null}
      {late ? <LinkButton href={viewHref("help")}>Ask your MEU for help</LinkButton> : null}
      {s.sigs.doc ? <LinkButton href={viewHref("pdf", { of: "eot" })}>View the signed PDF</LinkButton> : null}
    </>
  );
}

export function AskSupervisor({ s, dispatch, go }: ScreenProps) {
  const r = s.request;
  return (
    <>
      <ScreenHeader
        back={viewHref("hub")}
        backLabel="End-of-term"
        title="Ask your supervisor"
        subtitle="End-of-term · Psychiatry"
      />
      {r.sent ? (
        <Inset tone="ok" icon={Check} title={`${SUP} has your request`}>
          Open the end-of-term steps to see where it is up to.
        </Inset>
      ) : null}
      {selfDone(s) ? null : (
        <Inset tone="plain" title="You haven't rated yourself">
          That&apos;s optional, but it makes the meeting more useful. You can do it after sending, until {SUP} finishes
          her draft.
        </Inset>
      )}
      <SectionLabel end={<SectionNote>From your Work profile</SectionNote>}>Send to</SectionLabel>
      <List>
        <Row avatar={SAMPLE_SUPERVISOR.initials} title={SAMPLE_SUPERVISOR.name} subtitle={SAMPLE_SUPERVISOR.role} />
        <TickRow
          checked={r.registrar}
          onChange={() => dispatch({ type: "toggle-registrar" })}
          detail={`${SAMPLE_REGISTRAR.name} sees the blank form only and can add notes.`}
        >
          Also ask a registrar for notes
        </TickRow>
      </List>
      <List>
        <Row icon={Eye} title="The blank form" subtitle="What she sees now" />
        <Row icon={EyeOff} title="Your ratings and notes" subtitle="Hidden until she finishes her draft" />
        <Row icon={Clock} title="Fri 20 Nov" subtitle="Due to the MEU" />
      </List>
      <SectionLabel end={<SectionNote>You choose</SectionNote>}>Evidence to share</SectionLabel>
      <List>
        <TickRow checked={s.share.epa} onChange={() => dispatch({ type: "toggle-share", key: "epa" })}>
          EPAs this term (EPA 3)
        </TickRow>
        <TickRow checked={s.share.mid} onChange={() => dispatch({ type: "toggle-share", key: "mid" })}>
          Mid-term report, Fri 2 Oct
        </TickRow>
        <TickRow checked={s.share.log} onChange={() => dispatch({ type: "toggle-share", key: "log" })}>
          Logbook: 3 teaching sessions, 1 course
        </TickRow>
      </List>
      <NoteField
        id="assess-request-message"
        label="Message (optional)"
        value={r.message}
        readOnly={r.sent}
        onChange={(value) => dispatch({ type: "set-request-message", value })}
        placeholder="Anything you'd like her to look at."
      />
      <SmallPrint>
        {SUP} gets a secure link by email, or it appears in her PsychSift inbox if she has one. On these made-up records
        nothing is sent.
      </SmallPrint>
      {r.sent ? null : (
        <AssessButton
          icon={Send}
          variant="primary"
          block
          onClick={() => {
            dispatch({ type: "send-request" });
            go(viewHref("hub"));
          }}
        >
          Send request
        </AssessButton>
      )}
    </>
  );
}

function DayButton({
  day,
  selected,
  onPick,
  status,
  enabled,
}: {
  day: number;
  selected: boolean;
  onPick: () => void;
  status: string;
  enabled: boolean;
}) {
  const d = WINDOW_DAYS[day]!;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${dayLabel(day)}: ${status}`}
      disabled={!enabled}
      onClick={onPick}
      data-mode-identity="teaching"
      className={cn(
        focusRing,
        "grid min-h-16 min-w-0 justify-items-center gap-0.5 rounded-xl border px-1 py-2 text-center disabled:cursor-not-allowed forced-colors:border",
        selected
          ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]"
          : enabled
            ? cn(
                modePressable,
                "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-heading)]",
              )
            : "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
      )}
    >
      <small className="text-2xs font-semibold">{d[0]}</small>
      <b className="text-base font-normal tabular-nums">{d[1]}</b>
      <i className="text-2xs not-italic">{status}</i>
    </button>
  );
}

export function BookMeeting({ s, dispatch }: ScreenProps) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const firstBookable = WINDOW_DAYS.findIndex((_, i) => bookableDay(s, i));
  const [pickDay, setPickDay] = useState<number>(firstBookable);
  const [pickTime, setPickTime] = useState<string | null>(null);
  const header = (title: string, subtitle: string) => (
    <ScreenHeader back={viewHref("hub")} backLabel="End-of-term" title={title} subtitle={subtitle} />
  );

  if (meetingHeld(s))
    return (
      <>
        {header("Meeting", "End-of-term")}
        <Panel>
          <Eyebrow>Held</Eyebrow>
          <p className="text-lg font-semibold text-[color:var(--text-heading)]">{meetingDate(s)}</p>
          <p className={secondaryText}>With {SAMPLE_SUPERVISOR.name}</p>
        </Panel>
      </>
    );

  if (!windowOpen(s) && !s.booking)
    return (
      <>
        {header("Book a meeting", "End-of-term")}
        <Panel className="justify-items-start">
          <Lock aria-hidden="true" className="size-icon-lg text-[color:var(--text-muted)]" />
          <h2 className="text-lg font-semibold text-[color:var(--text-heading)]">Opens Mon 26 Oct</h2>
          <p className={secondaryText}>
            The booking window is the last two weeks of term. That keeps the meeting near the end of term, so the form
            can reach the MEU by Fri 20 Nov.
          </p>
          <AssessButton
            variant={s.remindWhenOpen ? "secondary" : "primary"}
            icon={s.remindWhenOpen ? Check : Bell}
            onClick={() => dispatch({ type: "toggle-remind-open" })}
          >
            {s.remindWhenOpen ? "Reminder set" : "Remind me when it opens"}
          </AssessButton>
        </Panel>
        <List>
          <Row icon={CalendarDays} title="Mon 26 Oct to Fri 6 Nov" subtitle="Term ends Sun 8 Nov" />
          <Row icon={Clock} title="30 minutes" subtitle={`At times ${SUP} has offered`} />
        </List>
        <SmallPrint center>Your MEU can change the window for your hospital.</SmallPrint>
      </>
    );

  if (s.booking)
    return (
      <>
        {header("Meeting booked", "End-of-term")}
        <Panel>
          <Eyebrow>Booked</Eyebrow>
          <p className="text-lg font-semibold text-[color:var(--text-heading)]">{bookingLabel(s.booking)}</p>
          <p className={secondaryText}>With {SAMPLE_SUPERVISOR.name} · Ward A office · 30 minutes</p>
        </Panel>
        <List>
          <TickRow checked={s.addToMyDay} onChange={() => dispatch({ type: "toggle-my-day" })}>
            Add to My Day
          </TickRow>
          <TickRow checked={s.remindDayBefore} onChange={() => dispatch({ type: "toggle-remind-day" })}>
            Remind me the day before
          </TickRow>
          <Row icon={Users} title={`${SUP} has been told`} subtitle="She gets an email, or it shows in her inbox" />
        </List>
        <SmallPrint>On these made-up records, nothing is added to My Day and no one is told.</SmallPrint>
        {confirmCancel ? (
          <>
            <Inset tone="warm" title="Cancel this booking?" role="status">
              {SUP} will be told. You can pick another time while the window is open.
            </Inset>
            <div className="grid grid-cols-2 gap-2">
              <AssessButton variant="secondary" onClick={() => setConfirmCancel(false)}>
                Keep it
              </AssessButton>
              <AssessButton
                variant="primary"
                onClick={() => {
                  dispatch({ type: "cancel-booking" });
                  setConfirmCancel(false);
                }}
              >
                Cancel booking
              </AssessButton>
            </div>
          </>
        ) : (
          <AssessButton variant="secondary" block onClick={() => setConfirmCancel(true)}>
            Change time
          </AssessButton>
        )}
      </>
    );

  const day = pickDay >= 0 && bookableDay(s, pickDay) ? pickDay : firstBookable;
  const slots = day >= 0 ? (s.avail[day] ?? []) : [];
  const time = pickTime && slots.includes(pickTime) ? pickTime : null;
  const nights = [...NIGHT_DAYS].map(dayLabel).map((l) => l.replace(/ Oct$/, ""));
  return (
    <>
      {header("Book a meeting", `End-of-term · with ${SUP}`)}
      <Inset tone="plain" icon={CalendarDays} title="Open until Fri 6 Nov">
        Pick a time {SUP} has offered. You&apos;re rostered on nights {nights.join(" and ")} Oct, so those days are
        blocked.
      </Inset>
      {[0, 5].map((start) => (
        <section
          key={start}
          className="grid gap-1.5"
          aria-label={start === 0 ? "Week 9, October" : "Week 10, November"}
        >
          <span className="px-1 text-2xs font-semibold tracking-label text-[color:var(--text-muted)] uppercase">
            {start === 0 ? "Week 9 · Oct" : "Week 10 · Nov"}
          </span>
          <div className="grid grid-cols-5 gap-1.5">
            {[0, 1, 2, 3, 4].map((offset) => {
              const i = start + offset;
              return (
                <DayButton
                  key={i}
                  day={i}
                  selected={i === day}
                  enabled={bookableDay(s, i)}
                  status={dayStatus(s, i)}
                  onPick={() => {
                    setPickDay(i);
                    setPickTime(null);
                  }}
                />
              );
            })}
          </div>
        </section>
      ))}
      {day >= 0 ? (
        <>
          <SectionLabel>{dayLabel(day)}</SectionLabel>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label={`Times on ${dayLabel(day)}`}>
            {slots.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={time === t}
                onClick={() => setPickTime(t)}
                data-mode-identity="teaching"
                className={cn(
                  focusRing,
                  modePressable,
                  "grid min-h-14 justify-items-center rounded-xl border px-2 py-2 forced-colors:border",
                  time === t
                    ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)] text-[color:var(--text-heading)]"
                    : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-heading)]",
                )}
              >
                <b className="text-sm font-normal tabular-nums">{t}</b>
                <small className="text-2xs text-[color:var(--text-muted)]">30 min</small>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className={secondaryText}>No times left in the window. Message {SUP} from Supervision.</p>
      )}
      <AssessButton
        icon={Check}
        variant="primary"
        block
        disabled={!time}
        describedBy={time ? undefined : "assess-book-why"}
        onClick={() => time && dispatch({ type: "book", day, time })}
      >
        {time ? `Book ${dayLabel(day)}, ${time}` : "Pick a time"}
      </AssessButton>
      {time ? null : <WhyNot id="assess-book-why">Pick one of the times above.</WhyNot>}
      <SampleOnlyButton>{`Ask ${SUP} for another time`}</SampleOnlyButton>
    </>
  );
}
