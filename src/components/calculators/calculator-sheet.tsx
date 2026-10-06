"use client";

import { Info, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { cn } from "@/components/ui-primitives";
import { canRestoreFocusTo, isTopmostSheet, popSheet, pushSheet, updateSheetRoot } from "@/components/ui/sheet-focus";
import { MissingValue } from "@/components/ui/missing-value";

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
import { CalculatorSearchHome, NextActionsPanel, ScorePanel, type SessionAnswers } from "./search-detail";

/**
 * Popup variant of the search flow: the individual calculator opens as a
 * modal dialog on desktop and a bottom sheet on phones, keeping the search
 * page in place underneath. Uses the app's modal layer (z-100) and the
 * sheet-up / dialog-rise motion tokens.
 */
export interface CalculatorSheetProps {
  calc: CalculatorFixture;
  answers: AnswerMap;
  onAnswersChange: (next: AnswerMap) => void;
  onClose: () => void;
  sheetId?: string;
  isOpen?: boolean;
}

export function CalculatorSheet({
  calc,
  answers,
  onAnswersChange,
  onClose,
  sheetId,
  isOpen = true,
}: CalculatorSheetProps) {
  const derived = deriveCalculator(calc, answers);
  const internalSheetId = useId();
  const effectiveSheetId = sheetId ?? internalSheetId;
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const Icon = calc.icon;

  // A backdrop click discards the whole assessment, and in the centred-dialog
  // layout the scroll body's bottom clip boundary IS the panel's bottom edge,
  // with the backdrop immediately beyond it (36px of it at 1440x900, 32px at
  // 1024x800). So a 48px option chip left half-clipped at that edge has its
  // centre as little as 2px inside the backdrop. Measured at 1440x900: a chip
  // showing 22 of its 48px answered a click at its own centre by discarding a
  // part-finished PHQ-9 — three entered answers gone, no confirmation, nothing
  // to undo (#EKB6XR). Phones are immune only because the sheet is `items-end`
  // and full-bleed, so there is no backdrop below the panel to miss onto.
  //
  // The geometry cannot be fixed by resizing: the chips are already at the
  // repo's 48px tap-target floor and must stay there. Guarding the consequence
  // is smaller than reserving space, costs no layout, and also covers a stray
  // backdrop click anywhere rather than only at that one edge.
  //
  // Keep the pointer shortcut while nothing has been entered — that is the case
  // it exists for — and stop it discarding work once there is any. The header
  // button and Escape remain the two deliberate exits, so focus moves to the
  // named close rather than leaving the click silently inert.
  const dismissFromBackdrop = () => {
    if (derived.started) {
      closeRef.current?.focus();
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    pushSheet(effectiveSheetId, dialogRef.current);
    updateSheetRoot(effectiveSheetId, dialogRef.current);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopmostSheet(effectiveSheetId)) {
        event.preventDefault();
        onCloseRef.current();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      updateSheetRoot(effectiveSheetId, null);
      popSheet(effectiveSheetId);
    };
  }, [effectiveSheetId, isOpen]);

  // Save the opener, move focus into the dialog, and restore on close.
  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      const target = previousFocusRef.current;
      if (target && target.isConnected && typeof target.focus === "function" && canRestoreFocusTo(target)) {
        target.focus();
      }
    };
  }, [calc.id, isOpen]);

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

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${calc.abbrev} calculator`}
      onKeyDown={trapTab}
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6"
    >
      {/* The backdrop is a click-to-close LAYER, not a second control. It was a
          `<button aria-label="Close calculator">`, which put two elements
          answering to the name "Close" in one dialog — and because it is
          `absolute inset-0` it also spans BEHIND the panel, so which one a
          "Close" lookup or a stray click reached was decided by DOM order alone
          (#EKB6XR). Presentational and aria-hidden now: the header button is the
          dialog's one named close, Escape is the keyboard route, and this stays
          the pointer shortcut it always was — but only while the sheet is
          unstarted; see `dismissFromBackdrop` above for why.

          Both layers carry an explicit rung from the ladder rather than relying
          on paint order — `--z-overlay` (80) under `--z-modal` (100) — so the
          panel sits above the sheet of glass that covers the whole viewport. */}
      <div
        aria-hidden="true"
        data-testid="calculator-sheet-backdrop"
        onClick={dismissFromBackdrop}
        className="absolute inset-0 z-[80] animate-overlay-in bg-[color:var(--neutral-950)]/55 backdrop-blur-[2px]"
      />
      <div className="relative z-[100] flex max-h-[calc(100dvh-max(0.75rem,var(--safe-area-top)))] w-full animate-sheet-up flex-col overflow-hidden rounded-t-xl border border-[color:var(--border-strong)] bg-[color:var(--background)] shadow-[var(--shadow-lux)] sm:max-h-[92dvh] sm:max-w-3xl sm:animate-dialog-rise sm:rounded-xl">
        <header className="modal-landscape-container grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-[color:var(--border)] bg-[color:var(--surface)] py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
            <Icon className="size-icon-md" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h2 className="text-base font-extrabold leading-6 text-[color:var(--text-heading)]">{calc.abbrev}</h2>
              <span className="hidden truncate text-2xs font-semibold text-[color:var(--text-muted)] sm:inline">
                {calc.name}
              </span>
            </div>
            <p className="truncate text-2xs font-semibold text-[color:var(--text-muted)]">
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
            {/* Unstarted is not a missing score: no score exists yet, so the fraction has no numerator. The scale's own
                endpoints stay visible in the ScoreBandBar directly below. */}
            {derived.started ? (
              <span className="font-mono text-lg font-extrabold tabular-nums text-[color:var(--text-heading)]">
                {derived.score}
                <span className="text-sm-minus font-bold text-[color:var(--text-muted)]"> / {calc.maxScore}</span>
              </span>
            ) : (
              <MissingValue reason="not_yet_calculated" />
            )}
            <span className="flex items-center gap-2">
              <span className="text-2xs font-semibold text-[color:var(--text-muted)]">{progressLabel(derived)}</span>
              <SeverityPill tone={derived.result.tone} label={derived.started ? derived.result.label : "Not started"} />
            </span>
          </div>
          <ScoreBandBar calc={calc} score={derived.score} started={derived.started} />
          {/* The scope line belongs HERE, not in ScorePanel at the foot of the
              scroll body: this strip is pinned, so the score and its severity are
              readable throughout a long instrument while anything below the fold is
              not. `caution` is set on one of the five released instruments, and the
              catalogue's "Scores support clinical judgement" note is on the page
              behind this modal, so without this the number and its label are the
              only things in view at the moment they are read. */}
          <p className="text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
            Clinical reference — not validated decision support. Confirm scoring and interpretation against the source
            instrument.
          </p>
        </div>

        <div
          ref={scrollRef}
          className="modal-landscape-container grid min-h-0 flex-1 content-start gap-4 overflow-y-auto overscroll-contain py-4"
        >
          <p className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border border-[color:var(--info-border)] bg-[color:var(--info-soft)] p-2.5 text-sm-minus font-semibold leading-5 text-[color:var(--info)]">
            <Info className="mt-0.5 size-icon-md shrink-0" aria-hidden="true" />
            {calc.indication}
          </p>
          {calc.caution ? (
            <p className="text-2xs font-semibold leading-4 text-[color:var(--warning)]">{calc.caution}</p>
          ) : null}

          <CalculatorItems calc={calc} answers={answers} onAnswersChange={onAnswersChange} />

          <NextActionsPanel calc={calc} derived={derived} />

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

  const calculatorSheetId = useId();

  useEffect(() => {
    if (!activeCalc) return;
    pushSheet(calculatorSheetId);
    const onKey = (event: KeyboardEvent) => {
      if (!isTopmostSheet(calculatorSheetId)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popSheet(calculatorSheetId);
    };
  }, [activeCalc, calculatorSheetId]);

  return (
    <div className="min-h-screen bg-[color:var(--background)]">
      <CalculatorSearchHome session={session} onOpen={setOpenId} />
      {activeCalc ? (
        <CalculatorSheet
          calc={activeCalc}
          sheetId={calculatorSheetId}
          answers={session[activeCalc.id] ?? {}}
          onAnswersChange={(next) => setSession((prev) => ({ ...prev, [activeCalc.id]: next }))}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
