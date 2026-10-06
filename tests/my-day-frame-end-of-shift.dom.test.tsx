/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MyDayFrame } from "@/components/my-day/my-day-frame";
import { REMIND_ME_STORAGE_KEY } from "@/lib/account-scoped-browser-state";

const shiftsState = vi.hoisted(() => ({
  current: {
    status: "ready" as const,
    shifts: [] as { label: string; startsAt: string; endsAt: string }[],
    teamLoading: false,
    demoMode: false,
    sample: false,
    reload: async () => undefined,
  },
}));

vi.mock("@/components/roster/use-roster-shifts", () => ({
  useRosterShifts: () => shiftsState.current,
}));

const auth = vi.hoisted(() => ({ status: "authenticated", authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => null,
}));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("MyDayFrame end-of-shift card and reminders", () => {
  const now = new Date("2026-10-05T08:15:00Z"); // 16:15 Perth

  it("does not show EndOfShiftCard when no shift is ending", () => {
    shiftsState.current.shifts = [
      { title: "Day shift", label: "Day shift", startsAt: "2026-10-05T00:00:00Z", endsAt: "2026-10-05T08:00:00Z" }, // already ended
    ];

    render(
      <MyDayFrame title="Test" subtitle={() => "Sub"} testId="test-frame" now={now}>
        {() => <div>Frame content</div>}
      </MyDayFrame>,
    );

    expect(screen.queryByTestId("end-of-shift-card")).toBeNull();
    expect(screen.getByText("Frame content")).toBeTruthy();
  });

  it("mounts EndOfShiftCard in the last 30 minutes of a shift", () => {
    shiftsState.current.shifts = [
      { title: "Day shift", label: "Day shift", startsAt: "2026-10-05T00:00:00Z", endsAt: "2026-10-05T08:30:00Z" }, // ends in 15m
    ];

    render(
      <MyDayFrame title="Test" subtitle={() => "Sub"} testId="test-frame" now={now}>
        {() => <div>Frame content</div>}
      </MyDayFrame>,
    );

    expect(screen.getByTestId("end-of-shift-card")).toBeTruthy();
    expect(screen.getByText("Day shift ends 16:30")).toBeTruthy();
    expect(screen.getByText("15 minutes left")).toBeTruthy();
    expect(screen.queryByTestId("end-of-shift-reminders")).toBeNull();
  });

  it("prompts doctors leaving a shift to review pending reminders and opens the reminders sheet", async () => {
    const user = userEvent.setup();
    shiftsState.current.shifts = [
      { title: "Day shift", label: "Day shift", startsAt: "2026-10-05T00:00:00Z", endsAt: "2026-10-05T08:30:00Z" },
    ];

    // Seed 2 reminders in localStorage
    const pending = [
      {
        id: "r1",
        text: "Hand over bloods to evening reg",
        dueAt: "2026-10-05T08:00:00Z",
        createdAt: "2026-10-05T07:00:00Z",
        doneAt: null,
      },
      {
        id: "r2",
        text: "Phone bed manager re outlier",
        dueAt: "2026-10-05T08:15:00Z",
        createdAt: "2026-10-05T07:00:00Z",
        doneAt: null,
      },
    ];
    window.localStorage.setItem(REMIND_ME_STORAGE_KEY, JSON.stringify(pending));

    render(
      <MyDayFrame title="Test" subtitle={() => "Sub"} testId="test-frame" now={now}>
        {() => <div>Frame content</div>}
      </MyDayFrame>,
    );

    const remindersRow = screen.getByTestId("end-of-shift-reminders");
    expect(remindersRow).toBeTruthy();
    expect(screen.getByText("2 reminders on this device")).toBeTruthy();

    await user.click(remindersRow);
    expect(await screen.findByRole("dialog", { name: "Your reminders" })).toBeTruthy();
    expect(screen.getByText("Hand over bloods to evening reg")).toBeTruthy();
    expect(screen.getByText("Phone bed manager re outlier")).toBeTruthy();
  });
});
