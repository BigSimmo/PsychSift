/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ConfirmSheet } from "@/components/open-shifts/open-shifts-confirm";

afterEach(cleanup);

function renderSheet(open: boolean, onConfirm: () => Promise<string | null>) {
  return (
    <ConfirmSheet
      open={open}
      onClose={() => undefined}
      title="Decline this claim?"
      confirmLabel="Yes, decline"
      busyLabel="Declining"
      onConfirm={onConfirm}
      testId="confirm-sheet"
    >
      <p>The doctor is told.</p>
    </ConfirmSheet>
  );
}

it("is ready again when reopened after a success, not stuck busy", async () => {
  const onConfirm = async () => null;
  const view = render(renderSheet(true, onConfirm));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Yes, decline" }));
  });
  // The page closes the sheet on success but keeps it mounted.
  view.rerender(renderSheet(false, onConfirm));
  view.rerender(renderSheet(true, onConfirm));

  const confirm = screen.getByRole("button", { name: "Yes, decline" });
  expect(confirm.hasAttribute("disabled")).toBe(false);
  expect(confirm.getAttribute("aria-busy")).not.toBe("true");
  expect(screen.getByRole("button", { name: "Go back" }).hasAttribute("disabled")).toBe(false);
});
