"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { focusRing } from "@/components/card-recipes";
import { buttonFaceClass } from "@/components/ui/button-face";
import { cn, fieldControlPlain, panelSubtle } from "@/components/ui-primitives";

export type CameraPermissionStatus = "prompt" | "granted" | "denied" | "unsupported";

export interface CameraStreamResult {
  stream: MediaStream | null;
  status: CameraPermissionStatus;
  errorMessage: string | null;
}

/**
 * Requests camera stream with mobile-tailored constraints and graceful fallbacks.
 *
 * Tries `facingMode: { ideal: 'environment' }` for back-facing mobile cameras,
 * then falls back to user-facing or basic video constraints if overconstrained.
 */
export async function requestMobileCameraStream(): Promise<CameraStreamResult> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== "function"
  ) {
    return {
      stream: null,
      status: "unsupported",
      errorMessage: "In-app camera scanning is not supported on this browser.",
    };
  }

  // 1. Try mobile back camera first
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    return { stream, status: "granted", errorMessage: null };
  } catch (err: unknown) {
    const error = err as Error;

    // Handle permission denial explicitly
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return {
        stream: null,
        status: "denied",
        errorMessage:
          "Camera access denied. Please enable camera permissions in your browser or enter the 6-digit code below.",
      };
    }

    // 2. Fall back to generic video constraints on overconstrained or hardware device error
    try {
      const fallbackStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      return { stream: fallbackStream, status: "granted", errorMessage: null };
    } catch (fallbackErr: unknown) {
      const fbError = fallbackErr as Error;
      if (fbError.name === "NotAllowedError" || fbError.name === "PermissionDeniedError") {
        return {
          stream: null,
          status: "denied",
          errorMessage:
            "Camera access denied. Please enable camera permissions in your browser or enter the 6-digit code below.",
        };
      }
      return {
        stream: null,
        status: "unsupported",
        errorMessage: `Unable to access camera: ${fbError.message || "Device unavailable"}.`,
      };
    }
  }
}

export interface QrCheckInHelperProps {
  onScanCode: (code: string) => void;
  onClose?: () => void;
  title?: string;
  initialTypedCode?: string;
  className?: string;
}

/**
 * In-app QR Scanner Check-in Helper for phone camera (#ZTDZ4Z).
 *
 * Handles mobile camera constraints, permissions, viewport fallbacks,
 * and seamlessly provides 6-digit code check-in fallback.
 */
export function QrCheckInHelper({
  onScanCode,
  onClose,
  title = "Scan Session QR Code",
  initialTypedCode = "",
  className = "",
}: QrCheckInHelperProps) {
  const [permissionStatus, setPermissionStatus] = useState<CameraPermissionStatus>("prompt");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [typedCode, setTypedCode] = useState(initialTypedCode);
  const [codeError, setCodeError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setErrorMessage(null);

    const result = await requestMobileCameraStream();
    setPermissionStatus(result.status);

    if (result.stream) {
      streamRef.current = result.stream;
      setIsScanning(true);

      if (videoRef.current) {
        try {
          videoRef.current.srcObject = result.stream;
          videoRef.current.play?.().catch(() => {});
        } catch {
          // Handled safely
        }
      }

      // Check if native BarcodeDetector is available
      if (typeof window !== "undefined" && "BarcodeDetector" in window) {
        try {
          // @ts-expect-error - native BarcodeDetector
          const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
          scanIntervalRef.current = setInterval(async () => {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              try {
                const barcodes = await detector.detect(videoRef.current);
                if (barcodes && barcodes.length > 0) {
                  const rawValue = barcodes[0].rawValue;
                  if (rawValue) {
                    stopCamera();
                    onScanCode(rawValue);
                  }
                }
              } catch {
                // Ignore transient frame detection errors
              }
            }
          }, 300);
        } catch {
          // BarcodeDetector initialization fallback
        }
      }
    } else {
      setErrorMessage(result.errorMessage);
    }
  }, [onScanCode, stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handleTypedSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = typedCode.replace(/\D/g, "").slice(0, 6);
    if (clean.length !== 6) {
      setCodeError("Enter the 6-digit code displayed on the screen.");
      return;
    }
    setCodeError(null);
    stopCamera();
    onScanCode(clean);
  };

  return (
    <div
      className={cn("qr-check-in-helper mx-auto flex max-w-md flex-col gap-3 p-4", panelSubtle, className)}
      data-testid="qr-check-in-helper"
    >
      <div className="flex items-center justify-between border-b border-[color:var(--border)] pb-2">
        <h3 className="text-sm font-semibold text-[color:var(--text-heading)]">{title}</h3>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "inline-flex min-h-tap items-center rounded-lg px-2 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
              focusRing,
            )}
            data-testid="qr-helper-close-btn"
          >
            Close
          </button>
        )}
      </div>

      {/* Camera Viewport / Fallback View */}
      <div
        className="qr-scanning-viewport relative flex h-56 w-full items-center justify-center overflow-hidden rounded-lg bg-[color:var(--surface-inset)]"
        data-testid="qr-scanning-viewport"
      >
        {isScanning ? (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
              data-testid="qr-camera-video"
            />
            {/* Viewfinder Target Reticle */}
            <div
              className="pointer-events-none absolute inset-0 m-8 flex items-center justify-center rounded-lg border-2 border-dashed border-[color:var(--clinical-accent)]"
              data-testid="qr-viewfinder-reticle"
            >
              <span className="rounded bg-[color:var(--surface-raised)] px-2 py-0.5 text-xs text-[color:var(--text-muted)]">
                Point at session QR code
              </span>
            </div>
          </>
        ) : (
          <div
            className="flex flex-col items-center gap-2 p-4 text-center text-xs text-[color:var(--text-muted)]"
            data-testid="qr-viewport-fallback"
          >
            {errorMessage ? (
              <p className="font-semibold text-[color:var(--warning-text)]">{errorMessage}</p>
            ) : (
              <p>Camera is currently inactive.</p>
            )}
            <button
              type="button"
              onClick={startCamera}
              className={buttonFaceClass({ variant: "secondary", size: "sm" })}
              data-testid="start-camera-scan-btn"
            >
              {permissionStatus === "denied" ? "Retry Camera Access" : "Open Camera Scanner"}
            </button>
          </div>
        )}
      </div>

      {/* Camera control button while scanning */}
      {isScanning && (
        <button
          type="button"
          onClick={stopCamera}
          className={cn(
            "inline-flex min-h-tap items-center self-center rounded-lg px-2 text-xs text-[color:var(--text-muted)] underline hover:text-[color:var(--text)]",
            focusRing,
          )}
          data-testid="stop-camera-scan-btn"
        >
          Stop camera
        </button>
      )}

      {/* Fallback to 6-digit Code Entry */}
      <div
        className="flex flex-col gap-2 border-t border-[color:var(--border)] pt-3"
        data-testid="qr-typed-code-fallback"
      >
        <span className="text-xs font-semibold text-[color:var(--text)]">Or check in with 6-digit code:</span>
        <form onSubmit={handleTypedSubmit} className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={typedCode}
            onChange={(e) => {
              setTypedCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setCodeError(null);
            }}
            placeholder="e.g. 842103"
            aria-label="6-digit check-in code"
            className={cn(fieldControlPlain, "w-32 font-mono tracking-wider")}
            data-testid="qr-typed-code-input"
          />
          <button
            type="submit"
            className={buttonFaceClass({ variant: "primary", size: "sm" })}
            disabled={typedCode.replace(/\D/g, "").length !== 6}
            data-testid="qr-typed-code-submit-btn"
          >
            Check in
          </button>
        </form>
        {codeError && (
          <span className="text-xs font-semibold text-[color:var(--danger-text)]" data-testid="qr-code-error">
            {codeError}
          </span>
        )}
      </div>
    </div>
  );
}
