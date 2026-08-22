import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

// Mirrors tests/mode-nav.dom.test.tsx: WardModeWorkspace renders next/link anchors and this
// suite never checks routing itself, so a plain <a> avoids requiring an App Router context
// jsdom cannot provide.
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { useWardFlow, WardFlowProvider } from "@/components/ward-management/ward-flow-provider";
import { WardModeWorkspace } from "@/components/ward-management/ward-management-modes";
import { NOW_ANCHOR } from "@/components/ward-management/ward-sites";

/** A minimal control that raises the same `ADVANCE_CLOCK` demo event Task 12's demo controls
 * will dispatch, so this test can move the shared clock without reaching into the reducer
 * directly. Mirrors `DispatchProbe` in ward-flow-provider.dom.test.tsx. */
function ClockAdvancer({ minutes }: { minutes: number }) {
  const { now, dispatch } = useWardFlow();
  return (
    <button type="button" onClick={() => dispatch({ type: "ADVANCE_CLOCK", role: "demo", now, minutes })}>
      advance clock
    </button>
  );
}

describe("clock consistency across routes", () => {
  /**
   * Task 6 fix round 1. The movements/units rewire alone was not enough: all three files this
   * task touches still read the frozen `NOW_ANCHOR` constant for waiting times, eligibility,
   * and capacity freshness. That meant a clock advance on the coordinator screen (Task 12's
   * demo controls dispatch `ADVANCE_CLOCK`, which the provider folds into `clockOffsetMinutes`
   * and therefore into the live `now` every screen reads) would leave every other route's
   * displayed wait time frozen at import time forever — the same "two screens disagree about
   * one patient" defect this task exists to fix, just moved from the movement record onto the
   * clock instead. Every other Task 6 test pins the clock with `initialNow` and never moves it,
   * so none of them could have caught this; this is deliberately the first test in this task
   * that advances the clock after render and reads a live surface again.
   *
   * WF-001 opened at `NOW_ANCHOR - 95` and carries no closure or acceptance, so at the pinned
   * `NOW_ANCHOR` its "waiting" label on the movements board reads `1h 35m waiting`. Advancing
   * the shared clock 60 minutes must move that label to `2h 35m waiting` — proof that
   * `ward-management-modes.tsx` (a different route file from the coordinator screen) reads the
   * same live `now` the provider ticks forward, not a value frozen at the moment this route
   * first rendered.
   */
  it("moves the movements board's waiting time when the shared clock advances", () => {
    render(
      <WardFlowProvider initialNow={NOW_ANCHOR}>
        <WardModeWorkspace mode="movements" />
        <ClockAdvancer minutes={60} />
      </WardFlowProvider>,
    );

    const cardBefore = screen.getByText("WF-001").closest("a");
    if (!cardBefore) throw new Error("WF-001 movement card not found before the clock advance");
    expect(cardBefore).toHaveTextContent("1h 35m waiting");

    fireEvent.click(screen.getByRole("button", { name: "advance clock" }));

    const cardAfter = screen.getByText("WF-001").closest("a");
    if (!cardAfter) throw new Error("WF-001 movement card not found after the clock advance");
    expect(cardAfter).toHaveTextContent("2h 35m waiting");
    expect(cardAfter).not.toHaveTextContent("1h 35m waiting");
  });
});
