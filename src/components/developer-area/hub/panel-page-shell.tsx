import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { ContextualBackLink } from "@/components/contextual-back-link";
import { FreshnessStamp } from "@/components/developer-area/hub/freshness-stamp";
import type { Freshness } from "@/lib/developer-area/freshness";

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
  freshnessLabel?: string;
  children: ReactNode;
}) {
  return (
    <main data-testid={testId} className="mx-auto grid w-full max-w-[64rem] gap-6 px-4 py-8 sm:px-6">
      <ContextualBackLink
        data-testid={`${testId}-back`}
        fallbackHref="/mockups/development"
        className="inline-flex min-h-12 w-fit items-center gap-2 text-sm font-bold text-[color:var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      >
        <ArrowLeft aria-hidden="true" className="size-icon-sm" />
        Developer hub
      </ContextualBackLink>

      <h1 className="text-2xl font-extrabold text-[color:var(--text-heading)]">{title}</h1>

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
