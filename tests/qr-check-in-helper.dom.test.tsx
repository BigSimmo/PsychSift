/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QrCheckInHelper } from "@/components/teaching/qr-check-in-helper";
import { TeachingCodeSheet } from "@/components/teaching/teaching-code-sheet";

describe("QrCheckInHelper (#ZTDZ4Z)", () => {
  let mockTracks: { stop: ReturnType<typeof vi.fn> }[];
  let mockStream: { getTracks: () => typeof mockTracks };

  beforeEach(() => {
    mockTracks = [{ stop: vi.fn() }];
    mockStream = { getTracks: () => mockTracks };

    // Mock navigator.mediaDevices.getUserMedia
    Object.defineProperty(global.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    // @ts-expect-error - clean up BarcodeDetector
    delete window.BarcodeDetector;
  });

  it("renders camera viewport fallback and typed-code input with privacy attributes", () => {
    render(<QrCheckInHelper onScanCode={vi.fn()} />);

    expect(screen.getByTestId("qr-check-in-helper")).toBeInTheDocument();
    expect(screen.getByTestId("qr-viewport-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("start-camera-scan-btn")).toBeInTheDocument();

    const input = screen.getByTestId("qr-typed-code-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("id", "manual-session-code-input");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("data-gramm", "false");
    expect(input).toHaveAttribute("data-enable-grammarly", "false");
  });

  it("starts camera with mobile back camera constraints", async () => {
    const onScan = vi.fn();
    render(<QrCheckInHelper onScanCode={onScan} />);

    const startBtn = screen.getByTestId("start-camera-scan-btn");
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    expect(screen.getByTestId("qr-camera-video")).toBeInTheDocument();
    expect(screen.getByTestId("qr-viewfinder-reticle")).toBeInTheDocument();
  });

  it("handles camera permission denial gracefully with clear feedback", async () => {
    const permError = new Error("Permission denied");
    permError.name = "NotAllowedError";

    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(permError);

    render(<QrCheckInHelper onScanCode={vi.fn()} />);

    const startBtn = screen.getByTestId("start-camera-scan-btn");
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(screen.getByTestId("qr-viewport-fallback")).toHaveTextContent(
      "Camera access denied. Please enable camera permissions",
    );
    expect(screen.getByTestId("start-camera-scan-btn")).toHaveTextContent("Retry Camera Access");
  });

  it("validates and submits 6-digit typed code", () => {
    const onScan = vi.fn();
    render(<QrCheckInHelper onScanCode={onScan} />);

    const input = screen.getByTestId("qr-typed-code-input");
    const submitBtn = screen.getByTestId("qr-typed-code-submit-btn");

    // Partial input -> disabled submit
    fireEvent.change(input, { target: { value: "123" } });
    expect(submitBtn).toBeDisabled();

    // 6 digits -> enabled submit
    fireEvent.change(input, { target: { value: "842103" } });
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);
    expect(onScan).toHaveBeenCalledWith("842103");
  });

  it("detects QR code with BarcodeDetector and calls onScanCode", async () => {
    vi.useFakeTimers();

    class MockBarcodeDetector {
      detect = vi.fn().mockResolvedValue([{ rawValue: "951753" }]);
    }
    // @ts-expect-error - assign mock detector
    window.BarcodeDetector = MockBarcodeDetector;

    const onScan = vi.fn();
    render(<QrCheckInHelper onScanCode={onScan} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-camera-scan-btn"));
    });

    const video = screen.getByTestId("qr-camera-video") as HTMLVideoElement;
    Object.defineProperty(video, "readyState", { value: 4, configurable: true });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(onScan).toHaveBeenCalledWith("951753");
  });

  it("toggles QrCheckInHelper inside TeachingCodeSheet and populates scanned code", () => {
    render(
      <TeachingCodeSheet
        open={true}
        onClose={vi.fn()}
        session={{ serviceId: "svc-1", occurrenceId: "occ-1", hasJoinLink: false }}
        live={false}
        onDone={vi.fn()}
      />,
    );

    const toggleBtn = screen.getByTestId("toggle-in-app-qr-scanner");
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId("qr-check-in-helper")).toBeInTheDocument();

    const helperInput = screen.getByTestId("qr-typed-code-input");
    fireEvent.change(helperInput, { target: { value: "654321" } });
    fireEvent.click(screen.getByTestId("qr-typed-code-submit-btn"));

    expect(screen.getByLabelText("Or type the six digits")).toHaveValue("654321");
  });
});
