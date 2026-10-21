import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { cn, textMuted } from "@/components/ui-primitives";
import type { AppModeId } from "@/lib/app-modes";

// Compact APP-5 privacy notice shown beside clinical input controls (query
// composer). Deliberately one quiet 11px line — the wording
// and the /privacy link are governance copy (PIA-5) and must stay intact.
export function PrivacyInputNotice({
  className,
  id,
  testId,
  returnMode,
}: {
  className?: string;
  id?: string;
  testId?: string;
  returnMode?: AppModeId;
}) {
  return (
    <p
      role="note"
      id={id}
      data-testid={testId}
      className={cn(
        // z sits above the composer dock backdrop (z-0) but below the command
        // surface (z-10) so the suggestions dropdown can cover the notice.
        "relative z-[5] flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-0 text-2xs leading-4",
        textMuted,
        className,
      )}
    >
      <ShieldAlert className="size-icon-xs shrink-0 text-[color:var(--warning)]" aria-hidden />
      <span>Do not enter patient-identifiable information.</span>
      <Link
        href={returnMode ? `/privacy?from=${returnMode}` : "/privacy"}
        // min-h-tap stays: ui-accessibility.spec.ts measures this link's own
        // border box and requires >=44x44, so the 48px target is load-bearing
        // and a pseudo-element expander would not satisfy it. On a phone the
        // link wraps onto its own line, where that 48px box turned a 16px line
        // of text into a 48px row.
        //
        // The negative margin is bottom-only on purpose. Split symmetrically
        // (-my-2) the box overhangs the line above by 8px, and because that
        // line is only 16px tall the overhang reaches its centre: tapping the
        // "Do not enter patient-identifiable information." sentence then
        // navigated to /privacy. Pulling only from the bottom keeps the full
        // 48px target, reclaims the same 16px that --spacing-mode-home-composer-phone
        // assumes, and leaves the sentence inert. sm:min-h-0 is intentional: from
        // sm up the notice is a single 16px line and the wide composer reserve is
        // already exact without a 48px tap box. Fixed phone docks that mount this
        // notice (calculators) cancel -mb-4 via [&_a]:mb-0 so the focus ring stays
        // inside the viewport.
        className="-mb-4 inline-flex min-h-tap items-center rounded-sm font-medium underline decoration-[color:var(--border-strong)] underline-offset-2 transition-colors hover:text-[color:var(--clinical-accent)] hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:mb-0 sm:min-h-0"
      >
        Privacy and data processing
      </Link>
    </p>
  );
}
