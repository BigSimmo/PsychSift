/** @vitest-environment jsdom */

// Psychiatry · MHA clock once the owner's countdown switch is on. The switch is off on main, so the
// timeframe engine is wrapped here to return a countdown for Form 2 exactly as it would when signed.
// A passed limit must read as passed, in the warning colour, on the card and in the count line; a
// running one shows the time left. Form 3A stays quote-only whatever the switch says.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/psychiatry/mha-clock",
}));

vi.mock("@/lib/on-call/mha-timers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/on-call/mha-timers")>();
  return {
    ...actual,
    mhaTimers: (...args: Parameters<typeof actual.mhaTimers>) => {
      const [inputs, now] = args;
      const result = actual.mhaTimers(...args);
      return {
        ...result,
        items: result.items.map((item) => {
          const input = inputs.find((candidate) => candidate.timerId === item.timerId);
          if (!input || input.formCode !== "2" || item.kind !== "quote-only") return item;
          const deadline = new Date(input.madeAt.getTime() + 6 * 60 * 60_000);
          return {
            kind: "countdown" as const,
            timerId: item.timerId,
            entry: item.entry,
            deadline,
            remainingMs: deadline.getTime() - now.getTime(),
            expired: deadline.getTime() <= now.getTime(),
            occurrence: 1,
            repeatsEveryHours: null,
          };
        }),
      };
    },
  };
});

import {
  MhaClockPage,
  mhaClockDuration,
  mhaClockWhen,
  type MhaClockForm,
} from "@/components/psychiatry/mha-clock-page";
import { addMhaClock, clearMhaClocks } from "@/lib/psychiatry-hub/mha-clocks";

const forms: MhaClockForm[] = [
  { code: "2", title: "Detain voluntary inpatient for assessment", slug: "form-2" },
  { code: "3A", title: "Detention to enable examination or movement", slug: "detention-examination-movement" },
];
const madeForm2 = new Date("2026-10-04T15:40:00Z"); // Sun 23:40 Perth
const madeForm3A = new Date("2026-10-04T17:55:00Z"); // Mon 01:55 Perth

beforeEach(() => {
  window.localStorage.clear();
  clearMhaClocks();
  addMhaClock("2", madeForm2);
  addMhaClock("3A", madeForm3A);
});
afterEach(cleanup);

describe("MHA clock with countdowns signed", () => {
  it("shows the time left on a running limit, and Form 3A stays quote-only", () => {
    render(<MhaClockPage forms={forms} now={new Date("2026-10-04T18:50:00Z")} />); // Mon 02:50
    const [form2, form3A] = screen.getAllByTestId("mha-clock-card");
    const countdown = within(form2).getByTestId("mha-clock-countdown");
    expect(countdown).toHaveTextContent("Time limit");
    expect(countdown).toHaveTextContent("Mon 05:40");
    expect(countdown).toHaveTextContent("2 h 50 min left");
    expect(countdown).not.toHaveAttribute("data-passed");
    expect(within(form3A).queryByTestId("mha-clock-countdown")).toBeNull();
    expect(within(form3A).getAllByTestId("mha-clock-quote-only").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("mha-clock-passed-count")).toBeNull();
  });

  it("marks a passed limit as passed, in red, on the card and in the count line", () => {
    render(<MhaClockPage forms={forms} now={new Date("2026-10-04T22:10:00Z")} />); // Mon 06:10
    const countdown = screen.getByTestId("mha-clock-countdown");
    expect(countdown).toHaveTextContent("Time limit passed");
    expect(countdown).toHaveTextContent("30 min ago");
    expect(countdown).toHaveAttribute("data-passed", "true");
    expect(countdown.className).toContain("--danger-text");
    expect(screen.getByTestId("mha-clock-passed-count")).toHaveTextContent("· 1 time limit passed");
    expect(screen.getAllByTestId("mha-clock-meta")[0]).toHaveTextContent("Made Sun 23:40 · 6 h 30 min running");
  });
});

describe("MHA clock wording helpers", () => {
  const nowMs = new Date("2026-10-04T18:50:00Z").getTime();

  it("names the day for times within six days, and the date beyond", () => {
    expect(mhaClockWhen(madeForm2, nowMs)).toBe("Sun 23:40");
    expect(mhaClockWhen(new Date("2026-09-20T01:00:00Z"), nowMs)).toContain("20 Sep 2026");
  });

  it("writes durations in hours and minutes, never as a clock time", () => {
    expect(mhaClockDuration(45 * 60_000)).toBe("45 min");
    expect(mhaClockDuration(190 * 60_000)).toBe("3 h 10 min");
    expect(mhaClockDuration(72 * 60 * 60_000)).toBe("72 h");
  });
});
