"use client";

import { CircleX, Info } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { CmeNote } from "@/components/cme/cme-flat-list";
import { WorkSignInNotice } from "@/components/mode-kit/work-sign-in-notice";
import { WorkStateNotice } from "@/components/mode-kit/work-state";
import { cn } from "@/components/ui-primitives";
import { workFrameForRoute } from "@/lib/work-frame/areas";

export type CmeLoadState = "ready" | "unconfigured" | "signed-out" | "unavailable" | "offline" | "error";

// Spec §7 and the 5 Oct mock-up (screen 09), approved wording. Real apostrophes (standard v13 §1).
const SIGNED_OUT_LINE = "It is linked to your account only, and it is not shared with your health service.";
const OFFLINE_LINE = "Your CPD record isn’t kept on this phone. It opens again as soon as you’re back online.";
const ERROR_LINE = "Nothing was changed or lost. Check your connection, then try again.";
const NO_ZEROS_LINE = "No hours or counts are shown until your records load, so nothing here can look like a zero.";

/** A quiet in-line text action with a 48px tap area (the mock-up's one link inside a note). */
const TEXT_ACTION = cn(
  focusRing,
  "inline-flex min-h-12 items-center text-sm-minus font-medium text-[color:var(--clinical-accent)] hover:underline",
);

/**
 * Where the page's figures would be: grey outlines only, never numbers, so a
 * record that did not load can never be read as zero hours or nothing due.
 */
function NoFiguresPlaceholder() {
  const bar = "block h-3 rounded-sm bg-[color:var(--surface-inset)]";
  return (
    <>
      <div aria-hidden="true" data-testid="cme-state-placeholder" className="work-card work-card--pad grid gap-3.5">
        <span className={cn(bar, "w-2/5")} />
        <span className={cn(bar, "h-5 w-[70%]")} />
        <span className={cn(bar, "h-2.5 w-full")} />
        <span className={cn(bar, "w-[85%]")} />
      </div>
      <p className="m-0 text-xs text-[color:var(--text-muted)]">{NO_ZEROS_LINE}</p>
    </>
  );
}

/**
 * CPD's one state module (spec §7, standard §9, the 5 Oct mock-up screen 09).
 * It picks the words; signed out, offline and a failed read are drawn as the
 * shared work-mode state, so CPD looks like every other area.
 *
 * - `unavailable` is the server loaders' name for "the record could not be
 *   read" (an outage or an unexpected throw). It renders exactly as `error`,
 *   so the loaders' contract does not change.
 * - `offline` and `error` are a real failure, so their badge is amber, with
 *   "Try again" under the words, then grey outlines where
 *   the figures would be and a plain line saying why there are no numbers. It
 *   calls `onRetry` when the caller has one (the segment error boundary passes
 *   Next's `retry`); a server-rendered notice cannot pass a function, so it
 *   reloads the page.
 * - `unconfigured` (no confirmed targets for the year yet): one line and where
 *   to start.
 * - `heading` is the page's own title, kept above the state so the page never
 *   loses its header. Where the work frame's band already names the page, the
 *   heading is for screen readers only, so the title is not shown twice.
 */
export function CmeStateNotice({
  state,
  year,
  heading,
  onRetry,
}: {
  readonly state: Exclude<CmeLoadState, "ready">;
  readonly year: number;
  readonly heading?: string;
  readonly onRetry?: () => void;
}) {
  const pathname = usePathname();
  const bandNamesPage = pathname ? workFrameForRoute("cme", pathname) !== null : false;
  const retry = onRetry ?? (() => window.location.reload());

  let notice: ReactNode;
  if (state === "signed-out") {
    notice = (
      <WorkSignInNotice
        testId="cme-signed-out"
        role="status"
        title="Sign in to open your private CPD record."
        body={SIGNED_OUT_LINE}
      />
    );
  } else if (state === "offline") {
    notice = (
      <>
        <WorkStateNotice
          kind="offline"
          testId="cme-offline"
          title="You’re offline."
          body={OFFLINE_LINE}
          onRetry={retry}
          retryTestId="cme-state-retry"
        />
        <NoFiguresPlaceholder />
      </>
    );
  } else if (state === "error" || state === "unavailable") {
    notice = (
      <>
        <WorkStateNotice
          kind="error"
          icon={CircleX}
          testId="cme-error"
          title="Your CPD records did not load"
          body={ERROR_LINE}
          onRetry={retry}
          retryTestId="cme-state-retry"
        />
        <NoFiguresPlaceholder />
      </>
    );
  } else {
    notice = (
      <CmeNote
        testId="cme-unconfigured"
        role="status"
        icon={<Info aria-hidden="true" strokeWidth={1.6} />}
        title={`You have not confirmed a yearly target for ${year}.`}
      >
        <span>
          Nothing is measured until you do. Set one up whenever you like.{" "}
          <Link href={`/cme/setup?year=${year}`} className={TEXT_ACTION}>
            Set up your year
          </Link>
        </span>
      </CmeNote>
    );
  }

  return (
    <div data-mode-identity="cme" className="flex flex-col gap-3">
      {heading ? (
        <h1 className={bandNamesPage ? "sr-only" : "text-xl font-semibold text-[color:var(--text)]"}>{heading}</h1>
      ) : null}
      {notice}
    </div>
  );
}
