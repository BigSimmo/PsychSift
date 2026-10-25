/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.doUnmock("qrcode");
  vi.resetModules();
});

describe("CheckinQr when the QR module cannot load", () => {
  it("says the code could not load, and does not keep the failed load, so a later try loads again", async () => {
    vi.resetModules();
    vi.doMock("qrcode", () => {
      throw new Error("Synthetic chunk load failure");
    });
    const { CheckinQr, loadQrCode } = await import("@/components/teaching/checkin-qr");
    render(<CheckinQr value="https://example.test/c" label="Check-in QR code" />);
    expect(
      await screen.findByRole("img", {
        name: "Check-in QR code could not load. Reload the page, or use the typed code.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Code could not load.")).toBeInTheDocument();
    vi.doUnmock("qrcode");
    const mod = await loadQrCode();
    expect(typeof mod.create).toBe("function");
  });
});
