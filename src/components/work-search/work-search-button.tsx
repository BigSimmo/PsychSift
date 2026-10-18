"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  LazyWorkSearchKeys,
  LazyWorkSearchSheet,
  prefetchWorkSearchSheet,
} from "@/components/work-search/lazy-work-search-sheet";
import { WorkSearchGlyph } from "@/components/work-search/work-search-glyph";
import type { AppModeId } from "@/lib/app-modes";
import { cn } from "@/components/ui-primitives";
import { isWorkSearchArea } from "@/lib/work-search/model";

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
 * Discovery stays in the labelled control, search screen and keyboard-shortcut help.
 *
 * Keys (work-mode redesign, ideas list #3): "/" or Ctrl K (Command K on a Mac) opens
 * it from anywhere on a work page that is not a text field, and "?" shows the list.
 */
export function WorkSearchButton({ modeId, className }: { modeId: AppModeId; className?: string }) {
  const [open, setOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const openSearch = () => {
    markOpening();
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
      if (slash && document.querySelector('[data-shortcut-owner="slash"], #agreement-question-input')) return;
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
    <span className="relative inline-flex shrink-0 rounded-full">
      <button
        ref={buttonRef}
        type="button"
        onClick={openSearch}
        onPointerEnter={prefetchWorkSearchSheet}
        onFocus={prefetchWorkSearchSheet}
        aria-label="AI Search"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="AI Search"
        aria-keyshortcuts="/ Control+k Meta+k"
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
