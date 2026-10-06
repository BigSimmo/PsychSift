/** @vitest-environment jsdom */

// My Day's CPD card, once the logged hours meet the target. It says the hours are
// logged, never "Target reached": the app cannot tell whether a CPD home's
// requirements are met, so the card must not read as that verdict.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CpdSummary } from "@/components/my-day/my-day-today-cards";

afterEach(cleanup);

describe("My Day CPD wording", () => {
  it("says the target hours are logged, not that the target is reached", () => {
    render(
      <CpdSummary loggedHours={52} targetHours={50} byCategory={{ educational: 30, reviewing: 12, measuring: 10 }} />,
    );
    const card = screen.getByTestId("my-day-cpd");
    expect(card.textContent).toContain("Target hours logged");
    expect(card.textContent).toContain("Your target hours are logged.");
    expect(card.textContent).not.toMatch(/target reached/i);
  });

  it("still counts down while hours are short", () => {
    render(
      <CpdSummary loggedHours={32} targetHours={50} byCategory={{ educational: 20, reviewing: 8, measuring: 4 }} />,
    );
    expect(screen.getByTestId("my-day-cpd").textContent).toContain("18 hours to go by 31 December.");
  });
});
