"use client";

import { LogIn } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { EndOfShiftCard } from "@/components/alerts/end-of-shift-card";
import { useRemindMe } from "@/components/alerts/use-remind-me";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";
import { ModeNotice } from "@/components/mode-kit/notice";
import { useMyDayNow } from "@/components/my-day/my-day-page-parts";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { endOfShiftCard, type ShiftWindow } from "@/lib/alerts/end-of-shift";
import { myDayEnabledForAuth, myDayNeedsSignIn } from "@/lib/my-day/model";
import { useAuthSession } from "@/lib/supabase/client";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";

/* The sign-in dialog and the two reminder sheets are closed at first paint, so each loads only when first opened. */
const AccountSetupDialog = dynamic(
  () => import("@/components/clinical-dashboard/account-setup-dialog").then((module) => module.AccountSetupDialog),
  { ssr: false },
);
const loadRemindMeSheets = () => import("@/components/alerts/remind-me-sheet");
const RemindMeSheet = dynamic(() => loadRemindMeSheets().then((module) => module.RemindMeSheet), { ssr: false });
const YourRemindersSheet = dynamic(() => loadRemindMeSheets().then((module) => module.YourRemindersSheet), {
  ssr: false,
});

const PAGE_WIDTH = "mx-auto grid w-full max-w-2xl gap-5 sm:gap-6";
/** A two-column page on a computer (Alerts); the phone layout is unchanged. */
const WIDE_PAGE_WIDTH = "mx-auto grid w-full max-w-2xl gap-5 sm:gap-6 lg:max-w-5xl";

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
  signedOutSample,
  signedOut,
  wide = false,
  children,
}: {
  readonly title: string;
  readonly subtitle: (now: Date) => string;
  /** Prefix for the frame's test ids, e.g. `my-day-week`. */
  readonly testId: string;
  readonly now?: Date;
  /**
   * What a signed-out visitor sees instead of the sign-in prompt: the shared
   * Sample notice (with this body) above the page's real content built from
   * invented data. The sample reads and keeps nothing.
   */
  readonly signedOutSample?: { readonly notice: ReactNode; readonly render: (now: Date) => ReactNode };
  /** The sign-in prompt's own words, for a page that is not about "your day". */
  readonly signedOut?: { readonly title: string; readonly body: string };
  readonly wide?: boolean;
  readonly children: (now: Date) => ReactNode;
}) {
  const { status: authStatus } = useAuthSession();
  const enabled = myDayEnabledForAuth(authStatus);
  const now = useMyDayNow(nowProp);
  const [signInOpen, setSignInOpen] = useState(false);
  // Once opened the dialog stays mounted, so it can close normally and hand focus back to the button.
  const [signInMounted, setSignInMounted] = useState(false);
  if (signInOpen && !signInMounted) setSignInMounted(true);

  return (
    <InformationPageShell testId={`${testId}-main`}>
      <div className={wide ? WIDE_PAGE_WIDTH : PAGE_WIDTH}>
        <header className="grid gap-0.5" data-testid={`${testId}-header`}>
          <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
            {title}
          </PageTitleUnderBand>
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

        {myDayNeedsSignIn(authStatus) && signedOutSample ? (
          <div className="grid gap-5" data-testid={`${testId}-signed-out-sample`}>
            <SignedOutSampleNotice
              title="Sign in to see your day"
              testId={`${testId}-signed-out`}
              noticeTestId={`${testId}-sample-notice`}
            >
              {signedOutSample.notice}
            </SignedOutSampleNotice>
            {signedOutSample.render(now)}
          </div>
        ) : null}

        {myDayNeedsSignIn(authStatus) && !signedOutSample ? (
          <div className="grid gap-3" data-testid={`${testId}-signed-out`}>
            <EmptyState
              icon={LogIn}
              title={signedOut?.title ?? "Sign in to see your day"}
              body={
                signedOut?.body ??
                "My Day gathers your own On Call, Roster, CPD, Teaching and Admin records. Nothing is shared."
              }
              actions={
                <Button variant="primary" onClick={() => setSignInOpen(true)}>
                  Sign in
                </Button>
              }
            />
            {signInMounted ? <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} /> : null}
          </div>
        ) : null}

        {enabled ? <MyDayFrameBody now={now}>{children}</MyDayFrameBody> : null}
      </div>
    </InformationPageShell>
  );
}

function MyDayFrameBody({ now, children }: { readonly now: Date; readonly children: (now: Date) => ReactNode }) {
  const shiftsState = useRosterShifts();
  const { reminders } = useRemindMe();
  const [sheet, setSheet] = useState<"reminders" | "remind-me" | null>(null);
  // Once a reminder sheet has opened both stay mounted, as before, so moving between them is unchanged.
  const [sheetsMounted, setSheetsMounted] = useState(false);
  if (sheet !== null && !sheetsMounted) setSheetsMounted(true);

  const shiftWindows: readonly ShiftWindow[] = useMemo(
    () =>
      shiftsState.shifts.map((s) => ({
        label: s.title || (s as { label?: string }).label || "Rostered shift",
        startsAt: s.startsAt,
        endsAt: s.endsAt,
      })),
    [shiftsState.shifts],
  );

  const endOfShift = useMemo(() => endOfShiftCard(now, shiftWindows), [now, shiftWindows]);
  const openReminders = useMemo(() => reminders.filter((item) => !item.doneAt), [reminders]);
  const hasEndOfShift = endOfShift !== null;
  useEffect(() => {
    // The end-of-shift card is the way into the reminder sheets: fetch them quietly while it shows.
    if (!hasEndOfShift) return;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => void loadRemindMeSheets().catch(() => undefined));
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(() => void loadRemindMeSheets().catch(() => undefined), 1500);
    return () => window.clearTimeout(timer);
  }, [hasEndOfShift]);

  return (
    <>
      {endOfShift ? (
        <EndOfShiftCard
          shift={endOfShift}
          pendingReminders={openReminders.length}
          onOpenReminders={() => setSheet("reminders")}
        />
      ) : null}
      {children(now)}
      {sheetsMounted ? (
        <>
          <YourRemindersSheet
            open={sheet === "reminders"}
            onClose={() => setSheet(null)}
            now={now}
            onAdd={() => setSheet("remind-me")}
          />
          <RemindMeSheet
            open={sheet === "remind-me"}
            onClose={() => setSheet("reminders")}
            now={now}
            shiftEndsAt={endOfShift?.endsAt ?? null}
          />
        </>
      ) : null}
    </>
  );
}
