"use client";

import { Maximize, Minimize } from "lucide-react";
import { useEffect, useState } from "react";

import { CheckinQr } from "@/components/teaching/checkin-qr";
import { formatTypedCode } from "@/components/teaching/session-view-model";
import { perthTime } from "@/components/teaching/teaching-dates";
import { DrainingHairline } from "@/components/teaching/teaching-modules";
import { CHECKIN_WINDOW_MS, useCheckinClock, useCheckinCode } from "@/components/teaching/use-checkin-code";
import { useWakeLock } from "@/components/teaching/use-wake-lock";
import { Button } from "@/components/ui/button";
import { cn, textMuted } from "@/components/ui-primitives";
import { checkinScanPath, isTeachingSecret } from "@/lib/teaching/checkin-token";
import type { DisplayCode } from "@/lib/teaching/model";

/*
 * The shared screen for a projector or a Teams share (spec §9). No app chrome,
 * no sign-in, and nothing about anyone: the session's title and room, the QR,
 * its six digits and the hairline. It lives in the `(display)` route group so
 * the search shell's layout never wraps it. The same 20-second rule as the
 * presenter's screen takes a stale code down (review focus 3).
 */
/** Full screen, offered only where the browser allows it; follows Esc and the browser's own controls. */
function useFullscreen(): { supported: boolean; on: boolean; toggle: () => void } {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => {
      setSupported(document.fullscreenEnabled === true);
      setOn(document.fullscreenElement !== null && document.fullscreenElement !== undefined);
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggle = () => {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    // A refused request leaves the screen as it was.
    void request?.catch(() => undefined);
  };
  return { supported, on, toggle };
}

export function TeachingDisplayScreen({ secret }: { secret: string }) {
  const valid = isTeachingSecret(secret);
  const now = useCheckinClock();
  const nowMs = now ? now.getTime() : null;
  const code = useCheckinCode<DisplayCode>(valid ? `/api/teaching/display/${secret}` : null, nowMs);
  const payload = code.code?.payload ?? null;
  const live = code.phase === "live";
  // A projector left on the code must not dim or lock.
  useWakeLock(live);
  const fullscreen = useFullscreen();

  return (
    <main
      // The root layout's "Skip to main content" link lands here (A11Y-06).
      id="main-content"
      tabIndex={-1}
      className="grid min-h-dvh place-items-center bg-[color:var(--surface)] p-6 text-[color:var(--text-heading)] outline-none"
      data-testid="teaching-display"
    >
      <div className="grid w-full justify-items-center gap-4 text-center">
        {!valid || code.phase === "ended" ? (
          <>
            <h1 className="sr-only">Check-in code</h1>
            <p className="text-lg-minus" data-testid="teaching-display-ended">
              This display link has ended. Open a new one from the session page.
            </p>
          </>
        ) : code.phase === "live" && payload && code.code && nowMs !== null ? (
          <>
            <h1 className="text-xl font-semibold">{payload.title}</h1>
            {payload.venue ? <p className={cn("text-base-minus", textMuted)}>{payload.venue}</p> : null}
            <CheckinQr
              value={`${window.location.origin}${checkinScanPath(payload.token)}`}
              label="Check-in QR code. Scan it with your phone's camera."
              className="max-w-[min(80vw,60vh,calc(100dvh_-_22rem))]"
            />
            <p className="nums text-hero font-normal tracking-widest lg:text-display" data-testid="teaching-typed-code">
              {formatTypedCode(payload.typedCode)}
            </p>
            <div className="w-full max-w-72">
              <DrainingHairline windowStartMs={code.code.windowStartMs} windowMs={CHECKIN_WINDOW_MS} nowMs={nowMs} />
            </div>
            <p className={cn("text-base-minus", textMuted)}>
              {`Scan to check in · members only · open until ${perthTime(payload.closesAt)}`}
            </p>
          </>
        ) : code.phase === "reconnecting" ? (
          <>
            <h1 className="sr-only">Check-in code</h1>
            <p role="status" className="text-lg-minus" data-testid="teaching-display-reconnecting">
              Reconnecting. The code shows again when the connection is back.
            </p>
          </>
        ) : (
          <>
            <h1 className="sr-only">Check-in code</h1>
            <p role="status" className={cn("text-base-minus", textMuted)}>
              Loading the check-in code
            </p>
          </>
        )}
        {fullscreen.supported && valid && code.phase !== "ended" ? (
          <Button
            variant="ghost"
            size="sm"
            icon={fullscreen.on ? Minimize : Maximize}
            onClick={fullscreen.toggle}
            testId="teaching-display-fullscreen"
          >
            {fullscreen.on ? "Exit full screen" : "Full screen"}
          </Button>
        ) : null}
      </div>
    </main>
  );
}
