import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RotationsRead } from "@/components/roster/rotations/use-rotations";
import { exampleRotationRounds } from "@/lib/example-data/datasets/roster-rotations";
import { myRoundView } from "@/lib/roster/rotations/operations";

/* The doctor's Rotations page, read from the example rounds through a stubbed data hook. Invented data only. */

const read: { current: RotationsRead } = { current: null as unknown as RotationsRead };
vi.mock("@/components/roster/rotations/use-rotations", () => ({ useRotations: () => read.current }));

const { RotationsHomePage } = await import("@/components/roster/rotations/rotations-home-page");

const NOW = new Date("2026-10-08T02:00:00.000Z");
const example = exampleRotationRounds(NOW);

function readWith(rounds = example.rounds): RotationsRead {
  return {
    status: "ready",
    source: "example",
    mine: rounds.map((round) => myRoundView(round, example.selfId)),
    managed: rounds,
    canManage: true,
    teams: [],
    team: null,
    actions: {} as RotationsRead["actions"],
    retry: vi.fn(),
  };
}

afterEach(cleanup);

describe("RotationsHomePage", () => {
  it("leads with the open round to rank, then the published year with the current term marked", () => {
    read.current = readWith();
    render(<RotationsHomePage now={NOW} />);
    const hero = screen.getByTestId("rotations-open-hero");
    expect(hero).toHaveAttribute("href", `/roster/rotations/${encodeURIComponent(example.rounds[0]!.round.id)}`);
    expect(hero).toHaveTextContent("Rank your rotations");
    expect(hero).toHaveTextContent("8 rotations · 4 terms");
    expect(hero).toHaveTextContent("Not started");
    expect(screen.queryByTestId("rotation-year-hero")).not.toBeInTheDocument();
    const terms = screen.getAllByTestId("rotation-year-term");
    expect(terms).toHaveLength(4);
    expect(terms[2]).toHaveAttribute("aria-current", "date");
    expect(screen.getByTestId("rotation-calendar")).toBeInTheDocument();
  });

  it("says when results come out while nothing is published yet", () => {
    read.current = readWith([example.rounds[0]!]);
    render(<RotationsHomePage now={NOW} />);
    expect(screen.getByTestId("rotations-year-placeholder")).toHaveTextContent("Results come out after");
  });

  it("explains rounds come from the roster administrator when there are none", () => {
    read.current = readWith([]);
    render(<RotationsHomePage now={NOW} />);
    expect(screen.getByTestId("rotations-home-empty")).toHaveTextContent("Your roster administrator opens a round");
  });

  it("offers Try again when the rounds did not load", () => {
    read.current = { ...readWith([]), status: "error" };
    render(<RotationsHomePage now={NOW} />);
    screen.getByTestId("rotations-home-retry").click();
    expect(read.current.retry).toHaveBeenCalled();
  });
});
