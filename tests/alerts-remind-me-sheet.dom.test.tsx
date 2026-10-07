// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RemindMeSheet } from "@/components/alerts/remind-me-sheet";
import { useRemindMe } from "@/components/alerts/use-remind-me";
import { REMIND_ME_STORAGE_KEY } from "@/lib/account-scoped-browser-state";

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

  it("refuses what the shared patient-detail check catches, look-alike letters included", async () => {
    // Final review (7 Oct 2026): the sheet used the reminder's own patterns, so a Cyrillic "М" in "Мr Smith"
    // and "Patient John" could be saved. It now reads the one shared check.
    render(<RemindMeSheet open onClose={() => undefined} now={new Date("2026-10-05T01:00:00Z")} shiftEndsAt={null} />);
    const field = screen.getByLabelText("What to remind you about");
    for (const text of ["Check the \u041Cr Smith letter", "Patient John bloods", "bed twelve obs"]) {
      await userEvent.clear(field);
      await userEvent.type(field, text);
      expect(screen.getByTestId("remind-me-problem"), text).toBeTruthy();
      expect((screen.getByTestId("remind-me-save") as HTMLButtonElement).disabled, text).toBe(true);
    }
    await userEvent.clear(field);
    await userEvent.type(field, "Ask switchboard for the new pager list");
    expect(screen.queryByTestId("remind-me-problem")).toBeNull();
  });

  it("drops a stored note that only the shared patient-detail check catches", () => {
    // A note kept before the shared check reached Remind me must not stay on the device.
    const note = (id: string, text: string) => ({
      id,
      text,
      dueAt: "2099-10-05T09:00:00.000Z",
      createdAt: "2026-10-05T01:00:00.000Z",
      doneAt: null,
    });
    window.localStorage.setItem(
      REMIND_ME_STORAGE_KEY,
      JSON.stringify([note("a", "Patient John bloods"), note("b", "Ask switchboard for the new pager list")]),
    );
    const { result } = renderHook(() => useRemindMe());
    expect(result.current.reminders.map((item) => item.text)).toEqual(["Ask switchboard for the new pager list"]);
    expect(window.localStorage.getItem(REMIND_ME_STORAGE_KEY)).not.toContain("Patient John");
  });
});
