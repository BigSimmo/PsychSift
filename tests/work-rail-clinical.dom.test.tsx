/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/my-day",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { WorkRail } from "@/components/work-frame/work-rail";
import { LAST_APP_MODE_STORAGE_KEY } from "@/components/clinical-dashboard/use-last-app-mode";

const identity = { signedIn: false, displayName: "", initials: "G" } as Parameters<typeof WorkRail>[0]["identity"];

describe("WorkRail Clinical button", () => {
  afterEach(() => window.localStorage.clear());

  it("goes back to Clinical Answer by default", () => {
    render(<WorkRail identity={identity} currentArea="day" onOpenSettings={() => {}} />);
    const link = screen.getByTestId("work-rail-clinical");
    expect(link).toHaveAccessibleName("Clinical, Answer");
    expect(link.getAttribute("href")).toContain("mode=answer");
  });

  it("goes back to the Clinical mode used last", () => {
    window.localStorage.setItem(LAST_APP_MODE_STORAGE_KEY, "dsm");
    render(<WorkRail identity={identity} currentArea="day" onOpenSettings={() => {}} />);
    const link = screen.getByTestId("work-rail-clinical");
    expect(link.getAttribute("href")).toContain("mode=dsm");
    expect(link).toHaveTextContent("Clinical");
  });
});
