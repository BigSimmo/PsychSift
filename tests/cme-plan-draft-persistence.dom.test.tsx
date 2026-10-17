// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CmePlanPage, cmePlanDraftStorageKey } from "@/components/cme/cme-plan-page";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";
import type { CmeRequirementSet } from "@/lib/cme/types";

function buildDefaultRequirementSet(year: number): CmeRequirementSet {
  return {
    year,
    confirmedOn: `${year}-01-15`,
    confirmedSource: "RANZCP CPD Program Guide",
    totalHours: 50,
    requirements: [
      {
        id: "plan",
        label: "Professional development plan written",
        source: "national",
        spec: { shape: "task" },
        completedOn: null,
      },
    ],
  };
}

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: refreshMock,
  }),
  usePathname: () => "/cme/plan",
}));

describe("CmePlanPage draft persistence across navigation and failed saves (R09)", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("preserves unsaved goals in sessionStorage across internal navigation to /cme/setup and back", () => {
    const initialSet = buildDefaultRequirementSet(2026);
    const { unmount } = render(<CmePlanPage set={initialSet} goals={[]} entries={[]} />);

    const textarea = screen.getByLabelText("Goal 1");
    fireEvent.change(textarea, {
      target: { value: "Improve documentation of metabolic monitoring on clozapine" },
    });

    fireEvent.click(screen.getByTestId("cme-plan-add-goal"));
    const secondTextarea = screen.getByLabelText("Goal 2");
    fireEvent.change(secondTextarea, {
      target: { value: "Review perinatal lithium dosing protocols across trimesters" },
    });

    expect(window.sessionStorage.getItem(cmePlanDraftStorageKey(2026))).not.toBeNull();
    expect(screen.getByTestId("cme-plan-status-link")).toHaveAttribute("href", "/cme/setup#cme-setup-steps");

    // Simulate navigating away via "Record it" and returning after recording the plan-written date.
    unmount();

    const updatedSet: CmeRequirementSet = {
      ...initialSet,
      requirements: initialSet.requirements.map((req) =>
        req.id === "plan" ? { ...req, completedOn: "2026-02-10" } : req,
      ),
    };
    render(<CmePlanPage set={updatedSet} goals={[]} entries={[]} />);

    expect(screen.getByLabelText("Goal 1")).toHaveValue("Improve documentation of metabolic monitoring on clozapine");
    expect(screen.getByLabelText("Goal 2")).toHaveValue("Review perinatal lithium dosing protocols across trimesters");
  });

  it("reopens the editor with unsaved edits when returning to a year that already had saved goals", () => {
    const set = buildDefaultRequirementSet(2026);
    const existingGoals: CmePlanGoal[] = [
      { id: "g-1", goal: "Audit acute sedation prescribing on the inpatient unit", sortOrder: 0 },
    ];

    const { unmount } = render(<CmePlanPage set={set} goals={existingGoals} entries={[]} />);
    fireEvent.click(screen.getByTestId("cme-plan-edit"));

    const textarea = screen.getByLabelText("Goal 1");
    fireEvent.change(textarea, {
      target: { value: "Audit acute sedation prescribing and post-incident debriefing" },
    });

    unmount();

    render(<CmePlanPage set={set} goals={existingGoals} entries={[]} />);
    expect(screen.getByLabelText("Goal 1")).toHaveValue(
      "Audit acute sedation prescribing and post-incident debriefing",
    );
  });

  it("retains unsaved drafts in the editor and sessionStorage when saving fails or conflicts, and clears on save or cancel", async () => {
    const set = buildDefaultRequirementSet(2026);
    const existingGoals: CmePlanGoal[] = [
      { id: "g-1", goal: "Audit acute sedation prescribing on the inpatient unit", sortOrder: 0 },
    ];

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Database temporarily unavailable." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            goals: [{ id: "g-1", goal: "Updated sedation audit goal for 2026", sortOrder: 0 }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    render(<CmePlanPage set={set} goals={existingGoals} entries={[]} />);
    fireEvent.click(screen.getByTestId("cme-plan-edit"));

    fireEvent.change(screen.getByLabelText("Goal 1"), {
      target: { value: "Updated sedation audit goal for 2026" },
    });

    fireEvent.click(screen.getByTestId("cme-plan-save"));

    await waitFor(() => {
      expect(screen.getByTestId("cme-plan-message")).toHaveTextContent("Database temporarily unavailable.");
    });

    // Draft remains in the editor and in sessionStorage after failed save.
    expect(screen.getByLabelText("Goal 1")).toHaveValue("Updated sedation audit goal for 2026");
    expect(window.sessionStorage.getItem(cmePlanDraftStorageKey(2026))).not.toBeNull();

    // Retry save succeeds and clears sessionStorage.
    fireEvent.click(screen.getByTestId("cme-plan-save"));

    await waitFor(() => {
      expect(screen.getByTestId("cme-plan-message")).toHaveTextContent("Plan saved.");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.sessionStorage.getItem(cmePlanDraftStorageKey(2026))).toBeNull();

    // Editing again and clicking Cancel clears sessionStorage and reverts to saved goals.
    fireEvent.click(screen.getByTestId("cme-plan-edit"));
    fireEvent.change(screen.getByLabelText("Goal 1"), {
      target: { value: "Temporary unsaved edit before cancel" },
    });
    expect(window.sessionStorage.getItem(cmePlanDraftStorageKey(2026))).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.sessionStorage.getItem(cmePlanDraftStorageKey(2026))).toBeNull();
  });
});
