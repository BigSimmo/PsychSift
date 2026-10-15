/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NowOnCallHero } from "@/components/on-call/now/on-call-hero";
import type { OnCallShiftContext } from "@/lib/on-call/shift-context";

import { handbookItems } from "./helpers/on-call-handbook-fixtures";

// Now's summary hero (Work standard, owner 15 Oct 2026): the filled On Call card
// that opens the page, its main action a white "Call switchboard" pill.

afterEach(cleanup);

/** Tue 6 Oct 21:00 to Wed 7 Oct 08:00, Perth (UTC+8). */
const ROSTERED: OnCallShiftContext = {
  kind: "roster",
  shiftKey: "shift-1",
  period: "night",
  phase: "during",
  startsAt: "2026-10-06T13:00:00.000Z",
  endsAt: "2026-10-07T00:00:00.000Z",
};
const NO_SHIFT: OnCallShiftContext = { kind: "none", shiftKey: "clock", period: "night", phase: "unknown" };
const AT_0350 = new Date("2026-10-06T19:50:00.000Z"); // Wed 03:50 Perth
const [SWITCHBOARD] = handbookItems([{ id: "sw", title: "Switchboard", phone: "9000 0000" }]);

describe("NowOnCallHero", () => {
  it("leads with the time left on your rostered shift, its end and switchboard, and a white call pill", () => {
    render(
      <NowOnCallHero
        context={ROSTERED}
        answer={SWITCHBOARD!}
        hours={null}
        hospitalPeriod={null}
        hospitalName="Synthetic Hospital"
        handbookLoading={false}
        now={AT_0350}
      />,
    );
    const hero = screen.getByRole("region", { name: "On call summary" });
    expect(hero).toHaveClass("work-hero");
    expect(hero).toHaveTextContent("On call now · Synthetic Hospital");
    expect(hero).toHaveTextContent("4 h 10 min left");
    expect(hero).toHaveTextContent("Night shift ends Wed 08:00 · Switchboard");
    const call = within(hero).getByRole("link", { name: /^Call switchboard, / });
    expect(call).toHaveTextContent("Call switchboard");
    expect(call).toHaveAttribute("href", "tel:0890000000");
    expect(call).toHaveClass("work-hero__action");
  });

  it("says no rostered shift is on, and offers no number the hospital has not recorded", () => {
    render(
      <NowOnCallHero
        context={NO_SHIFT}
        answer={null}
        hours={null}
        hospitalPeriod={null}
        hospitalName={null}
        handbookLoading={false}
        now={AT_0350}
      />,
    );
    const hero = screen.getByTestId("on-call-now-hero");
    expect(hero).toHaveTextContent("Right now");
    expect(hero).toHaveTextContent("No rostered shift on now");
    expect(within(hero).queryByRole("link")).toBeNull();
    expect(hero.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("holds the pill's place while the handbook loads, so nothing moves under the thumb", () => {
    render(
      <NowOnCallHero
        context={NO_SHIFT}
        answer={null}
        hours={null}
        hospitalPeriod={null}
        hospitalName={null}
        handbookLoading
        now={AT_0350}
      />,
    );
    const hero = screen.getByTestId("on-call-now-hero");
    expect(hero.querySelector("[data-placeholder]")).toHaveAttribute("aria-hidden", "true");
    expect(within(hero).queryByRole("link")).toBeNull();
  });
});
