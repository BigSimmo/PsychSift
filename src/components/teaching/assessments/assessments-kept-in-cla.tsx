"use client";

import { ExternalLink, FileText, GraduationCap, Mail, Target, Undo2, UserCheck, Users } from "lucide-react";

import { WorkButton, WorkCard, WorkEmpty, WorkIconRow, WorkSectionLabel } from "@/components/mode-kit/work";
import { useAuthSession } from "@/lib/supabase/client";
import { TERM_TRACKER_SOURCES } from "@/lib/teaching/term-tracker";

/**
 * Assessment records stay in Clinical Learning Australia (owner decision 7 Oct 2026, "Backend
 * decisions for Josh", question 11). A signed-in doctor is never shown the made-up Assessments
 * records, so nobody mistakes them for real ones; signed out and in the local demo build they still
 * show as the labelled example.
 */
export function useAssessmentsAccess(): "loading" | "signed-in" | "signed-out" {
  const { status } = useAuthSession();
  if (status === "loading") return "loading";
  return status === "authenticated" || status === "expired" ? "signed-in" : "signed-out";
}

/**
 * Where the "How CLA works" lines come from. Every line is checked against these, 9 Oct 2026; the cited
 * notes are in /mnt/project-files/work-mode-build/assessments-cla-sources-check.md.
 */
export const CLA_SOURCES = {
  /** AMC National Framework for prevocational (PGY1 and PGY2) medical training. */
  amcFramework:
    "https://www.amc.org.au/accredited-organisations/prevocational-training/new-national-framework-for-prevocational-pgy1-and-pgy2-medical-training-2024/",
  /** CLA user guides and factsheets for doctors, supervisors and assessors. */
  claGuides:
    "https://www.digitalhealth.gov.au/healthcare-providers/initiatives-and-programs/workforce-capability/clinical-learning-australia/clinical-learning-australia-resources",
} as const;

/**
 * How CLA works, for the doctor and for anyone who assesses them. Nothing here is a PsychSift rule.
 * - EPA minimums: AMC Section 3A, Assessment approach, p.50.
 * - Asking, Email for later, no account needed: CLA factsheets "How to complete an EPA", 18 Jul 2025.
 * - Unapproved guest assessors: CLA detailed FAQs v2.0, p.5, and the supervisors' training guide, p.17.
 * - Cancelling: CLA supervisors' training guide, p.32 (delete or change the recipient from the three-dot menu).
 *   No CLA guide or form has a decline, send back or "unable to assess" option.
 * - Term assessments: AMC Section 3A. Only a linked supervisor starts an end-of-term form: CLA FAQs v2.0.
 * - Who can assess: AMC Section 3A, p.50, and the AMC FAQ, November 2023.
 * - RANZCP registrars: the College's own system (owner, 8 Oct 2026).
 */
const HOW_CLA_WORKS = [
  {
    icon: Target,
    title: "EPAs you need",
    sub: "At least 10 a year and at least 2 each term, with EPA 1 every term. The same for PGY1 and PGY2.",
  },
  {
    icon: Mail,
    title: "Asking for an EPA",
    sub: "Start it in CLA, then hand your phone over or use Email for later. Assessors don't need a CLA account.",
  },
  {
    icon: UserCheck,
    title: "New assessors",
    sub: "An assessor without an account shows as Unapproved until your MEU approves them.",
  },
  {
    icon: Undo2,
    title: "If they can't do it",
    sub: "CLA has no send back button. Delete the emailed form, or change who it goes to, from its three-dot menu.",
  },
  {
    icon: Users,
    title: "Who can assess",
    sub: "At least one EPA a term from your term supervisor or another specialist. Trained registrars, nurses and pharmacists can do the rest.",
  },
  {
    icon: FileText,
    title: "Term assessments",
    sub: "Mid-term and end-of-term, by your term supervisor. Only a supervisor linked to you can start the end-of-term form.",
  },
  {
    icon: GraduationCap,
    title: "RANZCP registrars",
    sub: "Your assessments go in the College's own system, not CLA.",
  },
] as const;

/** What a signed-in doctor sees on every Assessments address: where the records are kept, and how CLA works. */
export function AssessmentsKeptInCla() {
  return (
    <section data-testid="teaching-assessments-kept-in-cla" aria-label="Assessment records" className="grid gap-3">
      <WorkEmpty
        icon={FileText}
        title="Assessments are kept in CLA"
        body="Forms and EPAs stay in Clinical Learning Australia (CLA) and with your Medical Education Unit. Supervision hours are kept here in Teaching."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <a
              href={TERM_TRACKER_SOURCES.pmcwaCla}
              target="_blank"
              rel="noopener noreferrer"
              className="work-button"
              data-variant="primary"
              data-testid="teaching-assessments-open-cla"
            >
              Open CLA
              <ExternalLink aria-hidden="true" strokeWidth={2} />
              <span className="sr-only">(opens outside PsychSift)</span>
            </a>
            <WorkButton variant="secondary" href="/teaching/supervision">
              Supervision hours
            </WorkButton>
          </div>
        }
      />
      <WorkSectionLabel id="assess-how-cla" action={{ label: "Count EPAs", href: "/teaching/term" }}>
        How CLA works
      </WorkSectionLabel>
      <WorkCard testId="teaching-assessments-how-cla" aria-label="How CLA works">
        {HOW_CLA_WORKS.map((row) => (
          <WorkIconRow key={row.title} icon={row.icon} title={row.title} sub={row.sub} />
        ))}
      </WorkCard>
      <p className="m-0 px-1 text-sm text-[color:var(--text-muted)]">
        From the{" "}
        <a href={CLA_SOURCES.amcFramework} target="_blank" rel="noopener noreferrer" className="underline">
          AMC framework
          <span className="sr-only"> (opens outside PsychSift)</span>
        </a>{" "}
        and the{" "}
        <a href={CLA_SOURCES.claGuides} target="_blank" rel="noopener noreferrer" className="underline">
          CLA guides
          <span className="sr-only"> (opens outside PsychSift)</span>
        </a>
        , checked 9 Oct 2026. Your MEU has the final word.
      </p>
    </section>
  );
}
