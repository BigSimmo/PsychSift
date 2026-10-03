"use client";

import { LogIn } from "lucide-react";
import { useState, type ReactNode } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { useMyDayNow } from "@/components/my-day/my-day-page";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { myDayEnabledForAuth, myDayNeedsSignIn } from "@/lib/my-day/model";
import { useAuthSession } from "@/lib/supabase/client";

const PAGE_WIDTH = "mx-auto grid w-full max-w-2xl gap-5 sm:gap-6";

/**
 * The shared frame of My Day's sub-pages: header, then the sign-in states
 * (checking, failed, signed out) the page body never has to repeat. The body
 * renders only for a reader who can be read for, so nothing fetches signed out.
 */
export function MyDayFrame({
  title,
  subtitle,
  testId,
  now: nowProp,
  children,
}: {
  readonly title: string;
  readonly subtitle: (now: Date) => string;
  /** Prefix for the frame's test ids, e.g. `my-day-week`. */
  readonly testId: string;
  readonly now?: Date;
  readonly children: (now: Date) => ReactNode;
}) {
  const { status: authStatus } = useAuthSession();
  const enabled = myDayEnabledForAuth(authStatus);
  const now = useMyDayNow(nowProp);
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <InformationPageShell testId={`${testId}-main`}>
      <div className={PAGE_WIDTH}>
        <header className="grid gap-0.5" data-testid={`${testId}-header`}>
          <h1 className="text-2xl font-semibold text-[color:var(--text-heading)]">{title}</h1>
          <p className="text-sm text-[color:var(--text-muted)]">{subtitle(now)}</p>
        </header>

        {authStatus === "loading" ? (
          <>
            <span role="status" className="sr-only">
              {`Loading ${title}`}
            </span>
            <div className="grid gap-5" data-testid={`${testId}-loading`} aria-hidden="true">
              <ModeModuleSkeleton rows={3} twoLine eyebrow />
            </div>
          </>
        ) : null}

        {authStatus === "error" ? (
          <div className="grid gap-2" data-testid={`${testId}-auth-error`}>
            <ModeNotice tone="warning">Couldn&apos;t check your sign-in. Try again.</ModeNotice>
            <div>
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          </div>
        ) : null}

        {myDayNeedsSignIn(authStatus) ? (
          <div className="grid gap-3" data-testid={`${testId}-signed-out`}>
            <EmptyState
              icon={LogIn}
              title="Sign in to see your day"
              body="My Day gathers your own On Call, Roster, CPD, Teaching and Admin records. Nothing is shared."
              actions={
                <Button variant="primary" onClick={() => setSignInOpen(true)}>
                  Sign in
                </Button>
              }
            />
            <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
          </div>
        ) : null}

        {enabled ? children(now) : null}
      </div>
    </InformationPageShell>
  );
}
