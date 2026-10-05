// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AlertsDeviceSection } from "@/components/alerts/alerts-device-section";
import type { PhoneAlerts } from "@/components/alerts/use-phone-alerts";

function alerts(overrides: Partial<PhoneAlerts>): PhoneAlerts {
  return {
    state: "on",
    device: "iphone",
    configured: true,
    enabled: true,
    busy: false,
    message: null,
    lastTestArrivedAt: null,
    testSentAt: null,
    toggle: vi.fn(async () => undefined),
    sendTest: vi.fn(async () => undefined),
    setShared: vi.fn(async () => undefined),
    retry: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("This phone", () => {
  it("screen 11: an iPhone not on the Home Screen gets three steps and a locked test", async () => {
    const value = alerts({ state: "needs-home-screen", enabled: false });
    render(<AlertsDeviceSection alerts={value} shared={false} />);
    expect(screen.getByText("Alerts aren't set up on this iPhone yet")).toBeTruthy();
    expect(screen.getByText("Tap Share in Safari")).toBeTruthy();
    expect(screen.getByText("Add to Home Screen")).toBeTruthy();
    expect(screen.getByText("Tap Allow")).toBeTruthy();
    const locked = screen.getByTestId("alerts-test-locked");
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(locked);
    expect(value.sendTest).not.toHaveBeenCalled();
  });

  it("screen 12: blocked is a warning, with the iPhone's own Settings steps", () => {
    render(<AlertsDeviceSection alerts={alerts({ state: "blocked", enabled: false })} shared={false} />);
    expect(screen.getByText("Alerts are turned off for PsychSift")).toBeTruthy();
    expect(screen.getByText("Open the Settings app")).toBeTruthy();
    expect(
      screen.getByText("Until then you won't get phone alerts, but everything still shows in My Day."),
    ).toBeTruthy();
  });

  it("a failed check offers Try again, which re-runs the check", async () => {
    const value = alerts({ state: "error", enabled: false });
    render(<AlertsDeviceSection alerts={value} shared={false} />);
    expect(screen.getByText("Couldn't be checked. Check your connection and try again.")).toBeTruthy();
    await userEvent.click(screen.getByTestId("alerts-retry"));
    expect(value.retry).toHaveBeenCalledTimes(1);
  });

  it("blocked on a computer gives browser steps, not iPhone ones", () => {
    render(<AlertsDeviceSection alerts={alerts({ state: "blocked", device: "computer" })} shared={false} />);
    expect(screen.queryByText("Open the Settings app")).toBeNull();
    expect(screen.getByText("Open this site's settings")).toBeTruthy();
  });

  it("on: says when the last test arrived and sends a test on request", async () => {
    const value = alerts({ lastTestArrivedAt: "2026-10-04T08:02:00Z" });
    render(<AlertsDeviceSection alerts={value} shared={false} />);
    expect(screen.getByText("On for this iPhone · last test arrived Sun 16:02")).toBeTruthy();
    await userEvent.click(screen.getByTestId("alerts-send-test"));
    expect(value.sendTest).toHaveBeenCalledTimes(1);
  });

  it("a failed check says so and is never shown as off", () => {
    render(<AlertsDeviceSection alerts={alerts({ state: "error", enabled: false })} shared={false} />);
    expect(screen.getByText("Couldn't be checked. Check your connection and try again.")).toBeTruthy();
    expect(screen.queryByText(/^Off on this/)).toBeNull();
  });

  it("a shared computer: the switch turns personal alerts off here", async () => {
    const value = alerts({ state: "on", device: "computer" });
    render(<AlertsDeviceSection alerts={value} shared={false} />);
    expect(screen.getByText("This computer")).toBeTruthy();
    await userEvent.click(screen.getByRole("switch", { name: "This is a shared computer" }));
    expect(value.setShared).toHaveBeenCalledWith(true);
  });
});
