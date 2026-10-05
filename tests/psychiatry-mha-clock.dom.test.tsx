/** @vitest-environment jsdom */

// Psychiatry · MHA clock. A clock holds a form code and a time only, lives in its own store on this
// device until it is removed or the account changes (never at shift end: a Form 3A detention can
// outlast a shift; owner decision 5 October 2026), and every time limit on the page
// comes from the governed timeframe engine: while a limit may not be counted, the page shows the
// owner-approved line and the Act's own words, never an invented time.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/psychiatry/mha-clock",
}));

import { MHA_TIMELINE_REFERENCE_NOTE } from "@/components/forms/mha-timeline-panel";
import { MhaClockPage, type MhaClockForm } from "@/components/psychiatry/mha-clock-page";
import { PsychiatryHome } from "@/components/psychiatry/psychiatry-home";
import { mhaTimers } from "@/lib/on-call/mha-timers";
import {
  clearAccountScopedBrowserStorage,
  PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY,
} from "@/lib/account-scoped-browser-state";
import { clearPatientLabels, readPatientLabels, writePatientLabels } from "@/lib/patient-label-storage";
import {
  addMhaClock,
  clearMhaClocks,
  LEGACY_MHA_CLOCK_STORE_NAME,
  loadMhaClocks,
  loadMhaClockState,
  MHA_CLOCK_LIMIT,
  parseMhaClocks,
  parseMhaClockState,
  removeMhaClock,
  restoreMhaClock,
} from "@/lib/psychiatry-hub/mha-clocks";

const forms: MhaClockForm[] = [
  { code: "2", title: "Order to detain voluntary inpatient in authorised hospital for assessment", slug: "form-2" },
  { code: "3A", title: "Detention order", slug: "detention-examination-movement" },
];
const now = new Date("2026-10-05T10:00:00Z"); // 18:00 Perth

beforeEach(() => {
  window.localStorage.clear();
  clearMhaClocks();
});
afterEach(cleanup);

describe("MHA clock store", () => {
  it("keeps a form code and a time only, under its own key", () => {
    expect(addMhaClock("3A", new Date(now.getTime() - 45 * 60_000))).toBe("added");
    const [clock] = loadMhaClocks();
    expect(Object.keys(clock).sort()).toEqual(["formCode", "id", "madeAt"]);
    expect(Object.keys(window.localStorage)).toEqual([PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY]);
    expect(removeMhaClock(clock.id)).toBe(true);
    expect(loadMhaClocks()).toEqual([]);
    expect(window.localStorage.getItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY)).toBeNull();
  });

  it("puts a removed clock back for Undo, once, and never beyond the limit", () => {
    addMhaClock("2", now);
    const [clock] = loadMhaClocks();
    removeMhaClock(clock.id);
    expect(restoreMhaClock(clock)).toBe("added");
    expect(restoreMhaClock(clock)).toBe("added");
    expect(loadMhaClocks()).toEqual([clock]);
    removeMhaClock(clock.id);
    for (let index = 0; index < MHA_CLOCK_LIMIT; index += 1) addMhaClock("2", now);
    expect(restoreMhaClock(clock)).toBe("full");
    expect(restoreMhaClock({ id: "x", formCode: "2", madeAt: 1 })).toBe("invalid");
  });

  it("refuses bad input and a full list rather than dropping a clock", () => {
    expect(addMhaClock("not a form", now)).toBe("invalid");
    expect(addMhaClock("2", new Date(Number.NaN))).toBe("invalid");
    for (let index = 0; index < MHA_CLOCK_LIMIT; index += 1) expect(addMhaClock("2", now)).toBe("added");
    expect(addMhaClock("2", now)).toBe("full");
    expect(loadMhaClocks()).toHaveLength(MHA_CLOCK_LIMIT);
  });

  it("drops malformed stored rows, including any extra field such as a label", () => {
    const raw = JSON.stringify({
      v: 1,
      clocks: [
        { id: "abcdefgh-1", formCode: "2", madeAt: 1 },
        { id: "x", formCode: "2", madeAt: 1 },
        { id: "abcdefgh-2", formCode: "<b>", madeAt: 1 },
      ],
    });
    expect(parseMhaClocks(raw)).toEqual([{ id: "abcdefgh-1", formCode: "2", madeAt: 1 }]);
    expect(parseMhaClocks("{nope")).toEqual([]);
    expect(parseMhaClockState(raw).unreadable).toBe(true);
    expect(parseMhaClockState("{nope").unreadable).toBe(true);
    expect(parseMhaClockState(null)).toEqual({ clocks: [], unreadable: false });
  });

  it("survives the end-of-shift wipe, because a detention can outlast a shift", () => {
    addMhaClock("2", now);
    clearPatientLabels("shift-ended");
    expect(loadMhaClocks()).toHaveLength(1);
  });

  it("is cleared at sign-out and every other account transition", () => {
    addMhaClock("2", now);
    expect(loadMhaClocks()).toHaveLength(1);
    clearAccountScopedBrowserStorage();
    expect(loadMhaClocks()).toEqual([]);
  });

  it("moves clocks from the old patient-label store once, and removes the old copy", () => {
    const old = { id: "abcdefgh-1", formCode: "3A", madeAt: now.getTime() - 60_000 };
    expect(writePatientLabels(LEGACY_MHA_CLOCK_STORE_NAME, JSON.stringify({ v: 1, clocks: [old] }))).toBe(true);
    expect(loadMhaClocks()).toEqual([old]);
    expect(readPatientLabels(LEGACY_MHA_CLOCK_STORE_NAME)).toBeNull();
    expect(window.localStorage.getItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY)).not.toBeNull();
  });

  it("reports storage it cannot read instead of an empty list", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(loadMhaClockState()).toEqual({ clocks: [], unreadable: true });
    } finally {
      getItem.mockRestore();
    }
    window.localStorage.setItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY, "{broken");
    expect(loadMhaClockState().unreadable).toBe(true);
  });
});

describe("MhaClockPage", () => {
  it("starts with an empty state and the owner-approved reference line", () => {
    render(<MhaClockPage forms={forms} now={now} />);
    expect(screen.getByRole("heading", { level: 1, name: "MHA clock" })).toBeTruthy();
    expect(screen.getByTestId("mha-clock-empty")).toBeTruthy();
    expect(screen.getByTestId("mha-clock-reference")).toHaveTextContent(MHA_TIMELINE_REFERENCE_NOTE);
  });

  it("starts a clock from the form and time entered, and removes it", () => {
    render(<MhaClockPage forms={forms} now={now} />);
    fireEvent.change(screen.getByTestId("mha-clock-form"), { target: { value: "3A" } });
    fireEvent.change(screen.getByTestId("mha-clock-time"), { target: { value: "2026-10-05T17:15" } });
    act(() => {
      fireEvent.click(screen.getByTestId("mha-clock-start"));
    });

    const card = screen.getByTestId("mha-clock-card");
    expect(card).toHaveTextContent("Detention order");
    expect(card).toHaveTextContent("Made Mon 17:15 · 45 min running");
    expect(screen.getByTestId("mha-clock-count")).toHaveTextContent("1");
    expect(within(card).getByRole("link", { name: "Open Form 3A" }).getAttribute("href")).toBe(
      "/forms/detention-examination-movement",
    );

    act(() => {
      fireEvent.click(within(card).getByTestId("mha-clock-remove"));
    });
    expect(screen.queryByTestId("mha-clock-card")).toBeNull();
    expect(screen.getByTestId("mha-clock-undo")).toHaveTextContent("Form 3A clock removed");

    act(() => {
      fireEvent.click(screen.getByTestId("mha-clock-undo-button"));
    });
    expect(screen.getByTestId("mha-clock-card")).toHaveTextContent("Made Mon 17:15");
    expect(screen.getByTestId("mha-clock-undo")).toHaveTextContent("Form 3A clock put back");
  });

  it("copies the form and made-at time only for handover, with the reference line", () => {
    addMhaClock("2", new Date("2026-10-04T15:40:00Z")); // Sun 23:40 Perth
    addMhaClock("3A", new Date("2026-10-04T17:55:00Z")); // Mon 01:55 Perth
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<MhaClockPage forms={forms} now={now} />);
    fireEvent.click(screen.getByTestId("mha-clock-handover-copy"));
    expect(writeText).toHaveBeenCalledWith(
      ["As at Mon 18:00", "Form 2 · made Sun 23:40", "Form 3A · made Mon 01:55", MHA_TIMELINE_REFERENCE_NOTE].join(
        "\n",
      ),
    );
  });

  it("says when clocks could not be read, never that there are none", () => {
    window.localStorage.setItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY, "{broken");
    render(<MhaClockPage forms={forms} now={now} />);
    expect(screen.getByTestId("mha-clock-unreadable")).toHaveTextContent("Clocks could not be read on this phone.");
    expect(screen.queryByTestId("mha-clock-empty")).toBeNull();
  });

  it("says clocks are kept until removed or sign-out", () => {
    render(<MhaClockPage forms={forms} now={now} />);
    expect(screen.getByTestId("mha-clock-retention")).toHaveTextContent("Kept until you remove it or sign out.");
    expect(screen.getByTestId("mha-clock-retention")).not.toHaveTextContent(/end of your shift/);
  });

  it("shows exactly what the timeframe engine allows, never a time it withholds", () => {
    addMhaClock("2", new Date(now.getTime() - 60 * 60_000));
    render(<MhaClockPage forms={forms} now={now} />);
    const [clock] = loadMhaClocks();
    const engine = mhaTimers([{ timerId: clock.id, formCode: "2", madeAt: new Date(clock.madeAt) }], now);
    const countdowns = engine.items.filter((item) => item.kind === "countdown");
    expect(screen.queryAllByTestId("mha-clock-countdown")).toHaveLength(countdowns.length);
    expect(screen.queryAllByTestId("mha-clock-quote-only")).toHaveLength(engine.items.length - countdowns.length);
  });

  it("refuses a start time later than now", () => {
    render(<MhaClockPage forms={forms} now={now} />);
    fireEvent.change(screen.getByTestId("mha-clock-form"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("mha-clock-time"), { target: { value: "2026-10-05T19:00" } });
    fireEvent.click(screen.getByTestId("mha-clock-start"));
    expect(screen.getByTestId("mha-clock-message")).toHaveTextContent("later than now");
    expect(loadMhaClocks()).toEqual([]);
  });
});

describe("Psychiatry hub · For a shift", () => {
  const counts = { dsm: 1, differentials: 1, presentations: 1, specifiers: 1, formulation: 1, therapy: 1, forms: 1 };

  it("links the MHA clock with this device's running count and form codes", () => {
    addMhaClock("2", now);
    addMhaClock("3A", now);
    render(<PsychiatryHome counts={counts} now={now} />);
    const link = screen.getByTestId("psychiatry-shift-mha-clock");
    expect(link.getAttribute("href")).toBe("/psychiatry/mha-clock");
    expect(screen.getByTestId("psychiatry-shift-mha-summary")).toHaveTextContent(
      "2 running on this phone · Forms 2 and 3A",
    );
  });

  it("signposts Medicines instead of copying Medication and Calculators", () => {
    render(<PsychiatryHome counts={counts} now={now} />);
    const actions = within(screen.getByRole("list", { name: "Quick actions" }));
    expect(actions.queryByText("Medication")).toBeNull();
    expect(actions.queryByText("Calculators")).toBeNull();
    expect(actions.getByText("Safety plan")).toBeTruthy();
    expect(actions.getByText("First Nations")).toBeTruthy();
    expect(screen.getByTestId("psychiatry-medicines-signpost").getAttribute("href")).toBe("/medicines");
  });
});
