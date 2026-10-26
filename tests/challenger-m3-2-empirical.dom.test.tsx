/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnswerProgress } from "@/components/clinical-dashboard/answer-status";
import { FavouriteRow } from "@/components/favourites/favourite-row";
import type { FavouriteItem } from "@/components/favourites/favourites-view-model";
import { RosterApproveTab } from "@/components/roster/manage/roster-approve-tab";

vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/manage",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/roster/manage/roster-decision-sheet", () => ({
  managerReason: {
    within_7_days: "Needs you because it's within 7 days",
    cross_site: "Needs manager for cross-site coverage",
  },
  RosterDecisionSheet: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="roster-decision-sheet">
      <button type="button" onClick={onClose}>
        Close Decision
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Empirical Challenger M3-2: Button Wiring, A11y Names & Focus Integrity", () => {
  describe("1. RosterApproveTab button wiring & form context safety", () => {
    const mockSwap = {
      id: "swap-1",
      status: "accepted",
      requesterId: "dr-smith",
      counterpartyId: "dr-jones",
      needsManagerBecause: "within_7_days",
      autoApproved: false,
      give: {
        id: "g1",
        userId: "dr-smith",
        name: "Dr Smith",
        grade: "registrar",
        startsAt: "2026-10-05T08:00:00Z",
        endsAt: "2026-10-05T17:00:00Z",
        kind: "day",
        shiftCode: "D",
        siteName: null,
        siteId: null,
      },
      take: null,
    };

    const mockOpenShift = {
      id: "shift-1",
      serviceId: "svc-1",
      postedBy: "dr-doe",
      claimedBy: null,
      startsAt: "2026-10-06T08:00:00Z",
      endsAt: "2026-10-06T17:00:00Z",
      kind: "day",
      shiftCode: "D",
      status: "reported",
      note: "Family emergency",
    };

    beforeEach(() => {
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const what = new URL(String(input), "http://localhost").searchParams.get("what");
        return Response.json(
          what === "manage"
            ? { swaps: [mockSwap], openShifts: [mockOpenShift], seen: null }
            : what === "people"
              ? {
                  people: [
                    { userId: "dr-smith", displayName: "Dr Alice Smith" },
                    { userId: "dr-jones", displayName: "Dr Bob Jones" },
                    { userId: "dr-doe", displayName: "Dr Charlie Doe" },
                  ],
                }
              : { leave: [] },
        );
      });
      vi.stubGlobal("fetch", fetcher);
    });

    it("verifies both swap and open-shift buttons declare type='button' and never submit enclosing form", async () => {
      const user = userEvent.setup();
      const formSubmitSpy = vi.fn((e) => e.preventDefault());

      render(
        <form onSubmit={formSubmitSpy} data-testid="enclosing-form">
          <RosterApproveTab serviceId="svc-1" />
        </form>,
      );

      // Wait for data load
      const swapButton = await screen.findByRole("button", {
        name: /Swap · Dr Alice Smith and Dr Bob Jones/i,
      });
      expect(swapButton).toHaveAttribute("type", "button");
      expect((swapButton as HTMLButtonElement).type).toBe("button");

      const openButton = screen.getByRole("button", {
        name: /Dr Charlie Doe can't make/i,
      });
      expect(openButton).toHaveAttribute("type", "button");
      expect((openButton as HTMLButtonElement).type).toBe("button");

      // Click swap button -> must NOT submit form
      await user.click(swapButton);
      expect(formSubmitSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId("roster-decision-sheet")).toBeInTheDocument();

      // Close sheet
      await user.click(screen.getByRole("button", { name: "Close Decision" }));
      expect(screen.queryByTestId("roster-decision-sheet")).toBeNull();

      // Click open shift button -> must NOT submit form
      await user.click(openButton);
      expect(formSubmitSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId("roster-decision-sheet")).toBeInTheDocument();
    });

    it("verifies keyboard actuation (Enter and Space) does NOT submit enclosing form", async () => {
      const user = userEvent.setup();
      const formSubmitSpy = vi.fn((e) => e.preventDefault());

      render(
        <form onSubmit={formSubmitSpy}>
          <RosterApproveTab serviceId="svc-1" />
        </form>,
      );

      const swapButton = await screen.findByRole("button", {
        name: /Swap · Dr Alice Smith and Dr Bob Jones/i,
      });

      swapButton.focus();
      expect(document.activeElement).toBe(swapButton);

      // Press Enter
      await user.keyboard("{Enter}");
      expect(formSubmitSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId("roster-decision-sheet")).toBeInTheDocument();

      // Close sheet
      await user.click(screen.getByRole("button", { name: "Close Decision" }));

      const openButton = screen.getByRole("button", {
        name: /Dr Charlie Doe can't make/i,
      });
      openButton.focus();
      expect(document.activeElement).toBe(openButton);

      // Press Space
      await user.keyboard(" ");
      expect(formSubmitSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId("roster-decision-sheet")).toBeInTheDocument();
    });
  });

  describe("2. FavouriteRow accessible names and multi-select non-collision", () => {
    const item: FavouriteItem = {
      id: "services:acute-mental-health",
      title: "Acute Mental Health Unit",
      description: "24-bed adult acute open unit",
      type: "Service",
      tabId: "services",
      set: "Inpatient Services",
      evidence: "Adult Acute Open",
      lastUsed: "Saved",
      openedAt: null,
      action: "Open",
      href: "/services/acute-mental-health",
      icon: FileText,
      pinned: false,
    };

    it("renders desktop workspace button with exact accessible name and syncs aria-pressed", async () => {
      const user = userEvent.setup();
      const onSelectForWorkspace = vi.fn();
      const onOpen = vi.fn();

      const { rerender } = render(
        <FavouriteRow
          item={item}
          view="type"
          now={Date.now()}
          showSet={true}
          mode="browse"
          workspaceSelected={false}
          swipeOpen={false}
          onSwipeOpenChange={() => {}}
          canMutate={true}
          onOpen={onOpen}
          onSelectForWorkspace={onSelectForWorkspace}
          onShowActions={() => {}}
          onTogglePin={() => {}}
          onMove={() => {}}
          onRemove={() => {}}
          onToggleSelected={() => {}}
        />,
      );

      // Check desktop button
      const workspaceBtn = screen.getByRole("button", {
        name: new RegExp(`^Select ${item.title}\\b.* for workspace$`),
      });
      expect(workspaceBtn).toBeInTheDocument();
      expect(workspaceBtn).toHaveAttribute("type", "button");
      expect(workspaceBtn).toHaveAttribute("aria-pressed", "false");
      // Named by its content, so the words on screen are in the name (WCAG 2.5.3).
      expect(workspaceBtn).not.toHaveAttribute("aria-label");

      // Check mobile link
      const mobileLink = screen.getByRole("link", {
        name: new RegExp(`^Open ${item.title}\\b`),
      });
      expect(mobileLink).toBeInTheDocument();
      expect(mobileLink).toHaveAttribute("href", item.href);

      // Click desktop button
      await user.click(workspaceBtn);
      expect(onSelectForWorkspace).toHaveBeenCalledWith(item);

      // Rerender with workspaceSelected = true
      rerender(
        <FavouriteRow
          item={item}
          view="type"
          now={Date.now()}
          showSet={true}
          mode="browse"
          workspaceSelected={true}
          swipeOpen={false}
          onSwipeOpenChange={() => {}}
          canMutate={true}
          onOpen={onOpen}
          onSelectForWorkspace={onSelectForWorkspace}
          onShowActions={() => {}}
          onTogglePin={() => {}}
          onMove={() => {}}
          onRemove={() => {}}
          onToggleSelected={() => {}}
        />,
      );

      expect(
        screen.getByRole("button", {
          name: new RegExp(`^Select ${item.title}\\b.* for workspace$`),
        }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("ensures zero naming collisions in multi-select mode", async () => {
      const user = userEvent.setup();
      const onToggleSelected = vi.fn();

      render(
        <FavouriteRow
          item={item}
          view="type"
          now={Date.now()}
          showSet={true}
          mode="select"
          selected={false}
          workspaceSelected={false}
          swipeOpen={false}
          onSwipeOpenChange={() => {}}
          canMutate={true}
          onOpen={() => {}}
          onSelectForWorkspace={() => {}}
          onShowActions={() => {}}
          onTogglePin={() => {}}
          onMove={() => {}}
          onRemove={() => {}}
          onToggleSelected={onToggleSelected}
        />,
      );

      // The desktop workspace button MUST NOT exist in multi-select mode
      expect(
        screen.queryByRole("button", {
          name: new RegExp(`^Select ${item.title}\\b.* for workspace$`),
        }),
      ).toBeNull();

      // The selection checkbox button MUST exist with the distinct name "Select ${item.title}"
      const selectBtn = screen.getByRole("button", {
        name: new RegExp(`^Select ${item.title}\\b(?!.* for workspace$)`),
      });
      expect(selectBtn).toBeInTheDocument();
      expect(selectBtn).toHaveAttribute("type", "button");
      expect(selectBtn).toHaveAttribute("aria-pressed", "false");

      // Verify no other button matches ambiguous naming
      const allButtonsWithName = screen.getAllByRole("button", { name: new RegExp(item.title) });
      expect(allButtonsWithName).toHaveLength(1);
      expect(allButtonsWithName[0]).toBe(selectBtn);

      await user.click(selectBtn);
      expect(onToggleSelected).toHaveBeenCalledWith(item);
    });
  });

  describe("3. AnswerStatus focus ring, layout shift & hit-area integrity", () => {
    it("renders StopControl with direct focus-visible outline without outline-none or layout disruption", async () => {
      const user = userEvent.setup();
      const stopSpy = vi.fn();

      render(
        <div data-testid="container" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span data-testid="sibling-before">Status</span>
          <AnswerProgress
            events={[{ stage: "generating", message: "Drafting clinical response...", receivedAt: Date.now() }]}
            startedAt={Date.now() - 2000}
            active={true}
            onStop={stopSpy}
          />
          <span data-testid="sibling-after">Footer</span>
        </div>,
      );

      const stopBtn = screen.getByTestId("stop-answer");
      expect(stopBtn).toBeInTheDocument();
      expect(stopBtn).toHaveAttribute("type", "button");
      expect(stopBtn).toHaveAttribute("aria-label", "Stop generating answer");

      // Check classes directly on the button
      const btnClasses = stopBtn.className.split(/\s+/);
      expect(btnClasses).toContain("focus-visible:outline");
      expect(btnClasses).toContain("focus-visible:outline-2");
      expect(btnClasses).toContain("focus-visible:outline-offset-2");
      expect(btnClasses).toContain("focus-visible:outline-[color:var(--focus)]");
      expect(btnClasses).toContain("min-h-tap");
      expect(btnClasses).not.toContain("outline-none");

      // Check inner span does NOT carry group-focus-visible outline
      const innerSpan = stopBtn.querySelector("span");
      expect(innerSpan).not.toBeNull();
      const spanClasses = innerSpan?.className.split(/\s+/) ?? [];
      expect(spanClasses.some((c) => c.includes("focus-visible:outline"))).toBe(false);

      // Verify click action
      await user.click(stopBtn);
      expect(stopSpy).toHaveBeenCalledTimes(1);

      // Verify keyboard focus
      stopBtn.focus();
      expect(document.activeElement).toBe(stopBtn);
    });
  });
});
