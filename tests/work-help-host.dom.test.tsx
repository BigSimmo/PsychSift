/** @vitest-environment jsdom */

// The work help sheet and its topics load apart from the page. Opening help
// still shows the right topic for the area, and the Open shifts and Assessments
// pages keep their own topics inside their parent frames.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/roster" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/dynamic", async () => {
  const { lazy, Suspense, createElement } = await import("react");
  return {
    default: (load: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
      const Lazy = lazy(load);
      return (props: Record<string, unknown>) =>
        createElement(Suspense, { fallback: null }, createElement(Lazy, props));
    },
  };
});

import { WorkHelpHost } from "@/components/work-help/work-help-host";
import { closeWorkHelp, openWorkHelp } from "@/components/work-help/work-help-store";

afterEach(() => {
  act(() => closeWorkHelp());
  cleanup();
});

describe("WorkHelpHost", () => {
  it("shows the area's help topic when help is opened", async () => {
    nav.pathname = "/roster";
    render(<WorkHelpHost />);
    expect(screen.queryByTestId("work-help-sheet")).toBeNull();
    act(() => openWorkHelp("rost"));
    expect(await screen.findByRole("heading", { name: "Roster help" }, { timeout: 10_000 })).toBeTruthy();
  });

  it("keeps Open shifts' own topic inside Roster's frame", async () => {
    nav.pathname = "/open-shifts";
    render(<WorkHelpHost />);
    act(() => openWorkHelp("rost"));
    expect(await screen.findByRole("heading", { name: "Open shifts help" }, { timeout: 10_000 })).toBeTruthy();
  });
});
