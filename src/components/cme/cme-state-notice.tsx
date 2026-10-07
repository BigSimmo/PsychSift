"use client";

import { CircleX, CloudOff, Info, LogIn } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { CmeNote } from "@/components/cme/cme-flat-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";

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
 * It picks the words and draws them with the CPD kit's note, so every CPD page
 * shows a state the same way.
 *
 * - `unavailable` is the server loaders' name for "the record could not be
 *   read" (an outage or an unexpected throw). It renders exactly as `error`,
 *   so the loaders' contract does not change.
 * - `offline` and `error` are a real failure, so their note is the one amber
 *   outline in CPD, with a "Try again" link inside it, then grey outlines where
 *   the figures would be and a plain line saying why there are no numbers. It
 *   calls `onRetry` when the caller has one (the segment error boundary passes
 *   Next's `retry`); a server-rendered notice cannot pass a function, so it
 *   reloads the page.
 * - `unconfigured` (no confirmed targets for the year yet): one line and where
 *   to start.
 * - `heading` is the page's own title, kept above the state so the page never
 *   loses its header.
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
  const [accountOpen, setAccountOpen] = useState(false);
  const tryAgain = (
    <button
      type="button"
      data-testid="cme-state-retry"
      className={TEXT_ACTION}
      onClick={onRetry ?? (() => window.location.reload())}
    >
      Try again
    </button>
  );

  let notice: ReactNode;
  if (state === "signed-out") {
    notice = (
      <>
        <CmeNote
          testId="cme-signed-out"
          role="status"
          icon={<LogIn aria-hidden="true" strokeWidth={1.6} />}
          title="Sign in to open your private CPD record."
        >
          <span className="grid justify-items-start gap-2">
            <span>{SIGNED_OUT_LINE}</span>
            <Button variant="primary" onClick={() => setAccountOpen(true)}>
              Sign in
            </Button>
          </span>
        </CmeNote>
        <AccountSetupDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
      </>
    );
  } else if (state === "offline") {
    notice = (
      <>
        <CmeNote
          testId="cme-offline"
          role="status"
          tone="warn"
          icon={<CloudOff aria-hidden="true" strokeWidth={1.6} />}
          title="You’re offline."
        >
          <span>
            {OFFLINE_LINE} {tryAgain}
          </span>
        </CmeNote>
        <NoFiguresPlaceholder />
      </>
    );
  } else if (state === "error" || state === "unavailable") {
    notice = (
      <>
        <CmeNote
          testId="cme-error"
          role="alert"
          tone="warn"
          icon={<CircleX aria-hidden="true" strokeWidth={1.6} />}
          title="Your CPD records did not load"
        >
          <span>
            {ERROR_LINE} {tryAgain}
          </span>
        </CmeNote>
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
      {heading ? <h1 className="text-xl font-semibold text-[color:var(--text)]">{heading}</h1> : null}
      {notice}
    </div>
  );
}
