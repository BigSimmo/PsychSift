import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeEntryGoalPicker } from "@/components/cme/cme-entry-goal-picker";
import { CmePlanPage } from "@/components/cme/cme-plan-page";
import { createAustralianRanzcpPreset } from "@/lib/cme/presets";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }), usePathname: () => "/cme/plan" }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refresh.mockReset();
});

const SET = createAustralianRanzcpPreset(2026, "2026-01-05");
const GOAL = { id: "33333333-3333-4333-8333-333333333333", goal: "Document capacity well", sortOrder: 0 };

describe("development plan page", () => {
  it("saves the written goals in one request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ goals: [GOAL] }), { status: 200 }));
    render(<CmePlanPage set={SET} goals={[]} entries={[]} />);
    await user.type(screen.getByLabelText("Goal 1"), "Document capacity well");
    await user.click(screen.getByTestId("cme-plan-save"));
    await waitFor(() => expect(screen.getByTestId("cme-plan-message")).toHaveTextContent("Plan saved."));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({ year: 2026, expectedGoals: [], goals: [{ goal: "Document capacity well" }] });
    expect(refresh).toHaveBeenCalled();
  });

  it("is view-only in a closed year", () => {
    render(<CmePlanPage set={{ ...SET, closedAt: "2027-01-02T00:00:00Z" }} goals={[GOAL]} entries={[]} />);
    // Read as text, with no way into the editor: no textbox, no Edit, no Save.
    expect(screen.getByTestId("cme-plan-goals-read")).toHaveTextContent("Document capacity well");
    expect(screen.queryByLabelText("Goal 1")).toBeNull();
    expect(screen.queryByTestId("cme-plan-edit")).toBeNull();
    expect(screen.queryByTestId("cme-plan-save")).toBeNull();
    expect(screen.getByTestId("cme-plan-tally")).toHaveTextContent("Document capacity well");
  });

  it("reads saved goals as text until Edit, then saves and goes back to reading", async () => {
    const user = userEvent.setup();
    const edited = { ...GOAL, goal: "Document capacity well, every time" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ goals: [edited] }), { status: 200 }));
    render(<CmePlanPage set={SET} goals={[GOAL]} entries={[]} />);
    expect(screen.getByTestId("cme-plan-goals-read")).toHaveTextContent("Document capacity well");
    expect(screen.queryByLabelText("Goal 1")).toBeNull();
    expect(screen.queryByTestId("cme-plan-save")).toBeNull();

    await user.click(screen.getByTestId("cme-plan-edit"));
    await user.type(screen.getByLabelText("Goal 1"), ", every time");
    await user.click(screen.getByTestId("cme-plan-save"));
    await waitFor(() => expect(screen.getByTestId("cme-plan-message")).toHaveTextContent("Plan saved."));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).goals).toEqual([
      { id: GOAL.id, goal: "Document capacity well, every time" },
    ]);
    expect(screen.queryByLabelText("Goal 1")).toBeNull();
    expect(screen.getByTestId("cme-plan-goals-read")).toHaveTextContent("Document capacity well, every time");
  });

  it("Cancel leaves the editor without saving and puts the saved goals back", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<CmePlanPage set={SET} goals={[GOAL]} entries={[]} />);
    await user.click(screen.getByTestId("cme-plan-edit"));
    await user.clear(screen.getByLabelText("Goal 1"));
    await user.type(screen.getByLabelText("Goal 1"), "Something else entirely");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("cme-plan-goals-read")).toHaveTextContent("Document capacity well");
  });

  it("is read-only in demo mode: goals as text, no Edit", () => {
    render(<CmePlanPage set={SET} goals={[GOAL]} entries={[]} demoMode />);
    expect(screen.getByTestId("cme-plan-goals-read")).toHaveTextContent("Document capacity well");
    expect(screen.queryByTestId("cme-plan-edit")).toBeNull();
  });

  it("states hours by goal in words, with the activity count named and pluralised", () => {
    const linked = (id: string, hours: number, goalId: string | null) => ({
      id,
      date: "2026-03-01",
      title: id,
      allocations: [{ category: "educational" as const, hours }],
      reflection: "",
      costCents: null,
      transcribed: false,
      routineId: null,
      documentId: null,
      buckets: [],
      goalId,
    });
    render(
      <CmePlanPage
        set={SET}
        goals={[GOAL]}
        entries={[linked("a", 1.5, GOAL.id), linked("b", 2, null), linked("c", 1, null)]}
      />,
    );
    const tally = screen.getByTestId("cme-plan-tally");
    expect(tally).toHaveTextContent("1.5 h from 1 activity");
    expect(tally).toHaveTextContent("3 h from 2 activities");
    expect(screen.getAllByTestId("cme-plan-tally-bar")).toHaveLength(2);
    // One split bar of every logged hour, with the total and how many activities are linked.
    expect(screen.getByTestId("cme-plan-goal-split")).toHaveTextContent("4.5 h logged1 activity linked");
  });

  it("says when the plan is not yet marked written", () => {
    render(<CmePlanPage set={SET} goals={[]} entries={[]} />);
    expect(screen.getByTestId("cme-plan-status")).toHaveTextContent("Not yet marked as written.");
  });

  it("offers each goal to carry only in the open year-end window and only on a tap", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ year: 2027, goals: [GOAL], carried: true }), { status: 200 }));
    const props = { set: SET, goals: [GOAL], entries: [], nextYearConfirmed: true, nextYearGoals: [] };
    const { rerender } = render(<CmePlanPage {...props} now={new Date("2026-12-16T12:00:00+08:00")} />);
    expect(screen.queryByText("Carry goals into 2027")).toBeNull();
    rerender(<CmePlanPage {...props} now={new Date("2026-12-17T12:00:00+08:00")} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Carry into 2027" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/cme/plan/carry", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ sourceYear: 2026, goalId: GOAL.id });
    expect(screen.getByTestId("cme-carry-message")).toHaveTextContent("Carried into 2027.");
    rerender(<CmePlanPage {...props} now={new Date("2027-01-10T12:00:00+08:00")} />);
    expect(screen.getByText("Carry goals into 2027")).toBeInTheDocument();
    rerender(<CmePlanPage {...props} now={new Date("2027-02-01T12:00:00+08:00")} />);
    expect(screen.queryByText("Carry goals into 2027")).toBeNull();
    rerender(
      <CmePlanPage
        {...props}
        set={{ ...SET, closedAt: "2027-01-10T00:00:00Z" }}
        now={new Date("2027-01-10T12:00:00+08:00")}
      />,
    );
    expect(screen.queryByText("Carry goals into 2027")).toBeNull();
  });

  it("does not enable carry when the next-year plan has not been loaded", () => {
    render(<CmePlanPage set={SET} goals={[GOAL]} entries={[]} now={new Date("2026-12-18T12:00:00+08:00")} />);
    expect(screen.getByText(/next year’s targets have not been checked/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carry into 2027" })).toBeDisabled();
  });

  it("keeps a stale editor from overwriting a changed plan", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Plan changed", code: "cme_plan_conflict" }), { status: 409 }),
      );
    render(<CmePlanPage set={SET} goals={[GOAL]} entries={[]} />);
    await user.click(screen.getByTestId("cme-plan-edit"));
    await user.click(screen.getByTestId("cme-plan-save"));
    await waitFor(() => expect(screen.getByTestId("cme-plan-message")).toHaveTextContent("changed elsewhere"));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).expectedGoals).toEqual([
      { id: GOAL.id, goal: GOAL.goal },
    ]);
    expect(screen.getByTestId("cme-plan-save")).toBeDisabled();
  });
});

describe("goal picker on an activity", () => {
  it("saves the chosen goal, and puts the old one back if saving fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "This CPD year is closed." }), { status: 409 }));
    render(<CmeEntryGoalPicker entryId="e1" goals={[GOAL]} initialGoalId={null} readOnly={false} />);
    const select = screen.getByLabelText(/Which goal/);
    await user.selectOptions(select, GOAL.id);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(fetchMock).toHaveBeenCalledWith("/api/cme/entries/e1/goal", expect.objectContaining({ method: "PUT" }));
    await user.selectOptions(select, "");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("This CPD year is closed."));
    expect(select).toHaveValue(GOAL.id);
  });

  it("points to the plan when the year has no goals", () => {
    render(<CmeEntryGoalPicker entryId="e1" goals={[]} initialGoalId={null} readOnly={false} />);
    expect(screen.getByRole("link", { name: "Write your plan" })).toHaveAttribute("href", "/cme/plan");
  });
});
