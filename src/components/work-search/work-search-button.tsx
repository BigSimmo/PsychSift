"use client";

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";

import {
  LazyWorkSearchKeys,
  LazyWorkSearchSheet,
  prefetchWorkSearchSheet,
} from "@/components/work-search/lazy-work-search-sheet";
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

/** Typing in a field (or a rich-text box): the shortcut keys are the reader's letters there, not ours. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Another dialog is open over the page: its keys belong to it. */
function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/** The start of the "opening to first result" timing, kept on this device only. */
function markOpening() {
  try {
    performance.clearMarks("work-search:open");
    performance.mark("work-search:open");
  } catch {
    // A browser without the timeline simply records nothing.
  }
}

/**
 * Fetches the search screen's code once the page has settled, so the first tap opens it
 * at once. Skipped when the reader has asked the browser to save data.
 */
function prefetchWhenIdle(): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => {};
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(() => prefetchWorkSearchSheet(), { timeout: 4000 });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(prefetchWorkSearchSheet, 2500);
  return () => window.clearTimeout(timer);
}

/**
 * The header's "AI Search" control on the staff modes (it searches the reader's own work
 * records, never patients and never clinical content): a round lens-with-stars on phones and a labelled pill on wide screens, so it is never mistaken for the clinical
 * search box. The pill opens only when the header's trailing column (a wide-screen container
 * the header names `header-trailing`) has room for it beside the bell: 20.75rem is the bell,
 * the gap and the 18rem pill, less the grid gap it may lean into. Measured in rem, so at large
 * text sizes the control stays a round icon rather than running under the mode switcher. It opens a full-screen search across Roster, Teaching, CPD, Admin and On Call.
 * The first time it appears, a small "New" note points at it until dismissed.
 *
 * Keys (work-mode redesign, ideas list #3): "/" or Ctrl K (Command K on a Mac) opens
 * it from anywhere on a work page that is not a text field, and "?" shows the list.
 */
export function WorkSearchButton({ modeId, className }: { modeId: AppModeId; className?: string }) {
  const [open, setOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  // Read from storage after hydration (the server snapshot says "seen"), then hidden for good once dismissed.
  const seen = useSyncExternalStore(subscribeNever, coachSeen, () => true);
  const [dismissed, setDismissed] = useState(false);
  // Any tap elsewhere hides the note for this visit, without counting it as read,
  // so it never sits over the page the reader is trying to use.
  const [setAside, setSetAside] = useState(false);
  const coach = !seen && !dismissed && !setAside;
  const coachRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!coach) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!coachRef.current?.contains(event.target as Node)) setSetAside(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [coach]);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const dismissCoach = () => {
    setDismissed(true);
    markCoachSeen();
  };
  const openSearch = () => {
    markOpening();
    dismissCoach();
    setOpen(true);
  };
  const openSearchFromKeys = useEffectEvent(openSearch);

  useEffect(prefetchWhenIdle, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.isComposing || isTyping(event.target) || dialogOpen()) return;
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey;
      const command = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.shiftKey;
      const help = event.key === "?" && !event.metaKey && !event.ctrlKey;
      if (!slash && !command && !help) return;
      // Captured first, so no other page shortcut acts on the same key as well.
      event.preventDefault();
      event.stopPropagation();
      if (help) setKeysOpen(true);
      else openSearchFromKeys();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 rounded-full",
        // While the note shows, a soft halo in the page's colour draws the eye to the button it is about.
        coach && "ring-4 ring-[color:color-mix(in_srgb,var(--mode-identity,var(--focus))_20%,transparent)]",
      )}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={openSearch}
        onPointerEnter={prefetchWorkSearchSheet}
        onFocus={prefetchWorkSearchSheet}
        aria-label="AI Search"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={coach ? "work-search-coach" : undefined}
        title="AI Search"
        data-testid="work-search-button"
        className={cn(
          "universal-header-icon-control relative inline-flex h-tap w-tap shrink-0 items-center justify-center gap-2.5 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-heading)] shadow-[var(--e2)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none @min-[20.75rem]/header-trailing:w-72 @min-[20.75rem]/header-trailing:justify-start @min-[20.75rem]/header-trailing:px-3.5",
          className,
        )}
      >
        <WorkSearchGlyph className="size-icon-lg" />
        <span className="hidden text-sm-minus text-[color:var(--text-muted)] @min-[20.75rem]/header-trailing:inline">
          AI Search
        </span>
      </button>
      {/* Below 640px the note would sit over the page title and first row, so phones get only the
          ring above; tapping the button still marks the note as read. From 640px it shows as before. */}
      {coach ? (
        <span
          ref={coachRef}
          id="work-search-coach"
          role="note"
          className="pointer-events-none absolute right-0 top-full z-[var(--z-popover)] mt-3 hidden w-[min(14.75rem,calc(100vw-2rem))] gap-1 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3.5 text-left shadow-[var(--e4)] sm:grid"
        >
          <span
            aria-hidden="true"
            className="absolute -top-1.5 right-4 size-3 rotate-45 border-l border-t border-[color:var(--border)] bg-[color:var(--surface-raised)]"
          />
          <span className="text-3xs font-extrabold uppercase tracking-widest text-[color:var(--mode-identity,var(--focus))]">
            New
          </span>
          <span className="text-base-minus font-bold text-[color:var(--text-heading)]">AI Search</span>
          <span className="text-xs text-[color:var(--text-muted)]">
            Find shifts, leave, CPD, forms and renewals in one place.
          </span>
          <button
            type="button"
            onClick={dismissCoach}
            className="pointer-events-auto inline-flex min-h-12 items-center justify-self-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            <span className="rounded-full bg-[color:var(--mode-identity,var(--focus))] px-4 py-2 text-sm-minus font-bold text-[color:var(--mode-identity-contrast,var(--surface-raised))]">
              Got it
            </span>
          </button>
        </span>
      ) : null}
      <LazyWorkSearchSheet
        open={open}
        onClose={(navigated) => {
          setOpen(false);
          // After opening a result, focus belongs to the new page, not back on this icon.
          if (navigated) return;
          // The sheet unmounts on close, so focus is put back here rather than left to it.
          requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
        }}
        // Open shifts lives in Roster's frame, so its search starts on Roster.
        currentArea={modeId === "open-shifts" ? "roster" : isWorkSearchArea(modeId) ? modeId : null}
        returnFocusRef={buttonRef}
      />
      <LazyWorkSearchKeys open={keysOpen} onClose={() => setKeysOpen(false)} />
    </span>
  );
}
