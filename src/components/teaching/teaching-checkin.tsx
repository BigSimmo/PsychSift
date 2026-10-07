"use client";

import { T5Button, t5ButtonFace } from "@/components/teaching/t5-kit";

import { Copy, ExternalLink, MonitorUp, MonitorX, Share2 } from "lucide-react";
import { useState } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { CheckinQr } from "@/components/teaching/checkin-qr";
import { checkinCloses, checkinOpens, formatTypedCode, isOccurrenceId } from "@/components/teaching/session-view-model";
import { perthTime } from "@/components/teaching/teaching-dates";
import { AttendanceTileRow, DrainingHairline, TeachingSwitch } from "@/components/teaching/teaching-modules";
import { TeachingNavHeader } from "@/components/teaching/teaching-nav-header";
import type { SessionDetailRead } from "@/components/teaching/teaching-reads";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import {
  attendanceTiles,
  CHECKIN_WINDOW_MS,
  useCheckinClock,
  useCheckinCode,
  useRegisterCounts,
} from "@/components/teaching/use-checkin-code";
import { useSessionDetail } from "@/components/teaching/use-session-detail";
import { useWakeLock } from "@/components/teaching/use-wake-lock";
import { cn, textMuted } from "@/components/ui-primitives";
import { checkinScanPath } from "@/lib/teaching/checkin-token";
import { teachingErrorMessage, teachingPost, teachingServiceUrl } from "@/lib/teaching/client";
import type { CheckinCode, CheckinStream } from "@/lib/teaching/model";
import { useTeachingDemoMode } from "@/components/teaching/use-teaching-sample";
import { guardExampleAction } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";

/*
 * The presenter's code screen (spec §9, review focus 3): the QR and its six
 * digits for the chosen stream, a draining hairline for the window, the counts
 * so far, and a shared-screen link for a projector. There is no manual "Close
 * check-in" (master plan R11): the window closes by itself 15 minutes after the
 * end. Only the check-in token reaches this page, never the occurrence secret.
 */
const MINUTE = 60_000;

type SharedScreen = { token: string; path: string; expiresAt: string };

export function TeachingCheckinScreen({
  occurrenceId,
  demoMode: serverDemoMode,
}: {
  occurrenceId: string;
  demoMode: boolean;
}) {
  const demoMode = useTeachingDemoMode(serverDemoMode);
  const now = useCheckinClock();
  const valid = isOccurrenceId(occurrenceId);
  const resource = useSessionDetail(valid && !demoMode ? occurrenceId : null, false, now);
  const detail = resource.data;

  let body;
  if (!valid || resource.code === "teaching_not_found")
    body = <ModeNotice>This session is no longer in the programme.</ModeNotice>;
  else if (demoMode) body = <ModeNotice>The demo has no check-in code.</ModeNotice>;
  else if (resource.status === "signed-out") body = <TeachingSignInNotice />;
  else if (resource.status === "offline" || resource.status === "error" || resource.status === "setup")
    body = <TeachingStateNotice state={resource.status} onRetry={resource.retry} />;
  else if (!now || !detail) body = <ModeModuleSkeleton rows={2} twoLine eyebrow />;
  else if (detail.visitor || !detail.canShowCode)
    body = <ModeNotice>Only the presenter and your service&apos;s organisers can show this code.</ModeNotice>;
  else if (detail.status === "cancelled")
    body = <ModeNotice>This session is cancelled, so it has no check-in code.</ModeNotice>;
  else if (now.getTime() < Date.parse(detail.startsAt) - 15 * MINUTE)
    body = <ModeNotice>{`Check-in opens at ${checkinOpens(detail)}. The code shows here then.`}</ModeNotice>;
  else if (now.getTime() > Date.parse(detail.endsAt) + 15 * MINUTE)
    body = <ModeNotice>Check-in for this session has closed.</ModeNotice>;
  else body = <CodePanel detail={detail} nowMs={now.getTime()} />;

  return (
    <>
      {/* The header's title is the page's h1; the session's name sits under it in the body. */}
      <TeachingNavHeader
        title="Check-in code"
        titleAs="h1"
        testIdPrefix="teaching-checkin"
        back={{ href: `/teaching/session/${occurrenceId}`, label: "Session" }}
      />
      <InformationPageShell width="narrow" gap={false} testId="teaching-checkin">
        <div className="grid gap-3">
          {detail ? (
            <p className="text-base-minus font-medium text-[color:var(--text-heading)]">{detail.title}</p>
          ) : null}
          {body}
        </div>
      </InformationPageShell>
    </>
  );
}

function CodePanel({ detail, nowMs }: { detail: SessionDetailRead; nowMs: number }) {
  const [stream, setStream] = useState<CheckinStream>("room");
  const [shared, setShared] = useState<SharedScreen | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const { active: example } = useExampleData("teach");
  const serviceUrl = teachingServiceUrl(detail.serviceId);
  const code = useCheckinCode<CheckinCode>(
    teachingServiceUrl(detail.serviceId, { action: "checkin.code", occurrenceId: detail.occurrenceId, stream }),
    nowMs,
  );
  const counts = useRegisterCounts(
    teachingServiceUrl(detail.serviceId, { action: "register.read", occurrenceId: detail.occurrenceId }),
  );
  const expected = detail.counts?.expected ?? null;
  // Keep the phone awake while the code is on show; the screen sleeps as normal otherwise.
  useWakeLock(code.phase === "live");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const sharedUrl = shared ? new URL(shared.path, window.location.origin).toString() : null;

  async function copyLink() {
    if (!guardExampleAction(example, "copy")) return;
    if (!sharedUrl) return;
    try {
      await navigator.clipboard.writeText(sharedUrl);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  async function shareLink() {
    if (!guardExampleAction(example, "share")) return;
    if (!sharedUrl) return;
    try {
      await navigator.share({ title: detail.title, url: sharedUrl });
    } catch {
      // Dismissing the share sheet is not an error worth showing.
    }
  }
  const closes = checkinCloses(detail);

  async function toggleShared() {
    // One request at a time: a double tap must not open two links or revoke a link twice.
    if (sharing) return;
    setError(null);
    setSharing(true);
    try {
      if (shared) {
        await teachingPost(serviceUrl, { action: "display.revoke", token: shared.token });
        setShared(null);
        setCopied(null);
      } else {
        // Master plan R2: `display.create` answers `{ token, path, expiresAt }`; the path shows codes only.
        setShared(
          await teachingPost<SharedScreen>(serviceUrl, {
            action: "display.create",
            occurrenceId: detail.occurrenceId,
            stream,
          }),
        );
      }
    } catch (cause) {
      setError(teachingErrorMessage(cause));
    } finally {
      setSharing(false);
    }
  }

  return (
    <>
      {detail.hasJoinLink ? (
        <TeachingSwitch
          value={stream}
          onChange={setStream}
          label="Code for"
          options={[
            { value: "room", label: "Room" },
            { value: "teams", label: "Teams" },
          ]}
        />
      ) : null}
      <section aria-label="Check-in code" className="grid justify-items-center gap-3 p-4">
        {code.phase === "live" && code.code ? (
          <>
            <CheckinQr
              value={`${window.location.origin}${checkinScanPath(code.code.payload.token)}`}
              label="Check-in QR code. Scan it with your phone's camera."
              className="max-w-72"
            />
            <p
              data-testid="teaching-typed-code"
              className="nums text-3xl-minus font-normal tracking-widest text-[color:var(--text-heading)]"
            >
              {formatTypedCode(code.code.payload.typedCode)}
            </p>
            <div className="w-full max-w-72">
              <DrainingHairline windowStartMs={code.code.windowStartMs} windowMs={CHECKIN_WINDOW_MS} nowMs={nowMs} />
            </div>
            <p className={cn("text-center text-sm", textMuted)}>{`Members only · open until ${closes}`}</p>
          </>
        ) : code.phase === "ended" ? (
          <ModeNotice>{code.message ?? "Check-in for this session has closed."}</ModeNotice>
        ) : code.phase === "reconnecting" ? (
          <p
            role="status"
            data-testid="teaching-checkin-reconnecting"
            className="text-center text-sm text-[color:var(--text-heading)]"
          >
            Reconnecting. The code shows again when the connection is back.
          </p>
        ) : (
          <ModeModuleSkeleton rows={2} twoLine eyebrow />
        )}
      </section>
      {counts ? <AttendanceTileRow label="Attendance so far" tiles={attendanceTiles(counts, expected)} /> : null}
      <section aria-label="Shared screen" className="grid gap-2" data-testid="teaching-checkin-shared">
        <T5Button
          variant="secondary"
          block
          icon={shared ? MonitorX : MonitorUp}
          busy={sharing}
          busyLabel={shared ? "Stopping" : "Creating link"}
          onClick={() => void toggleShared()}
          testId="teaching-checkin-share"
        >
          {shared ? "Stop sharing" : "Show on a shared screen"}
        </T5Button>
        <p className={cn("text-sm", textMuted)}>
          {shared
            ? `Link works until ${perthTime(shared.expiresAt)}. Stopping makes it stop working.`
            : "No sign-in needed. It shows the code only."}
        </p>
        {shared ? (
          <div className="grid gap-2 @container">
            <a
              href={shared.path}
              target="_blank"
              rel="noreferrer"
              {...t5ButtonFace({ variant: "secondary", block: true })}
            >
              <ExternalLink aria-hidden="true" />
              <span>Open the shared screen</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <div className="grid gap-2 @min-[17rem]:auto-cols-fr @min-[17rem]:grid-flow-col">
              <T5Button variant="ghost" block icon={Copy} onClick={() => void copyLink()}>
                Copy link
              </T5Button>
              {canShare ? (
                <T5Button variant="ghost" block icon={Share2} onClick={() => void shareLink()}>
                  Share…
                </T5Button>
              ) : null}
            </div>
            {copied === "copied" ? (
              <p role="status" className={cn("text-sm", textMuted)} data-testid="teaching-checkin-copied">
                Link copied.
              </p>
            ) : copied === "failed" ? (
              <p
                role="alert"
                className="text-sm text-[color:var(--text-heading)]"
                data-testid="teaching-checkin-copied"
              >
                Couldn&apos;t copy the link. Open the shared screen and copy it from there.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
      {error ? (
        <div role="alert">
          <ModeNotice tone="warning">{error}</ModeNotice>
        </div>
      ) : null}
      <p className={cn("text-sm", textMuted)}>Presenters see counts only. Organisers see the named register.</p>
    </>
  );
}
