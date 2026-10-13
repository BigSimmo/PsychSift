/** @vitest-environment jsdom */

// Site review 12 Oct 2026: the one inline empty state (a plain sentence plus at
// most one real action), and My Day's quick tiles not repeating the on-call
// hero's Log a call and Handover.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkEmptyLine } from "@/components/mode-kit/work-empty-line";
import { QuickActionsCard } from "@/components/my-day/my-day-today-cards";
import { ON_CALL_SERVICE_HANDBOOK_ACTION, OnCallStateLabel } from "@/components/on-call/kit/state-label";

describe("WorkEmptyLine", () => {
  it("draws the sentence only when there is nowhere real to go", () => {
    render(<WorkEmptyLine testId="line">Nothing here yet.</WorkEmptyLine>);
    const line = screen.getByTestId("line");
    expect(line).toHaveTextContent("Nothing here yet.");
    expect(within(line).queryByRole("link")).toBeNull();
    expect(within(line).queryByRole("button")).toBeNull();
  });

  it("keeps a not-set-up row's words and adds the service handbook as its one action", () => {
    render(
      <WorkEmptyLine testId="line" action={ON_CALL_SERVICE_HANDBOOK_ACTION}>
        <OnCallStateLabel state={{ kind: "not-set-up" }} />
      </WorkEmptyLine>,
    );
    const line = screen.getByTestId("line");
    expect(line).toHaveTextContent("Not set up for this hospital");
    const link = within(line).getByRole("link", { name: "Service handbook" });
    expect(link).toHaveAttribute("href", "/on-call/service");
    expect(link.className).toContain("min-h-12");
  });

  it("can carry a button action instead of a link", () => {
    const onClick = vi.fn();
    render(<WorkEmptyLine action={{ label: "Start", onClick }}>No list yet.</WorkEmptyLine>);
    screen.getByRole("button", { name: "Start" }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("My Day quick tiles", () => {
  const labels = () =>
    within(screen.getByTestId("dash-quick-actions"))
      .getAllByRole("listitem")
      .map((item) => item.textContent);

  it("off call: stay as before", () => {
    render(<QuickActionsCard onRemindMe={() => undefined} />);
    expect(labels()).toEqual(["Log a call", "Log CPD", "Who's on", "Roster"]);
  });

  it("on call: offer what the hero does not, never Log a call or Handover twice", () => {
    render(<QuickActionsCard onCall onRemindMe={() => undefined} />);
    expect(labels()).toEqual(["Playbook", "Contacts", "Who's on", "Remind me"]);
    expect(screen.getByTestId("my-day-qa-playbook").getAttribute("href")).toMatch(/^\/on-call\/playbook/);
    expect(screen.getByTestId("my-day-qa-contacts").getAttribute("href")).toMatch(/^\/on-call\/contacts/);
  });
});
