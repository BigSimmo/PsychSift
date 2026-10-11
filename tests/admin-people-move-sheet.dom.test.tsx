/** @vitest-environment jsdom */

// People and roles: the administrator's "Move to another hospital" sheet for a
// team linked to the wrong hospital. Pick the hospital, read what changes,
// then confirm.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MoveTeamSheet, type PeopleRun } from "@/components/work-screens/admin/people-sheets";

const TEAM = { serviceId: "team-a", name: "Ward A team" };
const FROM = { id: "h1", name: "Example Hospital" };
const HOSPITALS = [FROM, { id: "h2", name: "Example Health Campus" }, { id: "h3", name: "Example Mental Health Unit" }];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open(options: { run?: PeopleRun; online?: boolean; hospitals?: typeof HOSPITALS } = {}) {
  const run = options.run ?? vi.fn<PeopleRun>(async () => null);
  const onClose = vi.fn();
  render(
    <MoveTeamSheet
      team={TEAM}
      supervisors={1}
      from={FROM}
      hospitals={options.hospitals ?? HOSPITALS}
      online={options.online ?? true}
      run={run}
      onClose={onClose}
    />,
  );
  return { run, onClose, sheet: within(screen.getByTestId("admin-people-move-sheet")) };
}

describe("MoveTeamSheet", () => {
  it("offers every other hospital, explains the move, then sends it", async () => {
    const { run, onClose, sheet } = open();
    const choices = sheet.getAllByTestId("admin-people-move-hospital").map((row) => row.textContent);
    expect(choices).toEqual(["Example Health Campus", "Example Mental Health Unit"]);
    expect(sheet.getByTestId("admin-people-move-next")).toBeDisabled();

    fireEvent.click(sheet.getByRole("radio", { name: "Example Health Campus" }));
    fireEvent.click(sheet.getByTestId("admin-people-move-next"));

    const confirm = within(sheet.getByTestId("admin-people-move-confirm"));
    expect(confirm.getByText("Move Ward A team from Example Hospital to Example Health Campus?")).toBeInTheDocument();
    expect(
      confirm.getByText(
        "Medical Workforce and the DCT at Example Health Campus start seeing Ward A team, and those at Example Hospital stop.",
      ),
    ).toBeInTheDocument();
    expect(
      confirm.getByText("1 supervisor of Ward A team will lose the role. Give it again at Example Health Campus."),
    ).toBeInTheDocument();

    fireEvent.click(sheet.getByTestId("admin-people-move-yes"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith(
      { action: "move-team", serviceId: "team-a", toHospitalId: "h2" },
      "Ward A team moved to Example Health Campus",
    );
  });

  it("keeps the sheet open with the reason when the move is refused, and Back returns to the picker", async () => {
    const run = vi.fn<PeopleRun>(async () => "That team changed while you were moving it. Try again.");
    const { onClose, sheet } = open({ run });
    fireEvent.click(sheet.getByRole("radio", { name: "Example Mental Health Unit" }));
    fireEvent.click(sheet.getByTestId("admin-people-move-next"));
    fireEvent.click(sheet.getByTestId("admin-people-move-yes"));

    expect(await sheet.findByTestId("admin-people-move-problem")).toHaveTextContent(
      "That team changed while you were moving it. Try again.",
    );
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(sheet.getByTestId("admin-people-move-back"));
    expect(sheet.getByRole("radio", { name: "Example Mental Health Unit" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows Moving while it sends, so a second tap does nothing", async () => {
    let finish: (value: string | null) => void = () => {};
    const run = vi.fn<PeopleRun>(() => new Promise((resolve) => (finish = resolve)));
    const { sheet } = open({ run });
    fireEvent.click(sheet.getByRole("radio", { name: "Example Health Campus" }));
    fireEvent.click(sheet.getByTestId("admin-people-move-next"));
    fireEvent.click(sheet.getByTestId("admin-people-move-yes"));
    const button = sheet.getByTestId("admin-people-move-yes");
    expect(button).toHaveTextContent("Moving");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(run).toHaveBeenCalledTimes(1);
    finish(null);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it("cannot send while offline, and says so", () => {
    const { run, sheet } = open({ online: false });
    fireEvent.click(sheet.getByRole("radio", { name: "Example Health Campus" }));
    fireEvent.click(sheet.getByTestId("admin-people-move-next"));
    expect(sheet.getByTestId("admin-people-move-yes")).toBeDisabled();
    expect(sheet.getByText(/You're offline/)).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it("says to add the right hospital first when there is no other one", () => {
    const { onClose, sheet } = open({ hospitals: [FROM] });
    expect(sheet.getByTestId("admin-people-move-empty")).toHaveTextContent("No other hospital yet");
    fireEvent.click(sheet.getByTestId("admin-people-move-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
