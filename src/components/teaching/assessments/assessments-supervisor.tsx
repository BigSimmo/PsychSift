"use client";

import {
  BookOpen,
  CalendarDays,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileText,
  MessageSquare,
  PenLine,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { ComparisonChart } from "@/components/teaching/assessments/assessments-report";
import {
  Card,
  Eyebrow,
  Inset,
  KeyValue,
  List,
  Panel,
  Pill,
  Row,
  ScreenHeader,
  SectionLabel,
  SectionNote,
  SmallPrint,
  TextLink,
  secondaryText,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/chip";
import { cn } from "@/components/ui-primitives";
import { epa as epaInfo, globalRatingName } from "@/lib/teaching/assessments/content";
import {
  bookingLabel,
  compareRatings,
  dayLabel,
  meetingDate,
  selfDone,
  stage,
  supervisorTodo,
  talkingPoints,
  type Pill as PillValue,
} from "@/lib/teaching/assessments/model";
import { MEETING_TIMES, SAMPLE_DOCTOR, WINDOW_DAYS } from "@/lib/teaching/assessments/sample";

const DOC = SAMPLE_DOCTOR;
const asSup = { as: "supervisor" };

function LinkRowButton({
  href,
  primary,
  icon: Icon,
  children,
}: {
  href: string;
  primary?: boolean;
  icon?: typeof Eye;
  children: string;
}) {
  return (
    <Link
      href={href}
      className={cn(buttonFaceClass({ variant: primary ? "primary" : "secondary", block: true }), "no-underline")}
    >
      {Icon ? <Icon aria-hidden="true" className="size-icon-sm" /> : null}
      {children}
    </Link>
  );
}

export function SupervisorHome({ s, dispatch, openSheet }: ScreenProps) {
  const st = stage(s);
  const todo = supervisorTodo(s);
  const overdue = s.now >= 0;
  const ben = (
    <Row
      avatar="BO"
      title={
        <>
          Dr Ben Ortiz · <span className="font-normal">mid-term</span>
        </>
      }
      subtitle={`PGY2 · ${overdue ? "was due to the MEU Fri 16 Oct" : "due to the MEU Fri 16 Oct"}`}
      tag={
        <Pill
          pill={
            overdue ? { label: "Overdue since Fri 16 Oct", tone: "warm" } : { label: "Due Fri 16 Oct", tone: "neutral" }
          }
        />
      }
    />
  );
  const samMap: Record<string, [PillValue, string, string]> = {
    requested: [{ label: "New", tone: "accent" }, viewHref("form", asSup), "Psychiatry · due to the MEU Fri 20 Nov"],
    "sup-draft": [
      { label: "Draft saved", tone: "accent" },
      viewHref("form", asSup),
      "Psychiatry · due to the MEU Fri 20 Nov",
    ],
    ready: [
      { label: "Ready for meeting", tone: "accent" },
      viewHref("side", asSup),
      s.booking ? `Meeting ${bookingLabel(s.booking)}` : "Sam hasn't booked yet",
    ],
    met: [{ label: "Sign now", tone: "warm" }, viewHref("side", asSup), `Discussed ${meetingDate(s)}`],
    "sup-signed": [{ label: "Signed", tone: "ok" }, viewHref("side", asSup), "Waiting for Sam to sign"],
    "doc-signed": [
      { label: "Done", tone: "ok" },
      viewHref("side", asSup),
      "Signed by you both · Sam emails it to the MEU",
    ],
  };
  const sam = samMap[st] ?? samMap.requested!;
  return (
    <>
      <Panel>
        <Eyebrow accent>Psychiatry · term 4</Eyebrow>
        <h2 className="text-xl font-semibold text-[color:var(--text-heading)]">{`3 doctors · ${todo} to finish`}</h2>
        <KeyValue k="End-of-term window" v="26 Oct to 6 Nov" />
        <Inset tone="accent" icon={EyeOff} title="You rate first">
          You see each doctor&apos;s self-assessment only after you finish your draft. You sign after the meeting.
        </Inset>
      </Panel>
      <SectionLabel>Requests</SectionLabel>
      <List>
        {overdue ? ben : null}
        {s.request.sent ? (
          <Row
            avatar={DOC.initials}
            title={
              <>
                {DOC.name} · <span className="font-normal">end-of-term</span>
              </>
            }
            subtitle={`${DOC.grade} · ${sam[2]}`}
            tag={<Pill pill={sam[0]} />}
            href={sam[1]}
          />
        ) : (
          <li className="border-t border-[color:var(--border)] first:border-t-0">
            <div className="flex min-h-15 items-center gap-3 px-3.5 py-3">
              <span className="grid min-w-0 gap-0.5">
                <span className="text-sm font-semibold text-[color:var(--text-heading)]">{`${DOC.name} · end-of-term`}</span>
                <span className={secondaryText}>Sam hasn&apos;t sent a request yet.</span>
              </span>
            </div>
            <div className="px-3.5 pb-3.5">
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: "form-example", who: "self" });
                  dispatch({ type: "form-finish", who: "self" });
                  dispatch({ type: "send-request" });
                }}
                className={cn(
                  focusRing,
                  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-dashed border-[color:var(--border-strong)] px-4 py-2 text-sm font-semibold text-[color:var(--text-muted)]",
                )}
              >
                <Copy aria-hidden="true" className="size-icon-sm" />
                Use an example request (made-up records only)
              </button>
            </div>
          </li>
        )}
        {s.epaRequests.map((r, i) =>
          r.who === "sup" && r.status === "requested" ? (
            <Row
              key={`epa-${i}`}
              avatar={DOC.initials}
              title={`${DOC.name} · EPA ${r.epa}`}
              subtitle={`${epaInfo(r.epa).title} · needed by Sun 8 Nov`}
              tag={<Pill pill={{ label: "New", tone: "accent" }} />}
              onClick={() => openSheet({ kind: "supepa", index: i })}
            />
          ) : null,
        )}
        {overdue ? null : ben}
        <Row
          avatar="MC"
          title="Dr Mia Chen · EPA 2"
          subtitle="Acutely unwell patient · asked Fri 2 Oct"
          tag={<Pill pill={{ label: "New", tone: "accent" }} />}
        />
      </List>
      <SmallPrint>
        Dr Ben Ortiz and Dr Mia Chen are made-up examples of a list; their forms aren&apos;t built into this sample.
      </SmallPrint>
      <SectionLabel end={<TextLink href={viewHref("times", asSup)}>Set times</TextLink>}>Meetings</SectionLabel>
      <List>
        {s.booking ? (
          <Row icon={CalendarDays} title={DOC.name} subtitle={`${bookingLabel(s.booking)} · end-of-term`} />
        ) : null}
        <Row
          icon={Clock}
          title="Your times in the end-of-term window"
          subtitle={`${Object.values(s.avail).flat().length} half-hour times offered over 2 weeks`}
          href={viewHref("times", asSup)}
        />
      </List>
      <SectionLabel>Help for supervisors</SectionLabel>
      <List>
        <Row
          icon={BookOpen}
          title="How to rate"
          subtitle="Rate against what's expected for PGY1 or PGY2, not a registrar."
        />
        <Row
          icon={TriangleAlert}
          title="A doctor is struggling"
          subtitle="Talk to the DCT or MEU early. Any 1 or 2 needs an improvement plan."
        />
      </List>
    </>
  );
}

export function SideBySide({ s, dispatch }: ScreenProps) {
  const st = stage(s);
  const self = selfDone(s) ? s.self : null;
  const p = s.sup;
  if (st === "start" || st === "self-draft" || st === "self-done" || st === "requested" || st === "sup-draft")
    return (
      <>
        <ScreenHeader
          back={viewHref("home", asSup)}
          backLabel="your requests"
          title="Side by side"
          subtitle={DOC.name}
        />
        <Inset tone="plain" icon={EyeOff} title="Finish your draft first">
          {DOC.first}&apos;s self-assessment appears here only after you finish your own draft.
        </Inset>
        <LinkRowButton primary href={viewHref("form", asSup)} icon={PenLine}>
          Open your draft
        </LinkRowButton>
      </>
    );
  let head: React.ReactNode;
  let actions: React.ReactNode;
  if (st === "ready") {
    const meetingToday = s.booking && s.now >= s.booking.day;
    head = (
      <Inset tone="accent" icon={Eye} title="Draft finished">
        {DOC.first}&apos;s self-assessment is now visible to you. You can still change your answers until you sign. Any
        change from now on is shown to {DOC.first}.
      </Inset>
    );
    actions = (
      <>
        <SectionLabel>Meeting</SectionLabel>
        <List>
          {s.booking ? (
            <Row
              icon={CalendarDays}
              iconTone="ok"
              title="Booked"
              subtitle={`${bookingLabel(s.booking)} · Ward 4 office`}
            />
          ) : (
            <Row
              icon={CalendarDays}
              title="Not booked yet"
              subtitle={`${DOC.first} books in the window, Mon 26 Oct to Fri 6 Nov`}
            />
          )}
        </List>
        {meetingToday ? (
          <Button icon={PenLine} variant="primary" block onClick={() => dispatch({ type: "meeting-held" })}>
            We&apos;ve met · sign now
          </Button>
        ) : (
          <SmallPrint>After the meeting{s.booking ? ` on ${dayLabel(s.booking.day)}` : ""}, you sign here.</SmallPrint>
        )}
        <LinkRowButton href={viewHref("form", asSup)} icon={PenLine}>
          Change my answers
        </LinkRowButton>
      </>
    );
  } else if (st === "met") {
    head = (
      <Inset tone="ok" icon={Check} title={`Discussed on ${meetingDate(s)}`}>
        Change anything you agreed in the meeting, then sign.
      </Inset>
    );
    actions = (
      <>
        <LinkRowButton primary href={viewHref("sign", asSup)} icon={PenLine}>
          Sign as term supervisor
        </LinkRowButton>
        <LinkRowButton href={viewHref("form", asSup)} icon={PenLine}>
          Change my answers
        </LinkRowButton>
      </>
    );
  } else {
    head = (
      <Inset tone="ok" icon={PenLine} title="Signed by you">
        {s.sigs.doc
          ? `${DOC.first} has signed too, and emails the PDF to the MEU.`
          : `${DOC.first} has an alert to read and sign.`}
      </Inset>
    );
    actions = (
      <LinkRowButton href={viewHref("pdf", { ...asSup, of: "eot" })} icon={FileText}>
        View PDF
      </LinkRowButton>
    );
  }
  return (
    <>
      <ScreenHeader
        back={viewHref("home", asSup)}
        backLabel="your requests"
        title={st === "ready" ? "Side by side" : "End-of-term"}
        subtitle={DOC.name}
      />
      {head}
      <SectionLabel end={<SectionNote>{`Your overall rating: ${globalRatingName(p.global)}`}</SectionNote>}>
        Side by side
      </SectionLabel>
      <Card>
        <ComparisonChart rows={compareRatings(self?.ratings ?? null, p.ratings, "sup", DOC.first)} view="sup" />
      </Card>
      <SectionLabel end={<SectionNote>Prompts from the ratings</SectionNote>}>Talking points</SectionLabel>
      <List>
        {talkingPoints(self, p, DOC.first).map((t) => (
          <Row key={t} icon={MessageSquare} title={<span className="font-normal">{t}</span>} />
        ))}
      </List>
      {self ? (
        <>
          <SectionLabel>{`${DOC.first}'s own words`}</SectionLabel>
          <Card>
            <Eyebrow>Strengths</Eyebrow>
            <p className="text-sm text-[color:var(--text-heading)]">{self.strengths || "Not written"}</p>
            <Eyebrow>Wants to work on</Eyebrow>
            <p className="text-sm text-[color:var(--text-heading)]">{self.areas || "Not written"}</p>
          </Card>
        </>
      ) : null}
      {actions}
    </>
  );
}

export function SupervisorTimes({ s, dispatch }: ScreenProps) {
  return (
    <>
      <ScreenHeader
        back={viewHref("home", asSup)}
        backLabel="your requests"
        title="Your times"
        subtitle="End-of-term window"
      />
      <Inset tone="accent" title="Mon 26 Oct to Fri 6 Nov">
        Tap times to offer them. Doctors book 30 minutes, and you get an alert for each booking.
      </Inset>
      {WINDOW_DAYS.map((_, i) => {
        const on = s.avail[i] ?? [];
        return (
          <Card key={i} className="gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-[color:var(--text-heading)]">{dayLabel(i)}</h2>
              <span className="text-sm text-[color:var(--text-muted)]">
                {on.length ? `${on.length} offered` : "None offered"}
              </span>
            </div>
            <div role="group" aria-label={`Times on ${dayLabel(i)}`} className="flex flex-wrap gap-1.5">
              {MEETING_TIMES.map((t) => {
                const booked = s.booking?.day === i && s.booking.time === t;
                return (
                  <ChoiceChip
                    key={t}
                    pressed={on.includes(t)}
                    ariaDisabled={booked}
                    title={booked ? "Booked by Sam" : undefined}
                    onPressedChange={() => dispatch({ type: "toggle-availability", day: i, time: t })}
                  >
                    {booked ? `${t} · Sam` : t}
                  </ChoiceChip>
                );
              })}
            </div>
          </Card>
        );
      })}
    </>
  );
}
