/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnCallNextShift } from "@/components/on-call/on-call-next-shift";
import type { RosterShiftsState } from "@/components/roster/use-roster-shifts";
import type { OnCallShift, OnCallShiftImportSummary } from "@/lib/roster/shifts/model";

/*
 * My shifts on the On Call home: the next-shift card. The page where a roster
 * is imported, checked and saved moved to Roster (tests/roster-*.dom.test.tsx).
 * Every roster here is invented.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/shifts",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const now = new Date("2026-10-05T01:00:00.000Z"); // 09:00 Monday in Perth

const nightShift: OnCallShift = {
  id: "s1",
  startsAt: "2026-10-06T13:00:00.000Z",
  endsAt: "2026-10-07T00:00:00.000Z",
  title: "Night registrar",
  location: "Example Hospital",
  sourceUid: null,
  kind: "night",
  source: "import",
  seriesId: null,
  workplace: "Example Hospital",
};

const unseenImport: OnCallShiftImportSummary = {
  id: "33333333-3333-4333-8333-333333333333",
  importedAt: "2026-10-04T00:00:00.000Z",
  format: "csv",
  windowStart: "2026-10-05",
  windowEnd: "2026-10-11",
  added: 2,
  changed: 1,
  removed: 0,
  changes: [],
  seenAt: null,
};

function state(overrides: Partial<RosterShiftsState> = {}): RosterShiftsState {
  return {
    status: "ready",
    shifts: [],
    teamLoading: false,
    latestImport: null,
    demoMode: false,
    sample: false,
    save: vi.fn(async () => null),
    addManual: vi.fn(async () => null),
    removeSeries: vi.fn(async () => null),
    deleteAll: vi.fn(async () => ({ ok: true, message: null })),
    removeWorkplace: vi.fn(async () => null),
    reload: vi.fn(async () => undefined),
    dismissChanges: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the next-shift card", () => {
  it("draws nothing while loading or signed out, so the home is unchanged", () => {
    const { container, rerender } = render(<OnCallNextShift state={state({ status: "loading" })} now={now} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OnCallNextShift state={state({ status: "signed-out" })} now={now} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("invites a roster import when there are no shifts", () => {
    render(<OnCallNextShift state={state()} now={now} />);
    const link = screen.getByTestId("on-call-next-shift-empty");
    expect(link).toHaveAttribute("href", "/roster");
    expect(link).toHaveTextContent("Add your roster");
  });

  it("shows the next shift and an unseen roster change", () => {
    render(<OnCallNextShift state={state({ shifts: [nightShift], latestImport: unseenImport })} now={now} />);
    expect(screen.getByTestId("on-call-next-shift-when")).toHaveTextContent("Tomorrow at 21:00");
    expect(screen.getByTestId("on-call-next-shift")).toHaveTextContent("21:00 to 08:00 (next day)");
    expect(screen.getByTestId("on-call-next-shift")).toHaveTextContent("Example Hospital");
    expect(screen.getByTestId("on-call-next-shift-changed")).toHaveTextContent("Roster changed: 2 added, 1 moved");
  });
});
