/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnCallPageMenu } from "@/components/on-call/on-call-page-menu";

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/contacts",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("On Call in-page More", () => {
  it("is a labelled More control, not a header round button", () => {
    render(<OnCallPageMenu view="contacts" entryCount={3} />);
    const trigger = screen.getByTestId("on-call-page-menu-trigger");
    expect(trigger.textContent).toContain("More");
    expect(trigger.className).toMatch(/min-h-12/);
    expect(trigger.getAttribute("aria-label")).toBe("Open Contacts actions");
  });

  it("keeps add, pocket card, shifts, calendar, and order in the sheet", () => {
    render(
      <OnCallPageMenu view="contacts" onAdd={vi.fn()} addLabel="Add a contact" order="area" onOrderChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("on-call-page-menu-trigger"));
    expect(screen.getByTestId("on-call-page-menu-add")).toBeTruthy();
    expect(screen.getByTestId("on-call-page-menu-card")).toBeTruthy();
    expect(screen.getByTestId("on-call-page-menu-shifts")).toBeTruthy();
    expect(screen.getByTestId("on-call-page-menu-calendar")).toBeTruthy();
    expect(screen.getByTestId("on-call-page-menu-order")).toBeTruthy();
    expect(screen.queryByTestId("on-call-notifications-list")).toBeNull();
    expect(screen.queryByTestId("on-call-page-menu-notification-dot")).toBeNull();
  });
});
