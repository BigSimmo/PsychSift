/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NeedsYouButton } from "@/components/needs-you/needs-you-button";

const nav = vi.hoisted(() => ({ pathname: "/my-day" }));
const auth = vi.hoisted(() => ({ status: "authenticated" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => auth,
}));

vi.mock("@/components/needs-you/lazy-needs-you-sheet", () => ({
  prefetchNeedsYouSheet: () => undefined,
  LazyNeedsYouSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="needs-you-sheet-stub">Needs you</div> : null,
}));

afterEach(() => {
  cleanup();
  nav.pathname = "/my-day";
  auth.status = "authenticated";
});

describe("Needs you header bell", () => {
  it("opens the sheet from a 48px control labelled Needs you", () => {
    render(<NeedsYouButton modeId="my-day" />);
    const bell = screen.getByTestId("needs-you-bell");
    expect(bell.getAttribute("aria-label")).toBe("Needs you");
    expect(bell.className).toMatch(/min-h-12/);
    fireEvent.click(bell);
    expect(screen.getByTestId("needs-you-sheet-stub")).toBeTruthy();
  });

  it("hides when signed out", () => {
    auth.status = "signed_out";
    render(<NeedsYouButton modeId="my-day" />);
    expect(screen.queryByTestId("needs-you-bell")).toBeNull();
  });

  it("hides on an inner On Call page so the row is not three round buttons", () => {
    nav.pathname = "/on-call/contacts";
    render(<NeedsYouButton modeId="on-call" />);
    expect(screen.queryByTestId("needs-you-bell")).toBeNull();
  });

  it("shows on On Call home and Who's on", () => {
    nav.pathname = "/on-call";
    const { unmount } = render(<NeedsYouButton modeId="on-call" />);
    expect(screen.getByTestId("needs-you-bell")).toBeTruthy();
    unmount();
    nav.pathname = "/on-call/whos-on";
    render(<NeedsYouButton modeId="on-call" />);
    expect(screen.getByTestId("needs-you-bell")).toBeTruthy();
  });
});
