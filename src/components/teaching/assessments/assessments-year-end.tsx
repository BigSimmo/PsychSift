"use client";

import {
  List,
  SectionLabel,
  SectionNote,
  SmallPrint,
  StepRow,
} from "@/components/teaching/assessments/assessments-parts";
import { PANEL_DATE } from "@/lib/teaching/assessments/dct";
import {
  PANEL_LOOKS_AT,
  PANEL_OUTCOMES,
  PGY1_REGISTRATION,
  PGY1_TIME_LIMIT,
  PGY2_CERTIFICATE,
  PGY2_RULES,
  TRANSCRIPT_LINE,
} from "@/lib/teaching/assessments/year-rules";

/** One plain rule line inside a `List` card: no meter, nothing to tap. */
export function RuleLine({ children }: { children: string }) {
  return <li className="px-3.5 py-3 text-sm text-[color:var(--text-heading)]">{children}</li>;
}

/**
 * The doctor's year end: the Assessment Review Panel, what it can decide, and what follows. For PGY1 that is
 * general registration, which the Medical Board decides. Rules and sources live in `year-rules.ts`.
 */
export function YearEnd({ grade }: { grade: "PGY1" | "PGY2" }) {
  return (
    <section aria-labelledby="assess-year-end" className="grid gap-1" data-testid="assess-year-end">
      <SectionLabel id="assess-year-end" end={<SectionNote>Made-up date</SectionNote>}>
        Year end
      </SectionLabel>
      <List label="Year end steps">
        <StepRow state="lock" title="Assessment Review Panel" detail={`Meets ${PANEL_DATE}. ${PANEL_LOOKS_AT}`} />
        <StepRow state="lock" title="Panel outcome" detail="One of the four below." />
        {grade === "PGY1" ? (
          <StepRow state="lock" title="General registration" detail={PGY1_REGISTRATION} />
        ) : (
          <StepRow state="lock" title="Certificate of completion" detail={PGY2_CERTIFICATE} />
        )}
      </List>
      <List label="What the panel can decide">
        {PANEL_OUTCOMES.map((line) => (
          <RuleLine key={line}>{line}</RuleLine>
        ))}
      </List>
      <SmallPrint>{grade === "PGY1" ? `${PGY1_TIME_LIMIT} ${TRANSCRIPT_LINE}` : TRANSCRIPT_LINE}</SmallPrint>
    </section>
  );
}

/** PGY2's own rules, shown to a PGY1 doctor as what comes next. */
export function Pgy2Rules() {
  return (
    <section aria-labelledby="assess-pgy2-rules" className="grid gap-1" data-testid="assess-pgy2-rules">
      <SectionLabel id="assess-pgy2-rules" end={<SectionNote>Next year</SectionNote>}>
        PGY2 rules
      </SectionLabel>
      <List label="PGY2 rules">
        {PGY2_RULES.map((line) => (
          <RuleLine key={line}>{line}</RuleLine>
        ))}
      </List>
      <SmallPrint>{PGY2_CERTIFICATE}</SmallPrint>
    </section>
  );
}
