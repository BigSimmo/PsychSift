"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { perthDateKey, perthTime, shortDayLabel } from "@/components/teaching/teaching-dates";
import { LogToCpdSheet } from "@/components/teaching/log-to-cpd-sheet";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { useSessionDetail } from "@/components/teaching/use-session-detail";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
import { ApiClientError } from "@/lib/api-client-error";
import { useAuthSession } from "@/lib/supabase/client";
import { TeachingSignedOutError, teachingErrorMessage, teachingPost } from "@/lib/teaching/client";
import { attendanceLabels, type CheckinCompleted, type CheckinOpened } from "@/lib/teaching/model";

/*
 * Where a scanned QR lands (spec §9, part 2 S4 Step 14). It opens the scan once
 * (which leaves a 10-minute claim cookie in this browser), then finishes it.
 * Signed out, it keeps the claim and sends a sign-in link that returns to
 * `/teaching/c/complete`. A failed finish keeps the claim and offers Try again;
 * nothing here says "checked in" until the server has said so (review focus 3).
 * No app header of its own (contract D11).
 */
const COMPLETE_PATH = "/teaching/c/complete";

/** Refusals a retry cannot fix: the doctor needs a new scan, or an invitation. */
const FINAL_CODES = new Set([
  "teaching_code_expired",
  "teaching_code_invalid",
  "teaching_code_other_team",
  "teaching_access_denied",
  "teaching_team_unverified",
  "teaching_window_closed",
  "teaching_not_found",
  "teaching_claim_missing",
]);

type Step = "open" | "complete";
type ScanState =
  | { kind: "working"; opened: CheckinOpened | null }
  | { kind: "sign-in"; opened: CheckinOpened | null; sent: boolean }
  | { kind: "done"; opened: CheckinOpened | null; mark: CheckinCompleted }
  | { kind: "failed"; opened: CheckinOpened | null; message: string; retry: Step | null }
  | { kind: "offline"; opened: CheckinOpened | null; retry: Step };

function failure(error: unknown, opened: CheckinOpened | null, step: Step, returning: boolean): ScanState {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { kind: "offline", opened, retry: step };
  if (error instanceof ApiClientError && error.code === "teaching_claim_missing") {
    return {
      kind: "failed",
      opened,
      retry: null,
      message: returning
        ? "Scan the screen again. Sign-in opened in a different browser, so this one has no scan to finish."
        : "Scan the screen again to check in.",
    };
  }
  const final = error instanceof ApiClientError && FINAL_CODES.has(error.code);
  return { kind: "failed", opened, message: teachingErrorMessage(error), retry: final ? null : step };
}

export function TeachingScanLanding({ token }: { token: string | null }) {
  const auth = useAuthSession();
  const [state, setState] = useState<ScanState>({ kind: "working", opened: null });
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [cpdBridgeOpen, setCpdBridgeOpen] = useState(false);
  const started = useRef(false);

  const occurrenceId = state.kind === "done" ? state.mark.occurrenceId : null;
  const now = useTeachingNow();
  const sessionDetail = useSessionDetail(occurrenceId, false, now);

  const sessionStartsAt = sessionDetail.data?.startsAt ?? state.opened?.startsAt;
  const sessionEndsAt = sessionDetail.data?.endsAt;
  const hasEnded = Boolean(sessionEndsAt && now && new Date(sessionEndsAt).getTime() <= now.getTime());

  const run = useCallback(
    async (step: Step, known: CheckinOpened | null) => {
      let opened = known;
      if (step === "open" && token) {
        try {
          opened = await teachingPost<CheckinOpened>("/api/teaching/checkin/open", { token });
        } catch (error) {
          setState(failure(error, null, "open", false));
          return;
        }
        setState({ kind: "working", opened });
      }
      try {
        const mark = await teachingPost<CheckinCompleted>("/api/teaching/checkin/complete", {});
        setState({ kind: "done", opened, mark });
      } catch (error) {
        setState(
          error instanceof TeachingSignedOutError
            ? { kind: "sign-in", opened, sent: false }
            : failure(error, opened, "complete", token === null),
        );
      }
    },
    [token],
  );

  useEffect(() => {
    // Once per page: React's development double mount must not open the scan twice.
    if (started.current) return;
    started.current = true;
    void run(token ? "open" : "complete", null);
  }, [run, token]);

  function retry(step: Step, opened: CheckinOpened | null) {
    setState({ kind: "working", opened });
    void run(step, opened);
  }

  async function sendLink(opened: CheckinOpened | null) {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setEmailError("Enter your email address.");
      return;
    }
    setEmailError(null);
    setSending(true);
    try {
      await auth.signInWithEmail(address, COMPLETE_PATH);
      setState({ kind: "sign-in", opened, sent: true });
    } catch (error) {
      setEmailError(teachingErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  const opened = state.opened;
  const todayLink = (
    <Link href="/teaching" className={cn(buttonFaceClass({ variant: "ghost", block: true }), "no-underline")}>
      Go to Today
    </Link>
  );
  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-scan">
      <div className="grid gap-3">
        {/* A live region around the heading (always present, so a change is announced): "You're checked in" is read out without losing the heading. */}
        <div role="status">
          <h1 className="text-xl font-semibold text-[color:var(--text-heading)]">
            {state.kind === "done"
              ? "You're checked in"
              : state.kind === "sign-in"
                ? "Sign in to finish checking in"
                : "Check in"}
          </h1>
        </div>
        {opened ? (
          <div className={cn(modeModuleSurface, "grid gap-0.5 p-3")}>
            <p className="text-base-minus font-medium text-[color:var(--text-heading)]">{opened.title}</p>
            <p className="nums text-sm font-normal text-[color:var(--text-muted)]">
              {`${shortDayLabel(perthDateKey(opened.startsAt))} · ${perthTime(opened.startsAt)}`}
            </p>
          </div>
        ) : null}

        {state.kind === "working" ? <ModeModuleSkeleton rows={2} twoLine eyebrow /> : null}

        {state.kind === "done" ? (
          <>
            <p className="text-sm text-[color:var(--text-heading)]">{attendanceLabels[state.mark.method]}</p>
            {!hasEnded && sessionEndsAt ? (
              <p className="text-xs text-[color:var(--text-muted)]">
                You can log this session to CPD once it has ended at {perthTime(sessionEndsAt)}.
              </p>
            ) : null}
            <Button
              variant="primary"
              block
              disabled={!hasEnded}
              onClick={() => setCpdBridgeOpen(true)}
              data-testid="teaching-scan-cpd-bridge-open"
            >
              {hasEnded ? "Log to CPD" : "Available once session ends"}
            </Button>
            <Link
              href={`/teaching/session/${state.mark.occurrenceId}`}
              className={cn(buttonFaceClass({ variant: "secondary", block: true }), "no-underline")}
            >
              Open the session
            </Link>
            {todayLink}
            {hasEnded && sessionStartsAt && sessionEndsAt ? (
              <LogToCpdSheet
                open={cpdBridgeOpen}
                onClose={() => setCpdBridgeOpen(false)}
                occurrenceId={state.mark.occurrenceId}
                startsAt={sessionStartsAt}
                endsAt={sessionEndsAt}
              />
            ) : null}
          </>
        ) : null}

        {state.kind === "sign-in" ? (
          state.sent ? (
            <div className="grid gap-2">
              <ModeNotice>
                Check your email. Open the link on this phone, in this browser, within 10 minutes.
              </ModeNotice>
              <Button
                variant="secondary"
                block
                busy={sending}
                busyLabel="Sending"
                onClick={() => void sendLink(opened)}
              >
                Send again
              </Button>
              <Button variant="ghost" block onClick={() => setState({ kind: "sign-in", opened, sent: false })}>
                Use a different email
              </Button>
              {emailError ? (
                <div role="alert">
                  <ModeNotice tone="warning">{emailError}</ModeNotice>
                </div>
              ) : null}
            </div>
          ) : (
            <form
              className="grid gap-2"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (!sending) void sendLink(opened);
              }}
            >
              <p className={cn("text-sm", textMuted)}>Your scan is kept on this phone for 10 minutes.</p>
              <TextField
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                enterKeyHint="send"
                error={emailError ?? undefined}
              />
              <Button type="submit" variant="primary" block busy={sending} busyLabel="Sending">
                Email me a sign-in link
              </Button>
            </form>
          )
        ) : null}

        {state.kind === "failed" ? (
          <div className="grid gap-2">
            <div role="alert">
              <ModeNotice tone="warning">{state.message}</ModeNotice>
            </div>
            {state.retry ? (
              <Button variant="secondary" block onClick={() => retry(state.retry ?? "complete", opened)}>
                Try again
              </Button>
            ) : null}
            {todayLink}
          </div>
        ) : null}

        {state.kind === "offline" ? (
          <TeachingStateNotice state="offline" onRetry={() => retry(state.retry, opened)} />
        ) : null}
      </div>
    </InformationPageShell>
  );
}
