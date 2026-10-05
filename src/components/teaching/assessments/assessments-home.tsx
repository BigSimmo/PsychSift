"use client";

import { BookOpen, CalendarDays, FileText, List as ListIcon, Shield, Target } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { ProgressRing } from "@/components/dashboard-kit/rings";
import {
  Eyebrow,
  List,
  Panel,
  Pill,
  Row,
  SectionLabel,
  SmallPrint,
  StepRow,
  TextLink,
  secondaryText,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { cn } from "@/components/ui-primitives";
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

/** The weeks-of-the-year ring; a link to the year's requirements. */
export function WeeksRing({ weeks, href }: { weeks: number; href?: string }) {
  const ring = (
    <ProgressRing
      fraction={weeks / YEAR_WEEKS}
      size={80}
      strokeWidth={7}
      stroke="stroke-[color:var(--mode-identity)]"
      track="stroke-[color:var(--border)]"
    >
      <b className="text-xl leading-none font-normal text-[color:var(--text-heading)] tabular-nums">{weeks}</b>
      <small className="mt-0.5 text-2xs font-semibold text-[color:var(--text-muted)]">of {YEAR_WEEKS} wk</small>
    </ProgressRing>
  );
  if (!href) return <span data-mode-identity="teaching">{ring}</span>;
  return (
    <Link
      href={href}
      data-mode-identity="teaching"
      aria-label={`${weeks} of ${YEAR_WEEKS} weeks done. Open year requirements.`}
      className={cn(focusRing, "shrink-0 rounded-full")}
    >
      {ring}
    </Link>
  );
}

/** Week of term on a line: the mid-term mark, and the last two weeks shaded as the booking window. */
function TermTrack({ week }: { week: number }) {
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
  return (
    <>
      <Panel>
        <div className="flex items-center justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <Eyebrow accent>{`${SAMPLE_DOCTOR.grade} 2026 · term 4 of 5`}</Eyebrow>
            <h2 className="text-xl leading-tight font-semibold text-[color:var(--text-heading)]">{t.name}</h2>
            <p className={secondaryText}>
              Chronic illness (B) · {t.from} to {t.to}
              <br />
              Term supervisor {SAMPLE_SUPERVISOR.name}
            </p>
          </div>
          <WeeksRing weeks={weeks} href={viewHref("reqs")} />
        </div>
        <TermTrack week={week} />
        <p className={secondaryText}>
          Week {week} of 10. {windowOpen(s) ? "Booking is open until Fri 6 Nov." : "Booking opens Mon 26 Oct."} The form
          is due to your Medical Education Unit (MEU) by Fri 20 Nov.
        </p>
      </Panel>

      <SectionLabel end={<TextLink href={viewHref("term", { term: "t4" })}>Term details</TextLink>}>
        This term
      </SectionLabel>
      <List>
        <StepRow state="ok" title="Beginning-of-term talk" detail="Wed 2 Sep with Dr Nair. Goals agreed." />
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

      <SectionLabel>Your year</SectionLabel>
      <List>
        <Row
          icon={CalendarDays}
          title={`${weeks} of ${YEAR_WEEKS} weeks · ${kindsDone(SAMPLE_TERMS)} of 4 kinds`}
          subtitle={`${epaRecords(s).length} EPAs recorded here, at least ${epaNeedMore(s)} more needed. Leave: ${SAMPLE_LEAVE.used} of ${SAMPLE_LEAVE.limit} days.`}
          tag={
            <Pill
              pill={
                epa1ThisTerm(s) ? { label: "On track", tone: "ok" } : { label: "1 thing needs attention", tone: "warm" }
              }
            />
          }
          href={viewHref("reqs")}
        />
      </List>

      <SectionLabel>More</SectionLabel>
      <List>
        <Row
          icon={Target}
          title="Request an EPA"
          subtitle="From Dr Nair or a registrar"
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
          title="Words used here"
          subtitle="Every abbreviation in plain words"
          onClick={() => openSheet({ kind: "words" })}
        />
      </List>
      <SmallPrint center>
        Rules from the AMC National Framework, run in WA by PMCWA. Due dates are set by your MEU.
      </SmallPrint>
    </>
  );
}
