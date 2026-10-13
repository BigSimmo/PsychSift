import type { Metadata } from "next";

import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { CountTile, META_CLASS, PanelSection } from "@/components/developer-area/hub/panel-primitives";
import { referencedQuestionCount, resolveClinicalAnswerFailures } from "@/lib/developer-area/clinical-answer-failures";
import { loadLedgerSnapshot, resolveFreshness } from "@/lib/developer-area/ledger-snapshot";

export const metadata: Metadata = {
  title: "Answer failures · Developer · PsychSift",
  description: "Open ledger items that name one of the repository's clinical eval questions.",
};

export default function DeveloperClinicalAnswerFailuresPage() {
  const snapshot = loadLedgerSnapshot();
  const now = new Date();
  const freshness = resolveFreshness(snapshot, now);
  const failures = resolveClinicalAnswerFailures(snapshot);
  const questions = referencedQuestionCount(failures);

  return (
    <PanelPageShell
      testId="developer-clinical-answer-failures"
      title="Answer failures"
      freshness={freshness}
      freshnessLabel="Ledger"
    >
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <CountTile
          testId="developer-clinical-answer-failures-count-items"
          value={failures.length}
          label={failures.length === 1 ? "open problem" : "open problems"}
        />
        <CountTile
          testId="developer-clinical-answer-failures-count-questions"
          value={questions}
          label={questions === 1 ? "question referenced" : "questions referenced"}
        />
      </div>

      {/*
       * The scope caveat is page content, not a footnote, and it is deliberately
       * above the list rather than below it. This page reports the intersection
       * of two records — the task ledger and the eval case list — and that
       * intersection is narrower than "clinical answer quality". Anyone reading
       * an empty list here must not conclude the answer engine is well.
       */}
      <p className={META_CLASS}>
        Every open item in the task ledger that names one of the repository&rsquo;s clinical eval questions by its case
        id. That is a narrower thing than a picture of answer quality: a recorded problem that does not name a case is
        not listed here, and a question that is failing right now but that nobody has written up is not either. An empty
        list means nothing is <em>recorded</em> against a named question, not that every question answers well.
      </p>
      {/*
       * The correction from review of #2498, and the reason the questions below
       * are labelled as referenced rather than affected. An item names a case for
       * more than one reason: `#J8SJQ9` names the discharge-documentation case as
       * the *contrast* that legitimately answers with a source pointer. Nothing in
       * the text separates that from a case being reported broken, so the page
       * asserts at the level it can stand behind -- the item -- and leaves the
       * reader to open it.
       */}
      <p className={META_CLASS}>
        The questions under each item are the ones its text <em>names</em>, not a verdict on each question. An item may
        name a question as the contrast that is behaving correctly, so read the item before concluding that a question
        listed here answers badly.
      </p>

      <PanelSection
        headingId="developer-clinical-answer-failures-heading"
        heading={`Recorded problems naming a clinical question · ${failures.length}`}
      >
        {failures.length > 0 ? (
          <ul className="grid gap-3">
            {failures.map(({ item, cases }) => (
              <li
                key={item.id}
                data-testid={`developer-clinical-answer-failure-${item.id}`}
                className="grid gap-2 rounded-xl border border-[color:var(--border)] p-4"
              >
                <p className="text-sm font-extrabold leading-6 text-[color:var(--text-heading)]">{item.summary}</p>
                <p className={META_CLASS}>
                  {item.id} · {item.priority} · recorded {item.added}
                </p>
                <p className="text-xs font-bold text-[color:var(--text-muted)]">Questions this item names</p>
                <ul className="grid gap-1">
                  {cases.map((testCase) => (
                    <li key={testCase.id} className="text-sm leading-6 text-[color:var(--text)]">
                      {/*
                       * The question as a clinician would ask it, with the case
                       * id beside it rather than instead of it. The id is what
                       * makes the match verifiable; the question is what makes
                       * the entry mean anything to a reader.
                       */}
                      &ldquo;{testCase.question}&rdquo;
                      <span className="block text-xs text-[color:var(--text-muted)]">{testCase.id}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          /*
           * In words, never a blank container: an empty result and a failed load
           * look identical otherwise, and here the difference matters more than
           * usual because the empty state is the reassuring-looking one.
           */
          <div
            data-testid="developer-clinical-answer-failures-empty"
            className="grid gap-2 rounded-xl border border-[color:var(--border)] p-4"
          >
            <p className="text-sm leading-6 text-[color:var(--text-heading)]">
              No open ledger item names a clinical eval question.
            </p>
            <p className={META_CLASS}>
              That is the ledger being quiet, not the answer engine being proven well. Answer quality itself is measured
              by the eval runs, which this page does not read.
            </p>
          </div>
        )}
      </PanelSection>
    </PanelPageShell>
  );
}
