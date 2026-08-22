import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

// Mirrors tests/mode-nav.dom.test.tsx and tests/ward-flow-clock-consistency.dom.test.tsx:
// WardModeWorkspace renders next/link anchors and this suite never checks routing itself, so a
// plain <a> avoids requiring an App Router context jsdom cannot provide.
import { vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { useWardFlow, WardFlowProvider } from "@/components/ward-management/ward-flow-provider";
import { WardModeWorkspace } from "@/components/ward-management/ward-management-modes";
import { eligibleCandidates } from "@/components/ward-management/ward-derivations";
import { wardMovements } from "@/components/ward-management/ward-movements";
import { NOW_ANCHOR } from "@/components/ward-management/ward-sites";

const FIRST_MOVEMENT = wardMovements[0]!;
// Same call the app itself makes for the "top candidate" the decision panel falls back to when
// nothing has been referred yet, computed here only to build a real, valid dispatch payload —
// not to assert against production's own output.
const TOP_CANDIDATE_ID = eligibleCandidates(FIRST_MOVEMENT, NOW_ANCHOR, 1)[0]!.unit.id;

/** Dispatches a real REFER_TO_UNITS event from a sibling of QueueView, mirroring `ClockAdvancer`
 * in tests/ward-flow-clock-consistency.dom.test.tsx and `DispatchProbe` in
 * tests/ward-flow-provider.dom.test.tsx. Nothing QueueView itself renders today dispatches to the
 * reducer (Task 6 fix round 3, Finding 2), so this is the only way to prove `movements` can change
 * out from under an already-selected row without navigating away and remounting the page. */
function ReferFirstMovement() {
  const { dispatch, now } = useWardFlow();
  return (
    <button
      type="button"
      onClick={() =>
        dispatch({
          type: "REFER_TO_UNITS",
          role: "coordinator",
          now,
          movementId: FIRST_MOVEMENT.id,
          unitIds: [TOP_CANDIDATE_ID],
        })
      }
    >
      refer first movement
    </button>
  );
}

describe("queue view selected-movement derivation", () => {
  /**
   * Task 6 fix round 3, Finding 2. `QueueView` used to hold the selected movement as
   * `useState(movements[0])` — the object itself, captured once at mount. A dispatch that later
   * changed that exact record (nothing on this route triggers one today, but a sibling route or a
   * future control easily could, since they all share one `WardFlowProvider`) would never be
   * reflected here: the decision panel would keep rendering the record's pre-dispatch fields
   * forever, the "captured once, silently stale" shape this whole task exists to remove. The fix
   * holds only the id and derives the record with `movements.find(...)`, matching
   * `WardNetworkWorkspace`. This test proves the derivation is live by mutating the selected
   * movement's own referral state after mount and reading the decision panel again, without
   * navigating (a `page.goto()`/remount would trivially "fix" a stale-capture bug by reseeding
   * state, so this stays on one render tree throughout, exactly like the sibling clock test).
   */
  it("reflects a referral made after mount, not the movement object captured at mount", () => {
    render(
      <WardFlowProvider initialNow={NOW_ANCHOR}>
        <WardModeWorkspace mode="queue" />
        <ReferFirstMovement />
      </WardFlowProvider>,
    );

    // WF-001 (movements[0]) is auto-selected on mount and has no recorded destination yet, so the
    // decision panel reads its own top candidate as a suggestion, not a recorded destination.
    // `getByRole("heading", ...)` (not `getByText`) because the id also appears in the queue
    // table's own row button, and both must legitimately stay on screen at once.
    expect(screen.getByRole("heading", { name: FIRST_MOVEMENT.id })).toBeInTheDocument();
    expect(screen.getByText("Suggested destination")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "refer first movement" }));

    // Once the movement carries a real, recorded referral to the same unit, that unit is no
    // longer a suggestion — it is the recorded destination, so the badge flips to "Eligibility
    // check" (the exact wording the coordinator's own manual browser pass observed for this same
    // transition — see the report's fix round 1 Step 6). A `selected` object frozen at mount would
    // never see the referral (its own `referredUnitIds` would stay empty forever), so the badge
    // would incorrectly keep reading "Suggested destination".
    expect(screen.getByText("Eligibility check")).toBeInTheDocument();
    expect(screen.queryByText("Suggested destination")).not.toBeInTheDocument();
  });
});
