"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/ui-primitives";
import {
  FIRST_RUN_GUIDE_DISMISS_LABEL,
  FIRST_RUN_GUIDE_STEPS,
  FIRST_RUN_GUIDE_TITLE,
  FRONT_DOOR_DRAFT_MARKER,
} from "@/lib/front-door-content";
import { useAuthSession } from "@/lib/supabase/client";
import { GUIDE_METADATA_KEY, isFirstRunGuideDismissed, markFirstRunGuideDismissed } from "@/lib/terms-acceptance";

/**
 * Three-step getting started guide on the Answer home, shown once per user.
 *
 * Dismissal is remembered in this browser per user id and in the account's
 * metadata, so other devices skip it too. Loaded with `ssr: false` (see `answer-status.tsx`), so the
 * server markup never depends on browser storage.
 */
export function FirstRunGuide() {
  const { client, session, status } = useAuthSession();
  const owner = session?.user.id ?? "";
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  // Signed-in users only. A late card on the signed-out home would shift the
  // centred composer and become its largest paint (Lighthouse CLS/LCP budget).
  if (status !== "authenticated" || !session) return null;
  if (dismissedFor === owner || isFirstRunGuideDismissed(owner, session?.user.user_metadata)) return null;

  function dismiss() {
    markFirstRunGuideDismissed(owner);
    setDismissedFor(owner);
    if (client) {
      // Best effort: the browser copy above already keeps it dismissed here.
      void client.auth.updateUser({ data: { [GUIDE_METADATA_KEY]: new Date().toISOString() } }).catch(() => undefined);
    }
  }

  return (
    <section
      aria-labelledby="first-run-guide-title"
      data-testid="first-run-guide"
      className="mx-auto grid w-full max-w-reading gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="first-run-guide-title" className="text-base font-semibold text-[color:var(--text-heading)]">
          {FIRST_RUN_GUIDE_TITLE}{" "}
          <span className="text-xs font-semibold text-[color:var(--text-muted)]">({FRONT_DOOR_DRAFT_MARKER})</span>
        </h2>
        <IconButton label={FIRST_RUN_GUIDE_DISMISS_LABEL} icon={X} onClick={dismiss} />
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {FIRST_RUN_GUIDE_STEPS.map((step, index) => (
          <li key={step.id} className="grid content-start gap-1">
            <p className="text-sm font-semibold text-[color:var(--text-heading)]">
              {index + 1}. {step.title}
            </p>
            <p className="text-sm leading-6 text-[color:var(--text-muted)]">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="text-xs text-[color:var(--text-muted)]">
        <Link
          href="/about"
          className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)] underline underline-offset-4"
        >
          About and intended use
        </Link>
      </p>
    </section>
  );
}
