/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const routerPush = vi.fn();
const readContextSpy = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("@/components/roster/ask/use-roster-ask-context", () => ({
  useRosterAskContext: () => {
    readContextSpy();
    return {
      parser: {
        today: "2026-10-01",
        actorId: "11111111-1111-4111-8111-111111111111",
        assignments: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            userId: "11111111-1111-4111-8111-111111111111",
            name: "Alex Example",
            grade: "registrar",
            startsAt: "2026-10-20T13:00:00Z",
            endsAt: "2026-10-21T05:00:00Z",
            kind: "night",
            shiftCode: "N",
          },
        ],
        people: [],
        codes: ["N"],
      },
      answers: { today: "2026-10-01", shifts: [], assignments: [], actorId: "11111111-1111-4111-8111-111111111111" },
      teamChoices: [],
      selectedTeamId: "22222222-2222-4222-8222-222222222222",
      selectTeam: vi.fn(),
      loading: false,
      teamLoading: false,
    };
  },
}));

import { RosterAskButton } from "@/components/roster/ask/roster-ask-box";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  routerPush.mockClear();
  readContextSpy.mockClear();
});

function openAsk() {
  render(<RosterAskButton />);
  fireEvent.click(screen.getByRole("button", { name: "Ask or change your roster" }));
  return screen.getByRole("textbox", { name: "Ask or change your roster" });
}

it("opens from a single icon and shows no suggestion buttons", () => {
  render(<RosterAskButton />);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "When am I next on nights?" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ask or change your roster" }));
  expect(screen.getByRole("textbox", { name: "Ask or change your roster" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "When am I next on nights?" })).toBeNull();
});

it("does not read roster data until someone asks", () => {
  const input = openAsk();
  expect(readContextSpy).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "When am I next on nights?" } });
  fireEvent.submit(input.closest("form")!);
  expect(readContextSpy).toHaveBeenCalled();
});

it("keeps reason text out of fetch, URL and storage", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
  const storageSpy = vi.spyOn(Storage.prototype, "setItem");
  const input = openAsk();
  fireEvent.change(input, { target: { value: "I can't do Tue 20 Oct night because my partner is unwell" } });
  fireEvent.submit(input.closest("form")!);
  expect(screen.getByText("Reasons aren't saved.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(routerPush).toHaveBeenCalledWith(
    "/roster/requests?team=22222222-2222-4222-8222-222222222222&start=give_away&assignment=33333333-3333-4333-8333-333333333333",
  );
  expect(fetchSpy.mock.calls.flat().join(" ")).not.toMatch(/partner|unwell|can't do/i);
  expect(routerPush.mock.calls.flat().join(" ")).not.toMatch(/partner|unwell|can't do/i);
  expect(storageSpy).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: "Ask or change your roster" })).toBeNull();
});

it("has no microphone", () => {
  openAsk();
  expect(screen.queryByRole("button", { name: /voice|microphone|dictate/i })).toBeNull();
});
