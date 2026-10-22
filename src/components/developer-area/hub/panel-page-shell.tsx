import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { ContextualBackLink } from "@/components/contextual-back-link";
import { FreshnessStamp } from "@/components/developer-area/hub/freshness-stamp";
import type { Freshness } from "@/lib/developer-area/freshness";

/**
 * No `"use client"` on this component itself: it stays a Server Component so
 * the build-time snapshot data passed in `children` never has to cross a
 * client boundary. It does render `ContextualBackLink`, a `"use client"` leaf
 * for the back control's history-aware navigation — that is a legal Server →
 * Client composition, not a client boundary on the shell. Never let snapshot
 * data flow through that client child; it would arrive as an inert
 * client-reference proxy on the other side.
 */
export function PanelPageShell({
  testId,
  title,
  freshness,
  freshnessLabel,
  children,
}: {
  testId: string;
  title: string;
  freshness: Freshness;
  /**
   * Required, not defaulted. `FreshnessStamp` still defaults its own `label` to
   * "Ledger" for its direct callers, but that default is exactly the trap this
   * shell must not forward: a page that forgot to pass its own label would
   * silently render "Ledger content as of …" over data that is not the ledger.
   * Every current call site already has an unambiguous label to state.
   */
  freshnessLabel: string;
  children: ReactNode;
}) {
  return (
    <main data-testid={testId} className="mx-auto grid w-full max-w-[64rem] gap-6 px-4 py-8 sm:px-6">
      <ContextualBackLink
        data-testid={`${testId}-back`}
        fallbackHref="/admin/developer-hub"
        className="inline-flex min-h-12 w-fit items-center gap-2 text-sm font-medium text-[color:var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      >
        <ArrowLeft aria-hidden="true" className="size-icon-sm" />
        Owner panel
      </ContextualBackLink>

      <h1 className="text-2xl font-semibold text-[color:var(--text-heading)]">{title}</h1>

      {/*
       * Unconditional, and directly under the title. Every number below is read
       * from a snapshot committed at build time, so the one thing a reader must
       * never have to guess is how old it is.
       */}
      <FreshnessStamp freshness={freshness} label={freshnessLabel} />

      {children}
    </main>
  );
}
