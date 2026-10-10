/** @vitest-environment jsdom */

// The new-round form for someone who runs two teams (Medical Workforce, say): picking a team
// starts that team's form with its people, the save names that team, and the team can't change
// while a save is in flight. Invented data only.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RotationsRead } from "@/components/roster/rotations/use-rotations";
import { EXAMPLE_ROTATION_SERVICE_ID, exampleRotationRounds } from "@/lib/example-data/datasets/roster-rotations";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/manage/rotations/new",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

const read: { current: RotationsRead } = { current: null as unknown as RotationsRead };
vi.mock("@/components/roster/rotations/use-rotations", () => ({ useRotations: () => read.current }));

const { NewRotationRoundPage } = await import("@/components/roster/rotations/admin/round-form");

const example = exampleRotationRounds(new Date());
const exampleTeam = example.rounds[0]!.round;
const OTHER = "example:rotations:other-team";
const otherPeople = [
  { id: "example:person:other-1", name: "Dr Avery Lim" },
  { id: "example:person:other-2", name: "Dr Bo Hartley" },
];

let finishSave: (result: { ok: true; roundId: string }) => void = () => undefined;
const createRound = vi.fn(
  () =>
    new Promise<{ ok: true; roundId: string }>((resolve) => {
      finishSave = resolve;
    }),
);

beforeEach(() => {
  createRound.mockClear();
  router.replace.mockReset();
  const teams = [
    { serviceId: OTHER, name: "Older adult team", people: otherPeople },
    { serviceId: EXAMPLE_ROTATION_SERVICE_ID, name: "Adult team", people: exampleTeam.people },
  ];
  read.current = {
    status: "ready",
    source: "example",
    mine: [],
    managed: example.rounds,
    canManage: true,
    teams,
    team: teams[0]!,
    actions: { createRound } as unknown as RotationsRead["actions"],
    retry: vi.fn(),
  };
});
afterEach(cleanup);

describe("new round form for two teams", () => {
  it("starts the chosen team's form and names that team when saving", async () => {
    const user = userEvent.setup();
    render(<NewRotationRoundPage />);
    const picker = await screen.findByTestId("rotation-new-round-team");
    expect(picker).toHaveProperty("value", OTHER);

    await user.selectOptions(picker, EXAMPLE_ROTATION_SERVICE_ID);
    // The Adult team's last round carries its rotations into the new form.
    await user.click(screen.getByTestId("rotation-form-next"));
    expect(screen.getAllByTestId(/^rotation-form-rotation-\d+$/)).toHaveLength(exampleTeam.rotations.length);
    await user.click(screen.getByTestId("rotation-form-next"));
    const first = exampleTeam.people[0]!;
    expect(screen.getByTestId(`rotation-form-person-remove-${first.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`rotation-form-person-remove-${otherPeople[0]!.id}`)).toBeNull();

    await user.click(screen.getByTestId("rotation-form-save-draft"));
    expect(createRound).toHaveBeenCalledTimes(1);
    expect(createRound.mock.calls[0]).toHaveLength(2);
    expect((createRound.mock.calls[0] as unknown[])[1]).toBe(EXAMPLE_ROTATION_SERVICE_ID);
    await waitFor(() => expect(screen.getByTestId("rotation-new-round-team")).toHaveProperty("disabled", true));

    await act(async () => finishSave({ ok: true, roundId: "example:round:new" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
  });
});

describe("site administrator in no team", () => {
  beforeEach(() => {
    read.current = { ...read.current, managed: [], teams: [], team: null };
  });

  it("points the new-round page at People and roles", async () => {
    render(<NewRotationRoundPage />);
    const card = await screen.findByTestId("rotation-no-team");
    expect(card.textContent).toContain("you aren't in one");
    expect(screen.getByTestId("rotation-no-team-people").getAttribute("href")).toBe("/admin/people");
  });

  it("keeps managed rounds visible while offering no New round", async () => {
    const { RotationRoundsPage } = await import("@/components/roster/rotations/admin/rounds-page");
    read.current = { ...read.current, managed: example.rounds };
    render(<RotationRoundsPage />);
    await screen.findByTestId("rotation-no-team");
    expect(screen.getByTestId(`rotation-round-row-${example.rounds[0]!.round.id}`)).toBeTruthy();
    expect(screen.queryByTestId("rotation-rounds-new-empty")).toBeNull();
    expect(screen.queryByTestId("rotation-rounds-new")).toBeNull();
  });
});
