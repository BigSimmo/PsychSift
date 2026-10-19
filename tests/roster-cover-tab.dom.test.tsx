/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RosterCoverGap, RosterCoverTab } from "@/components/roster/manage/roster-cover-tab";
import type { RosterOverview } from "@/lib/roster/team/model";
const work = vi.hoisted(() => ({ zone: "Australia/Perth" }));
vi.mock("@/components/work-time/use-work-time-zone", () => ({ useWorkTimeZone: () => ({ zone: work.zone }) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  work.zone = "Australia/Perth";
});

it("posts an overnight Cover gap using the selected Sydney wall clock", async () => {
  work.zone = "Australia/Sydney";
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ result: { openShiftId: "synthetic" } }));
  vi.stubGlobal("fetch", fetcher);
  render(
    <RosterCoverGap
      date="2026-10-17"
      need={{
        id: "need",
        date: "2026-10-17",
        weekday: null,
        kind: "night",
        grade: "registrar",
        siteId: null,
        needed: 1,
      }}
      assignments={[]}
      overview={overview}
      serviceId="team"
      onPosted={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Gap:/ }));
  fireEvent.change(screen.getByLabelText("Starts (Sydney and Canberra)"), { target: { value: "23:00" } });
  fireEvent.change(screen.getByLabelText("Ends (Sydney and Canberra)"), { target: { value: "07:00" } });
  fireEvent.change(screen.getByLabelText("Shift code"), { target: { value: "N" } });
  fireEvent.click(screen.getByRole("button", { name: "Post gap" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
  expect(body).toMatchObject({ startsAt: "2026-10-17T12:00:00.000Z", endsAt: "2026-10-17T20:00:00.000Z" });
});

it("blocks a Cover gap at a skipped daylight-saving time", () => {
  work.zone = "Australia/Sydney";
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(
    <RosterCoverGap
      date="2026-10-04"
      need={{ id: "need", date: "2026-10-04", weekday: null, kind: "day", grade: "registrar", siteId: null, needed: 1 }}
      assignments={[]}
      overview={overview}
      serviceId="team"
      onPosted={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Gap:/ }));
  fireEvent.change(screen.getByLabelText("Starts (Sydney and Canberra)"), { target: { value: "02:30" } });
  fireEvent.change(screen.getByLabelText("Ends (Sydney and Canberra)"), { target: { value: "08:00" } });
  fireEvent.change(screen.getByLabelText("Shift code"), { target: { value: "D" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose valid times");
  expect(screen.getByRole("button", { name: "Post gap" })).toBeDisabled();
  expect(fetcher).not.toHaveBeenCalled();
});

const overview: RosterOverview = {
  service: { id: "team", name: "Example team" },
  me: { role: "manager", grade: null, rotationEndsOn: null },
  latestPublication: null,
  seenLatest: true,
  settings: { swapApproval: "auto_same_grade", rules: {}, rulesSource: null, payFortnightAnchor: null },
  sites: [],
};

it("counts a Sunday target (weekday 7) and a Monday target (weekday 1) on those days", async () => {
  // Saturday 24 October 2026, Perth.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-24T02:00:00Z") });
  const need = (id: string, weekday: number) => ({
    id,
    weekday,
    date: null,
    kind: "day",
    grade: null,
    siteId: null,
    needed: 2,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const what = new URL(String(input), "http://localhost").searchParams.get("what");
      return Response.json(
        what === "maker"
          ? {
              codes: [],
              needs: [need("c1000000-0000-4000-8000-000000000001", 7), need("c1000000-0000-4000-8000-000000000002", 1)],
              drafts: [],
            }
          : what === "assignments"
            ? { assignments: [] }
            : { swaps: [], openShifts: [], seen: null },
      );
    }),
  );
  render(<RosterCoverTab serviceId="team" overview={overview} />);
  const sunday = (await screen.findByText("Sun 25 Oct")).closest("tr")!;
  expect(within(sunday).getByText("0 / 2")).toBeTruthy();
  const monday = screen.getByText("Mon 26 Oct").closest("tr")!;
  expect(within(monday).getByText("0 / 2")).toBeTruthy();
  const saturday = screen.getByText("Sat 24 Oct").closest("tr")!;
  expect(within(saturday).queryByText(/\/ 2/)).toBeNull();
});
