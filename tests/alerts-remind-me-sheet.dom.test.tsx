// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RemindMeSheet } from "@/components/alerts/remind-me-sheet";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Remind me sheet", () => {
  it("keeps the picked time while the clock moves on", async () => {
    // 15:29 Perth: 17:00 is still offered.
    const before = new Date("2026-10-05T07:29:00Z");
    const { rerender } = render(<RemindMeSheet open onClose={() => undefined} now={before} shiftEndsAt={null} />);
    await userEvent.click(screen.getByRole("radio", { name: /17:00/ }));
    // 15:31 Perth: 17:00 would no longer be offered if the choices were re-worked.
    rerender(
      <RemindMeSheet open onClose={() => undefined} now={new Date("2026-10-05T07:31:00Z")} shiftEndsAt={null} />,
    );
    expect(screen.getByRole("radio", { name: /17:00/ }).getAttribute("aria-checked")).toBe("true");
  });
});
