/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PatientSafetyPlan } from "@/components/patient-safety-plan";
import { WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";

// The tool header renders a NavigationBackButton that reads the router/pathname.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/safety-plan",
}));

const draftPattern = /this plan is incomplete/i;
const examplePattern = /example only|non-working contact numbers/i;
const exampleExportPattern =
  /\*\*\* EXAMPLE — SAMPLE SAFETY PLAN WITH NON-WORKING NUMBERS, NOT FOR PATIENT HANDOVER \*\*\*/;

describe("PatientSafetyPlan — incomplete-plan draft guard", () => {
  it("sits inside the search shell, which owns the top inset and the skip target", () => {
    // /safety-plan renders inside the (search-app) shell, so the shell header owns the
    // OS top inset and #main-content. The tool must not duplicate either.
    const { container } = render(<PatientSafetyPlan />);
    const header = container.querySelector('[data-testid="safety-plan-tool-header"]');
    expect(header).toBeTruthy();
    const className = header?.getAttribute("class") ?? "";
    expect(className).not.toContain("safe-area-top");
    expect(className).not.toMatch(/(?:^|\s)py-\S+/);
    expect(className).not.toMatch(/(?:^|\s)sm:py-\S+/);
    expect(container.querySelector("#main-content")).toBeNull();
    // The patient copy is the print output, so the shell chrome never prints.
    expect(container.querySelector("[data-safety-plan-copy]")?.hasAttribute("data-print-output")).toBe(true);
    expect(screen.getByRole("heading", { name: /Safety plan generator/i })).toBeTruthy();
  });

  it("flags the patient copy as a draft until every step is complete", async () => {
    render(<PatientSafetyPlan />);

    // Blank plan — the patient copy is clearly marked a draft.
    expect(screen.getByText(draftPattern)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Finalise plan/i })).toBeDisabled();
  });

  it("keeps Load example non-shareable so fake crisis numbers cannot look print-ready", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<PatientSafetyPlan />);

    await user.click(screen.getByRole("button", { name: /Load example/ }));

    // Example seed fills every step, but must stay marked as example/draft —
    // SEED includes non-working numbers like 0400 000 000.
    expect(screen.getByText(examplePattern)).toBeTruthy();
    expect(screen.queryByText(/^Ready to share$/)).toBeNull();
    expect(screen.getByText(/Example — not for handover/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Finalise plan/i })).toBeDisabled();
    expect(screen.getAllByText(/0400 000 000/).length).toBeGreaterThan(0);

    // Date-only edits must not clear the example guard while seeded contacts remain.
    await user.type(screen.getByLabelText(/Plan date/i), "12 Aug 2026");
    expect(screen.getByText(examplePattern)).toBeTruthy();
    expect(screen.queryByText(/^Ready to share$/)).toBeNull();
    expect(screen.getByRole("button", { name: /Finalise plan/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^Copy$/ }));
    const copied = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(copied).toMatch(exampleExportPattern);
    expect(copied).toContain("0400 000 000");
    expect(copied.startsWith("*** EXAMPLE")).toBe(true);
  });

  it("keeps example mode while seeded rows remain after a partial contact edit", async () => {
    const user = userEvent.setup();
    render(<PatientSafetyPlan />);

    await user.click(screen.getByRole("button", { name: /Load example/ }));
    expect(screen.getByText(examplePattern)).toBeTruthy();

    // Rebuild the "People I can ask for help" contact step with a name but no phone.
    // Other seeded steps still contain SEED rows, so example mode must stay on.
    const supportStep = screen.getByRole("region", { name: "Step 4: People I can ask for help" });
    for (const remove of within(supportStep).getAllByRole("button", { name: /^Remove/ })) {
      await user.click(remove);
    }
    await user.type(within(supportStep).getByLabelText("Name & relationship"), "Sam — a friend");
    await user.click(within(supportStep).getByRole("button", { name: /^Add$/ }));

    expect(screen.getByText(examplePattern)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Finalise plan/i })).toBeDisabled();
  });

  it("marks an incomplete contact plan as a draft once every seeded row is gone", async () => {
    const user = userEvent.setup();
    render(<PatientSafetyPlan />);

    await user.click(screen.getByRole("button", { name: /Load example/ }));
    await user.click(screen.getByRole("button", { name: /Clear all/ }));

    const supportStep = screen.getByRole("region", { name: "Step 4: People I can ask for help" });
    await user.type(within(supportStep).getByLabelText("Name & relationship"), "Sam — a friend");
    await user.click(within(supportStep).getByRole("button", { name: /^Add$/ }));

    expect(screen.getByText(draftPattern)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Finalise plan/i })).toBeDisabled();
  });

  it("marks copied text as a draft when the plan is incomplete", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<PatientSafetyPlan />);
    expect(screen.getByText(draftPattern)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^Copy$/ }));
    expect(writeText).toHaveBeenCalled();
    const copied = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(copied).toMatch(/\*\*\* DRAFT — INCOMPLETE SAFETY PLAN, NOT FOR PATIENT HANDOVER \*\*\*/);
  });

  it("does not schedule copy feedback when clipboard settles after unmount", async () => {
    const user = userEvent.setup();
    let resolveWrite!: () => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = () => resolve();
        }),
    );
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    try {
      const { unmount } = render(<PatientSafetyPlan />);
      await user.click(screen.getByRole("button", { name: /^Copy$/ }));
      expect(writeText).toHaveBeenCalledTimes(1);

      const callsBeforeUnmount = setTimeoutSpy.mock.calls.length;
      unmount();
      await act(async () => {
        resolveWrite();
      });

      const feedbackTimers = setTimeoutSpy.mock.calls.slice(callsBeforeUnmount).filter((call) => call[1] === 1600);
      expect(feedbackTimers).toHaveLength(0);
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      } else {
        // `navigator.clipboard` is usually inherited; delete the shadowing test override.
        delete (navigator as { clipboard?: Clipboard }).clipboard;
      }
      setTimeoutSpy.mockRestore();
    }
  });

  it("clears the scheduled copy-feedback timer on unmount", async () => {
    vi.useFakeTimers();
    try {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
      const setTimeoutSpy = vi.spyOn(window, "setTimeout");

      const { unmount } = render(<PatientSafetyPlan />);
      // fireEvent avoids userEvent's real-timer waits under fake timers.
      fireEvent.click(screen.getByRole("button", { name: /^Copy$/ }));

      // Flush the resolved clipboard promise so the 1600ms reset is scheduled.
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByRole("button", { name: /^Copied$/ })).toBeTruthy();
      const feedbackTimers = setTimeoutSpy.mock.calls.filter((call) => call[1] === 1600);
      expect(feedbackTimers).toHaveLength(1);
      const timerHandle = setTimeoutSpy.mock.results.find(
        (result, index) => setTimeoutSpy.mock.calls[index]?.[1] === 1600,
      )?.value;

      const clearsBeforeUnmount = clearTimeoutSpy.mock.calls.length;
      unmount();
      expect(clearTimeoutSpy.mock.calls.slice(clearsBeforeUnmount).some((call) => call[0] === timerHandle)).toBe(true);

      // Advancing past the reset window must not throw after teardown
      // (original jsdom `window is not defined` / setState-after-unmount failure).
      expect(() => {
        act(() => {
          vi.advanceTimersByTime(2000);
        });
      }).not.toThrow();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("prints every WA/national crisis number from the shared module, on screen and in the copied plan", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<PatientSafetyPlan />);

    // Every one of the seven numbers appears exactly as WA_CRISIS_CONTACTS holds it.
    for (const contact of WA_CRISIS_CONTACTS) {
      expect(screen.getAllByText(new RegExp(contact.telephoneDisplay.replace(/\s/g, "\\s"))).length).toBeGreaterThan(0);
    }

    // A crisis number's stated limitation (e.g. "not an emergency service") must never be
    // shown separated from that number — a printed/copied plan is the one place this
    // prototype's "everything is synthetic" framing does not protect the reader.
    const contactsWithCaveat = WA_CRISIS_CONTACTS.filter((contact) => contact.caveat !== null);
    expect(contactsWithCaveat.length).toBeGreaterThan(0);
    for (const contact of contactsWithCaveat) {
      const numberNode = screen.getByText(new RegExp(contact.telephoneDisplay.replace(/\s/g, "\\s")));
      const listItem = numberNode.closest("li");
      expect(listItem, `${contact.name}'s number is not inside a list item with its caveat`).not.toBeNull();
      expect(within(listItem as HTMLElement).getByText(contact.caveat as string)).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: /^Copy$/ }));
    await act(async () => {
      await Promise.resolve();
    });
    const copied = String(writeText.mock.calls[0]?.[0] ?? "");
    for (const contact of WA_CRISIS_CONTACTS) {
      expect(copied, `${contact.name} (${contact.telephoneDisplay}) is missing from the copied plan`).toContain(
        contact.telephoneDisplay,
      );
    }

    // Adjacency in the copied plain text too: the caveat is the very next line after its
    // number's line, never separated by a blank line or another entry.
    const copiedLines = copied.split("\n");
    for (const contact of contactsWithCaveat) {
      const numberLineIndex = copiedLines.findIndex((line) => line.includes(contact.telephoneDisplay));
      expect(numberLineIndex, `${contact.name}'s number line is missing from the copied plan`).toBeGreaterThanOrEqual(
        0,
      );
      expect(
        copiedLines[numberLineIndex + 1]?.trim(),
        `${contact.name}'s caveat is not on the line immediately after its number in the copied plan`,
      ).toBe(contact.caveat);
    }
  });
});
