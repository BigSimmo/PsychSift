"use client";

import {
  ChevronLeft,
  CloudOff,
  CornerDownLeft,
  FileText,
  MessageCircleQuestion,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { AgreementAnswerCard } from "@/components/agreement-ask/agreement-answer-card";
import { AgreementClauseSheet } from "@/components/agreement-ask/agreement-clause-sheet";
import {
  AgreementHighlight,
  AgreementIconCircle,
  AgreementPdfLink,
  AgreementRowButton,
  AgreementSectionLabel,
  agreementCard,
} from "@/components/agreement-ask/agreement-parts";
import { ContextualBackLink } from "@/components/contextual-back-link";
import { InformationPageShell } from "@/components/information-page-shell";
import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { SearchField } from "@/components/ui/text-field";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { useOnlineStatus } from "@/lib/use-online-status";
import {
  AGREEMENT_QUESTION_LIMIT,
  AGREEMENT_SUGGESTED_QUESTIONS,
  agreementAnswerCopyText,
  agreementClause,
  agreementClauseCopyText,
  agreementClauses,
  agreementHighlightWords,
  agreementSignOffState,
  agreementSource,
  agreementSuggestions,
  answerAgreementQuestion,
  answerAgreementTopic,
  checkAgreementQuestion,
  isAgreementTopicId,
  type AgreementAnswer,
  type AgreementClause,
  type AgreementTopicId,
} from "@/lib/work-profile/agreement-answers";

type Shown = Extract<AgreementAnswer, { kind: "quoted" | "not-checked" }>;

const COPIED_MS = 2500;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Ask the agreement: a question field, suggested questions, the quoted answer and the clause
 * sheet. Everything runs on this phone from the clause text built into PsychSift: no AI, no
 * request, nothing saved, and it works signed out and offline (only the PDF needs a connection).
 * The typed question is never put in the address bar; deep links carry fixed ids only.
 */
export function AgreementAskPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnlineStatus();
  const offline = !online;

  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState<Shown | null>(null);
  const [askedText, setAskedText] = useState("");
  const [sheet, setSheet] = useState<{ clause: AgreementClause; used: readonly string[] } | null>(null);
  const [copied, setCopied] = useState<"answer" | "clause" | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [emptyNudge, setEmptyNudge] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const answerHeadingRef = useRef<HTMLHeadingElement>(null);
  const copiedTimer = useRef<number | null>(null);
  const deepLinkRead = useRef(false);
  const warnId = useId();

  const source = useMemo(() => agreementSource(), []);
  const signOff = useMemo(() => agreementSignOffState(), []);
  const clauses = useMemo(() => agreementClauses(), []);

  const check = checkAgreementQuestion(draft);
  const patient = check.kind === "patient" ? check : null;
  const typing = draft.trim().length > 0 && draft.trim() !== askedText && !patient;
  const suggestions = useMemo(
    () => (typing ? agreementSuggestions(draft) : { questions: [], topics: [] }),
    [draft, typing],
  );
  const highlight = useMemo(() => agreementHighlightWords(draft), [draft]);

  const show = useCallback((next: AgreementAnswer, asked: string) => {
    if (next.kind !== "quoted" && next.kind !== "not-checked") return;
    setAnswer(next);
    setAskedText(asked);
    setCopied(null);
    setCopyFailed(false);
    setFocusToken((token) => token + 1);
    announce(
      next.kind === "quoted"
        ? `Quoted from clause ${[...new Set(next.topics.flatMap((t) => t.lines.map((l) => l.clause)))].join(", ")}${
            next.signOff.signedOff ? "" : ". Not signed off yet"
          }`
        : "Not in the clauses PsychSift has checked. Open the agreement.",
      { priority: "polite" },
    );
  }, []);

  // A deep link opens a topic or a clause. Fixed ids only; any other parameter is ignored.
  useEffect(() => {
    if (deepLinkRead.current) return;
    deepLinkRead.current = true;
    const topic = searchParams.get("topic");
    const clause = searchParams.get("clause");
    if (isAgreementTopicId(topic)) {
      const next = answerAgreementTopic(topic);
      // Deferred a tick so the heading exists before it takes focus.
      window.setTimeout(() => show(next, ""), 0);
    }
    const found = clause ? agreementClause(clause) : null;
    if (found) window.setTimeout(() => setSheet({ clause: found, used: [] }), 0);
  }, [searchParams, show]);

  // After asking, the answer's heading takes focus so a screen reader starts there.
  useEffect(() => {
    if (focusToken > 0) answerHeadingRef.current?.focus({ preventScroll: false });
  }, [focusToken]);

  // "/" focuses the question from anywhere on the page, as Search my work does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const clearUrl = useCallback(() => {
    if (searchParams.get("topic") || searchParams.get("clause")) router.replace(pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const ask = useCallback(
    (question: string) => {
      const text = question.trim();
      const result = checkAgreementQuestion(text);
      if (result.kind === "empty" || result.kind === "too-short") {
        setEmptyNudge(true);
        announce("Type a question first", { priority: "polite" });
        inputRef.current?.focus();
        return;
      }
      if (result.kind === "patient") {
        // Never matched, never kept: the catch card under the field explains why.
        announce("Not asked. It looks like patient details.", { priority: "assertive" });
        inputRef.current?.focus();
        return;
      }
      setEmptyNudge(false);
      clearUrl();
      show(answerAgreementQuestion(text), text);
    },
    [clearUrl, show],
  );

  const askTopic = useCallback(
    (id: AgreementTopicId) => {
      setDraft("");
      clearUrl();
      show(answerAgreementTopic(id), "");
    },
    [clearUrl, show],
  );

  const askSuggested = (question: string) => {
    setDraft(question);
    ask(question);
  };

  const clear = () => {
    setDraft("");
    setEmptyNudge(false);
    inputRef.current?.focus();
  };

  const flashCopied = (which: "answer" | "clause") => {
    setCopied(which);
    setCopyFailed(false);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), COPIED_MS);
  };

  const copy = (which: "answer" | "clause", text: string, done: string) => {
    copyTextToClipboard(text).then(
      () => {
        flashCopied(which);
        announce(done, { priority: "polite" });
      },
      () => {
        setCopyFailed(true);
        announce("Couldn’t copy. Select the text and copy it instead.", { priority: "assertive" });
      },
    );
  };

  const openClause = (clause: string) => {
    const found = agreementClause(clause);
    if (!found) return;
    const used = answer?.kind === "quoted" ? answer.topics.flatMap((t) => t.lines.map((l) => l.text)) : [];
    setSheet({ clause: found, used });
    setCopied(null);
  };

  return (
    <InformationPageShell testId="agreement-ask-main">
      <div className="mx-auto grid w-full min-w-0 max-w-2xl gap-5">
        <header className="grid gap-1" data-testid="agreement-ask-header">
          <ContextualBackLink
            fallbackHref="/my-day/profile?tab=work"
            className="-ml-1 inline-flex min-h-12 w-fit items-center gap-1 text-sm font-medium text-[color:var(--clinical-accent)] no-underline"
          >
            <ChevronLeft aria-hidden="true" className="size-icon-sm" />
            Work profile
          </ContextualBackLink>
          <h1 className="text-hero font-semibold leading-tight text-[color:var(--text-heading)]">Ask the agreement</h1>
          <p className="text-sm leading-5 text-[color:var(--text-muted)]">
            Answers only in the agreement’s own words, each with its clause. No AI.
          </p>
        </header>

        <form
          role="search"
          aria-label="Ask the agreement"
          className="grid min-w-0 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            ask(draft);
          }}
        >
          <div className="flex min-w-0 items-start gap-2">
            <SearchField
              ref={inputRef}
              label="Your question about the agreement"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value.slice(0, AGREEMENT_QUESTION_LIMIT));
                setEmptyNudge(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && draft) {
                  event.preventDefault();
                  clear();
                }
              }}
              onClear={clear}
              clearLabel="Clear question"
              placeholder="Ask about breaks, shifts or nights"
              maxLength={AGREEMENT_QUESTION_LIMIT}
              autoComplete="off"
              enterKeyHint="go"
              error={patient ? "Looks like patient details, so it was not searched" : undefined}
              hint={emptyNudge ? "Type a question first" : undefined}
              aria-describedby={patient ? warnId : undefined}
              fieldClassName="min-w-0 flex-1"
              data-testid="agreement-question"
            />
            <Button type="submit" variant="primary" className="shrink-0" testId="agreement-ask">
              Ask
            </Button>
          </div>
        </form>

        {offline ? (
          <p
            role="status"
            className="-mt-2 flex items-start gap-2 text-sm leading-5 text-[color:var(--text-muted)]"
            data-testid="agreement-offline"
          >
            <CloudOff aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
            You’re offline. The quotes still work. Opening the agreement PDF needs a connection.
          </p>
        ) : null}

        {patient ? (
          <div
            id={warnId}
            className={agreementCard + " grid gap-3 border-[color:var(--warning-border)] p-3"}
            data-testid="agreement-patient"
          >
            <div className="flex min-w-0 items-start gap-3">
              <AgreementIconCircle icon={ShieldAlert} tone="warning" />
              <span className="grid min-w-0 gap-0.5 text-sm leading-5">
                <span className="font-semibold text-[color:var(--text-heading)]">This looks like {patient.what}</span>
                <span className="text-[color:var(--text)]">
                  Not searched and not saved. Take patient details out to ask.
                </span>
              </span>
            </div>
            {patient.safer ? (
              <div className="grid gap-1">
                <p className="text-xs font-medium leading-4 text-[color:var(--text-muted)]">Ask without them</p>
                <button
                  type="button"
                  onClick={() => askSuggested(patient.safer!)}
                  data-testid="agreement-ask-safer"
                  className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-md border border-[color:var(--border)] px-3 text-left text-sm font-medium text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
                >
                  <span className="min-w-0 flex-1 break-words">{patient.safer}</span>
                  <span className="text-[color:var(--clinical-accent)]">Ask</span>
                </button>
              </div>
            ) : null}
            <Button variant="secondary" block onClick={clear} testId="agreement-clear-patient">
              Clear
            </Button>
            <p className="text-xs leading-4 text-[color:var(--text-muted)]">
              Names, initials, record numbers, bed numbers and dates of birth are never searched.
            </p>
          </div>
        ) : null}

        {typing ? (
          <div className="grid gap-4" data-testid="agreement-suggestions">
            <ul role="list" className={agreementCard}>
              <AgreementRowButton
                icon={CornerDownLeft}
                title={<span className="break-words">{draft.trim()}</span>}
                subtitle="Ask this"
                onSelect={() => ask(draft)}
                testId="agreement-ask-typed"
              />
            </ul>
            {suggestions.questions.length ? (
              <section aria-label="Suggestions" className="grid gap-1">
                <AgreementSectionLabel>Suggestions</AgreementSectionLabel>
                <ul role="list" className={agreementCard}>
                  {suggestions.questions.map((question) => (
                    <AgreementRowButton
                      key={question}
                      icon={MessageCircleQuestion}
                      title={<AgreementHighlight text={question} words={highlight} />}
                      onSelect={() => askSuggested(question)}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {suggestions.topics.length ? (
              <section aria-label="Clauses" className="grid gap-1">
                <AgreementSectionLabel>
                  Clauses <span className="nums">{suggestions.topics.length}</span>
                </AgreementSectionLabel>
                <ul role="list" className={agreementCard}>
                  {suggestions.topics.map((topic) => (
                    <AgreementRowButton
                      key={topic.id}
                      icon={FileText}
                      title={<AgreementHighlight text={topic.label} words={highlight} />}
                      subtitle={`Clause ${[...new Set(topic.lines.map((l) => l.clause))].join(", ")}`}
                      onSelect={() => askTopic(topic.id)}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}

        {answer ? (
          <div className="grid gap-2">
            {askedText ? (
              <p className="text-sm leading-5 text-[color:var(--text-muted)]" data-testid="agreement-asked">
                You asked: <span className="text-[color:var(--text-heading)]">{askedText}</span>
              </p>
            ) : null}
            <AgreementAnswerCard
              ref={answerHeadingRef}
              answer={answer}
              onOpenClause={openClause}
              onAskTopic={askTopic}
              onCopy={() => copy("answer", agreementAnswerCopyText(answer), "Answer copied with its clause numbers")}
              copied={copied === "answer"}
              offline={offline}
              activeClause={sheet?.clause.clause ?? null}
            />
            {copyFailed ? (
              <p role="status" className="text-sm text-[color:var(--warning-text)]">
                Couldn’t copy. Select the text and copy it instead.
              </p>
            ) : null}
          </div>
        ) : null}

        {!answer && !typing && !patient ? (
          <div className={agreementCard + " grid justify-items-start gap-2 p-4"} data-testid="agreement-intro">
            <AgreementIconCircle icon={Scale} size="lg" />
            <p className="text-base font-semibold leading-6 text-[color:var(--text-heading)]">
              Ask about your hours and rest
            </p>
            <p className="text-sm leading-5 text-[color:var(--text)]">
              Every answer is quoted straight from the WA Health doctors’ agreement, with the clause it comes from. Your
              question stays on this phone and is never saved.
            </p>
            <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-xs font-medium text-[color:var(--text-muted)]">
              Clause 15 only, for now
            </span>
          </div>
        ) : null}

        {!typing && !patient ? (
          <section aria-labelledby="agreement-try" className="grid gap-1">
            <AgreementSectionLabel id="agreement-try">
              {answer ? "Ask something else" : "Try asking"}
            </AgreementSectionLabel>
            <ul role="list" className={agreementCard} data-testid="agreement-try">
              {AGREEMENT_SUGGESTED_QUESTIONS.slice(0, answer ? 3 : 4).map((question) => (
                <AgreementRowButton
                  key={question}
                  icon={MessageCircleQuestion}
                  title={question}
                  onSelect={() => askSuggested(question)}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {!typing && !patient ? (
          <section aria-labelledby="agreement-checked" className="grid gap-1">
            <AgreementSectionLabel id="agreement-checked">
              What PsychSift has checked <span className="nums">{clauses.length}</span>
            </AgreementSectionLabel>
            <ul role="list" className={agreementCard} data-testid="agreement-clause-list">
              {clauses.map((entry) => (
                <AgreementRowButton
                  key={entry.clause}
                  icon={FileText}
                  title={`Clause ${entry.clause}`}
                  subtitle={entry.labels.join(" · ")}
                  onSelect={() => {
                    setSheet({ clause: entry, used: [] });
                    setCopied(null);
                  }}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {!typing && !patient ? (
          <section aria-labelledby="agreement-source" className="grid gap-1">
            <AgreementSectionLabel id="agreement-source">Your agreement</AgreementSectionLabel>
            <div className={agreementCard + " grid gap-1 p-3"} data-testid="agreement-source">
              <p className="text-sm font-medium leading-5 text-[color:var(--text-heading)]">{source.title}</p>
              <p className="text-xs leading-4 text-[color:var(--text-muted)]">
                {source.citation} · Checked {source.checkedOn} ·{" "}
                {signOff.signedOff ? signOff.signedLine : "Not signed off yet"}
              </p>
              <p className="text-xs leading-4 text-[color:var(--text-muted)]">
                {source.pastExpiry
                  ? `Passed its expiry date of ${source.expiresOn}. It stays in force until a new agreement is made.`
                  : `Expires ${source.expiresOn}, then stays in force until a new agreement is made.`}{" "}
                Private work follows your own contract, not this agreement.
              </p>
              <AgreementPdfLink href={source.url} variant="text" offline={offline} />
            </div>
          </section>
        ) : null}
      </div>

      <AgreementClauseSheet
        clause={sheet?.clause ?? null}
        usedLines={sheet?.used ?? []}
        source={source}
        signOff={signOff}
        onClose={() => {
          setSheet(null);
          setCopied(null);
        }}
        onCopy={() =>
          sheet
            ? copy("clause", agreementClauseCopyText(sheet.clause, source), `Clause ${sheet.clause.clause} copied`)
            : undefined
        }
        copied={copied === "clause"}
        offline={offline}
      />
    </InformationPageShell>
  );
}
