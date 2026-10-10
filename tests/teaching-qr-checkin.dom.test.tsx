/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeachingQrCheckinSheet } from "@/components/teaching-attendance/teaching-qr-checkin-sheet";
import * as clientModule from "@/lib/teaching/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // @ts-expect-error - clean up BarcodeDetector mock
  delete window.BarcodeDetector;
});

describe("TeachingQrCheckinSheet (#ZTDZ4Z)", () => {
  it("detects native BarcodeDetector when available on window", () => {
    // Mock native BarcodeDetector
    class MockBarcodeDetector {
      static getSupportedFormats = vi.fn().mockResolvedValue(["qr_code"]);
      detect = vi.fn().mockResolvedValue([]);
    }
    // @ts-expect-error - assign mock to window
    window.BarcodeDetector = MockBarcodeDetector;

    render(<TeachingQrCheckinSheet open onClose={vi.fn()} serviceId="service-1" occurrenceId="occurrence-1" />);

    expect(screen.getByTestId("teaching-camera-scanner-section")).toBeInTheDocument();
    expect(screen.getByText("Camera QR scanner available")).toBeInTheDocument();
    expect(screen.getByTestId("teaching-camera-scan-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-camera-unsupported-note")).toBeNull();

    // Fallback typed code input is still available
    expect(screen.getByTestId("teaching-typed-code-input")).toBeInTheDocument();
  });

  it("shows fallback notice when BarcodeDetector is not supported", () => {
    // Ensure BarcodeDetector is absent
    // @ts-expect-error - delete from window
    delete window.BarcodeDetector;

    render(<TeachingQrCheckinSheet open onClose={vi.fn()} serviceId="service-1" occurrenceId="occurrence-1" />);

    expect(screen.queryByTestId("teaching-camera-scanner-section")).toBeNull();
    expect(screen.getByTestId("teaching-camera-unsupported-note")).toBeInTheDocument();
    expect(screen.getByTestId("teaching-typed-code-input")).toBeInTheDocument();
  });

  it("validates 6-digit code before submission", async () => {
    const user = userEvent.setup();
    const teachingPostSpy = vi.spyOn(clientModule, "teachingPost").mockResolvedValue({});

    render(<TeachingQrCheckinSheet open onClose={vi.fn()} serviceId="service-1" occurrenceId="occurrence-1" />);

    const input = screen.getByTestId("teaching-typed-code-input");
    await user.type(input, "123");

    const submitBtn = screen.getByTestId("teaching-typed-code-submit");
    await user.click(submitBtn);

    expect(screen.getByText("Enter the 6-digit code.")).toBeInTheDocument();
    expect(teachingPostSpy).not.toHaveBeenCalled();
  });

  it("submits typed check-in code and fires onCheckInSuccess", async () => {
    const user = userEvent.setup();
    const teachingPostSpy = vi.spyOn(clientModule, "teachingPost").mockResolvedValue({
      method: "code",
      recordedAt: new Date().toISOString(),
    });
    const onCheckInSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <TeachingQrCheckinSheet
        open
        onClose={onClose}
        serviceId="service-psych-1"
        occurrenceId="occ-teaching-101"
        onCheckInSuccess={onCheckInSuccess}
      />,
    );

    const input = screen.getByTestId("teaching-typed-code-input");
    await user.type(input, "654321");

    const submitBtn = screen.getByTestId("teaching-typed-code-submit");
    await user.click(submitBtn);

    await waitFor(() => expect(teachingPostSpy).toHaveBeenCalledTimes(1));
    expect(teachingPostSpy).toHaveBeenCalledWith("/api/teaching/services/service-psych-1", {
      action: "checkin.typed",
      occurrenceId: "occ-teaching-101",
      stream: "room",
      code: "654321",
    });

    expect(onCheckInSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handles camera stream and mounts video element when scanning starts", async () => {
    const user = userEvent.setup();
    class MockBarcodeDetector {
      static getSupportedFormats = vi.fn().mockResolvedValue(["qr_code"]);
      detect = vi.fn().mockResolvedValue([]);
    }
    // @ts-expect-error - assign mock
    window.BarcodeDetector = MockBarcodeDetector;

    const stopTrack = vi.fn();
    const mockStream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
    });

    render(<TeachingQrCheckinSheet open onClose={vi.fn()} serviceId="service-1" occurrenceId="occurrence-1" />);

    const scanBtn = screen.getByTestId("teaching-camera-scan-btn");
    await user.click(scanBtn);

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
    expect(screen.getByTestId("teaching-camera-video")).toBeInTheDocument();
    expect(screen.getByTestId("teaching-camera-stop-btn")).toBeInTheDocument();

    await user.click(screen.getByTestId("teaching-camera-stop-btn"));
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.queryByTestId("teaching-camera-video")).toBeNull();
  });

  it("falls back gracefully when camera permission is denied", async () => {
    const user = userEvent.setup();
    class MockBarcodeDetector {
      static getSupportedFormats = vi.fn().mockResolvedValue(["qr_code"]);
      detect = vi.fn().mockResolvedValue([]);
    }
    // @ts-expect-error - assign mock
    window.BarcodeDetector = MockBarcodeDetector;

    const permError = new Error("Permission denied");
    permError.name = "NotAllowedError";
    const getUserMediaMock = vi.fn().mockRejectedValue(permError);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
    });

    render(<TeachingQrCheckinSheet open onClose={vi.fn()} serviceId="service-1" occurrenceId="occurrence-1" />);

    const scanBtn = screen.getByTestId("teaching-camera-scan-btn");
    await user.click(scanBtn);

    await waitFor(() =>
      expect(screen.getByText("Camera permission denied. Please enter the 6-digit code below.")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("teaching-typed-code-input")).toBeInTheDocument();
  });

  it("automatically submits code when BarcodeDetector detects a 6-digit code in camera stream", async () => {
    const user = userEvent.setup();
    const teachingPostSpy = vi.spyOn(clientModule, "teachingPost").mockResolvedValue({
      method: "code",
      recordedAt: new Date().toISOString(),
    });
    const onCheckInSuccess = vi.fn();
    const onClose = vi.fn();

    class MockBarcodeDetector {
      static getSupportedFormats = vi.fn().mockResolvedValue(["qr_code"]);
      detect = vi.fn().mockResolvedValue([{ rawValue: "WARD-987654" }]);
    }
    // @ts-expect-error - assign mock
    window.BarcodeDetector = MockBarcodeDetector;

    const stopTrack = vi.fn();
    const mockStream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
      configurable: true,
    });

    render(
      <TeachingQrCheckinSheet
        open
        onClose={onClose}
        serviceId="service-psych-2"
        occurrenceId="occ-teaching-202"
        onCheckInSuccess={onCheckInSuccess}
      />,
    );

    const scanBtn = screen.getByTestId("teaching-camera-scan-btn");
    await user.click(scanBtn);

    await waitFor(() => expect(teachingPostSpy).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(teachingPostSpy).toHaveBeenCalledWith("/api/teaching/services/service-psych-2", {
      action: "checkin.typed",
      occurrenceId: "occ-teaching-202",
      stream: "room",
      code: "987654",
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(onCheckInSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
