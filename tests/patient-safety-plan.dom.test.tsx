/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PatientSafetyPlan, SAFETY_PLAN_UNDO_MS } from "@/components/patient-safety-plan";
import { WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";
import { confirmShellNavigation } from "@/lib/navigation-guards";

// The tool header renders a NavigationBackButton that reads the router/pathname.
// One router for every render, as the App Router gives, so effects keyed on it run once.
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
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

  it("draws each step's count as a plain tinted number, not an input-like box, and names it for screen readers", () => {
    render(<PatientSafetyPlan />);
    const counts = screen.getAllByTestId("safety-plan-step-count");
    // Six steps plus Reasons for living, all empty on a blank plan.
    expect(counts).toHaveLength(7);
    for (const count of counts) {
      const className = count.getAttribute("class") ?? "";
      expect(className).not.toMatch(/(?:^|\s)border(?:\s|$|-)/);
      expect(className).not.toContain("shadow");
      expect(className).toContain("rounded-full");
      expect(className).toContain("text-xs");
    }
    expect(counts[0].textContent).toBe("00 entries");
    expect(within(counts[0]).getByText("0 entries")).toHaveClass("sr-only");
    expect(counts.at(-1)?.textContent).toBe("00 reasons");
  });

  it("flags the patient copy as a draft until every step is complete", async () => {
    render(<PatientSafetyPlan />);

    // Blank plan — the patient copy is clearly marked a draft.
    expect(screen.getByText(draftPattern)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Finalise plan/i })).toHaveAttribute("aria-disabled", "true");
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
    expect(screen.getByRole("button", { name: /Finalise plan/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText(/0400 000 000/).length).toBeGreaterThan(0);

    // Date-only edits must not clear the example guard while seeded contacts remain.
    await user.type(screen.getByLabelText(/Plan date/i), "12 Aug 2026");
    expect(screen.getByText(examplePattern)).toBeTruthy();
    expect(screen.queryByText(/^Ready to share$/)).toBeNull();
    expect(screen.getByRole("button", { name: /Finalise plan/i })).toHaveAttribute("aria-disabled", "true");

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
    await user.type(within(supportStep).getByPlaceholderText("Name & relationship"), "Sam — a friend");
    await user.click(within(supportStep).getByRole("button", { name: /^Add to / }));

    expect(screen.getByText(examplePattern)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Finalise plan/i })).toHaveAttribute("aria-disabled", "true");
  });

  it("marks an incomplete contact plan as a draft once every seeded row is gone", async () => {
    const user = userEvent.setup();
    render(<PatientSafetyPlan />);

    await user.click(screen.getByRole("button", { name: /Load example/ }));
    await user.click(screen.getByRole("button", { name: /Clear the plan/ }));

    const supportStep = screen.getByRole("region", { name: "Step 4: People I can ask for help" });
    await user.type(within(supportStep).getByPlaceholderText("Name & relationship"), "Sam — a friend");
    await user.click(within(supportStep).getByRole("button", { name: /^Add to / }));

    expect(screen.getByText(draftPattern)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Finalise plan/i })).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps Finalise plan reachable by keyboard while unavailable, and explains why", async () => {
    const user = userEvent.setup();
    render(<PatientSafetyPlan />);

    const finalise = screen.getByRole("button", { name: /Finalise plan/i });
    // aria-disabled keeps the tab stop; a native disabled button would drop it and hide the reason.
    expect(finalise).not.toBeDisabled();
    expect(finalise).toHaveAttribute("aria-disabled", "true");
    const reasonId = finalise.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId as string)?.textContent).toMatch(/Complete all 6 steps.*0 of 6 complete/);

    finalise.focus();
    expect(document.activeElement).toBe(finalise);

    // Activating it does nothing: the plan is not finalised.
    await user.keyboard("{Enter}");
    await user.click(finalise);
    expect(screen.queryByText(/^Plan finalised$/)).toBeNull();
  });

  it("names the example text, not the step count, as the blocker while the example is loaded", async () => {
    const user = userEvent.setup();
    render(<PatientSafetyPlan />);

    await user.click(screen.getByRole("button", { name: /Load example/ }));

    // The example fills all six steps, so a step count would read "6 of 6 complete" beside an off button.
    const finalise = screen.getByRole("button", { name: /Finalise plan/i });
    expect(finalise).toHaveAttribute("aria-disabled", "true");
    const reason = document.getElementById(finalise.getAttribute("aria-describedby") as string)?.textContent ?? "";
    expect(reason).toMatch(/Replace the example text/i);
    expect(reason).not.toMatch(/6 of 6/);
    expect(finalise.getAttribute("title")).toMatch(/Replace the example text/i);

    await user.click(finalise);
    expect(screen.queryByText(/^Plan finalised$/)).toBeNull();
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

describe("PatientSafetyPlan — Clear all and Copy feedback", () => {
  // fireEvent rather than userEvent: an earlier case in this file uses fake timers.
  // D26-24: no browser "are you sure" box; the plan clears at once and Undo brings it back.
  it("clears a plan with real entries at once and offers Undo for ten seconds", () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<PatientSafetyPlan />);

    const supportStep = screen.getByRole("region", { name: "Step 4: People I can ask for help" });
    fireEvent.change(within(supportStep).getByPlaceholderText("Name & relationship"), {
      target: { value: "Sam — a friend" },
    });
    fireEvent.click(within(supportStep).getByRole("button", { name: /^Add to / }));
    fireEvent.click(screen.getByRole("button", { name: /Clear the plan/ }));

    expect(confirm).not.toHaveBeenCalled();
    expect(within(supportStep).queryByText("Sam — a friend")).toBeNull();
    expect(screen.getByTestId("safety-plan-undo")).toHaveTextContent("Plan cleared");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(supportStep).getAllByText("Sam — a friend").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("safety-plan-undo")).toBeNull();
    confirm.mockRestore();
  });

  it("drops Undo once new work starts on the cleared plan", () => {
    render(<PatientSafetyPlan />);
    const supportStep = screen.getByRole("region", { name: "Step 4: People I can ask for help" });
    const field = () => within(supportStep).getByPlaceholderText("Name & relationship") as HTMLInputElement;
    fireEvent.change(field(), { target: { value: "Sam — a friend" } });
    fireEvent.click(within(supportStep).getByRole("button", { name: /^Add to / }));
    fireEvent.click(screen.getByRole("button", { name: /Clear the plan/ }));
    expect(screen.getByTestId("safety-plan-undo")).toBeTruthy();

    fireEvent.change(field(), { target: { value: "Alex — a brother" } });
    fireEvent.click(within(supportStep).getByRole("button", { name: /^Add to / }));
    expect(screen.queryByTestId("safety-plan-undo")).toBeNull();
    expect(within(supportStep).getAllByText("Alex — a brother").length).toBeGreaterThan(0);
  });

  it("lets the Undo offer lapse after ten seconds", () => {
    vi.useFakeTimers();
    try {
      render(<PatientSafetyPlan />);
      const supportStep = screen.getByRole("region", { name: "Step 4: People I can ask for help" });
      fireEvent.change(within(supportStep).getByPlaceholderText("Name & relationship"), {
        target: { value: "Sam — a friend" },
      });
      fireEvent.click(within(supportStep).getByRole("button", { name: /^Add to / }));
      fireEvent.click(screen.getByRole("button", { name: /Clear the plan/ }));
      expect(screen.getByTestId("safety-plan-undo")).toBeTruthy();

      act(() => vi.advanceTimersByTime(SAFETY_PLAN_UNDO_MS));
      expect(screen.queryByTestId("safety-plan-undo")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears an untouched example or an empty plan without an Undo offer", () => {
    render(<PatientSafetyPlan />);

    fireEvent.click(screen.getByRole("button", { name: /Clear the plan/ }));
    fireEvent.click(screen.getByRole("button", { name: /Load example/ }));
    fireEvent.click(screen.getByRole("button", { name: /Clear the plan/ }));

    expect(screen.queryByTestId("safety-plan-undo")).toBeNull();
    expect(screen.queryByText(examplePattern)).toBeNull();
  });

  it("moves between Build and Plan preview with the arrow keys", () => {
    render(<PatientSafetyPlan />);
    const build = screen.getByRole("tab", { name: "Build" });
    expect(build).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(build, { key: "ArrowRight" });
    const preview = screen.getByRole("tab", { name: "Plan preview" });
    expect(preview).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(preview);
    expect(build).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(preview, { key: "Home" });
    expect(build).toHaveAttribute("aria-selected", "true");
  });

  it("says so when copying fails instead of failing silently", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<PatientSafetyPlan />);

    fireEvent.click(screen.getByRole("button", { name: /^Copy$/ }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /^Copy failed$/ })).toBeTruthy();
    expect(screen.getByText(/Copy didn’t work\. Use Print \/ PDF instead\./)).toBeTruthy();
  });
});

describe("PatientSafetyPlan — in-app links inside the shell", () => {
  function renderWithShellLink() {
    render(
      <>
        <a href="/psychiatry">Shell link</a>
        <PatientSafetyPlan />
      </>,
    );
    return screen.getByRole("link", { name: "Shell link" });
  }

  it("lets a shell link leave freely while the plan is empty", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = renderWithShellLink();
    expect(fireEvent.click(link)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("asks before a shell link discards entries, and stays when the doctor says no", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = renderWithShellLink();
    // fireEvent rather than userEvent: an earlier case in this file uses fake timers.
    fireEvent.click(screen.getByRole("button", { name: /Load example/i }));

    // fireEvent.click returns false when the click's default (the navigation) was prevented.
    expect(fireEvent.click(link)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      "Leave this safety plan? Your entries are only in this browser tab and will be lost.",
    );

    confirm.mockReturnValue(true);
    expect(fireEvent.click(link)).toBe(true);
    confirm.mockRestore();
  });
});

describe("PatientSafetyPlan — browser Back and shell controls", () => {
  const prompt = "Leave this safety plan? Your entries are only in this browser tab and will be lost.";
  const SENTINEL = "__psychsiftSafetyPlanGuard";
  const onSentinel = () => Boolean((window.history.state as Record<string, unknown> | null)?.[SENTINEL]);

  /** What the browser does on Back from the sentinel: the real entry, without the marker, is current. */
  function pressBack() {
    const rest = { ...((window.history.state ?? {}) as Record<string, unknown>) };
    delete rest[SENTINEL];
    window.history.replaceState(rest, "");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: rest }));
    });
  }

  function renderDirtyPlan() {
    window.history.replaceState({ __NA: true, keep: "router state" }, "");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const view = render(<PatientSafetyPlan />);
    fireEvent.click(screen.getByRole("button", { name: /Load example/i }));
    return { back, view };
  }

  it("holds Back with one sentinel entry that keeps the router's own history state", () => {
    const { back, view } = renderDirtyPlan();
    expect(onSentinel()).toBe(true);
    expect(window.history.state).toMatchObject({ __NA: true, keep: "router state" });
    view.unmount();
    // Leaving or unmounting while still on the sentinel steps off it, so Back never does nothing.
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  it("stays on the plan when the doctor cancels Back, and holds Back again", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { back, view } = renderDirtyPlan();
    pressBack();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(prompt);
    expect(back).not.toHaveBeenCalled();
    expect(onSentinel()).toBe(true);
    expect(screen.getByRole("button", { name: /Load example/i })).toBeTruthy();
    // A second Back asks again.
    pressBack();
    expect(confirm).toHaveBeenCalledTimes(2);
    view.unmount();
    confirm.mockRestore();
    back.mockRestore();
  });

  it("leaves when the doctor confirms Back, and asks only once", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { back, view } = renderDirtyPlan();
    pressBack();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
    expect(onSentinel()).toBe(false);
    // The real Back that follows is not guarded again.
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    view.unmount();
    confirm.mockRestore();
    back.mockRestore();
  });

  /** Leave a dirty plan by an in-app link: its sentinel, from this page load, stays behind. */
  function leaveSentinelBehind(hadHistoryBefore: boolean) {
    const { back, view } = renderDirtyPlan();
    const marker = (window.history.state as Record<string, Record<string, unknown>>)[SENTINEL];
    view.unmount();
    back.mockRestore();
    window.history.replaceState({ __NA: true, [SENTINEL]: { ...marker, hadHistoryBefore } }, "");
  }

  it("returning to a left-behind sentinel skips both plan entries when there was a page before", () => {
    leaveSentinelBehind(true);
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    router.replace.mockClear();
    const view = render(<PatientSafetyPlan />);
    expect(go).toHaveBeenCalledWith(-2);
    expect(router.replace).not.toHaveBeenCalled();
    expect(onSentinel()).toBe(false);
    view.unmount();
    go.mockRestore();
  });

  it("returning to a left-behind sentinel opens Psychiatry when the plan was the first page", () => {
    // Checking history from the sentinel would always find the plan's own entry behind it, so
    // the answer recorded when the sentinel was pushed is the one used.
    leaveSentinelBehind(false);
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    router.replace.mockClear();
    const view = render(<PatientSafetyPlan />);
    expect(go).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/psychiatry/));
    view.unmount();
    go.mockRestore();
  });

  it("reloading on a sentinel steps back to the plan's own entry", () => {
    // Browsers keep history state across a reload, so the sentinel is still there, but it
    // came from an earlier page load and the reloaded plan is empty. One step back lands on
    // the plan's own entry, so the next Back reaches the page before.
    window.history.replaceState(
      { __NA: true, [SENTINEL]: { hadHistoryBefore: true, documentId: "an earlier page load" } },
      "",
    );
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    router.replace.mockClear();
    const view = render(<PatientSafetyPlan />);
    expect(back).toHaveBeenCalledTimes(1);
    expect(go).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ __NA: true });
    view.unmount();
    back.mockRestore();
    go.mockRestore();
  });

  it("asks before a shell control navigates, and a link that also calls the shell asks once", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    window.history.replaceState(null, "");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    expect(confirmShellNavigation()).toBe(true);
    render(
      <>
        <a
          href="/psychiatry"
          onClick={(event) => {
            event.preventDefault();
            confirmShellNavigation();
          }}
        >
          Mode link
        </a>
        <PatientSafetyPlan />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Load example/i }));
    expect(confirmShellNavigation()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);

    confirm.mockClear();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("link", { name: "Mode link" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
    back.mockRestore();
  });
});

describe("PatientSafetyPlan — field names and focus after removing an entry", () => {
  it("names each add field and Add button after its step, not after the example text", () => {
    render(<PatientSafetyPlan />);

    const warningStep = screen.getByRole("region", { name: "Step 1: Warning signs" });
    const field = within(warningStep).getByRole("textbox", { name: "Warning signs: new entry" });
    expect(field).toHaveAttribute("placeholder", "e.g. Not sleeping for a couple of nights");
    expect(within(warningStep).getByRole("button", { name: "Add to Warning signs" })).toBeTruthy();

    const supportStep = screen.getByRole("region", { name: "Step 4: People I can ask for help" });
    expect(
      within(supportStep).getByRole("textbox", { name: "People I can ask for help: Name & relationship" }),
    ).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Reasons for living: new entry" })).toBeTruthy();
  });

  it("moves focus to the next entry, then the previous, then the add field as entries are removed", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const view = render(<PatientSafetyPlan />);
    const warningStep = screen.getByRole("region", { name: "Step 1: Warning signs" });
    const field = within(warningStep).getByRole("textbox", { name: "Warning signs: new entry" });
    for (const value of ["First sign", "Second sign", "Third sign"]) {
      fireEvent.change(field, { target: { value } });
      fireEvent.click(within(warningStep).getByRole("button", { name: "Add to Warning signs" }));
    }
    const removeButton = (text: string) => within(warningStep).getByRole("button", { name: `Remove “${text}”` });

    fireEvent.click(removeButton("First sign"));
    expect(document.activeElement).toBe(removeButton("Second sign"));

    fireEvent.click(removeButton("Third sign"));
    expect(document.activeElement).toBe(removeButton("Second sign"));

    fireEvent.click(removeButton("Second sign"));
    expect(document.activeElement).toBe(field);
    view.unmount();
    back.mockRestore();
  });

  it("moves focus to the reasons add field when the last reason is removed", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const view = render(<PatientSafetyPlan />);
    const field = screen.getByRole("textbox", { name: "Reasons for living: new entry" });
    fireEvent.change(field, { target: { value: "My dog" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Reasons for living" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove “My dog”" }));
    expect(document.activeElement).toBe(field);
    view.unmount();
    back.mockRestore();
  });
});
