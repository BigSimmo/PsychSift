/** @vitest-environment jsdom */

// #03ARD6: on the collapsed sidebar rail, the only lit item for most modes was the
// generic "More modes" opener, and on Calculators nothing was lit at all. The rail
// now shows the active mode itself, marked `aria-current`, when it is not already a
// pinned shortcut — including Calculators and Favourites, which cannot be pinned —
// and never marks two items as current.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClinicalDesktopSidebar, deriveSidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import type { AppModeId } from "@/lib/app-modes";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));

function renderRail(activeMode: AppModeId, showAccountLibrary = false) {
  render(
    <ClinicalDesktopSidebar
      collapsed
      recentQueries={[]}
      identity={deriveSidebarIdentity(showAccountLibrary ? "clinician@clinic.example" : null)}
      activeMode={activeMode}
      showAccountLibrary={showAccountLibrary}
      onCollapsedChange={() => undefined}
      onNewChat={() => undefined}
      onPickRecent={() => undefined}
      onOpenSettings={() => undefined}
      onOpenAccount={() => undefined}
      onPrefetchApplications={() => undefined}
      onOpenSearch={() => undefined}
    />,
  );
  return screen.getByRole("complementary", { name: "PsychSift collapsed sidebar" });
}

function currentItems(rail: HTMLElement) {
  return Array.from(rail.querySelectorAll('[aria-current="page"]'));
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("collapsed rail marks the active mode (#03ARD6)", () => {
  it.each([
    ["calculators", "Calculators"],
    ["cme", "CPD"],
    ["differentials", "Differentials"],
    ["on-call", "On Call"],
    ["forms", "Forms"],
    ["my-work", "Admin"],
    ["first-nations", "First Nations"],
    ["teaching", "Teaching"],
  ] as const)("shows unpinned %s as the one current item", (modeId, label) => {
    const rail = renderRail(modeId);

    const current = currentItems(rail);
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("aria-label", label);
    // It is a place, not a pin: the pinned list itself is unchanged.
    const pinned = within(rail).getByRole("navigation", { name: "Pinned shortcuts" });
    expect(within(pinned).queryByRole("link", { name: label })).toBeNull();
  });

  it("stops lighting the More modes opener", () => {
    const rail = renderRail("differentials");

    const moreModes = within(rail).getByTestId("sidebar-more-modes");
    // The exact active-state token, not a `hover:` variant of it.
    expect(moreModes.className.split(/\s+/)).not.toContain("bg-[color:var(--clinical-accent-soft)]");
    expect(moreModes).not.toHaveAttribute("aria-current");
  });

  it("marks only the pinned shortcut when the active mode is pinned", () => {
    const rail = renderRail("answer");

    const current = currentItems(rail);
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("aria-label", "Answer");
    expect(within(rail).queryByRole("navigation", { name: "Current mode" })).toBeNull();
  });

  it("marks only the library link for Favourites when the library is shown", () => {
    const rail = renderRail("favourites", true);

    const current = currentItems(rail);
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("aria-label", "Favourites");
    expect(within(rail).getAllByRole("link", { name: "Favourites" })).toHaveLength(1);
  });

  it("still shows Favourites as the current place when the library is hidden", () => {
    const rail = renderRail("favourites", false);

    const current = currentItems(rail);
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("aria-label", "Favourites");
  });
});
