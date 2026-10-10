import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RotationsRead } from "@/components/roster/rotations/use-rotations";
import { exampleRotationRounds } from "@/lib/example-data/datasets/roster-rotations";
import { myRoundView } from "@/lib/roster/rotations/operations";

/* The doctor's ranking screen, read from the example rounds through a stubbed data hook. Invented data only. */

const read: { current: RotationsRead } = { current: null as unknown as RotationsRead };
vi.mock("@/components/roster/rotations/use-rotations", () => ({ useRotations: () => read.current }));

const { RotationRankPage } = await import("@/components/roster/rotations/rotation-rank-page");

const NOW = new Date("2026-10-08T02:00:00.000Z");
const example = exampleRotationRounds(NOW);
const [openRound, publishedRound] = example.rounds as [
  (typeof example.rounds)[number],
  (typeof example.rounds)[number],
];
const savePreference = vi.fn(async () => ({ ok: true as const }));

function readWith(): RotationsRead {
  return {
    status: "ready",
    source: "example",
    mine: example.rounds.map((round) => myRoundView(round, example.selfId)),
    managed: example.rounds,
    canManage: true,
    teams: [],
    team: null,
    actions: { savePreference } as unknown as RotationsRead["actions"],
    retry: vi.fn(),
  };
}

beforeEach(() => {
  read.current = readWith();
  savePreference.mockClear();
});
afterEach(cleanup);

function rankedNames() {
  return screen
    .queryAllByTestId("rotation-rank-row")
    .map((row) => row.querySelector(".work-row__title")?.textContent ?? "");
}

describe("RotationRankPage while the round is open", () => {
  it("starts with nothing ranked and holds Send until the round's minimum is met", async () => {
    render(<RotationRankPage roundId={openRound.round.id} now={NOW} />);
    expect(screen.getAllByTestId("rotation-unranked-row")).toHaveLength(8);
    expect(screen.getByTestId("rotation-rank-send")).toBeDisabled();
    expect(screen.getByTestId("rotation-rank-status")).toHaveTextContent("Rank at least 4 to send");

    for (const name of ["Consultation liaison", "Emergency psychiatry", "Older adult", "Youth mental health"]) {
      fireEvent.click(screen.getByRole("button", { name: `Rank ${name}` }));
    }
    expect(rankedNames()).toEqual([
      "1st: Consultation liaison",
      "2nd: Emergency psychiatry",
      "3rd: Older adult",
      "4th: Youth mental health",
    ]);
    expect(screen.getByTestId("rotation-rank-send")).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByTestId("rotation-rank-send"));
    });
    expect(savePreference).toHaveBeenCalledWith(
      openRound.round.id,
      ["example:rot:cl", "example:rot:ed", "example:rot:older", "example:rot:youth"],
      true,
    );
    expect(screen.getByTestId("rotation-rank-sent")).toHaveTextContent("You can change it until");
    expect(screen.getByTestId("rotation-rank-change")).toBeInTheDocument();
  });

  it("moves with the arrows and the handle's arrow keys, and says where it went", () => {
    render(<RotationRankPage roundId={openRound.round.id} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Rank Consultation liaison" }));
    fireEvent.click(screen.getByRole("button", { name: "Rank Addictions" }));

    fireEvent.click(screen.getByRole("button", { name: "Move Consultation liaison down" }));
    expect(rankedNames()).toEqual(["1st: Addictions", "2nd: Consultation liaison"]);
    expect(screen.getByTestId("rotation-rank-live")).toHaveTextContent("Consultation liaison moved to 2nd");

    const handle = screen.getByRole("button", { name: /^Reorder Consultation liaison/ });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(rankedNames()).toEqual(["1st: Consultation liaison", "2nd: Addictions"]);
    expect(screen.getByTestId("rotation-rank-live")).toHaveTextContent("Consultation liaison moved to 1st");
    expect(screen.getByRole("button", { name: "Move Consultation liaison up" })).toBeDisabled();
  });

  it("removes a rotation from the ranking from its name, and saves the order as a draft", async () => {
    render(<RotationRankPage roundId={openRound.round.id} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Rank Forensic" }));
    fireEvent.click(screen.getByRole("button", { name: "Rank Community" }));
    fireEvent.click(screen.getByRole("button", { name: /^1st:\s?Forensic/ }));
    fireEvent.click(screen.getByTestId("rotation-rank-remove"));
    expect(rankedNames()).toEqual(["1st: Community"]);
    expect(screen.getByRole("button", { name: "Rank Forensic" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("rotation-rank-save"));
    });
    expect(savePreference).toHaveBeenCalledWith(openRound.round.id, ["example:rot:community"], false);
  });

  it("shows a refused save in words and keeps the order", async () => {
    savePreference.mockResolvedValueOnce({ ok: false, message: "This round is closed to changes." } as never);
    render(<RotationRankPage roundId={openRound.round.id} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Rank Forensic" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("rotation-rank-save"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("This round is closed to changes.");
    expect(rankedNames()).toEqual(["1st: Forensic"]);
  });
});

describe("RotationRankPage other states", () => {
  it("shows the published year with a rank word on every term", () => {
    render(<RotationRankPage roundId={publishedRound.round.id} now={NOW} />);
    expect(screen.getByTestId("rotation-year-hero")).toBeInTheDocument();
    const terms = screen.getAllByTestId("rotation-year-term");
    expect(terms).toHaveLength(4);
    for (const term of terms) expect(term.textContent).toMatch(/1st|2nd|3rd|\dth|Free place|Set/);
    // 8 Oct 2026 sits in Term 3 (2 Aug to 31 Oct).
    expect(terms[2]).toHaveAttribute("aria-current", "date");
  });

  it("reads the ranking back once the round has closed", () => {
    render(<RotationRankPage roundId={openRound.round.id} now={new Date("2026-12-01T00:00:00.000Z")} />);
    expect(screen.getByTestId("rotation-rank-closed")).toHaveTextContent("Closed. Allocation is in progress");
    expect(screen.queryByTestId("rotation-rank-send")).not.toBeInTheDocument();
  });

  it("says when a round is not here, with a way back", () => {
    render(<RotationRankPage roundId="example:round:gone" now={NOW} />);
    expect(screen.getByTestId("rotation-rank-not-found")).toBeInTheDocument();
    expect(screen.getByTestId("rotation-rank-back")).toHaveAttribute("href", "/roster/rotations");
  });

  it("offers the example while rotations are not live for real teams", () => {
    read.current = { ...readWith(), status: "unavailable", mine: [], managed: [] };
    render(<RotationRankPage roundId={openRound.round.id} now={NOW} />);
    expect(screen.getByTestId("rotation-rank-unavailable")).toHaveTextContent("not live for real teams yet");
    expect(screen.getByTestId("rotation-rank-show-example")).toBeInTheDocument();
  });
});
