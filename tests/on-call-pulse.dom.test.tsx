import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { endOnCallBreak, onCallBreaksFrom, startOnCallBreak } from "@/lib/on-call/break-log";
import {
  ON_CALL_DEVICE_STATE_KEYS,
  clearOnCallDeviceState,
  onCallBreaksStorageKey,
  onCallCallCountsStorageKey,
} from "@/lib/on-call/device-state-keys";
import { fatigueWarnings } from "@/lib/roster/fatigue-rules";

const roster = vi.hoisted(() => ({
  state: { status: "ready", shifts: [] as unknown[], sample: false, latestImport: null, demoMode: false },
}));
vi.mock("@/components/roster/use-roster-shifts", () => ({ useRosterShifts: () => roster.state }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/on-call/pulse",
  useSearchParams: () => new URLSearchParams(),
}));

const { OnCallShiftPulsePage } = await import("@/components/on-call/pulse/shift-pulse-page");

// Sunday 11 Oct 2026, 02:10 Perth: inside a Saturday 17:00 to Sunday 08:00 night.
const NOW = new Date("2026-10-10T18:10:00.000Z");

function shift(id: string, startsAt: string, endsAt: string) {
  return {
    id,
    startsAt,
    endsAt,
    title: "Night",
    location: null,
    kind: "night",
    source: "manual",
    seriesId: null,
    workplace: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  roster.state = { status: "ready", shifts: [], sample: false, latestImport: null, demoMode: false };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("break store", () => {
  it("keeps start and end times only, drops breaks from before the shift, and is wiped at sign-out", () => {
    startOnCallBreak(new Date(NOW.getTime() - 60 * 60_000));
    endOnCallBreak(new Date(NOW.getTime() - 30 * 60_000));
    startOnCallBreak(NOW);
    startOnCallBreak(NOW); // a running break is not started twice
    const raw = window.localStorage.getItem(onCallBreaksStorageKey);
    const breaks = onCallBreaksFrom(raw, NOW);
    expect(breaks).toHaveLength(2);
    expect(Object.keys(breaks[0]!).sort()).toEqual(["endedAt", "startedAt"]);
    expect(breaks[1]!.endedAt).toBeNull();
    // A break before the current shift began is not this shift's.
    expect(onCallBreaksFrom(raw, NOW, new Date(NOW.getTime() - 45 * 60_000))).toHaveLength(1);
    // Older than 16 hours: gone.
    expect(onCallBreaksFrom(raw, new Date(NOW.getTime() + 17 * 60 * 60_000))).toHaveLength(0);
    expect(onCallBreaksFrom('{"v":1,"breaks":[{"startedAt":"x","endedAt":null,"bed":"4"}]}', NOW)).toEqual([]);

    expect(ON_CALL_DEVICE_STATE_KEYS).toContain(onCallBreaksStorageKey);
    clearOnCallDeviceState();
    expect(window.localStorage.getItem(onCallBreaksStorageKey)).toBeNull();
  });
});

describe("Shift pulse", () => {
  it("starts and ends a break, and counts breaks without claiming how many are owed", async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<OnCallShiftPulsePage />);
    const breaks = await screen.findByTestId("on-call-pulse-breaks");
    expect(breaks).toHaveTextContent("No break noted yet");
    expect(within(breaks).getByTestId("on-call-pulse-breaks-count")).toHaveTextContent("0breaks");
    await user.click(within(breaks).getByRole("button", { name: "Start break" }));
    expect(screen.getByTestId("on-call-pulse-breaks-title")).toHaveTextContent("On a break since 02:10");
    expect(within(breaks).getByRole("button", { name: "End break" })).toBeInTheDocument();
    await user.click(within(breaks).getByRole("button", { name: "End break" }));
    expect(screen.getByTestId("on-call-pulse-breaks-title")).toHaveTextContent("Last break ended 02:10");
    // No fraction of breaks "due": that rule is not in the signed set.
    expect(document.body.textContent).not.toMatch(/\d\/\d|break is due|breaks due/i);
  });

  it("draws calls by hour from counts only, and says plainly when there are none", async () => {
    render(<OnCallShiftPulsePage />);
    expect(await screen.findByTestId("on-call-pulse-calls-empty")).toHaveTextContent("No calls noted after hours");
    expect(screen.getByTestId("on-call-pulse-call-log")).toHaveAttribute("href", "/on-call/call");
    cleanup();
    window.localStorage.setItem(
      onCallCallCountsStorageKey,
      JSON.stringify({ v: 1, hours: { "2026-10-10T21": 3, "2026-10-10T22": 2, "2026-10-09T21": 1 } }),
    );
    render(<OnCallShiftPulsePage />);
    const calls = await screen.findByTestId("on-call-pulse-calls");
    expect(within(calls).getByText("21:00, 3 calls")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-pulse-peak")).toHaveTextContent("Busiest 21:00–23:00");
    expect(screen.queryByTestId("on-call-pulse-calls-empty")).toBeNull();
  });

  it("shows rest before the next shift only from the roster, and never invents a confirmation", async () => {
    roster.state = {
      ...roster.state,
      shifts: [
        shift("a", "2026-10-10T09:00:00.000Z", "2026-10-11T00:00:00.000Z"),
        shift("b", "2026-10-12T09:00:00.000Z", "2026-10-13T00:00:00.000Z"),
      ],
    };
    render(<OnCallShiftPulsePage />);
    await act(async () => {});
    expect(screen.getByTestId("on-call-pulse-breaks")).toHaveTextContent("Sat 17:00 – Sun 08:00");
    expect(screen.getByTestId("on-call-pulse-roster")).toHaveAttribute("href", "/roster");
    expect(screen.getByTestId("on-call-pulse-roster")).toHaveTextContent("Stayed past 08:00?");
    const rest = screen.queryByTestId("on-call-pulse-rest");
    const gateOn = fatigueWarnings([], undefined, undefined, NOW.getTime()).gate.on;
    expect(rest !== null).toBe(gateOn);
    if (gateOn) {
      expect(rest).toHaveTextContent("33 h");
      expect(rest).toHaveTextContent("Next shift Mon 17:00, from your Roster");
      expect(screen.getByTestId("on-call-pulse-rest-chip")).toHaveTextContent("Over 10 h");
      expect(screen.getByTestId("on-call-pulse-rules")).toHaveTextContent("Signed off 4 Oct 2026");
    } else {
      expect(screen.queryByTestId("on-call-pulse-rules")).toBeNull();
    }
    expect(document.body.textContent).not.toMatch(/You confirmed/);
    // Taxi and overtime wording wait for the owner's sign-off of those clauses.
    expect(document.body.textContent).not.toMatch(/15\(10\)|taxi|15\(7\)|17\(1\)/i);
  });

  it("treats Roster's example roster as no shift at all", async () => {
    roster.state = {
      ...roster.state,
      sample: true,
      shifts: [shift("a", "2026-10-10T09:00:00.000Z", "2026-10-11T00:00:00.000Z")],
    };
    render(<OnCallShiftPulsePage />);
    await act(async () => {});
    expect(screen.getByTestId("on-call-pulse-breaks")).toHaveTextContent("This shift");
    expect(screen.queryByTestId("on-call-pulse-rest")).toBeNull();
    expect(screen.queryByTestId("on-call-pulse-roster")).toBeNull();
  });
});
