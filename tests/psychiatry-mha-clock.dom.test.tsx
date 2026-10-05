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
import { MhaClockPage, mhaClockHandoverText, type MhaClockForm } from "@/components/psychiatry/mha-clock-page";
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
  keepReadableMhaClocks,
  removeMhaClock,
  restoreMhaClock,
  subscribeMhaClocks,
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
        { id: "abcdefgh-1", formCode: "2", madeAt: 1, label: "Bed 4 JS" },
        { id: "x", formCode: "2", madeAt: 1 },
        { id: "abcdefgh-2", formCode: "<b>", madeAt: 1 },
      ],
    });
    expect(parseMhaClocks(raw)).toEqual([{ id: "abcdefgh-1", formCode: "2", madeAt: 1 }]);
    expect(parseMhaClocks("{nope")).toEqual([]);
    expect(parseMhaClockState(raw).unreadable).toBe(true);
    expect(parseMhaClockState("{nope").unreadable).toBe(true);
    const outOfRange = parseMhaClockState(
      JSON.stringify({ v: 1, clocks: [{ id: "abcdefgh-1", formCode: "2", madeAt: Number.MAX_VALUE }] }),
    );
    expect(outOfRange).toEqual({ clocks: [], unreadable: true });
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
    const listener = vi.fn();
    subscribeMhaClocks(listener)();
    expect(listener).toHaveBeenCalled();
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

  it("moves an old value it cannot fully read across as it was, so the page says it could not be read", () => {
    const good = { id: "abcdefgh-1", formCode: "2", madeAt: 1 };
    const legacy = JSON.stringify({ v: 1, clocks: [good, { id: "x", formCode: "2" }] });
    writePatientLabels(LEGACY_MHA_CLOCK_STORE_NAME, legacy);
    subscribeMhaClocks(() => undefined)();
    expect(window.localStorage.getItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY)).toBe(legacy);
    expect(readPatientLabels(LEGACY_MHA_CLOCK_STORE_NAME)).toBeNull();
    expect(loadMhaClockState()).toEqual({ clocks: [good], unreadable: true });
  });

  it("leaves the old copy where it is when the new store will not save", () => {
    writePatientLabels(LEGACY_MHA_CLOCK_STORE_NAME, JSON.stringify({ v: 1, clocks: [{ id: "x", formCode: "2" }] }));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    try {
      subscribeMhaClocks(() => undefined)();
    } finally {
      setItem.mockRestore();
    }
    expect(readPatientLabels(LEGACY_MHA_CLOCK_STORE_NAME)).not.toBeNull();
    expect(window.localStorage.getItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY)).toBeNull();
  });

  it("drops nothing when the reader keeps the readable clocks but storage refused even the read", () => {
    window.localStorage.setItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY, "{broken");
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(keepReadableMhaClocks()).toBe(false);
    } finally {
      getItem.mockRestore();
    }
    expect(window.localStorage.getItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY)).toBe("{broken");
  });

  it("refuses every change while some clocks cannot be read, until the reader keeps the readable ones", () => {
    const good = { id: "abcdefgh-1", formCode: "2", madeAt: 1 };
    const raw = JSON.stringify({ v: 1, clocks: [good, { id: "bad" }] });
    window.localStorage.setItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY, raw);
    expect(addMhaClock("3A", now)).toBe("unreadable");
    expect(removeMhaClock(good.id)).toBe(false);
    expect(restoreMhaClock({ ...good, id: "abcdefgh-2" })).toBe("unreadable");
    expect(window.localStorage.getItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY)).toBe(raw);
    expect(keepReadableMhaClocks()).toBe(true);
    expect(loadMhaClockState()).toEqual({ clocks: [good], unreadable: false });
    expect(addMhaClock("3A", now)).toBe("added");
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
      [
        "As at Mon 5 Oct 2026, 18:00 (Perth time)",
        "Form 2 · made Sun 4 Oct 2026, 23:40 (Perth time)",
        "Form 3A · made Mon 5 Oct 2026, 01:55 (Perth time)",
        MHA_TIMELINE_REFERENCE_NOTE,
      ].join("\n"),
    );
  });

  it("says when clocks could not be read, never that there are none", () => {
    window.localStorage.setItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY, "{broken");
    render(<MhaClockPage forms={forms} now={now} />);
    expect(screen.getByTestId("mha-clock-unreadable")).toHaveTextContent("Clocks could not be read on this phone.");
    expect(screen.queryByTestId("mha-clock-empty")).toBeNull();
    act(() => {
      fireEvent.click(screen.getByTestId("mha-clock-keep-readable"));
    });
    expect(screen.queryByTestId("mha-clock-unreadable")).toBeNull();
    expect(screen.getByTestId("mha-clock-empty")).toBeTruthy();
  });

  it("says so when the browser will not save the choice to keep the readable clocks", () => {
    window.localStorage.setItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY, "{broken");
    render(<MhaClockPage forms={forms} now={now} />);
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      act(() => {
        fireEvent.click(screen.getByTestId("mha-clock-keep-readable"));
      });
    } finally {
      removeItem.mockRestore();
    }
    expect(screen.getByTestId("mha-clock-unreadable")).toBeTruthy();
    expect(screen.getByTestId("mha-clock-undo")).toHaveTextContent("This browser would not save the change.");
  });

  it("says in the handover copy that some clocks could not be read, so the list never looks complete", () => {
    const good = { id: "abcdefgh-1", formCode: "2", madeAt: new Date("2026-10-04T15:40:00Z").getTime() };
    window.localStorage.setItem(
      PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY,
      JSON.stringify({ v: 1, clocks: [good, { id: "bad" }] }),
    );
    render(<MhaClockPage forms={forms} now={now} />);
    expect(screen.getByTestId("mha-clock-handover-lines")).toHaveTextContent(
      "Clocks could not be read on this phone. Check the others against the paperwork.",
    );
    expect(mhaClockHandoverText([good], now.getTime(), true).split("\n")[1]).toBe(
      "Clocks could not be read on this phone. Check the others against the paperwork.",
    );
  });

  it("keeps Undo on screen while it has focus, and starts the countdown again when focus leaves", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      addMhaClock("2", new Date("2026-10-05T09:00:00Z"));
      render(<MhaClockPage forms={forms} now={now} />);
      act(() => {
        fireEvent.click(screen.getByTestId("mha-clock-remove"));
      });
      act(() => {
        fireEvent.focus(screen.getByTestId("mha-clock-undo-button"));
        vi.advanceTimersByTime(20_000);
      });
      expect(screen.getByTestId("mha-clock-undo")).toBeTruthy();
      act(() => {
        fireEvent.blur(screen.getByTestId("mha-clock-undo-button"));
        vi.advanceTimersByTime(8_000);
      });
      expect(screen.queryByTestId("mha-clock-undo")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Undo while focus or the pointer remains, and only counts down once both have left", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      addMhaClock("2", new Date("2026-10-05T09:00:00Z"));
      render(<MhaClockPage forms={forms} now={now} />);
      act(() => {
        fireEvent.click(screen.getByTestId("mha-clock-remove"));
      });
      const bar = () => screen.getByTestId("mha-clock-undo");
      act(() => {
        fireEvent.pointerEnter(bar());
        fireEvent.focus(screen.getByTestId("mha-clock-undo-button"));
        fireEvent.pointerLeave(bar());
        vi.advanceTimersByTime(20_000);
      });
      expect(bar()).toBeTruthy();
      act(() => {
        fireEvent.pointerEnter(bar());
        fireEvent.blur(screen.getByTestId("mha-clock-undo-button"));
        vi.advanceTimersByTime(20_000);
      });
      expect(bar()).toBeTruthy();
      act(() => {
        fireEvent.pointerLeave(bar());
        vi.advanceTimersByTime(8_000);
      });
      expect(screen.queryByTestId("mha-clock-undo")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never puts a removed clock back after the account changes", () => {
    addMhaClock("2", new Date(now.getTime() - 60 * 60_000));
    render(<MhaClockPage forms={forms} now={now} />);
    act(() => {
      fireEvent.click(screen.getByTestId("mha-clock-remove"));
    });
    expect(screen.getByTestId("mha-clock-undo-button")).toBeTruthy();
    act(() => {
      clearAccountScopedBrowserStorage();
    });
    expect(screen.queryByTestId("mha-clock-undo-button")).toBeNull();
    expect(loadMhaClocks()).toEqual([]);
  });

  it("links the Act itself beside the reference line", () => {
    render(<MhaClockPage forms={forms} now={now} />);
    expect(screen.getByTestId("mha-clock-act-link")).toHaveTextContent("Mental Health Act 2014 (WA)");
    expect(screen.getByTestId("mha-clock-act-link").getAttribute("target")).toBe("_blank");
  });

  it("says clocks are kept until removed or sign-out", () => {
    render(<MhaClockPage forms={forms} now={now} />);
    expect(screen.getByTestId("mha-clock-retention")).toHaveTextContent(
      "Kept until you remove it or you are signed out.",
    );
    expect(screen.getByTestId("mha-clock-retention")).not.toHaveTextContent(/end of your shift/);
  });

  it("shows exactly what the timeframe engine allows, never a time it withholds", () => {
    addMhaClock("2", new Date(now.getTime() - 60 * 60_000));
    render(<MhaClockPage forms={forms} now={now} />);
    const [clock] = loadMhaClocks();
    const engine = mhaTimers([{ timerId: clock.id, formCode: "2", madeAt: new Date(clock.madeAt) }], now);
    // The page shows each limit once (a recurring review only at its next deadline).
    const shown = [...new Map(engine.items.map((item) => [`${item.timerId}:${item.entry.id}`, item])).values()];
    const countdowns = shown.filter((item) => item.kind === "countdown");
    expect(screen.queryAllByTestId("mha-clock-countdown")).toHaveLength(countdowns.length);
    expect(screen.queryAllByTestId("mha-clock-quote-only")).toHaveLength(shown.length - countdowns.length);
  });

  it("keeps the reader's half-typed time rather than snapping back to now", () => {
    render(<MhaClockPage forms={forms} now={now} />);
    const time = screen.getByTestId("mha-clock-time") as HTMLInputElement;
    expect(time.value).toBe("2026-10-05T18:00");
    fireEvent.change(time, { target: { value: "" } });
    expect(time.value).toBe("");
    fireEvent.change(screen.getByTestId("mha-clock-form"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("mha-clock-start"));
    expect(screen.getByTestId("mha-clock-message")).toHaveTextContent("Choose a form and enter when it was made.");
    expect(time).toHaveAttribute("aria-invalid", "true");
    expect(loadMhaClocks()).toEqual([]);
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

  it("says the clocks could not be read, never that none are running", () => {
    window.localStorage.setItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY, "{broken");
    render(<PsychiatryHome counts={counts} now={now} />);
    expect(screen.getByTestId("psychiatry-shift-mha-summary")).toHaveTextContent(
      "Clocks could not be read on this phone",
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
