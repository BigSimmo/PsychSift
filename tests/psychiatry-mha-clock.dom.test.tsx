/** @vitest-environment jsdom */

// Psychiatry · MHA clock. A clock holds a form code and a time only, lives in the shift-scoped
// patient-label store (so it clears at shift end and sign-out), and every time limit on the page
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
import { clearPatientLabels, PATIENT_LABEL_KEY_PREFIX } from "@/lib/patient-label-storage";
import {
  addMhaClock,
  clearMhaClocks,
  loadMhaClocks,
  MHA_CLOCK_LIMIT,
  parseMhaClocks,
  removeMhaClock,
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
  it("keeps a form code and a time only, in the patient-label namespace", () => {
    expect(addMhaClock("3A", new Date(now.getTime() - 45 * 60_000))).toBe("added");
    const [clock] = loadMhaClocks();
    expect(Object.keys(clock).sort()).toEqual(["formCode", "id", "madeAt"]);
    const keys = Object.keys(window.localStorage);
    expect(keys.every((key) => key.startsWith(PATIENT_LABEL_KEY_PREFIX))).toBe(true);
    removeMhaClock(clock.id);
    expect(loadMhaClocks()).toEqual([]);
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
  });

  it("is wiped with every other shift record", () => {
    addMhaClock("2", now);
    clearPatientLabels("account-transition");
    expect(loadMhaClocks()).toEqual([]);
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
    expect(card).toHaveTextContent("Made 17:15 · running 0:45");
    expect(screen.getByTestId("mha-clock-count")).toHaveTextContent("1");
    expect(within(card).getByRole("link", { name: "Open Form 3A" }).getAttribute("href")).toBe(
      "/forms/detention-examination-movement",
    );

    act(() => {
      fireEvent.click(within(card).getByTestId("mha-clock-remove"));
    });
    expect(screen.queryByTestId("mha-clock-card")).toBeNull();
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
    expect(link).toHaveTextContent("2 running");
    expect(screen.getByTestId("psychiatry-shift-mha-summary")).toHaveTextContent("Forms 2, 3A");
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
