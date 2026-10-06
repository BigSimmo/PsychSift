"use client";

import { Bell } from "lucide-react";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { LazyNeedsYouSheet, prefetchNeedsYouSheet } from "@/components/needs-you/lazy-needs-you-sheet";
import { cn } from "@/components/ui-primitives";
import type { AppModeId } from "@/lib/app-modes";
import { isStaffWorkHomePath, needsYouBellVisibleForAuth } from "@/lib/needs-you/homes";
import { useAuthSession } from "@/lib/supabase/client";

/**
 * The header's "Needs you" control on staff work homes: a round bell before
 * Search my work. Signed-out chrome, First Nations, clinical search, and inner
 * section pages do not render it.
 */
export function NeedsYouButton({ modeId, className }: { modeId: AppModeId; className?: string }) {
  const pathname = usePathname();
  const { status } = useAuthSession();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  if (!isStaffWorkHomePath(modeId, pathname) || !needsYouBellVisibleForAuth(status)) {
    return null;
  }

  return (
    <span className="relative inline-flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        onPointerEnter={prefetchNeedsYouSheet}
        onFocus={prefetchNeedsYouSheet}
        aria-label="Needs you"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Needs you"
        data-testid="needs-you-bell"
        className={cn(
          "universal-header-icon-control relative inline-flex h-tap w-tap min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] transition",
          "hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none",
          className,
        )}
      >
        <Bell aria-hidden="true" className="size-icon-lg" strokeWidth={2.25} />
      </button>
      <LazyNeedsYouSheet
        open={open}
        onClose={(navigated) => {
          setOpen(false);
          if (navigated) return;
          requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
        }}
        returnFocusRef={buttonRef}
      />
    </span>
  );
}
