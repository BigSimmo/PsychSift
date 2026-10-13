"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

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
  const mountedRef = useRef(true);
  // Bumped by every start/stop, so a permission prompt that resolves after the user stopped or
  // left cannot leave the camera running.
  const cameraRequestRef = useRef(0);

  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1;
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

    const request = cameraRequestRef.current;
    const result = await requestMobileCameraStream();
    if (!mountedRef.current || request !== cameraRequestRef.current) {
      result.stream?.getTracks().forEach((track) => track.stop());
      return;
    }
    setPermissionStatus(result.status);

    if (result.stream) {
      streamRef.current = result.stream;
      // The <video> mounts only once isScanning renders; the effect below attaches the stream.
      setIsScanning(true);

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
    if (!isScanning || !videoRef.current || !streamRef.current) return;
    try {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play?.().catch(() => {});
    } catch {
      // Handled safely
    }
  }, [isScanning]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
      className={`qr-check-in-helper flex flex-col gap-3 p-4 bg-white rounded-lg border border-gray-200 shadow-sm max-w-md mx-auto ${className}`}
      data-testid="qr-check-in-helper"
    >
      <div className="flex justify-between items-center border-b pb-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-700"
            data-testid="qr-helper-close-btn"
          >
            Close
          </button>
        )}
      </div>

      {/* Camera Viewport / Fallback View */}
      <div
        className="qr-scanning-viewport relative w-full h-56 bg-black rounded-lg overflow-hidden flex items-center justify-center"
        data-testid="qr-scanning-viewport"
      >
        {isScanning ? (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="w-full h-full object-cover"
              data-testid="qr-camera-video"
            />
            {/* Viewfinder Target Reticle */}
            <div
              className="absolute inset-0 border-2 border-dashed border-white/60 m-8 rounded-lg pointer-events-none flex items-center justify-center"
              data-testid="qr-viewfinder-reticle"
            >
              <span className="text-[10px] text-white/80 bg-black/60 px-2 py-0.5 rounded">
                Point at session QR code
              </span>
            </div>
          </>
        ) : (
          <div
            className="p-4 text-center text-xs text-gray-300 flex flex-col items-center gap-2"
            data-testid="qr-viewport-fallback"
          >
            {errorMessage ? (
              <p className="text-amber-300 font-medium">{errorMessage}</p>
            ) : (
              <p>Camera is currently inactive.</p>
            )}
            <button
              type="button"
              onClick={startCamera}
              className="px-3 py-1.5 text-xs bg-white text-gray-900 font-medium rounded shadow hover:bg-gray-100 transition-colors"
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
          className="text-xs text-gray-600 hover:text-gray-800 underline self-center"
          data-testid="stop-camera-scan-btn"
        >
          Stop camera
        </button>
      )}

      {/* Fallback to 6-digit Code Entry */}
      <div className="border-t pt-3 flex flex-col gap-2" data-testid="qr-typed-code-fallback">
        <span className="text-xs font-medium text-gray-700">Or check in with 6-digit code:</span>
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
            className="text-xs px-3 py-1.5 border rounded-md border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono tracking-wider w-32"
            data-testid="qr-typed-code-input"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-xs bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
            disabled={typedCode.replace(/\D/g, "").length !== 6}
            data-testid="qr-typed-code-submit-btn"
          >
            Check in
          </button>
        </form>
        {codeError && (
          <span className="text-[11px] text-red-600 font-medium" data-testid="qr-code-error">
            {codeError}
          </span>
        )}
      </div>
    </div>
  );
}
