"use client";

import { ExternalLink, FileText } from "lucide-react";

import { WorkButton, WorkEmpty } from "@/components/mode-kit/work";
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

/** What a signed-in doctor sees on every Assessments address: where the records are kept. */
export function AssessmentsKeptInCla() {
  return (
    <section data-testid="teaching-assessments-kept-in-cla" aria-label="Assessment records">
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
    </section>
  );
}
