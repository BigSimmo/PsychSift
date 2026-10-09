"use client";

import {
  Award,
  BookOpen,
  CalendarDays,
  Check,
  Clock,
  Copy,
  EyeOff,
  FileText,
  History,
  Layers,
  PenLine,
  Plus,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { AssessmentsSampleViewsNav, useAssessmentsExtras } from "@/components/teaching/assessments/assessments-extras";
import {
  WorkButton,
  WorkChip,
  WorkChips,
  WorkDateRow,
  WorkDock,
  WorkEmpty,
  WorkHero,
  WorkRing,
  WorkTag,
  useWorkUndoToast,
} from "@/components/mode-kit/work";
import {
  AssessCallout,
  AssessHeader,
  AssessKeyValue,
  AssessMeter,
  AssessNote,
  AssessPair,
  AssessSegmented,
  CompareRow,
  KindsStrip,
  SlotDay,
  type KindState,
  type SlotState,
} from "@/components/teaching/assessments/assess-kit";
import { TermTrack } from "@/components/teaching/assessments/assessments-home";
import {
  List,
  Row,
  SectionLabel,
  SectionNote,
  StepRow,
  TextLink,
  traineeHref,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import {
  EPAS,
  FORM_STEPS,
  GLOSSARY,
  epa as epaInfo,
  globalRatingName,
  supervisionLevelName,
} from "@/lib/teaching/assessments/content";
import {
  YEAR_WEEKS,
  bookingLabel,
  compareRatings,
  dayLabel,
  epa1ThisTerm,
  epaCounts,
  epaNeedMore,
  epaRecords,
  epasInTerm,
  kindsDone,
  meetingDate,
  epaWithAssessor,
  pendingEpaRequest,
  selfDone,
  stage,
  talkingPoints,
  termWeek,
  weeksDone,
  windowOpen,
  type AssessmentsState,
} from "@/lib/teaching/assessments/model";
import {
  MEETING_TIMES,
  NIGHT_DAYS,
  SAMPLE_DOCTOR,
  SAMPLE_LEAVE,
  SAMPLE_MIDTERM,
  SAMPLE_SUPERVISOR,
  SAMPLE_TERMS,
  WINDOW_DAYS,
} from "@/lib/teaching/assessments/sample";
import { withUnit } from "@/components/teaching/teaching-number";

const DOC = SAMPLE_DOCTOR;
const asSup = { as: "supervisor" };
const home = viewHref("home", asSup);
const FORM_TOTAL = FORM_STEPS.length;

/** The other doctors on the list are made-up names only: they have no forms in this sample. */
/** The made-up doctors' ids are the term overview's, so each row opens that doctor's own page. */
const BEN = { id: "ben", name: "Dr Ash Zamia", initials: "AZ", grade: "PGY2", due: "Fri 16 Oct" } as const;
const MIA = { id: "mia", requestId: "mia-epa-2", name: "Dr Frankie Mulga", initials: "FM" } as const;

const benOverdue = (s: AssessmentsState) => s.now >= 0;
const countersigned = SAMPLE_TERMS.filter((t) => t.status === "done").length;
const midTermsSigned = SAMPLE_TERMS.filter((t) => t.midSigned).length + 1;

/** Thirty minutes after a "14:30" time. */
function plusHalfHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function windowDay(day: number) {
  const d = WINDOW_DAYS[day];
  return d ? { date: d[1], month: d[2] } : { date: "", month: "" };
}

/** Form steps the supervisor has passed: none until asked, all once the draft is done. */
function stepsDone(s: AssessmentsState): number {
  const st = stage(s);
  if (st === "sup-draft") return Math.min(FORM_TOTAL - 1, s.sup.step);
  if (st === "start" || st === "self-draft" || st === "self-done" || st === "requested") return 0;
  return FORM_TOTAL;
}

const meetingIsToday = (s: AssessmentsState) => !!s.booking && s.now >= s.booking.day && !meetingDate(s);

/* ------------------------------------------------------------- the hero */

function SamHero({ s, dispatch, go }: Pick<ScreenProps, "s" | "dispatch" | "go">) {
  const st = stage(s);
  const done = stepsDone(s);
  const timesButton = (
    <WorkButton variant="tinted" icon={Clock} href={viewHref("times", asSup)}>
      Set times
    </WorkButton>
  );
  let eyebrow = "End-of-term · due to the MEU Fri 20 Nov";
  let sub: string;
  let actions: ReactNode;
  if (st === "start" || st === "self-draft" || st === "self-done") {
    sub = `${DOC.grade}. ${DOC.first} hasn't asked yet. Doctors ask in the last weeks of term.`;
    actions = (
      <>
        <WorkButton
          variant="secondary"
          icon={Copy}
          onClick={() => {
            dispatch({ type: "form-example", who: "self" });
            dispatch({ type: "form-finish", who: "self" });
            dispatch({ type: "send-request" });
          }}
        >
          Try an example request
        </WorkButton>
        {timesButton}
      </>
    );
  } else if (st === "requested" || st === "sup-draft") {
    sub =
      st === "requested"
        ? `${DOC.grade}. ${DOC.first} asked you on ${dayLabel(s.request.sentOn)}. You rate first.`
        : `${DOC.grade}. Your draft is saved at step ${withUnit(s.sup.step + 1, "of")} ${FORM_TOTAL}.`;
    actions = (
      <>
        <WorkButton variant="secondary" icon={PenLine} href={viewHref("form", asSup)}>
          {st === "requested" ? "Start draft" : "Continue draft"}
        </WorkButton>
        {timesButton}
      </>
    );
  } else if (st === "ready" && meetingIsToday(s)) {
    eyebrow = "Today · Ward A office";
    sub = `Meeting ${s.booking!.time} to ${plusHalfHour(s.booking!.time)}. You sign after it.`;
    actions = (
      <>
        <WorkButton
          variant="secondary"
          icon={PenLine}
          onClick={() => {
            dispatch({ type: "meeting-held" });
            go(viewHref("sign", asSup));
          }}
        >
          We&apos;ve met, sign now
        </WorkButton>
        <WorkButton variant="tinted" icon={Layers} href={viewHref("side", asSup)}>
          Side by side
        </WorkButton>
      </>
    );
  } else if (st === "ready") {
    sub = s.booking
      ? `Draft done. Meeting ${bookingLabel(s.booking)}, Ward A office.`
      : `Draft done. ${DOC.first} books a time in the window.`;
    actions = (
      <>
        <WorkButton variant="secondary" icon={Layers} href={viewHref("side", asSup)}>
          Side by side
        </WorkButton>
        {s.booking ? null : timesButton}
      </>
    );
  } else if (st === "met") {
    eyebrow = `Met ${meetingDate(s)}`;
    sub = `You sign next, then ${DOC.first} signs and emails the PDF to the MEU.`;
    actions = (
      <WorkButton variant="secondary" icon={PenLine} href={viewHref("sign", asSup)}>
        Sign now
      </WorkButton>
    );
  } else if (st === "sup-signed") {
    eyebrow = `Signed ${s.sigs.sup?.date ?? ""}`;
    sub = `Waiting for ${DOC.first} to read the report and sign.`;
    actions = (
      <WorkButton variant="secondary" icon={Layers} href={viewHref("side", asSup)}>
        Side by side
      </WorkButton>
    );
  } else {
    eyebrow = "Signed by you both";
    sub = `${DOC.first} emails the PDF to the MEU. The DCT countersigns next.`;
    actions = (
      <WorkButton variant="secondary" icon={FileText} href={viewHref("pdf", { ...asSup, of: "eot" })}>
        View PDF
      </WorkButton>
    );
  }
  return (
    <WorkHero
      testId="assess-hero"
      eyebrow={eyebrow}
      title={`${DOC.name} · end-of-term`}
      sub={sub}
      ring={
        <WorkRing
          value={`${done}/${FORM_TOTAL}`}
          label="steps"
          fraction={done / FORM_TOTAL}
          accessibleLabel={`${withUnit(done, "of")} ${FORM_TOTAL} form steps done`}
        />
      }
      footer={<div className="assess-hero-actions">{actions}</div>}
    />
  );
}

/* ---------------------------------------------------------- the To do tab */

export function SupervisorHome({ s, dispatch, openSheet, go }: ScreenProps) {
  const overdue = benOverdue(s);
  // Frankie's EPA is answered in the inbox or on Frankie's page: the row says so rather than staying New.
  const miaAnswer = useAssessmentsExtras().extras.answers[MIA.requestId]?.status;
  const miaTag =
    miaAnswer === "sent" || miaAnswer === "sending" ? (
      <WorkTag tone="green">Sent</WorkTag>
    ) : miaAnswer === "passed" ? (
      <WorkTag tone="neutral">Passed on</WorkTag>
    ) : miaAnswer === "later" ? (
      <WorkTag tone="neutral">Later</WorkTag>
    ) : miaAnswer === "queued" ? (
      <WorkTag tone="amber">To send</WorkTag>
    ) : (
      <WorkTag>New</WorkTag>
    );
  const offered = Object.values(s.avail).flat().length;
  const epaRows = s.epaRequests.map((r, i) => ({ r, i })).filter(({ r }) => r.who === "sup" && epaWithAssessor(r));
  const ben = (
    <Row
      avatar={BEN.initials}
      title={`${BEN.name} · mid-term`}
      subtitle={`${BEN.grade} · ${overdue ? "was due" : "due"} to the MEU ${BEN.due}`}
      tag={overdue ? <WorkTag tone="red">Overdue</WorkTag> : <WorkTag tone="neutral">{BEN.due}</WorkTag>}
      href={traineeHref(BEN.id)}
    />
  );
  const open = windowOpen(s);
  const first = windowDay(0);
  const last = windowDay(WINDOW_DAYS.length - 1);
  return (
    <>
      <AssessHeader eyebrow={`Term 4 · week ${withUnit(termWeek(s), "of")} 10`} title="Assessments" />
      <SamHero s={s} dispatch={dispatch} go={go} />
      <SectionLabel end={<SectionNote>{epaRows.length + 2}</SectionNote>}>Requests</SectionLabel>
      <List label="Requests">
        {overdue ? ben : null}
        {epaRows.map(({ r, i }) => (
          <Row
            key={`epa-${i}`}
            avatar={DOC.initials}
            title={`${DOC.name} · EPA ${r.epa}`}
            subtitle={`${epaInfo(r.epa).title} · ${r.status === "not-yet" ? "not yet, " : ""}by Sun 8 Nov`}
            end={
              <WorkButton variant="tinted" onClick={() => openSheet({ kind: "supepa", index: i })}>
                Record<span className="sr-only">{` EPA ${r.epa} for ${DOC.name}`}</span>
              </WorkButton>
            }
          />
        ))}
        <Row
          avatar={MIA.initials}
          title={`${MIA.name} · EPA 2`}
          subtitle="Acutely unwell patient · asked Fri 2 Oct"
          tag={miaTag}
          href={traineeHref(MIA.id)}
        />
        {overdue ? null : ben}
        <Row
          avatar={DOC.initials}
          title={`Everything from ${DOC.name}`}
          subtitle="Requests, supervision and corrections"
          href={traineeHref("sam")}
        />
        <Row
          icon={Users}
          iconTone="mode"
          title="Confirm supervision"
          subtitle="Hours your doctors logged with you"
          href="/teaching/supervision"
        />
      </List>
      <AssessNote icon={ShieldCheck}>
        {`${BEN.name} and ${MIA.name} are made-up names to show a list. Their forms aren't built into this example.`}
      </AssessNote>
      <AssessmentsSampleViewsNav s={s} />
      <SectionLabel>Coming up</SectionLabel>
      <List label="Coming up">
        {s.booking ? (
          <li>
            <WorkDateRow
              month={windowDay(s.booking.day).month}
              day={windowDay(s.booking.day).date}
              title={`Meeting with ${DOC.name}`}
              sub={`End-of-term · Ward A office · ${s.booking.time}`}
              end={<WorkTag tone="neutral">{meetingDate(s) ? "Held" : "Booked"}</WorkTag>}
              href={viewHref("side", asSup)}
            />
          </li>
        ) : null}
        <li>
          <WorkDateRow
            month={open ? last.month : first.month}
            day={open ? last.date : first.date}
            title={open ? "Booking window closes" : "Booking window opens"}
            sub={offered ? `${offered} half-hour times offered` : "No times offered yet"}
            end={
              <WorkButton variant="secondary" href={viewHref("times", asSup)}>
                Set times
              </WorkButton>
            }
          />
        </li>
        <li>
          <WorkDateRow month="Nov" day={20} title="Forms due to the MEU" sub={`End-of-term, ${DOC.name}`} />
        </li>
      </List>
      <AssessCallout icon={EyeOff} tone="neutral" title="You rate first">
        You see a doctor&apos;s self-ratings only after your draft is done. You sign after the meeting.
      </AssessCallout>
      <List label="Help">
        <Row
          icon={BookOpen}
          title="Help and words"
          subtitle="How to rate, and every abbreviation"
          href={viewHref("words", asSup)}
        />
      </List>
      <WorkDock>
        <WorkButton icon={Plus} onClick={() => openSheet({ kind: "recordepa" })}>
          Record EPA
        </WorkButton>
        <WorkButton variant="secondary" icon={Clock} href={viewHref("times", asSup)}>
          Your times
        </WorkButton>
      </WorkDock>
    </>
  );
}

/* ------------------------------------------------- side by side, meeting day */

function RatingsCard({ s }: { s: AssessmentsState }) {
  const self = selfDone(s) ? s.self : null;
  const rows = compareRatings(self?.ratings ?? null, s.sup.ratings, "sup", DOC.first);
  return (
    <section className="work-card" id="assess-ratings" aria-labelledby="assess-ratings-title" tabIndex={-1}>
      <div className="assess-card-head">
        <h3 id="assess-ratings-title" className="work-label m-0">
          Ratings
        </h3>
        <span className="assess-key" aria-hidden="true">
          <span>
            <i data-who="you" />
            You
          </span>
          <span>
            <i data-who="them" />
            {DOC.first}
          </span>
        </span>
      </div>
      {rows.map((row) => (
        <CompareRow
          key={row.domain}
          title={`Domain ${row.domain} · ${row.title}`}
          you={row.sup}
          them={row.self}
          youName="You"
          themName={DOC.first}
          message={row.message}
        />
      ))}
      <div className="assess-ax" aria-hidden="true">
        <span>1 Rarely met</span>
        <span>3 Consistently</span>
        <span>5 Exceeded</span>
      </div>
      <AssessKeyValue k="Your overall rating" v={globalRatingName(s.sup.global)} />
    </section>
  );
}

function TalkingPoints({ s }: { s: AssessmentsState }) {
  const self = selfDone(s) ? s.self : null;
  return (
    <>
      <SectionLabel end={<SectionNote>From the ratings</SectionNote>}>Talking points</SectionLabel>
      <ol className="work-card work-rows m-0 list-none p-0" aria-label="Talking points">
        {talkingPoints(self, s.sup, DOC.first).map((t, i) => (
          <li key={t} className="work-row">
            <span aria-hidden="true" className="work-ic" data-tone="neutral">
              <b className="text-xs font-bold tabular-nums">{i + 1}</b>
            </span>
            <span className="work-row__text">
              <span className="text-sm text-[color:var(--text-heading)]">{t}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

function MeetingList({ s }: { s: AssessmentsState }) {
  return (
    <List label="Meeting">
      {s.booking ? (
        <li>
          <WorkDateRow
            month={windowDay(s.booking.day).month}
            day={windowDay(s.booking.day).date}
            title="Meeting"
            sub={`Ward A office · ${s.booking.time} · you sign after`}
            end={<WorkTag tone="neutral">{meetingDate(s) ? "Held" : "Booked"}</WorkTag>}
          />
        </li>
      ) : (
        <Row
          icon={CalendarDays}
          title="Not booked yet"
          subtitle={`${DOC.first} books in the window, Mon 26 Oct to Fri 6 Nov`}
          href={viewHref("times", asSup)}
        />
      )}
    </List>
  );
}

export function SideBySide({ s, dispatch, go }: ScreenProps) {
  const st = stage(s);
  const self = selfDone(s) ? s.self : null;
  const back = { href: home, label: "To do" };
  if (st === "start" || st === "self-draft" || st === "self-done" || st === "requested" || st === "sup-draft") {
    const drafting = st === "requested" || st === "sup-draft";
    return (
      <>
        <AssessHeader eyebrow={DOC.name} title="Side by side" back={back} />
        <WorkEmpty
          icon={EyeOff}
          title="Finish your draft first"
          body={`${DOC.first}'s self-assessment appears here only after you finish your own draft, so your view is your own.`}
          action={
            <WorkButton icon={PenLine} href={drafting ? viewHref("form", asSup) : home}>
              {drafting ? "Open your draft" : "Back to To do"}
            </WorkButton>
          }
        />
      </>
    );
  }
  const met = st === "met";
  if (met || (st === "ready" && meetingIsToday(s))) {
    const time = s.booking?.time ?? "";
    return (
      <>
        <AssessHeader
          eyebrow={`${met ? meetingDate(s) : dayLabel(s.now)} · end-of-term`}
          title={DOC.name}
          back={back}
        />
        <WorkHero
          eyebrow={met ? `Met ${meetingDate(s)} · Ward A office` : "Today · Ward A office"}
          title={met ? "Ready to sign" : "Ready for the meeting"}
          sub={time ? `${time} to ${plusHalfHour(time)} · 30 minutes` : undefined}
          footer={
            <div className="assess-hero-actions">
              <WorkButton
                variant="secondary"
                icon={PenLine}
                onClick={() => {
                  if (!met) dispatch({ type: "meeting-held" });
                  go(viewHref("sign", asSup));
                }}
              >
                {met ? "Sign now" : "We've met, sign now"}
              </WorkButton>
              <WorkButton
                variant="tinted"
                icon={Layers}
                onClick={() => {
                  const card = document.getElementById("assess-ratings");
                  card?.scrollIntoView({ block: "start" });
                  card?.focus({ preventScroll: true });
                }}
              >
                Ratings
              </WorkButton>
            </div>
          }
        />
        <SectionLabel>Steps</SectionLabel>
        <List label="Steps">
          <StepRow state="ok" title="Your draft" detail="Finished" />
          <StepRow
            state={met ? "ok" : "now"}
            title="Meet and discuss"
            detail={met ? meetingDate(s) : `Today, ${time}`}
          />
          <StepRow state={met ? "now" : "lock"} title="You sign" detail={met ? "Now" : "After the meeting"} />
          <StepRow state="lock" title={`${DOC.first} signs`} detail="Then emails the PDF to the MEU" />
        </List>
        <TalkingPoints s={s} />
        <RatingsCard s={s} />
        <WorkDock>
          <WorkButton variant="secondary" icon={PenLine} href={viewHref("form", asSup)}>
            Change my answers
          </WorkButton>
        </WorkDock>
      </>
    );
  }
  const signed = st === "sup-signed" || st === "doc-signed";
  return (
    <>
      <AssessHeader eyebrow={`${DOC.name} · end-of-term`} title="Side by side" back={back} />
      {signed ? (
        <AssessCallout icon={Check} tone="neutral" title="Signed by you">
          {s.sigs.doc
            ? `${DOC.first} has signed too, and emails the PDF to the MEU. The DCT countersigns next.`
            : `${DOC.first} has an alert to read and sign.`}
        </AssessCallout>
      ) : (
        <AssessCallout icon={Check} title="Draft finished">
          {self
            ? `${DOC.first}'s self-assessment is now visible. Changes from now on are shown to ${DOC.first}.`
            : `${DOC.first} didn't rate themselves this time. Changes from now on are shown to ${DOC.first}.`}
        </AssessCallout>
      )}
      <RatingsCard s={s} />
      <TalkingPoints s={s} />
      {self ? (
        <>
          <SectionLabel>{`${DOC.first}'s own words`}</SectionLabel>
          <div className="work-card work-card--pad grid gap-1.5">
            <span className="work-label">Strengths</span>
            <p className="m-0 text-sm text-[color:var(--text-heading)]">{self.strengths || "Not written"}</p>
            <span className="work-label pt-1.5">Wants to work on</span>
            <p className="m-0 text-sm text-[color:var(--text-heading)]">{self.areas || "Not written"}</p>
          </div>
        </>
      ) : null}
      <MeetingList s={s} />
      <WorkDock>
        {signed ? (
          <WorkButton icon={FileText} href={viewHref("pdf", { ...asSup, of: "eot" })}>
            View PDF
          </WorkButton>
        ) : (
          <WorkButton variant="secondary" icon={PenLine} href={viewHref("form", asSup)}>
            Change my answers
          </WorkButton>
        )}
      </WorkDock>
    </>
  );
}

/* ------------------------------------------------------------ your times */

export function SupervisorTimes({ s, dispatch, go }: ScreenProps) {
  const toast = useWorkUndoToast();
  const offered = Object.values(s.avail).flat().length;
  const day = (i: number) => {
    const on = s.avail[i] ?? [];
    const past = i < Math.max(0, s.now);
    const note = past
      ? "Past"
      : NIGHT_DAYS.has(i)
        ? `${DOC.first} is on nights`
        : on.length
          ? `${on.length} offered`
          : "None offered";
    const slots = MEETING_TIMES.map((time) => {
      const booked = s.booking?.day === i && s.booking.time === time;
      const state: SlotState = booked ? "booked" : past ? "off" : on.includes(time) ? "on" : "idle";
      return {
        time,
        state,
        label: booked ? `${time}, booked by ${DOC.first}` : `${time}, ${on.includes(time) ? "offered" : "not offered"}`,
      };
    });
    return (
      <SlotDay
        key={i}
        day={dayLabel(i)}
        note={note}
        slots={slots}
        onToggle={(time) => dispatch({ type: "toggle-availability", day: i, time })}
      />
    );
  };
  return (
    <>
      <AssessHeader eyebrow="End-of-term window" title="Your times" back={{ href: home, label: "To do" }} />
      <div className="work-card">
        <div className="work-row">
          <span aria-hidden="true" className="work-ic">
            <CalendarDays aria-hidden="true" strokeWidth={2} />
          </span>
          <span className="work-row__text">
            <span className="work-row__title">Mon 26 Oct to Fri 6 Nov</span>
            <span className="work-row__sub">Tap times to offer them. Doctors book 30 minutes.</span>
          </span>
          <span className="work-row__end">
            <WorkTag>{`${offered} offered`}</WorkTag>
          </span>
        </div>
      </div>
      <SectionLabel end={<TextLink href="/roster">From your Roster</TextLink>}>Week 9 · October</SectionLabel>
      <div className="work-card">{[0, 1, 2, 3, 4].map(day)}</div>
      <SectionLabel>Week 10 · November</SectionLabel>
      <div className="work-card">{[5, 6, 7, 8, 9].map(day)}</div>
      <AssessNote icon={ShieldCheck}>
        {`${DOC.first} can't book a day on nights or a day that has passed. A booked time stays offered.`}
      </AssessNote>
      <WorkDock>
        <WorkButton
          icon={Check}
          onClick={() => {
            toast?.(offered ? `${offered} times offered to ${DOC.first}` : "No times offered yet");
            go(home);
          }}
        >
          {offered === 1 ? "Offer 1 time" : `Offer ${offered} times`}
        </WorkButton>
      </WorkDock>
    </>
  );
}

/* -------------------------------------------------------- the Progress tab */

function samEndOfTerm(s: AssessmentsState): string {
  switch (stage(s)) {
    case "requested":
      return "Asked, draft not started";
    case "sup-draft":
      return "Your draft is saved";
    case "ready":
      return s.booking ? `Meeting ${bookingLabel(s.booking)}` : "Draft done, not booked";
    case "met":
      return "Met, you sign next";
    case "sup-signed":
      return "Signed by you";
    case "doc-signed":
      return "Signed by you both";
    default:
      return "Not asked yet";
  }
}

export function SupervisorProgress({ s }: ScreenProps) {
  const [range, setRange] = useState<"term" | "year">("term");
  const week = termWeek(s);
  const weeks = weeksDone(s);
  const thisTerm = epasInTerm(s, "t4").length;
  const total = epaRecords(s).length;
  const yearTarget = total + epaNeedMore(s);
  const overdue = benOverdue(s);
  const ben = (
    <div className="work-card" key="ben">
      <AssessPair
        initials={BEN.initials}
        name={BEN.name}
        sub={`${BEN.grade} · mid-term`}
        tag={overdue ? <WorkTag tone="red">Overdue</WorkTag> : <WorkTag tone="neutral">Due soon</WorkTag>}
        href={traineeHref(BEN.id)}
      />
      <AssessKeyValue
        k="Mid-term"
        v={overdue ? `Overdue since ${BEN.due}` : `Due ${BEN.due}`}
        tone={overdue ? "red" : undefined}
      />
      <AssessKeyValue k="Records" v="Not in this sample" />
    </div>
  );
  const sam = (
    <div className="work-card" key="sam">
      <AssessPair
        initials={DOC.initials}
        name={DOC.name}
        sub={`${DOC.grade} · term ${withUnit(4, "of")} 5`}
        tag={epa1ThisTerm(s) ? undefined : <WorkTag tone="amber">EPA 1</WorkTag>}
        href={viewHref("record", asSup)}
        lines={
          range === "term"
            ? [
                {
                  label: "EPAs",
                  value: `${thisTerm} this term`,
                  fraction: Math.min(1, thisTerm / 2),
                  tone: epa1ThisTerm(s) ? undefined : "amber",
                },
                {
                  label: "Form",
                  value: `${withUnit(stepsDone(s), "of")} ${FORM_TOTAL}`,
                  fraction: stepsDone(s) / FORM_TOTAL,
                },
              ]
            : [
                { label: "Weeks", value: `${withUnit(weeks, "of")} ${YEAR_WEEKS}`, fraction: weeks / YEAR_WEEKS },
                { label: "EPAs", value: `${withUnit(total, "of")} ${yearTarget}`, fraction: total / yearTarget },
                {
                  label: "Kinds",
                  value: `${withUnit(kindsDone(SAMPLE_TERMS), "of")} 4`,
                  fraction: kindsDone(SAMPLE_TERMS) / 4,
                },
              ]
        }
      />
      {range === "term" ? (
        <>
          <AssessKeyValue k="Mid-term" v={`Signed ${SAMPLE_MIDTERM.date}`} />
          <AssessKeyValue k="End-of-term" v={samEndOfTerm(s)} />
        </>
      ) : (
        <>
          <AssessKeyValue k="End-of-term forms" v={`${withUnit(countersigned, "of")} 5 countersigned`} />
          <AssessKeyValue
            k="Leave"
            v={`${withUnit(SAMPLE_LEAVE.used, "of")} ${withUnit(SAMPLE_LEAVE.limit, "days")}`}
          />
        </>
      )}
    </div>
  );
  return (
    <>
      <AssessHeader eyebrow={`Term 4 · week ${withUnit(week, "of")} 10`} title="Progress" />
      <AssessSegmented
        label="Show"
        value={range}
        onChange={setRange}
        options={[
          { value: "term", label: "This term" },
          { value: "year", label: "This year" },
        ]}
      />
      {range === "term" ? (
        <>
          <div className="work-card work-card--pad grid gap-2.5">
            <div className="work-label">
              <span>Psychiatry</span>
              <em className="work-label__count">31 Aug to 8 Nov</em>
            </div>
            <TermTrack week={week} />
            <AssessNote icon={CalendarDays} center>
              {windowOpen(s)
                ? "Booking is open until Fri 6 Nov. Forms due Fri 20 Nov."
                : "Booking opens Mon 26 Oct. Forms due Fri 20 Nov."}
            </AssessNote>
          </div>
          {overdue ? [ben, sam] : [sam, ben]}
        </>
      ) : (
        <>
          {sam}
          <AssessNote icon={ShieldCheck}>{`Year records for ${BEN.name} aren't in this sample.`}</AssessNote>
        </>
      )}
      <AssessNote icon={ShieldCheck} center>
        Counts are records here. CLA stays the official record.
      </AssessNote>
    </>
  );
}

/* ---------------------------------------------------------- doctor record */

export function DoctorRecord({ s, openSheet }: ScreenProps) {
  const w = weeksDone(s);
  const total = epaRecords(s).length;
  const more = epaNeedMore(s);
  const by = epaCounts(s);
  const pending = pendingEpaRequest(s, 1);
  const recordEpa1 = () =>
    pending && pending.who === "sup"
      ? openSheet({ kind: "supepa", index: s.epaRequests.indexOf(pending) })
      : openSheet({ kind: "recordepa", pick: 1 });
  const kinds = (["A", "B", "C", "D"] as const).map((letter) => {
    const done = SAMPLE_TERMS.find((t) => t.category === letter && t.status === "done");
    const now = SAMPLE_TERMS.find((t) => t.category === letter && t.status === "current");
    const any = done ?? now ?? SAMPLE_TERMS.find((t) => t.category === letter);
    const state: KindState = done ? "done" : now ? "now" : "todo";
    return {
      letter,
      name: any?.categoryName ?? letter,
      state,
      note: done ? `Done in term ${done.n}` : now ? "This term, counts once countersigned" : "Not yet",
    };
  });
  return (
    <>
      <AssessHeader
        eyebrow={`${DOC.grade} · 2026`}
        title={DOC.name}
        back={{ href: viewHref("progress", asSup), label: "Progress" }}
      />
      <div className="work-card work-card--pad grid gap-2">
        <div className="work-label">
          <span>Supervised weeks</span>
          <em className="work-label__count">{`${YEAR_WEEKS - w} to go`}</em>
        </div>
        <div className="assess-stat">
          <b>
            {w} <small>{`of ${withUnit(YEAR_WEEKS, "weeks")}`}</small>
          </b>
        </div>
        <AssessMeter fraction={w / YEAR_WEEKS} />
      </div>
      {epa1ThisTerm(s) ? null : (
        <AssessCallout
          icon={TriangleAlert}
          tone="amber"
          title="EPA 1 needed this term"
          action={
            <WorkButton variant="secondary" onClick={recordEpa1}>
              Record
            </WorkButton>
          }
        >
          {pending && pending.who === "sup" ? "By Sun 8 Nov. Requested from you." : "By Sun 8 Nov. Needed every term."}
        </AssessCallout>
      )}
      <SectionLabel end={<SectionNote>{`${withUnit(kindsDone(SAMPLE_TERMS), "of")} 4`}</SectionNote>}>
        Kinds of experience
      </SectionLabel>
      <KindsStrip kinds={kinds} />
      <SectionLabel end={<SectionNote>{`${total} here · ${more} more needed`}</SectionNote>}>EPAs</SectionLabel>
      <List label="EPAs">
        {EPAS.map((x) => {
          const n = by[x.id];
          let tag: ReactNode;
          if (x.id === 1)
            tag = epa1ThisTerm(s) ? (
              <WorkTag tone="neutral">Done this term</WorkTag>
            ) : (
              <WorkTag tone="amber">This term</WorkTag>
            );
          else
            tag = n < 2 ? <WorkTag tone="neutral">{`${2 - n} more`}</WorkTag> : <WorkTag tone="neutral">Met</WorkTag>;
          return (
            <li key={x.id} className="min-w-0">
              <div className="work-row">
                <span aria-hidden="true" className="work-ic" data-tone="neutral">
                  <b className="text-xs font-bold tabular-nums">{x.id}</b>
                </span>
                <span className="work-row__text">
                  <span className="work-row__title">{x.title}</span>
                  <span className="work-row__sub">{n === 1 ? "1 recorded" : `${n} recorded`}</span>
                </span>
                <span className="work-row__end">{tag}</span>
              </div>
            </li>
          );
        })}
      </List>
      <section className="work-card" aria-labelledby="assess-term-forms">
        <h3 id="assess-term-forms" className="work-label assess-card-head">
          Term assessments
        </h3>
        <AssessKeyValue k="Mid-term" v={`${withUnit(midTermsSigned, "of")} 4 so far`} />
        <AssessKeyValue k="End-of-term" v={`${withUnit(countersigned, "of")} 5 countersigned`} />
        <AssessKeyValue k="Leave" v={`${withUnit(SAMPLE_LEAVE.used, "of")} ${withUnit(SAMPLE_LEAVE.limit, "days")}`} />
      </section>
      <AssessNote icon={ShieldCheck}>Counts are records here. CLA stays the official record.</AssessNote>
      <WorkDock>
        <WorkButton icon={Plus} onClick={epa1ThisTerm(s) ? () => openSheet({ kind: "recordepa" }) : recordEpa1}>
          {epa1ThisTerm(s) ? "Record EPA" : "Record EPA 1"}
        </WorkButton>
        <WorkButton variant="secondary" icon={History} href={viewHref("all", asSup)}>
          History
        </WorkButton>
      </WorkDock>
    </>
  );
}

/* ----------------------------------------------------------------- history */

type HistoryFilter = "all" | "mid" | "eot" | "epa";
type HistoryItem = { kind: Exclude<HistoryFilter, "all">; node: ReactNode };

const levelWord = (level: Parameters<typeof supervisionLevelName>[0]) =>
  supervisionLevelName(level).replace(" supervision", "").toLowerCase();

export function SupervisorHistory({ s }: ScreenProps) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const yours = epaRecords(s).filter((r) => r.term === "t4" && r.by === SAMPLE_SUPERVISOR.name);
  const items: HistoryItem[] = [];
  if (s.sigs.sup)
    items.push({
      kind: "eot",
      node: (
        <Row
          key="eot"
          icon={FileText}
          title={`${DOC.name} · end-of-term`}
          subtitle={s.sigs.doc ? `Both signed ${s.sigs.doc.date}` : `You signed ${s.sigs.sup.date}`}
          tag={<WorkTag tone="neutral">{s.sigs.doc ? "Awaiting DCT" : `Waiting for ${DOC.first}`}</WorkTag>}
          href={viewHref("pdf", { ...asSup, of: "eot" })}
        />
      ),
    });
  items.push({
    kind: "mid",
    node: (
      <Row
        key="mid"
        icon={FileText}
        title={`${DOC.name} · mid-term`}
        subtitle={`Both signed ${SAMPLE_MIDTERM.date}`}
        tag={<WorkTag tone="neutral">Feedback</WorkTag>}
        href={viewHref("pdf", { ...asSup, of: "mid" })}
      />
    ),
  });
  yours.forEach((r, i) =>
    items.push({
      kind: "epa",
      node: (
        <Row
          key={`epa-${i}`}
          icon={Award}
          title={`${DOC.name} · EPA ${r.epa}`}
          subtitle={`${epaInfo(r.epa).title} · ${levelWord(r.level)}`}
        />
      ),
    }),
  );
  const shown = items.filter((i) => filter === "all" || i.kind === filter);
  const count = (k: HistoryItem["kind"]) => items.filter((i) => i.kind === k).length;
  return (
    <>
      <AssessHeader eyebrow="Everything you signed" title="History" back={{ href: home, label: "To do" }} />
      <WorkChips label="Show" scroll>
        <WorkChip selected={filter === "all"} onClick={() => setFilter("all")} count={items.length}>
          All
        </WorkChip>
        <WorkChip selected={filter === "mid"} onClick={() => setFilter("mid")} count={count("mid")}>
          Mid-term
        </WorkChip>
        <WorkChip selected={filter === "eot"} onClick={() => setFilter("eot")} count={count("eot")}>
          End-of-term
        </WorkChip>
        <WorkChip selected={filter === "epa"} onClick={() => setFilter("epa")} count={count("epa")}>
          EPAs
        </WorkChip>
      </WorkChips>
      {shown.length ? (
        <>
          <SectionLabel end={<SectionNote>31 Aug to 8 Nov</SectionNote>}>Term 4 · Psychiatry</SectionLabel>
          <List label="Term 4">
            {shown.map((i) => i.node)}
            {filter === "all" ? (
              <Row
                icon={Users}
                title="Supervision"
                subtitle="Confirmed hours are on the Supervision tab"
                href="/teaching/supervision"
              />
            ) : null}
          </List>
        </>
      ) : (
        <WorkEmpty
          icon={History}
          title={filter === "eot" ? "No end-of-term signed yet" : "Nothing here yet"}
          body={
            filter === "eot"
              ? `${DOC.first}'s end-of-term shows here once you sign it.`
              : "Records you sign or save show here."
          }
          action={
            <WorkButton variant="secondary" onClick={() => setFilter("all")}>
              Show all
            </WorkButton>
          }
        />
      )}
      <AssessNote icon={ShieldCheck} center>
        Made-up records. Earlier terms had other supervisors, so they aren&apos;t listed here.
      </AssessNote>
    </>
  );
}

/* ---------------------------------------------------------- help and words */

export function SupervisorWords({ role }: ScreenProps) {
  const sup = role === "supervisor";
  return (
    <>
      <AssessHeader
        eyebrow={sup ? "For supervisors" : "For doctors in training"}
        title="Help and words"
        back={{ href: sup ? home : viewHref("home"), label: sup ? "To do" : "Assessments" }}
      />
      <SectionLabel>How to rate</SectionLabel>
      <List label="How to rate">
        <Row icon={BookOpen} iconTone="mode" title="Rate against PGY1 or PGY2" subtitle="Not against a registrar" />
        <Row
          icon={TriangleAlert}
          iconTone="mode"
          title="A doctor is struggling"
          subtitle="Talk to the DCT or MEU early. Any 1 or 2 needs a plan."
        />
        <Row
          icon={Award}
          iconTone="mode"
          title="Direct supervision is not a fail"
          subtitle="It is feedback for that moment"
        />
      </List>
      <SectionLabel>Words used here</SectionLabel>
      <dl className="work-card m-0">
        {GLOSSARY.map(([term, meaning]) => (
          <div key={term} className="assess-word" data-long={term.length > 8 ? "" : undefined}>
            <dt>{term}</dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
      <AssessNote icon={BookOpen} center>
        Rules from the AMC National Framework 2024
      </AssessNote>
    </>
  );
}
