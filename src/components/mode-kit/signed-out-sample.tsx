"use client";

import { LogIn } from "lucide-react";
import { useState } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { DashTag } from "@/components/dashboard-kit/icon-chip";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";

/**
 * The one signed-out sample box every personal mode shares (My Day set the
 * pattern): a Sample tag, what signing in shows, and the Sign in button. The
 * page below it is the mode's own screen filled with invented data that is
 * built in the browser, reads nothing from the server and keeps nothing.
 */
export function SignedOutSampleNotice({
  title,
  children,
  testId,
  noticeTestId,
  className,
}: {
  /** "Sign in to see your …" */
  readonly title: string;
  /** One or two plain sentences: the sample is invented, and what signing in shows instead. */
  readonly children: React.ReactNode;
  readonly testId: string;
  /** Defaults to `${testId}-notice`. */
  readonly noticeTestId?: string;
  readonly className?: string;
}) {
  const [signInOpen, setSignInOpen] = useState(false);
  return (
    <div
      className={cn(
        "grid gap-3 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-card)] p-4 forced-colors:border",
        className,
      )}
      data-testid={testId}
      data-signed-out-sample="true"
    >
      <div className="grid gap-1">
        <p>
          <DashTag tint="amber">Sample</DashTag>
        </p>
        <h2 className="font-dash-title text-lg text-[color:var(--dash-ink)]">{title}</h2>
        <p className="text-sm text-[color:var(--dash-muted)]" data-testid={noticeTestId ?? `${testId}-notice`}>
          {children}
        </p>
      </div>
      <div>
        <Button variant="primary" icon={LogIn} onClick={() => setSignInOpen(true)}>
          Sign in
        </Button>
      </div>
      <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
