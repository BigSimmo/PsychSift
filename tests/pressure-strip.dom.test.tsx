import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PressureStrip } from "@/components/ward-management/coordinator/pressure-strip";

/**
 * `edPressure` clamps `longestWaitMinutes` to 0 for a department with nobody waiting — a
 * correct internal value, but "0 waiting · longest 0m" is a plausible-looking duration for a
 * department where no duration exists to measure (Task 4 review Important 5). No fixture
 * department is currently quiet, so this was latent: nothing would have caught it reaching a
 * screen. `movements={[]}` makes every one of the 8 departments quiet without waiting for the
 * live fixture to grow one, using `PressureStrip`'s test-only injection point (mirrors
 * `edPressure`'s own `(now, movements)` parameter).
 */
describe("PressureStrip", () => {
  it("shows an explicit empty state for a department with nobody waiting, never a false duration", () => {
    render(<PressureStrip now={600} selectedEdId={undefined} onSelectEd={() => {}} movements={[]} />);

    const cards = screen.getAllByTestId(/^ward-ed-/);
    expect(cards).toHaveLength(8);
    for (const card of cards) {
      expect(card).toHaveTextContent(/no patients waiting/i);
      expect(card).not.toHaveTextContent(/longest/i);
      expect(card).not.toHaveTextContent(/0 waiting/i);
    }
  });
});
