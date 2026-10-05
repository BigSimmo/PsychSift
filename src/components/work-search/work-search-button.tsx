"use client";

import { useRef, useState, useSyncExternalStore } from "react";

import { LazyWorkSearchSheet, prefetchWorkSearchSheet } from "@/components/work-search/lazy-work-search-sheet";
import { WorkSearchGlyph } from "@/components/work-search/work-search-glyph";
import type { AppModeId } from "@/lib/app-modes";
import { cn } from "@/components/ui-primitives";
import { isWorkSearchArea } from "@/lib/work-search/model";

/** Remembered per device so the one-time "New" note never comes back once read. A convenience only. */
const COACH_KEY = "psychsift:work-search-coach-seen";

function coachSeen(): boolean {
  try {
    return window.localStorage.getItem(COACH_KEY) === "1";
  } catch {
    return true;
  }
}

function markCoachSeen() {
  try {
    window.localStorage.setItem(COACH_KEY, "1");
  } catch {
    // Storage blocked: the note simply shows again next time.
  }
}

function subscribeNever() {
  return () => {};
}

/**
 * The header's "Search my work" control on the staff modes: a round magnifier-with-sparkle
 * on phones and a labelled pill on wide screens, so it is never mistaken for the clinical
 * search box. It opens a full-screen search across Roster, Teaching, CPD, Admin and On Call.
 * The first time it appears, a small "New" note points at it until dismissed.
 */
export function WorkSearchButton({ modeId, className }: { modeId: AppModeId; className?: string }) {
  const [open, setOpen] = useState(false);
  // Read from storage after hydration (the server snapshot says "seen"), then hidden for good once dismissed.
  const seen = useSyncExternalStore(subscribeNever, coachSeen, () => true);
  const [dismissed, setDismissed] = useState(false);
  const coach = !seen && !dismissed;
  const buttonRef = useRef<HTMLButtonElement>(null);

  const dismissCoach = () => {
    setDismissed(true);
    markCoachSeen();
  };

  return (
    <span
      className={cn("relative inline-flex shrink-0 rounded-full", coach && "ring-4 ring-[color:var(--surface-inset)]")}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          dismissCoach();
          setOpen(true);
        }}
        onPointerEnter={prefetchWorkSearchSheet}
        onFocus={prefetchWorkSearchSheet}
        aria-label="Search my work"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={coach ? "work-search-coach" : undefined}
        title="Search my work"
        data-testid="work-search-button"
        className={cn(
          "universal-header-icon-control relative inline-flex h-tap w-tap shrink-0 items-center justify-center gap-2.5 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-heading)] shadow-[var(--e2)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none lg:w-72 lg:justify-start lg:px-3.5",
          className,
        )}
      >
        <WorkSearchGlyph className="size-icon-md" />
        <span className="hidden text-sm-minus text-[color:var(--text-muted)] lg:inline">Search my work</span>
      </button>
      {coach ? (
        <span
          id="work-search-coach"
          role="note"
          className="absolute right-0 top-full z-[var(--z-popover)] mt-3 grid w-60 gap-1.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3.5 text-left shadow-[var(--e4)]"
        >
          <span
            aria-hidden="true"
            className="absolute -top-1.5 right-4 size-3 rotate-45 border-l border-t border-[color:var(--border)] bg-[color:var(--surface-raised)]"
          />
          <span className="text-3xs font-extrabold uppercase tracking-widest text-[color:var(--text-muted)]">New</span>
          <span className="text-base-minus font-bold text-[color:var(--text-heading)]">Search my work</span>
          <span className="text-xs text-[color:var(--text-muted)]">
            Ask about your shifts, CPD, forms and renewals, across every area.
          </span>
          <button
            type="button"
            onClick={dismissCoach}
            className="inline-flex min-h-12 items-center justify-self-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            <span className="rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface-inset)] px-4 py-2 text-sm-minus font-bold text-[color:var(--text-heading)]">
              Got it
            </span>
          </button>
        </span>
      ) : null}
      <LazyWorkSearchSheet
        open={open}
        onClose={() => {
          setOpen(false);
          // The sheet unmounts on close, so focus is put back here rather than left to it.
          requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
        }}
        currentArea={isWorkSearchArea(modeId) ? modeId : null}
        returnFocusRef={buttonRef}
      />
    </span>
  );
}
