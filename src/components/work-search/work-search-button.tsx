"use client";

import { Search, Sparkle } from "lucide-react";
import { useRef, useState } from "react";

import { LazyWorkSearchSheet, prefetchWorkSearchSheet } from "@/components/work-search/lazy-work-search-sheet";
import type { AppModeId } from "@/lib/app-modes";
import { cn } from "@/lib/utils";
import { isWorkSearchArea } from "@/lib/work-search/model";

/**
 * The header's "Search my work" icon on the staff modes: a magnifier with a small
 * sparkle, so it is never mistaken for the clinical search box. It opens a
 * full-screen search across Roster, Teaching, CPD, Admin and On Call.
 */
export function WorkSearchButton({ modeId, className }: { modeId: AppModeId; className?: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        onPointerEnter={prefetchWorkSearchSheet}
        onFocus={prefetchWorkSearchSheet}
        aria-label="Search my work"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Search my work"
        data-testid="work-search-button"
        className={cn(
          "universal-header-icon-control relative inline-flex h-tap w-tap shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none",
          className,
        )}
      >
        <Search aria-hidden="true" className="size-icon-lg" />
        <Sparkle
          aria-hidden="true"
          className="absolute right-2 top-2 size-icon-xs fill-current text-[color:var(--clinical-accent)]"
        />
      </button>
      <LazyWorkSearchSheet
        open={open}
        onClose={() => setOpen(false)}
        currentArea={isWorkSearchArea(modeId) ? modeId : null}
        returnFocusRef={buttonRef}
      />
    </>
  );
}
