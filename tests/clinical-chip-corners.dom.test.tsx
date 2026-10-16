/** @vitest-environment jsdom */

// Owner decision (15 Oct 2026): Clinical keeps its square-ish control corners on
// buttons and chips; rounded pills are a Work-mode shape only. Three Clinical
// chips had drifted to pills — the mode-home "Prompts" rail (DSM, Differentials
// and the other Clinical homes), the "Show all" chip (Calculators), and the
// Medicines "Try" suggestions. Each now wears the Clinical control rung
// (`rounded-lg`, the same as `controlBase`), and the Prompts rail on a Work
// mode keeps its pill.

import { cleanup, render, screen, within } from "@testing-library/react";
import { Calculator } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const universal = vi.hoisted(() => ({
  state: { groups: [], loading: false, query: "" } as Record<string, unknown>,
}));

vi.mock("@/components/clinical-dashboard/use-universal-search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/clinical-dashboard/use-universal-search")>();
  return { ...actual, useUniversalSearch: () => universal.state };
});

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: "signed_out", session: null, isConfigured: true, authorizationHeader: {} }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({ items: [], status: "ready", registryStatus: "ready", refetch: () => undefined }),
}));

vi.mock("@/components/clinical-dashboard/search-command-context", () => ({
  useSearchCommand: () => null,
}));

import { AnswerSuggestionChips } from "@/components/clinical-dashboard/answer-suggestion-chips";
import { UniversalSearchCommandSurface } from "@/components/clinical-dashboard/universal-search-command-surface";
import { MedicinesHome } from "@/components/medicines/medicines-home";
import { ShowAllChip } from "@/components/show-all-chip";
import type { AppModeId } from "@/lib/app-modes";

function HomeSurface({ modeId }: { modeId: AppModeId }) {
  return (
    <UniversalSearchCommandSurface
      demoMode={false}
      canAccessFavourites={false}
      modeId={modeId}
      query=""
      recentQueries={[]}
      dropdownOpen={false}
      onDropdownOpenChange={() => undefined}
      onQueryChange={() => undefined}
      onSearch={() => undefined}
      onPickRecent={() => undefined}
      onCrossMode={() => undefined}
      showHomeSuggestions
    >
      <input data-testid="global-search-input" />
    </UniversalSearchCommandSurface>
  );
}

function promptChips() {
  return within(screen.getByTestId("smart-search-prompt-row")).getAllByRole("button");
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Clinical chips keep the control corner, not a pill", () => {
  it("leaves the shared suggestion chip a pill unless a caller asks for the control shape", () => {
    const { unmount } = render(<AnswerSuggestionChips suggestions={["One"]} onPick={() => undefined} />);
    expect(screen.getByRole("button", { name: "One" })).not.toHaveClass("!rounded-lg");
    unmount();

    render(<AnswerSuggestionChips suggestions={["Two"]} onPick={() => undefined} chipShape="control" />);
    expect(screen.getByRole("button", { name: "Two" })).toHaveClass("answer-suggestion-chip", "!rounded-lg");
  });

  it.each<AppModeId>(["dsm", "differentials"])("squares the Prompts chips on the %s home", (modeId) => {
    render(<HomeSurface modeId={modeId} />);
    const chips = promptChips();
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(chip).toHaveClass("!rounded-lg");
  });

  it("keeps the Prompts chips a pill on a Work mode home", () => {
    render(<HomeSurface modeId="my-work" />);
    const chips = promptChips();
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(chip).not.toHaveClass("!rounded-lg");
  });

  it("draws the Show all chip on the control rung, with its icon well one rung smaller", () => {
    render(
      <ShowAllChip href="/calculators/search" icon={Calculator} ariaLabel="Show all calculators" testId="calc-all" />,
    );
    const link = screen.getByTestId("calc-all");
    expect(link).toHaveClass("min-h-tap");
    const face = link.firstElementChild as HTMLElement;
    expect(face).toHaveClass("rounded-lg");
    expect(face).not.toHaveClass("rounded-full");
    const well = screen.getByTestId("calc-all-well");
    expect(well).toHaveClass("rounded-md");
    expect(well).not.toHaveClass("rounded-full");
  });

  it("draws the Medicines Try suggestions on the control rung at the 48px tap floor", () => {
    render(<MedicinesHome counts={{ medications: 1, factsheets: 1 }} now={new Date("2026-10-03T04:00:00Z")} />);
    const links = within(screen.getByTestId("medicines-find-try")).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveClass("min-h-12", "rounded-lg");
      expect(link).not.toHaveClass("rounded-xl");
      const face = link.firstElementChild as HTMLElement;
      expect(face).toHaveClass("rounded-lg");
      expect(face).not.toHaveClass("rounded-xl");
    }
  });
});
