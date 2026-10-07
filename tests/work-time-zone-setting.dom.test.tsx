/** @vitest-environment jsdom */

// The work time zone setting: the row's value and note, the device hint when
// the phone is on another clock, and the sheet's radio group (click and
// keyboard), each zone's current time, and the quiet save line.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SyncState = "local-only" | "syncing" | "synced" | "error";

const control = vi.hoisted(() => ({
  zone: "Australia/Perth",
  deviceZone: "Australia/Perth" as string | null,
  differsFromDevice: false,
  syncState: "synced" as SyncState,
  setZone: vi.fn(),
}));

vi.mock("@/components/work-time/use-work-time-zone", () => ({
  useWorkTimeZoneControl: () => ({ ...control, zones: [] }),
}));

import { WorkTimeZoneSetting } from "@/components/work-time/work-time-zone-setting";
import { deviceZoneLabel, formatWorkZoneValue } from "@/lib/work-time/labels";

// 11:37 on Tue 6 Oct 2026 in Perth: Sydney, Melbourne, Hobart and Adelaide are on daylight saving.
const NOW = new Date("2026-10-06T03:37:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  control.zone = "Australia/Perth";
  control.deviceZone = "Australia/Perth";
  control.differsFromDevice = false;
  control.syncState = "synced";
  control.setZone.mockReset();
  control.setZone.mockImplementation((zone: string) => {
    control.zone = zone;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: /Time zone/ }));
  return screen.getByRole("dialog", { name: "Time zone" });
}

describe("helpers", () => {
  it("formats the value and names the phone's zone", () => {
    expect(formatWorkZoneValue("Australia/Perth", NOW.getTime())).toBe("Perth (AWST)");
    expect(formatWorkZoneValue("Australia/Sydney", NOW.getTime())).toBe("Sydney and Canberra (AEDT)");
    expect(deviceZoneLabel("Australia/Darwin")).toBe("Darwin");
    expect(deviceZoneLabel("America/New_York")).toBe("New York");
  });
});

describe("WorkTimeZoneSetting", () => {
  it("shows the zone and the plain note when the phone agrees", () => {
    render(<WorkTimeZoneSetting />);
    expect(screen.getByText("Perth (AWST)")).toBeTruthy();
    expect(screen.getByTestId("work-time-zone-note").textContent).toBe(
      "Roster and shift times show in this time zone, whatever your phone is set to.",
    );
  });

  it("shows the device hint under the row and in the sheet when the phone is on another clock", () => {
    control.deviceZone = "Australia/Sydney";
    control.differsFromDevice = true;
    render(<WorkTimeZoneSetting />);
    expect(screen.getByTestId("work-time-zone-note").textContent).toBe(
      "This phone is on Sydney and Canberra time. Shifts show in Perth time.",
    );
    const sheet = openSheet();
    expect(within(sheet).getByText("This phone is on Sydney and Canberra time")).toBeTruthy();
    expect(within(sheet).getByText("Shifts still show in Perth time.")).toBeTruthy();
  });

  it("lists every zone with its abbreviation and time now, the current one checked", () => {
    render(<WorkTimeZoneSetting />);
    const sheet = openSheet();
    const group = within(sheet).getByRole("radiogroup", { name: "Time zone" });
    const options = within(group).getAllByRole("radio");
    expect(options).toHaveLength(7);
    const perth = within(group).getByRole("radio", { name: /Perth/ });
    expect(perth.getAttribute("aria-checked")).toBe("true");
    expect(perth.textContent).toContain("AWST");
    expect(perth.textContent).toContain("11:37");
    const sydney = within(group).getByRole("radio", { name: /Sydney and Canberra/ });
    expect(sydney.getAttribute("aria-checked")).toBe("false");
    expect(sydney.textContent).toContain("AEDT, daylight saving");
    expect(sydney.textContent).toContain("14:37");
    expect(within(group).getByRole("radio", { name: /Darwin/ }).textContent).toContain("13:07");
    // Roving focus: only the checked option is in the tab order.
    expect(perth.tabIndex).toBe(0);
    expect(sydney.tabIndex).toBe(-1);
  });

  it("saves a zone picked by tap, and says when it is saved", () => {
    const { rerender } = render(<WorkTimeZoneSetting />);
    const sheet = openSheet();
    expect(within(sheet).getByRole("status").textContent).toBe("");
    control.syncState = "syncing";
    fireEvent.click(within(sheet).getByRole("radio", { name: /Brisbane/ }));
    expect(control.setZone).toHaveBeenCalledWith("Australia/Brisbane");
    rerender(<WorkTimeZoneSetting />);
    expect(
      within(sheet)
        .getByRole("radio", { name: /Brisbane/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(within(sheet).getByRole("status").textContent).toBe("Saving");

    control.syncState = "error";
    rerender(<WorkTimeZoneSetting />);
    expect(within(sheet).getByRole("status").textContent).toBe("Not saved, try again");

    control.syncState = "local-only";
    rerender(<WorkTimeZoneSetting />);
    expect(within(sheet).getByRole("status").textContent).toBe("Saved on this phone");

    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Brisbane (AEST)")).toBeTruthy();
    expect(screen.getByText("Saved on this phone")).toBeTruthy();
  });

  it("moves and saves with the arrow keys, wrapping at the ends", () => {
    const { rerender } = render(<WorkTimeZoneSetting />);
    const sheet = openSheet();
    const perth = within(sheet).getByRole("radio", { name: /Perth/ });
    perth.focus();
    fireEvent.keyDown(perth, { key: "ArrowDown" });
    expect(control.setZone).toHaveBeenLastCalledWith("Australia/Darwin");
    rerender(<WorkTimeZoneSetting />);
    const darwin = within(sheet).getByRole("radio", { name: /Darwin/ });
    expect(document.activeElement).toBe(darwin);
    expect(darwin.getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(darwin, { key: "ArrowUp" });
    fireEvent.keyDown(within(sheet).getByRole("radio", { name: /Perth/ }), { key: "ArrowUp" });
    expect(control.setZone).toHaveBeenLastCalledWith("Australia/Hobart");
  });

  it("draws the list inline with no row or sheet: hint, clocks that move each minute, keys and the save line", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
    control.deviceZone = "Australia/Sydney";
    control.differsFromDevice = true;
    const { rerender } = render(<WorkTimeZoneSetting variant="inline" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("work-time-zone-row")).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.getByTestId("work-time-zone-device-hint").textContent).toContain(
      "This phone is on Sydney and Canberra time",
    );

    const group = screen.getByRole("radiogroup", { name: "Time zone" });
    const perth = within(group).getByRole("radio", { name: /Perth/ });
    expect(perth.textContent).toContain("11:37");
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(within(group).getByRole("radio", { name: /Perth/ }).textContent).toContain("11:38");

    expect(screen.getByRole("status").textContent).toBe("");
    perth.focus();
    fireEvent.keyDown(perth, { key: "End" });
    expect(control.setZone).toHaveBeenLastCalledWith("Australia/Hobart");
    rerender(<WorkTimeZoneSetting variant="inline" />);
    expect(document.activeElement).toBe(within(group).getByRole("radio", { name: /Hobart/ }));
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });
});
