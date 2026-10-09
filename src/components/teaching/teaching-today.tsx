"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { TodayShell, type TodaySharedState } from "@/components/mode-kit/today/today-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { catchUpCount } from "@/components/teaching/teaching-catch-up";
import { TeachingCalendarSheet } from "@/components/teaching/teaching-calendar-sheet";
import { addDays, mondayOf, perthDateKey } from "@/components/teaching/teaching-dates";
import { TeachingHero } from "@/components/teaching/teaching-hero";
import { TeachingContextBar } from "@/components/teaching/teaching-modules";
import { NeedsYou } from "@/components/teaching/teaching-needs-you";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import {
  ALL_TEAMS,
  heroModel,
  nextSession,
  restOfWeek,
  sessionHref,
  sessionsForTeam,
} from "@/components/teaching/teaching-view-model";
import { useSessionDetail } from "@/components/teaching/use-session-detail";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { useTeachingWeek, type TeachingWeekState } from "@/components/teaching/use-teaching-week";
import { teachingErrorMessage, teachingPost, teachingServiceUrl } from "@/lib/teaching/client";
import { useTeachingDemoMode } from "@/components/teaching/use-teaching-sample";

/*
 * Today on the shared Today shell: the hero is Now (the mode's own surface),
 * Needs you is the existing module, and "Rest of this week" is Coming up. The
 * page name is the pill, so the h1 is sr-only; it and the team picker are the
 * status slot. The hero is the next session in the coming seven days across
 * every service the reader is in; when nothing falls in those seven days,
 * `view=next-session` supplies it.
 *
 * Teaching keeps its own sign-in, offline, setup, no-team and empty notices
 * (`blocking`): the sign-in one carries the demo link and the offline one the
 * seven-day check-in note, neither of which the shared states have. A generic
 * load error uses the shared failed state.
 */
function TeachingTodayShell({
  bar,
  ...rest
}: {
  bar?: ReactNode;
  now?: ReactNode;
  needsYouNode?: ReactNode;
  comingUp?: ReactNode;
  state?: TodaySharedState | null;
  blocking?: ReactNode;
}) {
  return (
    <TodayShell
      mode="teaching"
      modeName="Teaching"
      nowSurface="own"
      loadingFallback={<ModeModuleSkeleton rows={2} twoLine eyebrow />}
      status={
        <>
          <h1 className="sr-only">Today</h1>
          {bar}
        </>
      }
      now={null}
      {...rest}
    />
  );
}

export function TeachingToday({ demoMode: serverDemoMode }: { demoMode: boolean }) {
  const demoMode = useTeachingDemoMode(serverDemoMode);
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  // From this Monday, so the catch-up count sees the whole calendar week (as Resources does); the hero
  // and Rest of this week only look at sessions that have not ended, so the earlier days change nothing there.
  const range = useMemo(() => (today ? { from: mondayOf(today), to: addDays(today, 6) } : null), [today]);
  const view = useTeachingWeek(range, { demoMode }, now);
  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-today">
      {now && today ? (
        <TodayBody view={view} now={now} today={today} />
      ) : (
        <TeachingTodayShell state={{ kind: "loading" }} />
      )}
    </InformationPageShell>
  );
}

function TodayBody({ view, now, today }: { view: TeachingWeekState; now: Date; today: string }) {
  const [team, setTeam] = useState(ALL_TEAMS);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [checkedIn, setCheckedIn] = useState(false);
  const live = view.demo === "off";
  const week = view.status === "ready" ? view.week : null;
  const teamValue = week && (team === ALL_TEAMS || week.teams.some((t) => t.id === team)) ? team : ALL_TEAMS;
  const sessions = week ? sessionsForTeam([...week.sessions, ...week.relocated], teamValue) : [];
  const inRange = week ? nextSession(sessions, now) : null;
  // Every hook sits above the early returns.
  const later = useTeachingResource<{ session: SessionSummaryRead | null }>(
    week && live && !inRange && week.teams.length > 0 ? "/api/teaching?view=next-session" : null,
  );
  const laterSession = later.data?.session ?? null;
  const next = inRange ?? (teamValue === ALL_TEAMS || laterSession?.serviceId === teamValue ? laterSession : null);
  const wantsJoin =
    next !== null && next.hasJoinLink && sessionHref(next) !== null && perthDateKey(next.startsAt) === today;
  const detail = useSessionDetail(wantsJoin && next ? next.occurrenceId : null, !live, now);

  if (view.status === "signed-out") return <TeachingTodayShell blocking={<TeachingSignInNotice />} />;
  if (view.status === "error") return <TeachingTodayShell state={{ kind: "failed", onRetry: view.retry }} />;
  if (view.status === "offline" || view.status === "setup")
    return <TeachingTodayShell blocking={<TeachingStateNotice state={view.status} onRetry={view.retry} />} />;
  if (!week || (!inRange && later.status === "loading")) return <TeachingTodayShell state={{ kind: "loading" }} />;
  if (week.teams.length === 0 && week.relocated.length === 0)
    return <TeachingTodayShell blocking={<TeachingStateNotice state="no-team" />} />;
  // A failed `view=next-session` read is not "No sessions yet": say what went wrong.
  const laterStatus = later.status;
  const laterFailure =
    !inRange &&
    (laterStatus === "offline" || laterStatus === "error" || laterStatus === "setup" || laterStatus === "signed-out")
      ? laterStatus
      : null;

  const bar = (
    <TeachingContextBar
      teams={week.teams}
      value={teamValue}
      onChange={setTeam}
      demoTag={!live || week.teams.some((t) => t.isDemo)}
    />
  );
  if (laterFailure) {
    return laterFailure === "error" ? (
      <TeachingTodayShell bar={bar} state={{ kind: "failed", onRetry: later.retry }} />
    ) : (
      <TeachingTodayShell
        bar={bar}
        blocking={
          laterFailure === "signed-out" ? (
            <TeachingSignInNotice />
          ) : (
            <TeachingStateNotice state={laterFailure} onRetry={later.retry} />
          )
        }
      />
    );
  }
  if (!next) {
    const chosen = week.teams.find((t) => t.id === teamValue) ?? (week.teams.length === 1 ? week.teams[0] : undefined);
    return (
      <TeachingTodayShell
        bar={bar}
        blocking={
          <div className="grid gap-3">
            <TeachingStateNotice
              state="empty"
              serviceName={chosen?.name}
              onSwitchService={teamValue !== ALL_TEAMS ? () => setTeam(ALL_TEAMS) : undefined}
            />
            {/* No session ahead still leaves past ones to log, give feedback on or catch up on. */}
            <NeedsYou live={live} today={today} catchUp={catchUpCount(week, now)} />
          </div>
        }
      />
    );
  }

  const hero = heroModel(next, {
    now,
    today,
    teams: week.teams,
    showTeam: teamValue === ALL_TEAMS && week.teams.length > 1,
    attendance: week.attendance,
    joinUrl: detail.data?.joinUrl ?? null,
    calendar: live,
    hadToday: sessions.some((s) => s.status !== "cancelled" && perthDateKey(s.startsAt) === today),
  });

  async function checkInWithoutCode() {
    if (!next) return;
    if (!live) {
      setSaveError("The demo doesn't save check-ins.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setCheckedIn(false);
    try {
      await teachingPost(teachingServiceUrl(next.serviceId), {
        action: "attendance.self",
        occurrenceId: next.occurrenceId,
      });
      setCheckedIn(true);
      view.retry();
    } catch (cause) {
      setSaveError(teachingErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  const actions = hero.actions.map((action) =>
    action.id === "self"
      ? { ...action, onClick: () => void checkInWithoutCode(), busy: saving, busyLabel: "Saving" }
      : action.id === "scan"
        ? {
            ...action,
            onClick: (e?: React.MouseEvent) => {
              if (e && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
              }
              setScanOpen(true);
            },
          }
        : action.id === "calendar"
          ? { ...action, onClick: () => setCalendarOpen(true) }
          : action,
  );

  return (
    <>
      <TeachingTodayShell
        bar={bar}
        now={
          <>
            <TeachingHero {...hero} actions={actions} />
            {checkedIn ? <ModeNotice testId="teaching-today-checked-in">Checked in.</ModeNotice> : null}
            {saveError ? (
              <div role="alert">
                <ModeNotice tone="warning">{saveError}</ModeNotice>
              </div>
            ) : null}
          </>
        }
        needsYouNode={<NeedsYou live={live} today={today} catchUp={catchUpCount(week, now)} />}
        comingUp={
          <ModeGroupedList testId="teaching-rest-of-week">
            <ModeRow
              href="/teaching/week"
              title="Rest of this week"
              subtitle={restOfWeek(sessions, next.occurrenceId, now, today)}
            />
          </ModeGroupedList>
        }
      />
      {live ? (
        <TeachingCalendarSheet
          open={calendarOpen}
          onClose={() => setCalendarOpen(false)}
          teams={week.teams}
          onChanged={view.retry}
        />
      ) : null}
      {scanOpen && next ? (
        <TeachingQrCheckinSheet
          open={scanOpen}
          onClose={() => setScanOpen(false)}
          serviceId={next.serviceId}
          occurrenceId={next.occurrenceId}
          live={live}
          onCheckInSuccess={() => {
            setCheckedIn(true);
            view.retry();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * QR camera scanner with 6-digit code fallback for teaching check-in (#ZTDZ4Z).
 * Probes for native window.BarcodeDetector support and falls back cleanly.
 */
export function TeachingQrCheckinSheet({
  open,
  onClose,
  serviceId,
  occurrenceId,
  live = true,
  onCheckInSuccess,
}: {
  open: boolean;
  onClose: () => void;
  serviceId: string;
  occurrenceId: string;
  live?: boolean;
  onCheckInSuccess?: () => void;
}) {
  const [hasBarcodeDetector] = useState(() => typeof window !== "undefined" && "BarcodeDetector" in window);
  const [scanning, setScanning] = useState(false);
  const [typedCode, setTypedCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const submitCode = useCallback(
    async (code: string) => {
      const clean = code.replace(/\D/g, "").slice(0, 6);
      if (clean.length !== 6) {
        setError("Enter the 6-digit code.");
        return;
      }
      if (!live) {
        setError("The demo doesn't save check-ins.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await teachingPost(teachingServiceUrl(serviceId), {
          action: "checkin.typed",
          occurrenceId,
          stream: "room",
          code: clean,
        });
        onCheckInSuccess?.();
        onClose();
      } catch (cause) {
        setError(teachingErrorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [live, serviceId, occurrenceId, onCheckInSuccess, onClose],
  );

  const handleTypedSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await submitCode(typedCode);
  };

  useEffect(() => {
    if (scanning && streamRef.current && videoRef.current) {
      try {
        videoRef.current.srcObject = streamRef.current;
      } catch {}
      try {
        const playResult = videoRef.current.play?.();
        if (playResult && typeof playResult.catch === "function") {
          playResult.catch(() => {});
        }
      } catch {}
    }
  }, [scanning]);

  const startCameraScanner = async () => {
    if (!hasBarcodeDetector) return;
    setError(null);
    setScanning(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API not available");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        try {
          videoRef.current.srcObject = stream;
        } catch {}
        try {
          const playResult = videoRef.current.play?.();
          if (playResult && typeof playResult.catch === "function") {
            await playResult.catch(() => {});
          }
        } catch {}
      }
    } catch (err) {
      setScanning(false);
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission denied. Please enter the 6-digit code below."
          : "Could not start camera. Please enter the 6-digit code below.",
      );
    }
  };

  useEffect(() => {
    if (!scanning || !hasBarcodeDetector || typeof window === "undefined" || !("BarcodeDetector" in window)) return;
    let active = true;
    // @ts-expect-error - native BarcodeDetector
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });

    const interval = setInterval(async () => {
      if (!active || !videoRef.current) return;
      try {
        const barcodes = await detector.detect(videoRef.current);
        if (!active || !barcodes || barcodes.length === 0) return;
        const raw = barcodes[0]?.rawValue?.trim();
        if (!raw) return;

        const codeMatch = raw.match(/\b\d{6}\b/);
        if (codeMatch) {
          const detected = codeMatch[0];
          setTypedCode(detected);
          stopCamera();
          submitCode(detected);
        }
      } catch {
        // Continue scanning frame
      }
    }, 300);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [scanning, hasBarcodeDetector, stopCamera, submitCode]);

  return (
    <Sheet
      open={open}
      onClose={() => {
        stopCamera();
        onClose();
      }}
      title="Check in to teaching"
    >
      <div className="grid gap-3" data-testid="teaching-qr-checkin-sheet">
        {hasBarcodeDetector ? (
          <div
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 text-center"
            data-testid="teaching-camera-scanner-section"
          >
            <p className="text-sm font-medium text-[color:var(--text)]">Camera QR scanner available</p>
            <p className="text-xs text-[color:var(--text-muted)] mt-1">Native BarcodeDetector supported</p>
            {scanning ? (
              <div className="mt-3 grid gap-2">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="mx-auto aspect-video max-h-48 w-full rounded-md bg-[color:var(--surface-sunken)] object-cover"
                  data-testid="teaching-camera-video"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={stopCamera}
                  testId="teaching-camera-stop-btn"
                >
                  Cancel camera scan
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={startCameraScanner}
                testId="teaching-camera-scan-btn"
              >
                Scan presenter QR code
              </Button>
            )}
          </div>
        ) : (
          <div
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3"
            data-testid="teaching-camera-unsupported-note"
          >
            <p className="text-xs text-[color:var(--text-muted)]">
              Camera QR scanning is not supported on this device/browser. Please type the 6-digit code shown on the
              presenter screen.
            </p>
          </div>
        )}

        <form onSubmit={handleTypedSubmit} className="grid gap-2" data-testid="teaching-typed-fallback-form">
          <label htmlFor="teaching-typed-code-input" className="block text-xs font-semibold text-[color:var(--text)]">
            6-digit check-in code
          </label>
          <input
            id="teaching-typed-code-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={typedCode}
            onChange={(e) => setTypedCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="field-control h-tap w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-center text-lg font-mono tracking-widest text-[color:var(--text)]"
            data-testid="teaching-typed-code-input"
          />
          {error ? <p className="text-xs text-[color:var(--danger)]">{error}</p> : null}
          <Button
            type="submit"
            variant="primary"
            block
            busy={busy}
            busyLabel="Checking in…"
            testId="teaching-typed-code-submit"
          >
            Check in with code
          </Button>
        </form>
      </div>
    </Sheet>
  );
}
