"use client";

import { Info, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { cn } from "@/components/ui-primitives";

import { calculators, domainLabels, type CalculatorFixture } from "./calculator-fixtures";
import {
  CalculatorItems,
  ScoreBandBar,
  SeverityPill,
  deriveCalculator,
  focusRing,
  progressLabel,
  type AnswerMap,
} from "./calculator-ui";
import {
  CalculatorSearchHome,
  NextActionsPanel,
  RelatedContentPanel,
  ScorePanel,
  type SessionAnswers,
} from "./search-detail-mockup";

/**
 * Popup variant of the search flow: the individual calculator opens as a
 * modal dialog on desktop and a bottom sheet on phones, keeping the search
 * page in place underneath. Uses the app's modal layer (z-100) and the
 * sheet-up / dialog-rise motion tokens.
 */
export function CalculatorSheet({
  calc,
  answers,
  onAnswersChange,
  onClose,
  onOpenCalculator,
}: {
  calc: CalculatorFixture;
  answers: AnswerMap;
  onAnswersChange: (next: AnswerMap) => void;
  onClose: () => void;
  onOpenCalculator: (calcId: string) => void;
}) {
  const derived = deriveCalculator(calc, answers);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const Icon = calc.icon;

  // Save the opener, move focus into the dialog, and restore on close.
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previousFocusRef.current?.focus?.();
  }, [calc.id]);

  // Switching calculators in place keeps this sheet mounted, so reset its scroll
  // on calc change — otherwise the next one opens at the prior sheet's offset
  // (e.g. partway down the related-content rows) instead of its indication.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [calc.id]);

  // Trap Tab / Shift+Tab within the dialog so focus can't reach the page behind.
  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) => element.tabIndex !== -1 && (element.offsetParent !== null || element === document.activeElement),
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${calc.abbrev} calculator`}
      onKeyDown={trapTab}
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6"
    >
      <button
        type="button"
        aria-label="Close calculator"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 animate-overlay-in bg-[color:var(--neutral-950)]/55 backdrop-blur-[2px]"
      />
      <div className="relative flex max-h-[92dvh] w-full animate-sheet-up flex-col overflow-hidden rounded-t-xl border border-[color:var(--border-strong)] bg-[color:var(--background)] shadow-[var(--shadow-lux)] sm:max-w-3xl sm:animate-dialog-rise sm:rounded-xl">
        <header className="modal-landscape-container grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-[color:var(--border)] bg-[color:var(--surface)] py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
            <Icon className="size-icon-md" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h2 className="text-base font-extrabold leading-6 text-[color:var(--text-heading)]">{calc.abbrev}</h2>
              <span className="hidden truncate text-2xs font-semibold text-[color:var(--text-soft)] sm:inline">
                {calc.name}
              </span>
            </div>
            <p className="truncate text-2xs font-semibold text-[color:var(--text-soft)]">
              {domainLabels[calc.domain]} · {calc.items.length} items · {calc.timeEstimate}
            </p>
          </div>
          {derived.started ? (
            <span className="hidden items-center gap-2 sm:inline-flex">
              <span className="font-mono text-base font-extrabold tabular-nums text-[color:var(--text-heading)]">
                {derived.score}
              </span>
              <SeverityPill tone={derived.result.tone} label={derived.result.label} />
            </span>
          ) : (
            <span aria-hidden="true" />
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "grid size-tap place-items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]",
              focusRing,
            )}
          >
            <X className="size-icon-md" aria-hidden="true" />
          </button>
        </header>

        {/* Live strip pinned under the header while items scroll */}
        <div className="modal-landscape-container grid shrink-0 gap-1.5 border-b border-[color:var(--border)] bg-[color:var(--surface-glass)] py-2.5 backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-lg font-extrabold tabular-nums text-[color:var(--text-heading)]">
              {derived.started ? derived.score : "—"}
              <span className="text-sm-minus font-bold text-[color:var(--text-soft)]"> / {calc.maxScore}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-2xs font-semibold text-[color:var(--text-soft)]">{progressLabel(derived)}</span>
              <SeverityPill tone={derived.result.tone} label={derived.started ? derived.result.label : "Not started"} />
            </span>
          </div>
          <ScoreBandBar calc={calc} score={derived.score} started={derived.started} />
        </div>

        <div
          ref={scrollRef}
          className="modal-landscape-container grid min-h-0 flex-1 content-start gap-4 overflow-y-auto py-4"
        >
          <p className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border border-[color:var(--info-border)] bg-[color:var(--info-soft)] p-2.5 text-sm-minus font-semibold leading-5 text-[color:var(--info)]">
            <Info className="mt-0.5 size-icon-md shrink-0" aria-hidden="true" />
            {calc.indication}
          </p>
          {calc.caution ? (
            <p className="text-2xs font-semibold leading-4 text-[color:var(--warning)]">{calc.caution}</p>
          ) : null}

          <CalculatorItems calc={calc} answers={answers} onAnswersChange={onAnswersChange} />

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <NextActionsPanel calc={calc} derived={derived} />
            <RelatedContentPanel calc={calc} derived={derived} onOpenCalculator={onOpenCalculator} />
          </div>

          <ScorePanel calc={calc} derived={derived} onReset={() => onAnswersChange({})} />
        </div>
      </div>
    </div>
  );
}

export function CalculatorsPopupSheetMockup() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionAnswers>({});

  const activeCalc = openId ? calculators.find((calc) => calc.id === openId) : undefined;

  useEffect(() => {
    if (!activeCalc) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [activeCalc]);

  return (
    <div className="min-h-screen bg-[color:var(--background)]">
      <CalculatorSearchHome session={session} onOpen={setOpenId} />
      {activeCalc ? (
        <CalculatorSheet
          calc={activeCalc}
          answers={session[activeCalc.id] ?? {}}
          onAnswersChange={(next) => setSession((prev) => ({ ...prev, [activeCalc.id]: next }))}
          onClose={() => setOpenId(null)}
          onOpenCalculator={setOpenId}
        />
      ) : null}
    </div>
  );
}
