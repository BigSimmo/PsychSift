"use client";

import { Camera } from "lucide-react";
import { useId, useRef, useState, useSyncExternalStore } from "react";

import { QrCheckInHelper } from "./qr-check-in-helper";
import { typedCodeDigits } from "@/components/teaching/session-view-model";
import { T5Segments } from "@/components/teaching/t5-kit";
import { WorkButton } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { wasAlreadyCheckedIn } from "@/components/teaching/checkin/checkin-recorded";
import { parseCheckinToken } from "@/lib/teaching/checkin-token";
import { teachingErrorMessage, teachingPostTimed, teachingServiceUrl } from "@/lib/teaching/client";
import type { AttendanceMethod, CheckinStream } from "@/lib/teaching/model";

export type CodeSheetMark = { method: AttendanceMethod; recordedAt: string };
/** What the sheet hands back: the mark, plus whether the server already had it (a repeat check-in). */
export type CodeSheetRecorded = CodeSheetMark & { already: boolean };

const STREAMS = [
  { value: "room", label: "Room" },
  { value: "teams", label: "Teams" },
] as const;

/**
 * Check in with code (work-mode redesign, owner request 6 Oct 2026), shared by Today's header
 * button and the session page. PsychSift has no camera of its own, so the sheet says to use the
 * phone's camera on the code on screen, and takes the six digits typed. Room or Teams shows only
 * when the session has a join link. Nothing says "checked in" until the server says so; the demo
 * saves nothing and says so.
 */
/*
 * The in-app scanner needs the browser's own QR reader (BarcodeDetector). iPhone Safari has none, so
 * there the camera would open and never read a code (#ZTDZ4Z). Without it the sheet offers only the
 * phone's camera app and the typed digits. Read after hydration, so the server and first render agree.
 */
const noSubscription = () => () => {};
const browserCanReadQr = () => typeof window !== "undefined" && "BarcodeDetector" in window;
const serverCannotReadQr = () => false;

export function TeachingCodeSheet({
  open,
  onClose,
  session,
  subtitle,
  live,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  session: { serviceId: string; occurrenceId: string; hasJoinLink: boolean };
  /** "Grand rounds · 12:30 to 13:30". */
  subtitle?: string;
  live: boolean;
  onDone: (mark: CodeSheetRecorded) => void;
}) {
  const [stream, setStream] = useState<CheckinStream>("room");
  const [typed, setTyped] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const canScanInApp = useSyncExternalStore(noSubscription, browserCanReadQr, serverCannotReadQr);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const errorId = useId();

  async function submit(overrideCode?: string) {
    const code = typedCodeDigits(overrideCode ?? typed);
    if (!code) {
      setError("Enter the 6-digit code.");
      inputRef.current?.focus();
      return;
    }
    if (!live) {
      setError("The demo doesn't save check-ins.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: saved, serverTime } = await teachingPostTimed<CodeSheetMark>(
        teachingServiceUrl(session.serviceId),
        {
          action: "checkin.typed",
          occurrenceId: session.occurrenceId,
          stream,
          code,
        },
      );
      onDone({
        method: saved.method,
        recordedAt: saved.recordedAt,
        already: wasAlreadyCheckedIn(saved.recordedAt, serverTime),
      });
      setTyped("");
      onClose();
    } catch (cause) {
      setError(teachingErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const digits = typed.padEnd(6, " ").split("");
  return (
    <Sheet open={open} onClose={onClose} title="Check in with code" description={subtitle} initialFocusRef={inputRef}>
      <div className="grid gap-3">
        <form
          id={formId}
          data-mode-identity="teaching"
          className="grid gap-3.25 pb-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void submit();
          }}
        >
          <div className="flex items-start justify-between gap-2.5 rounded-[var(--work-radius-card)] bg-[color:var(--surface-wash)] px-3 py-2.5 text-xs leading-snug text-[color:var(--text)]">
            <span className="flex items-start gap-2.5">
              <Camera aria-hidden="true" className="mt-px size-4 shrink-0 text-[color:var(--mode-identity)]" />
              <span>
                Open your phone&apos;s camera and point it at the code on screen. The link it opens checks you in.
              </span>
            </span>
            {canScanInApp ? (
              <button
                type="button"
                onClick={() => setShowScanner((prev) => !prev)}
                className="shrink-0 font-semibold text-[color:var(--mode-identity)] underline"
                data-testid="toggle-in-app-qr-scanner"
              >
                {showScanner ? "Hide scanner" : "Scan in app"}
              </button>
            ) : null}
          </div>
          {session.hasJoinLink ? (
            <div className="grid gap-1.75">
              <p className="work-label px-0.5">Where you are</p>
              <T5Segments value={stream} onChange={setStream} label="Where you are" options={STREAMS} />
            </div>
          ) : null}
          <div className="grid gap-1.75">
            <label htmlFor={`${formId}-code`} className="work-label px-0.5">
              Or type the six digits
            </label>
            {/* One real input, drawn as six boxes. Typing, pasting and the phone's code suggestion all work. */}
            <div className="relative">
              <input
                ref={inputRef}
                id={`${formId}-code`}
                inputMode="numeric"
                autoComplete="one-time-code"
                spellCheck={false}
                data-gramm="false"
                data-enable-grammarly="false"
                maxLength={6}
                value={typed}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => {
                  setError(null);
                  setTyped(event.target.value.replace(/\D/g, "").slice(0, 6));
                }}
                className="peer absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
              />
              <div
                aria-hidden="true"
                className="grid grid-cols-[1fr_1fr_1fr_0.625rem_1fr_1fr_1fr] items-center gap-1.5 peer-focus-visible:[&>[data-current]]:outline-2 peer-focus-visible:[&>[data-current]]:outline-offset-2 peer-focus-visible:[&>[data-current]]:outline-[color:var(--focus)]"
              >
                {digits.map((digit, index) => {
                  const current = index === Math.min(typed.length, 5);
                  const box = (
                    <b
                      key={index}
                      data-current={current ? "" : undefined}
                      className={cn(
                        "nums grid h-11.5 place-items-center rounded-xl border bg-[color:var(--surface-raised)] text-xl font-bold text-[color:var(--text-heading)]",
                        current
                          ? "border-[1.5px] border-[color:var(--mode-identity)]"
                          : "border-[color:var(--border-strong)]",
                      )}
                    >
                      {digit.trim()}
                    </b>
                  );
                  return index === 3
                    ? [<i key="gap" className="h-0.5 rounded-full bg-[color:var(--border-strong)]" />, box]
                    : box;
                })}
              </div>
            </div>
            {error ? (
              <p id={errorId} role="alert" className="px-0.5 text-xs font-semibold text-[color:var(--danger-text)]">
                {error}
              </p>
            ) : null}
          </div>
          <WorkButton type="submit" size="wide" disabled={busy}>
            {busy ? "Checking in" : "Check in"}
          </WorkButton>
        </form>
        {showScanner && canScanInApp ? (
          <QrCheckInHelper
            hideManualEntry
            onClose={() => setShowScanner(false)}
            onScanCode={(scanned) => {
              if (!live) {
                setError("The demo doesn't save check-ins.");
                return;
              }
              const trimmed = scanned.trim();
              if (trimmed.includes("/teaching/c/")) {
                if (typeof window !== "undefined") {
                  try {
                    const parsedUrl = new URL(trimmed, window.location.origin);
                    const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "");
                    const pathMatch = normalizedPath.match(/^\/teaching\/c\/([^/]+)$/);
                    let token = "";
                    if (pathMatch?.[1]) {
                      try {
                        token = decodeURIComponent(pathMatch[1]);
                      } catch {
                        token = "";
                      }
                    }
                    if (parsedUrl.origin === window.location.origin && token && parseCheckinToken(token)) {
                      const destUrl = new URL(`/teaching/c/${encodeURIComponent(token)}`, window.location.origin);
                      window.location.assign(destUrl.href);
                      return;
                    }
                  } catch {
                    // Fall through to link validation error below
                  }
                }
                setError("Scanned QR code is not a valid check-in link for this site.");
                return;
              }
              const exactSixDigits = trimmed.match(/^\d{3}\s?\d{3}$/);
              if (!exactSixDigits) {
                setError("Scanned QR code does not contain a 6-digit session code.");
                return;
              }
              const clean = trimmed.replace(/\D/g, "").slice(0, 6);
              setTyped(clean);
              void submit(clean);
            }}
          />
        ) : null}
      </div>
    </Sheet>
  );
}
