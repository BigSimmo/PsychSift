"use client";

import { TriangleAlert } from "lucide-react";

import { AgreementPdfLink } from "@/components/agreement-ask/agreement-parts";
import { CopyButton } from "@/components/ui/copy-button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import type { AgreementClause, AgreementSignOffState, AgreementSource } from "@/lib/work-profile/agreement-answers";

/**
 * The clause sheet, opened from a clause chip or the checked-clauses list: every quoted line that
 * carries the clause, the lines the answer used marked, then where it comes from.
 */
export function AgreementClauseSheet({
  clause,
  usedLines,
  source,
  signOff,
  onClose,
  onCopy,
  copied,
  offline,
}: {
  readonly clause: AgreementClause | null;
  /** Quotes the current answer used, so the sheet marks them. Empty when opened from the list. */
  readonly usedLines: readonly string[];
  readonly source: AgreementSource;
  readonly signOff: AgreementSignOffState;
  readonly onClose: () => void;
  readonly onCopy: () => void;
  readonly copied: boolean;
  readonly offline: boolean;
}) {
  const open = clause !== null;
  const anyUsed = clause ? clause.lines.some((line) => usedLines.includes(line.text)) : false;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={clause ? `Clause ${clause.clause}` : "Clause"}
      description={clause ? clause.labels.join(" · ") : undefined}
      testId="agreement-clause-sheet"
      portal
      footer={
        clause ? (
          <div className="grid grid-cols-2 gap-2">
            <CopyButton
              label="Copy clause"
              ariaLabel={`Copy clause ${clause.clause}`}
              copied={copied}
              onClick={onCopy}
              className="w-full"
              testId="agreement-copy-clause"
            />
            <AgreementPdfLink href={source.url} label="Full agreement" variant="primary" offline={offline} />
          </div>
        ) : null
      }
    >
      {clause ? (
        <div className="grid min-w-0 gap-4">
          {signOff.signedOff ? (
            <p className="text-sm leading-5 text-[color:var(--text-muted)]">{signOff.signedLine}.</p>
          ) : (
            <p className="flex items-start gap-2 text-sm leading-5 text-[color:var(--warning-text)]">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
              <span>Not signed off yet. Compare these words with the agreement before relying on them.</span>
            </p>
          )}
          <ol role="list" className="grid gap-2" data-testid="agreement-clause-lines">
            {clause.lines.map((line, index) => {
              const used = usedLines.includes(line.text);
              return (
                <li
                  key={index}
                  data-used={used || undefined}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm leading-6",
                    used
                      ? "border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--text-heading)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
                  )}
                >
                  <q className="break-words">{line.text}</q>
                  {used ? <span className="sr-only"> (used in the answer)</span> : null}
                </li>
              );
            })}
          </ol>
          {anyUsed ? (
            <p className="text-xs leading-4 text-[color:var(--text-muted)]">Shaded: the lines the answer used.</p>
          ) : null}
          <p className="text-xs leading-4 text-[color:var(--text-muted)]">
            Only the lines PsychSift has quoted. The full clause is in the agreement.
          </p>
          <dl className="grid min-w-0 gap-0 rounded-md border border-[color:var(--border)] text-sm">
            {[
              ["Agreement", source.title],
              ["Citation", source.citation],
              ["Checked", source.checkedOn],
              [
                "Expires",
                source.pastExpiry
                  ? `${source.expiresOn}. Stays in force until a new agreement is made`
                  : source.expiresOn,
              ],
            ].map(([term, value]) => (
              <div
                key={term}
                className="flex min-w-0 items-start justify-between gap-3 border-t border-[color:var(--border)] px-3 py-2 first:border-t-0"
              >
                <dt className="shrink-0 text-[color:var(--text-muted)]">{term}</dt>
                <dd className="min-w-0 break-words text-right text-[color:var(--text-heading)]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </Sheet>
  );
}
