"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { teachingErrorMessage, teachingPost, teachingServiceUrl } from "@/lib/teaching/client";

/**
 * QR camera scanner with 6-digit code fallback for teaching check-in (#ZTDZ4Z).
 * Probes for native window.BarcodeDetector support and falls back cleanly.
 *
 * Lives outside `src/components/teaching/` so Teaching's search-privacy contract
 * (no getUserMedia / microphone / search API under that tree) stays intact —
 * this sheet is attendance check-in, not Teaching search.
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
  const scanGenerationRef = useRef(0);

  const stopCamera = useCallback(() => {
    scanGenerationRef.current += 1;
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

  const handleTypedSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    await submitCode(typedCode);
  };

  useEffect(() => {
    if (scanning && streamRef.current && videoRef.current) {
      try {
        videoRef.current.srcObject = streamRef.current;
      } catch {
        // Best-effort: attaching a MediaStream can throw if the element unmounted mid-scan.
      }
      try {
        const playResult = videoRef.current.play?.();
        if (playResult && typeof playResult.catch === "function") {
          // Autoplay may reject when the tab is backgrounded; typed code entry remains available.
          playResult.catch(() => {});
        }
      } catch {
        // play() itself can throw synchronously on unsupported elements; fall through to typed entry.
      }
    }
  }, [scanning]);

  const startCameraScanner = async () => {
    if (!hasBarcodeDetector) return;
    const generation = ++scanGenerationRef.current;
    setError(null);
    setScanning(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API not available");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (generation !== scanGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        try {
          videoRef.current.srcObject = stream;
        } catch {
          // Best-effort: attaching a MediaStream can throw if the element unmounted mid-scan.
        }
        try {
          const playResult = videoRef.current.play?.();
          if (playResult && typeof playResult.catch === "function") {
            // Autoplay may reject when the tab is backgrounded; typed code entry remains available.
            await playResult.catch(() => {});
          }
        } catch {
          // play() itself can throw synchronously on unsupported elements; fall through to typed entry.
        }
      }
    } catch (err) {
      if (generation !== scanGenerationRef.current) return;
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
    let cancelled = false;
    // @ts-expect-error - native BarcodeDetector
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    const tick = async () => {
      if (cancelled || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes?.length) {
          const raw = String(codes[0]?.rawValue ?? "");
          const digits = raw.replace(/\D/g, "").slice(0, 6);
          if (digits.length === 6) {
            stopCamera();
            await submitCode(digits);
            return;
          }
        }
      } catch {
        // Frame detect can fail on an empty video element; keep polling.
      }
      if (!cancelled) requestAnimationFrame(() => void tick());
    };
    const id = requestAnimationFrame(() => void tick());
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [scanning, hasBarcodeDetector, stopCamera, submitCode]);

  return (
    <Sheet
      open={open}
      onClose={() => {
        stopCamera();
        onClose();
      }}
      title="Check in"
      description="Scan the session QR code or type the 6-digit code."
    >
      <div className="grid gap-3" data-testid="teaching-qr-checkin-sheet">
        {hasBarcodeDetector ? (
          <div className="grid gap-2" data-testid="teaching-camera-scanner-section">
            <p className="text-xs text-[color:var(--text-muted)]">Camera QR scanner available</p>
            {scanning ? (
              <video
                ref={videoRef}
                className="mx-auto aspect-video max-h-48 w-full rounded-md bg-[color:var(--surface-inset)] object-cover"
                muted
                playsInline
                data-testid="teaching-camera-video"
              />
            ) : null}
            {scanning ? (
              <Button type="button" variant="secondary" onClick={stopCamera} testId="teaching-camera-stop-btn">
                Stop camera
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={() => void startCameraScanner()}
                testId="teaching-camera-scan-btn"
              >
                Scan QR with camera
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-[color:var(--text-muted)]" data-testid="teaching-camera-unsupported-note">
            This browser cannot scan QR codes. Enter the 6-digit code instead.
          </p>
        )}
        <form className="grid gap-2" onSubmit={(e) => void handleTypedSubmit(e)}>
          <label
            className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]"
            htmlFor="teaching-typed-code"
          >
            6-digit code
          </label>
          <input
            id="teaching-typed-code"
            inputMode="numeric"
            autoComplete="one-time-code"
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
