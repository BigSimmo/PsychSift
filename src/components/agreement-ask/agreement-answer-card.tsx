"use client";

import { Briefcase, CalendarClock, ChevronRight, FileQuestion, FileText, Scale, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { forwardRef, type ReactNode } from "react";

import {
  AgreementIconCircle,
  AgreementPdfLink,
  AgreementUnionFooter,
  agreementCard,
} from "@/components/agreement-ask/agreement-parts";
import { focusRing } from "@/components/card-recipes";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/components/ui-primitives";
import {
  AGREEMENT_CHECKED_SCOPE,
  AGREEMENT_TOPICS,
  uncheckedSentence,
  type AgreementAnswer,
  type AgreementTopicId,
} from "@/lib/work-profile/agreement-answers";

type Quoted = Extract<AgreementAnswer, { kind: "quoted" }>;
type NotChecked = Extract<AgreementAnswer, { kind: "not-checked" }>;

/** The tappable clause number after each quoted line. Opens the clause sheet. */
export function AgreementClauseChip({
  clause,
  active,
  onOpen,
}: {
  readonly clause: string;
  readonly active?: boolean;
  readonly onOpen: (clause: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(clause)}
      aria-label={`Clause ${clause}. Opens the clause`}
      data-testid="agreement-clause-chip"
      className={cn(
        focusRing,
        // 48px tap area around a small flat chip.
        "-my-3 inline-flex min-h-12 items-center align-middle",
      )}
    >
      <span
        className={cn(
          "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs font-medium",
          active
            ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
            : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--mode-identity)]",
        )}
      >
        <FileText aria-hidden="true" className="size-icon-xs" />
        Clause {clause}
      </span>
    </button>
  );
}

function SignOffNote({ reason }: { readonly reason: string | null }) {
  return (
    <div
      role="note"
      data-testid="agreement-not-signed-off"
      className="flex min-w-0 items-start gap-2 rounded-md border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--warning-text)]" />
      <span className="grid min-w-0 gap-0.5 text-sm leading-5">
        <span className="font-semibold text-[color:var(--warning-text)]">Not signed off yet</span>
        <span className="text-[color:var(--text)]">
          {reason ? `${reason}. ` : null}The words are the agreement’s, but check the clause in the agreement before you
          rely on it.
        </span>
      </span>
    </div>
  );
}

function CardHeader({ icon, title, sub }: { readonly icon: ReactNode; readonly title: string; readonly sub: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {icon}
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">{title}</span>
        <span className="text-xs leading-4 text-[color:var(--text-muted)]">{sub}</span>
      </span>
    </div>
  );
}

export interface AgreementAnswerCardProps {
  readonly answer: Quoted | NotChecked;
  readonly onOpenClause: (clause: string) => void;
  readonly onAskTopic: (id: AgreementTopicId) => void;
  readonly onCopy: () => void;
  readonly copied: boolean;
  readonly offline: boolean;
  /** The clause last opened from this answer, so its chips show where you were. */
  readonly activeClause?: string | null;
}

/**
 * The answer: verbatim quotes only, each with its clause chip, then the PDF, then AMA (WA).
 * The heading takes focus after asking, so a screen reader starts at the answer.
 */
export const AgreementAnswerCard = forwardRef<HTMLHeadingElement, AgreementAnswerCardProps>(
  function AgreementAnswerCard(
    { answer, onOpenClause, onAskTopic, onCopy, copied, offline, activeClause },
    headingRef,
  ) {
    if (answer.kind === "not-checked") {
      return (
        <section aria-labelledby="agreement-answer-heading" className={agreementCard} data-testid="agreement-answer">
          <div className="grid justify-items-center gap-2 px-4 pb-4 pt-5 text-center">
            <AgreementIconCircle icon={FileQuestion} tone="neutral" size="lg" />
            <h2
              id="agreement-answer-heading"
              ref={headingRef}
              tabIndex={-1}
              className="text-base font-semibold leading-6 text-[color:var(--text-heading)] focus:outline-none"
            >
              Not in the clauses PsychSift has checked
            </h2>
            <p className="max-w-sm text-sm leading-5 text-[color:var(--text)]" data-testid="agreement-unchecked-line">
              {uncheckedSentence(answer.unchecked)} {AGREEMENT_CHECKED_SCOPE} Rather than guess, open the agreement and
              read it yourself.
            </p>
            <AgreementPdfLink
              href={answer.source.url}
              variant="primary"
              offline={offline}
              testId="agreement-open-pdf"
            />
            <p className="text-xs leading-4 text-[color:var(--text-muted)]">
              {answer.source.title}, {answer.source.citation}
            </p>
          </div>
          <div className="grid gap-2 border-t border-[color:var(--border)] px-3 py-3">
            <p className="text-xs font-medium leading-4 text-[color:var(--text-muted)]">What PsychSift can quote</p>
            <ul role="list" className="flex flex-wrap gap-x-2">
              {AGREEMENT_TOPICS.map((topic) => (
                <li key={topic.id}>
                  <button
                    type="button"
                    onClick={() => onAskTopic(topic.id)}
                    className={cn(focusRing, "inline-flex min-h-12 items-center")}
                  >
                    <span className="inline-flex h-8 items-center rounded-full border border-[color:var(--border)] px-3 text-xs font-medium text-[color:var(--text)]">
                      {topic.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-1 border-t border-[color:var(--border)] px-3 pt-3" data-testid="agreement-who-helps">
            <p className="text-xs font-medium leading-4 text-[color:var(--text-muted)]">Who could help</p>
            <Link
              href="/admin/help#admin-help-contacts"
              data-mode-identity="my-work"
              className={cn(focusRing, "flex min-h-13 min-w-0 items-center gap-3 rounded-md no-underline")}
            >
              <AgreementIconCircle icon={Briefcase} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm font-medium leading-5 text-[color:var(--text-heading)]">
                  Medical Workforce
                </span>
                <span className="text-xs leading-4 text-[color:var(--text-muted)]">
                  Your hospital’s team, in Admin contacts
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
            </Link>
          </div>
          <AgreementUnionFooter />
          <p className="border-t border-[color:var(--border)] px-3 py-3 text-xs leading-4 text-[color:var(--text-muted)]">
            PsychSift can quote your breaks, shift length, nights and weekly hours. Try asking about those.
          </p>
        </section>
      );
    }

    const clauses = [...new Set(answer.topics.flatMap((topic) => topic.lines.map((line) => line.clause)))];
    return (
      <section aria-labelledby="agreement-answer-heading" className={agreementCard} data-testid="agreement-answer">
        <div className="grid gap-3 px-3 pb-3 pt-3">
          <CardHeader
            icon={<AgreementIconCircle icon={Scale} />}
            title="In the agreement’s own words"
            sub="Every line is a quote, with its clause"
          />
          {answer.signOff.signedOff ? (
            <p className="text-xs leading-4 text-[color:var(--text-muted)]" data-testid="agreement-signed-off">
              {answer.signOff.signedLine}. Still read the clause before relying on it.
            </p>
          ) : (
            <SignOffNote reason={answer.signOff.reason} />
          )}
          <h2
            id="agreement-answer-heading"
            ref={headingRef}
            tabIndex={-1}
            className="sr-only focus:not-sr-only focus:outline-none"
          >
            {`Quoted from clause ${clauses.join(", ")}`}
          </h2>
          {answer.topics.map((topic) => (
            <div key={topic.id} className="grid gap-1.5" data-testid={`agreement-topic-${topic.id}`}>
              <h3 className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">{topic.label}</h3>
              <ol role="list" className="grid gap-2">
                {topic.lines.map((line, index) => (
                  <li
                    key={`${line.clause}-${index}`}
                    className="min-w-0 border-l-2 border-[color:var(--mode-identity-border)] pl-3 text-sm leading-6 text-[color:var(--text)]"
                  >
                    <q className="break-words">{line.text}</q>{" "}
                    <AgreementClauseChip
                      clause={line.clause}
                      active={activeClause === line.clause}
                      onOpen={onOpenClause}
                    />
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {answer.unchecked.length ? (
            <p
              className="rounded-md bg-[color:var(--surface-subtle)] px-3 py-2 text-sm leading-5 text-[color:var(--text)]"
              data-testid="agreement-unchecked-line"
            >
              {uncheckedSentence(answer.unchecked)} Open the agreement for that part.
            </p>
          ) : null}
          <p className="text-xs leading-4 text-[color:var(--text-muted)]">
            {answer.source.title}, {answer.source.citation}. Checked {answer.source.checkedOn}.
            {answer.source.pastExpiry
              ? ` It passed its expiry date of ${answer.source.expiresOn} and stays in force until a new agreement is made.`
              : null}{" "}
            These are the agreement’s limits, not a safety judgement.
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton
              label="Copy answer"
              ariaLabel="Copy the answer with its clause numbers"
              copied={copied}
              onClick={onCopy}
              testId="agreement-copy"
            />
            <AgreementPdfLink href={answer.source.url} offline={offline} testId="agreement-open-pdf" />
          </div>
          <Link
            href="/roster/shifts?view=hours"
            className={cn(
              focusRing,
              "inline-flex min-h-12 w-fit items-center gap-1.5 text-sm font-medium text-[color:var(--mode-identity)] no-underline",
            )}
          >
            <CalendarClock aria-hidden="true" className="size-icon-sm" />
            Check my next 14 days
          </Link>
        </div>
        <AgreementUnionFooter />
      </section>
    );
  },
);
