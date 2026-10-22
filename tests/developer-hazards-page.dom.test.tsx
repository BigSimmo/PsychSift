import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeveloperHazardsPage from "@/app/(admin)/admin/developer-hub/hazards/page";
import { loadHazardSnapshot, unmitigatedHazards } from "@/lib/developer-area/hazard-register";
import { DOCUMENT_CAUTIONS } from "@/lib/document-cautions";

// PanelPageShell's back control is a ContextualBackLink, which calls
// next/navigation's useRouter for its history-aware click handler. Outside an
// app-router tree that throws, so every render here needs the router mocked.
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/developer-hub/hazards",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/**
 * Rendered against the *real* committed snapshot, following the other panel
 * page tests: the failures worth catching here are about what the page says
 * concerning live clinical records, and a hand-built fixture cannot go wrong in
 * the way that matters.
 */
describe("developer hazard register page", () => {
  it("leads with what is NOT controlled, not with a reassuring total", () => {
    const snapshot = loadHazardSnapshot();
    render(<DeveloperHazardsPage />);

    const tile = screen.getByTestId("developer-hazards-count-unmitigated");
    expect(within(tile).getByTestId("developer-hazards-count-unmitigated-value")).toHaveTextContent(
      String(snapshot.counts.unmitigated),
    );
    expect(tile).toHaveTextContent("hazards with no control");

    // The uncontrolled section names every unmitigated row when any exist. A
    // row that rendered only inside its own register's long list would be the
    // page under-reporting exactly what it is for. When the snapshot has none,
    // the section is omitted (count tile still leads with 0) — do not invent a
    // list of blockers the register does not have.
    const listed = unmitigatedHazards(snapshot);
    const blockers = screen.queryByTestId("developer-hazards-unmitigated");
    if (listed.length === 0) {
      expect(blockers).toBeNull();
      return;
    }
    expect(blockers).not.toBeNull();
    for (const { hazard } of listed) {
      // Exact, not substring: "H1" appears inside "H-C01" and inside prose, so
      // a loose match would pass on text that is not the id at all.
      expect(within(blockers!).getAllByText(hazard.id, { exact: true }).length).toBeGreaterThan(0);
    }
  });

  it("keeps each register's own authority sentence instead of one shared reassurance", () => {
    render(<DeveloperHazardsPage />);

    const psychsift = screen.getByTestId("developer-hazards-register-psychsift-answer-pipeline");
    expect(psychsift).toHaveTextContent(/Static evidence register only/i);
    expect(psychsift).toHaveTextContent(/Not signed off by a clinician/i);
  });

  it("marks expired reviews from the render-time Australia/Perth date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T16:00:00Z"));
    render(<DeveloperHazardsPage />);

    const psychsift = screen.getByTestId("developer-hazards-register-psychsift-answer-pipeline");
    expect(psychsift).toHaveTextContent("Review EXPIRED 2026-11-23.");
  });

  it("describes the live register and the retired ones without overstating coverage", () => {
    render(<DeveloperHazardsPage />);
    const page = screen.getByTestId("developer-hazards");

    expect(page).toHaveTextContent(/One clinical area has a live register/i);
    expect(page).not.toHaveTextContent(/Three separate registers/i);

    // Retired registers are named with their status, never rendered as live registers.
    const retired = screen.getByTestId("developer-hazards-retired");
    expect(retired).toHaveTextContent(/Caring Contacts — retired 2026-09-26: draft never signed; retired/);
    expect(retired).toHaveTextContent(/Ward Flow — retired 2026-09-26: no register ever written; retired/);
    expect(screen.queryByTestId("developer-hazards-register-caring-contacts")).toBeNull();
  });

  it("renders every recorded hazard, so no row can be silently dropped from a register", () => {
    const snapshot = loadHazardSnapshot();
    render(<DeveloperHazardsPage />);

    for (const register of snapshot.registers.filter((entry) => entry.exists)) {
      const section = screen.getByTestId(`developer-hazards-register-${register.id}`);
      for (const hazard of register.hazards) {
        expect(within(section).getAllByText(hazard.id, { exact: true }).length).toBeGreaterThan(0);
      }
    }
  });

  it("does not claim the page covers every clinical risk", () => {
    render(<DeveloperHazardsPage />);
    const page = screen.getByTestId("developer-hazards");

    expect(page).toHaveTextContent(/Nothing here is clinical assurance/i);
    expect(page).not.toHaveTextContent(/every clinical risk/i);
  });

  it("lists every known source-document error with its governance decision and ledger id", () => {
    render(<DeveloperHazardsPage />);
    const section = screen.getByTestId("developer-hazards-document-cautions");
    for (const caution of DOCUMENT_CAUTIONS) {
      const item = within(section).getByTestId(`developer-hazards-document-caution-${caution.id}`);
      expect(item).toHaveTextContent(caution.message);
      expect(item).toHaveTextContent(caution.decision);
      expect(item).toHaveTextContent(caution.ledger);
    }
    expect(
      within(section).getByTestId("developer-hazards-document-caution-rkpg-clozapine-wbc-anc-labels"),
    ).toHaveTextContent("#7VQ5RC");
  });
});
