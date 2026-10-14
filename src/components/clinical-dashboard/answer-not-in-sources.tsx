"use client";

import { SearchX } from "lucide-react";

import { NaturalLanguageAnswer } from "@/components/clinical-dashboard/answer-content";
import { cn, textMuted } from "@/components/ui-primitives";

const noop = () => {};

/** The one line on what was searched. Counts what the search looked at, never what it relied on. */
export function notInSourcesSearchedLine(searchedCount: number): string {
  if (searchedCount <= 0) return "Nothing in your library matched this question.";
  return `Checked ${searchedCount} ${searchedCount === 1 ? "source" : "sources"} in your library. None of them answers this question.`;
}

/**
 * The "Not in your sources" answer (audit D03, 2026-10-13).
 *
 * When the pipeline reports that the user's sources do not cover a question
 * (`answerIsNotInSources`), the screen used to wear a real answer's chrome: a support chip,
 * a limitations count, unrelated source cards, Copy, Log as CPD, thumbs and a dose caution
 * around one honest sentence. This is its own layout instead: a plain heading, the
 * pipeline's own sentence unchanged, and one line on what was searched. The answer surface
 * puts "Also in your library" straight after it as the useful next step.
 *
 * Nothing here is clinical content: the sentence is the pipeline's own refusal, and the
 * searched documents are left off because none of them answers the question.
 */
export function AnswerNotInSources({
  text,
  query,
  preformatted,
  searchedCount,
}: {
  text: string;
  query: string;
  preformatted: boolean;
  searchedCount: number;
}) {
  return (
    <section data-testid="answer-not-in-sources" aria-labelledby="answer-not-in-sources-heading" className="grid gap-2">
      <h3
        id="answer-not-in-sources-heading"
        className="flex items-center gap-2 text-base font-semibold leading-6 text-[color:var(--text-heading)]"
      >
        <SearchX aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
        Your sources don&apos;t cover this
      </h3>
      <NaturalLanguageAnswer
        text={text}
        query={query}
        preformatted={preformatted}
        bestSource={null}
        sources={[]}
        sourceLinks={[]}
        railRows={[]}
        hideSourceRail
        isRefusal
        showCopyAction={false}
        copied={false}
        onCopy={noop}
      />
      <p data-testid="answer-not-in-sources-searched" className={cn("text-sm leading-6", textMuted)}>
        {notInSourcesSearchedLine(searchedCount)}
      </p>
    </section>
  );
}
