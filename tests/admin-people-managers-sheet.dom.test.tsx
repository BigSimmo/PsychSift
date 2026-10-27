/** @vitest-environment jsdom */

// People and roles: the "Roster managers" sheet a site administrator, or Medical Workforce for their
// own hospital, uses to name a team's roster managers. Tick a member to name them, untick to remove.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamManagersSheet, type PeopleRun } from "@/components/work-screens/admin/people-sheets";
import { applyExampleAction, type ExampleWorkPeople, type PeopleHospital } from "@/lib/work-roles/people-model";

const TEAM = { serviceId: "team-a", name: "Ward A team", managers: [{ userId: "u-mel", name: "Mel Example" }] };
const HOSPITAL: PeopleHospital = {
  id: "h1",
  name: "Example Hospital",
  teams: [TEAM, { serviceId: "team-b", name: "Ward B team", managers: [] }],
  people: [
    { userId: "u-toni", name: "Toni Example", serviceIds: ["team-a"] },
    { userId: "u-mel", name: "Mel Example", serviceIds: ["team-a"] },
    { userId: "u-wren", name: "Wren Example", serviceIds: ["team-a", "team-b"] },
    { userId: "u-olly", name: "Olly Example", serviceIds: ["team-b"] },
  ],
  grants: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open(options: { run?: PeopleRun; viewerId?: string; administrator?: boolean; online?: boolean } = {}) {
  const run = options.run ?? vi.fn<PeopleRun>(async () => null);
  render(
    <TeamManagersSheet
      hospital={HOSPITAL}
      team={TEAM}
      viewerId={options.viewerId ?? "u-wren"}
      administrator={options.administrator ?? false}
      online={options.online ?? true}
      run={run}
      onClose={vi.fn()}
    />,
  );
  return { run, sheet: within(screen.getByTestId("admin-people-managers-sheet")) };
}

describe("TeamManagersSheet", () => {
  it("lists only the team's members, by name, with its managers ticked", () => {
    const { sheet } = open();
    const rows = sheet.getAllByRole("checkbox");
    expect(rows.map((row) => row.querySelector(".work-row__title")?.textContent)).toEqual([
      "Mel Example",
      "Toni Example",
      "Wren Example",
    ]);
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("names a manager and removes one", async () => {
    const { run, sheet } = open();
    fireEvent.click(sheet.getByRole("checkbox", { name: /Toni Example/ }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        { action: "set-manager", hospitalId: "h1", serviceId: "team-a", userId: "u-toni", manager: true },
        "Toni Example is now a roster manager for Ward A team",
      ),
    );
    fireEvent.click(sheet.getByRole("checkbox", { name: /Mel Example/ }));
    await waitFor(() =>
      expect(run).toHaveBeenLastCalledWith(
        { action: "set-manager", hospitalId: "h1", serviceId: "team-a", userId: "u-mel", manager: false },
        "Mel Example is no longer a roster manager for Ward A team",
      ),
    );
  });

  it("never lets Workforce change their own manager role, but lets the administrator", async () => {
    const workforce = open();
    fireEvent.click(workforce.sheet.getByRole("checkbox", { name: /Wren Example/ }));
    expect(workforce.sheet.getByText("You can't change your own manager role")).toBeInTheDocument();
    expect(workforce.run).not.toHaveBeenCalled();
    cleanup();

    const admin = open({ administrator: true });
    fireEvent.click(admin.sheet.getByRole("checkbox", { name: /Wren Example/ }));
    await waitFor(() => expect(admin.run).toHaveBeenCalled());
  });

  it("shows a refusal in words and sends nothing while offline", async () => {
    const refused = open({ run: vi.fn<PeopleRun>(async () => "That person isn't an active member of this team.") });
    fireEvent.click(refused.sheet.getByRole("checkbox", { name: /Toni Example/ }));
    expect(await refused.sheet.findByTestId("admin-people-managers-problem")).toHaveTextContent(
      "That person isn't an active member of this team.",
    );
    cleanup();

    const offline = open({ online: false });
    fireEvent.click(offline.sheet.getByRole("checkbox", { name: /Toni Example/ }));
    expect(offline.run).not.toHaveBeenCalled();
  });
});

describe("naming a manager in the example records", () => {
  const state: ExampleWorkPeople = {
    viewer: { userId: "u-wren", administrator: false, name: "Wren Example" },
    hospitals: [HOSPITAL],
    unlinkedTeams: [],
  };
  const context = { now: "2026-10-27T00:00:00.000Z", newId: (kind: string) => `example:${kind}` };

  it("names and removes, the way the server would", () => {
    const named = applyExampleAction(
      state,
      { action: "set-manager", hospitalId: "h1", serviceId: "team-a", userId: "u-toni", manager: true },
      context,
    );
    expect(named.ok && named.state.hospitals[0]!.teams[0]!.managers.map((m) => m.userId)).toEqual(["u-mel", "u-toni"]);
    const removed = applyExampleAction(
      state,
      { action: "set-manager", hospitalId: "h1", serviceId: "team-a", userId: "u-mel", manager: false },
      context,
    );
    expect(removed.ok && removed.state.hospitals[0]!.teams[0]!.managers).toEqual([]);
  });

  it("refuses someone outside the team, and the viewer themselves", () => {
    expect(
      applyExampleAction(
        state,
        { action: "set-manager", hospitalId: "h1", serviceId: "team-a", userId: "u-olly", manager: true },
        context,
      ),
    ).toEqual({ ok: false, problem: "That person isn't an active member of this team." });
    expect(
      applyExampleAction(
        state,
        { action: "set-manager", hospitalId: "h1", serviceId: "team-a", userId: "u-wren", manager: true },
        context,
      ),
    ).toEqual({ ok: false, problem: "You can't change your own manager role." });
  });
});
