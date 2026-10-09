"use client";

import { Disclosure } from "@/components/ui/disclosure";
import { SourceDesignationBadge, SourceStatusBadge } from "@/components/ui-primitives";
import { therapySourceMetadata } from "@/lib/therapy-source-governance";

import { splitSourceCitations } from "../prose";
import type { Therapy } from "../data/types";

/**
 * Where the record came from, at the bottom, one line high until asked.
 *
 * Three things were wrong with the card this replaces, and each is fixed here
 * rather than restyled. It led with
 * `Single Therapies 3497889e8a228045b290cedd09a905bf.md` — the same import
 * filename for all 205 records, so as a heading it identified nothing; that is
 * now a muted "Imported from" line underneath. It printed the reference blob as
 * one run-on paragraph; that is now the list of citations the author actually
 * wrote. And it claimed a full card in the reading column for information a
 * reader consults once, which is why it is now collapsed by default.
 *
 * What is emphatically not reduced is the disclosure: the review status is on
 * the collapsed row, so a record awaiting clinician sign-off says so without
 * anyone opening anything.
 */
export function TherapySourceProvenance({ therapy }: { therapy: Therapy }) {
  const reviewed = therapy.reviewStatus === "reviewed";
  const source = therapy.sources[0] ?? null;
  // References appended from the source register are not part of the
  // historical upload. They remain in the record for later adoption, but must
  // not be presented as a clinical citation while their register entry is a
  // candidate (or rejected).
  const hasUnadoptedRegisterReference = source?.reference?.includes("These references were added on ") ?? false;
  const blob = hasUnadoptedRegisterReference ? therapy.sourceNotes?.trim() || "" : source?.reference?.trim() || therapy.sourceNotes?.trim() || "";
  const { citations, notes } = splitSourceCitations(blob);
  const reviewStatus = reviewed ? "Reviewed" : "Awaiting review";
  const reviewStatusClass = reviewed
    ? "text-xs font-semibold text-[color:var(--success-text)]"
    : "text-xs font-semibold text-[color:var(--warning-text)]";

  return (
    <>
      <div className="hidden print:block">
        <h2 className="m-0 text-sm font-semibold text-[color:var(--text-heading)]">
          Source & review status <span className={reviewStatusClass}>{reviewStatus}</span>
        </h2>
      </div>
      <Disclosure
        className="text-sm"
        headingLevel={2}
        title="Source & review status"
        meta={<span className={reviewStatusClass}>{reviewStatus}</span>}
      >
        <div className="space-y-3 pb-1">
          {citations.length ? (
            <ol className="m-0 list-none space-y-2 p-0">
              {citations.map((citation, index) => (
                <li
                  key={`${citation.authority}-${index}`}
                  className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2"
                >
                  <p className="m-0 text-xs leading-5 text-[color:var(--text)]">{citation.text}</p>
                  {citation.authority ? (
                    <span className="mt-1.5 inline-flex rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2 py-px text-3xs font-semibold text-[color:var(--clinical-accent)]">
                      {citation.authority}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="m-0 text-xs leading-5 text-[color:var(--text-muted)]">
              No reference list was recorded for this therapy.
            </p>
          )}

          {notes.length ? (
            <div>
              <p className="m-0 text-3xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                Record note — not a clinical source
              </p>
              {notes.map((note) => (
                <p key={note} className="m-0 mt-1 text-xs leading-5 text-[color:var(--text-muted)]">
                  {note}
                </p>
              ))}
            </div>
          ) : null}

          {source ? (
            <div className="space-y-2 border-t border-[color:var(--border)] pt-2.5">
              <p className="m-0 text-xs text-[color:var(--text-muted)]">
                Imported from <span className="break-words font-medium">{source.title ?? "an uploaded source"}</span>
              </p>
              <span className="flex flex-wrap gap-2">
                <SourceDesignationBadge metadata={therapySourceMetadata(source, therapy.reviewStatus)} />
                <SourceStatusBadge metadata={therapySourceMetadata(source, therapy.reviewStatus)} />
              </span>
            </div>
          ) : null}
        </div>
      </Disclosure>
    </>
  );
}
