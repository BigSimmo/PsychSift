"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { cardSurface } from "@/components/card-recipes";
import { cn, textMuted } from "@/components/ui-primitives";

/**
 * Teaching's own count of sessions given but not yet logged as CPD, or null
 * when it is unknown (not asked, the endpoint failed, or nothing is waiting).
 * Teaching remains the owner of the count; CPD only reads it.
 */
export function useCmeTeachingUnloggedCount(enabled = true): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function loadCount() {
      try {
        const response = await fetch("/api/teaching?view=unlogged-count", {
          method: "GET",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const value: unknown = await response.json();
        const nextCount =
          value && typeof value === "object" && "count" in value ? (value as { count: unknown }).count : null;
        if (
          !controller.signal.aborted &&
          typeof nextCount === "number" &&
          Number.isSafeInteger(nextCount) &&
          nextCount > 0
        ) {
          setCount(nextCount);
        }
      } catch {
        // The Teaching endpoint is optional until its separate mode is connected.
      }
    }
    void loadCount();
    return () => controller.abort();
  }, [enabled]);

  return count;
}

/** The Year page's own "Teaching you gave" row carries this attribute; while it is on the page, this card stays away. */
export const CME_TEACHING_ROW_ATTRIBUTE = "data-cme-teaching-row";

/** Re-reads the snapshot once after mount, when the page's other parts are in the DOM. */
function subscribeAfterMount(callback: () => void) {
  const frame = window.requestAnimationFrame(callback);
  return () => window.cancelAnimationFrame(frame);
}

/** A quiet handoff: Teaching remains the owner of its unlogged count. */
export function CmeTeachingPrompt() {
  // The Year page now names the count in its own "Also for you" row; this card is only for pages without it.
  // Before the page is in the browser, assume the row is there, so nothing is fetched twice.
  const inPageRow = useSyncExternalStore(
    subscribeAfterMount,
    () => document.querySelector(`[${CME_TEACHING_ROW_ATTRIBUTE}]`) !== null,
    () => true,
  );
  const count = useCmeTeachingUnloggedCount(!inPageRow);

  if (inPageRow || count === null) return null;

  return (
    <section
      className={cn(cardSurface, "mt-3 p-4")}
      aria-label="Teaching sessions to log"
      data-testid="cme-teaching-prompt"
    >
      <p className="text-sm font-semibold text-[color:var(--text)]">Next to log: Teaching</p>
      <p className={cn("mt-1 text-sm", textMuted)}>
        {count} {count === 1 ? "teaching session" : "teaching sessions"} to review in Teaching.
      </p>
      <Link
        href="/teaching/review"
        className="mt-2 inline-flex min-h-tap items-center text-sm font-semibold text-[color:var(--clinical-accent)] underline underline-offset-2"
      >
        Review & log
      </Link>
    </section>
  );
}
