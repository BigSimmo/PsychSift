"use client";

import { Activity, ArrowRight, BookOpen, FileText, List as ListIcon, Plus, Shield } from "lucide-react";

import { WorkButton, WorkDock, WorkHero, WorkRing, WorkTag } from "@/components/mode-kit/work";
import { AssessHeader, AssessNote } from "@/components/teaching/assessments/assess-kit";
import {
  List,
  Pill,
  Row,
  SectionLabel,
  StepRow,
  TextLink,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import {
  YEAR_WEEKS,
  endOfTermLine,
  kindsDone,
  endOfTermPill,
  epa1ThisTerm,
  epaNeedMore,
  epaRecords,
  epasInTerm,
  pendingEpaRequest,
  stage,
  termWeek,
  weeksDone,
  windowOpen,
} from "@/lib/teaching/assessments/model";
import {
  CURRENT_TERM,
  SAMPLE_DOCTOR,
  SAMPLE_LEAVE,
  SAMPLE_REGISTRAR,
  SAMPLE_SUPERVISOR,
  SAMPLE_TERMS,
} from "@/lib/teaching/assessments/sample";
import { withUnit } from "@/components/teaching/teaching-number";

/** Week of term on a line: the mid-term mark, and the last two weeks shaded as the booking window. */
export function TermTrack({ week }: { week: number }) {
  const done = ((week - 0.5) / 10) * 100;
  return (
    <div aria-label={`Week ${week} of 10`} role="img" className="grid gap-1.5" data-mode-identity="teaching">
      <div className="relative h-1.5 rounded-full bg-[color:var(--border)]">
        <i
          className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[CanvasText]"
          style={{ width: `${done}%` }}
        />
        <em className="absolute -top-1 left-1/2 h-3.5 w-0.5 -translate-x-1/2 bg-[color:var(--text-muted)]" />
        <s className="absolute inset-y-[-3px] right-0 left-[80%] rounded border border-dashed border-[color:var(--border-strong)]" />
      </div>
      <div className="relative h-4 text-2xs text-[color:var(--text-muted)]">
        <span className="absolute left-0">Start</span>
        <span className="absolute left-1/2 -translate-x-1/2">Mid-term</span>
        <span className="absolute left-[80%] -translate-x-1/2">Booking</span>
        <span className="absolute right-0">End</span>
      </div>
    </div>
  );
}

function EpaTermStep({ s, openSheet }: Pick<ScreenProps, "s" | "openSheet">) {
  const eps = epasInTerm(s, "t4");
  const pending = pendingEpaRequest(s, 1);
  const recorded = eps.length
    ? `${eps.length} recorded here this term (${eps.map((r) => `EPA ${r.epa}`).join(", ")}).`
    : "None recorded here this term yet.";
  if (epa1ThisTerm(s))
    return (
      <StepRow
        state={eps.length >= 2 ? "ok" : "now"}
        title={`EPAs: ${eps.length} recorded here`}
        detail={eps.length >= 2 ? "EPA 1 done. At least 2 this term: met." : "EPA 1 done. One more needed this term."}
      />
    );
  if (pending)
    return (
      <StepRow
        state="now"
        title="EPA 1 requested"
        detail={`Waiting for ${pending.who === "sup" ? SAMPLE_SUPERVISOR.short : SAMPLE_REGISTRAR.name}. Needed by Sun 8 Nov. ${recorded}`}
      />
    );
  return (
    <StepRow
      state="now"
      title="EPA 1 needed by Sun 8 Nov"
      detail={`Needed every term. ${recorded}`}
      tag={<Pill pill={{ label: "Request it", tone: "warm" }} />}
      onClick={() => openSheet({ kind: "epa", pick: 1 })}
    />
  );
}

export function AssessmentsHome({ s, openSheet }: ScreenProps) {
  const t = CURRENT_TERM;
  const week = termWeek(s);
  const weeks = weeksDone(s);
  const started = stage(s) !== "start";
  return (
    <>
      <AssessHeader eyebrow={`${SAMPLE_DOCTOR.grade} 2026 · term ${withUnit(4, "of")} 5`} title={t.name} />
      <WorkHero
        testId="assess-doctor-hero"
        eyebrow={`${t.categoryName} (${t.category})`}
        title={`Week ${withUnit(week, "of")} 10`}
        sub={`${windowOpen(s) ? "Booking is open until Fri 6 Nov." : "Booking opens Mon 26 Oct."} Form due to your MEU Fri 20 Nov.`}
        ring={
          <WorkRing
            value={weeks}
            label={`of ${YEAR_WEEKS} wk`}
            fraction={weeks / YEAR_WEEKS}
            accessibleLabel={`${withUnit(weeks, "of")} ${withUnit(YEAR_WEEKS, "weeks")} done this year`}
          />
        }
        href={viewHref("reqs")}
        aria-label={`Week ${withUnit(week, "of")} 10. ${withUnit(weeks, "of")} ${withUnit(YEAR_WEEKS, "weeks")} done this year. Open year requirements.`}
      />

      <SectionLabel end={<TextLink href={viewHref("term", { term: "t4" })}>Term details</TextLink>}>
        This term
      </SectionLabel>
      <List label="This term">
        <StepRow
          state="ok"
          title="Beginning-of-term talk"
          detail={`Wed 2 Sep with ${SAMPLE_SUPERVISOR.short}. Goals agreed.`}
        />
        <StepRow
          state="ok"
          title="Mid-term assessment"
          detail="Signed Fri 2 Oct. Read your report."
          href={viewHref("report", { of: "mid" })}
        />
        <EpaTermStep s={s} openSheet={openSheet} />
        <StepRow
          state="now"
          title="End-of-term assessment"
          detail={endOfTermLine(s)}
          tag={<Pill pill={endOfTermPill(s)} />}
          href={viewHref("hub")}
        />
      </List>

      <List label="Your year">
        <Row
          icon={Activity}
          title={`${withUnit(weeks, "of")} ${withUnit(YEAR_WEEKS, "weeks")} · ${withUnit(kindsDone(SAMPLE_TERMS), "of")} 4 kinds`}
          subtitle={`${epaRecords(s).length} EPAs here, at least ${epaNeedMore(s)} more. Leave ${withUnit(SAMPLE_LEAVE.used, "of")} ${withUnit(SAMPLE_LEAVE.limit, "days")}.`}
          tag={epa1ThisTerm(s) ? <WorkTag tone="neutral">On track</WorkTag> : <WorkTag tone="amber">1 to do</WorkTag>}
          href={viewHref("reqs")}
        />
      </List>

      <List label="More">
        <Row
          icon={Plus}
          title="Request an EPA"
          subtitle={`From ${SAMPLE_SUPERVISOR.short} or a registrar`}
          onClick={() => openSheet({ kind: "epa", pick: 1 })}
        />
        <Row icon={ListIcon} title="All assessments" subtitle="Every form and EPA, by term" href={viewHref("all")} />
        <Row
          icon={FileText}
          title="Blank form"
          subtitle="Your hospital's term assessment form"
          href={viewHref("pdf", { of: "blank" })}
        />
        <Row
          icon={Shield}
          title="Concerns and help"
          subtitle="Disagree, report or get support"
          href={viewHref("help")}
        />
        <Row
          icon={BookOpen}
          title="Help and words"
          subtitle="Every abbreviation in plain words"
          href={viewHref("words")}
        />
      </List>
      <AssessNote icon={BookOpen} center>
        Rules from the AMC National Framework, run in WA by PMCWA. Due dates are set by your MEU.
      </AssessNote>
      <WorkDock>
        <WorkButton icon={ArrowRight} href={viewHref("hub")}>
          {started ? "End-of-term steps" : "Start end-of-term"}
        </WorkButton>
      </WorkDock>
    </>
  );
}
