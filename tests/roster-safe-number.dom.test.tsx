/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RosterSafeNumber } from "@/components/roster/manage/roster-safe-number";
import { RosterManagePage } from "@/components/roster/manage/roster-manage-page";
import type { RosterOverview } from "@/lib/roster/team/model";
import { ToastProvider } from "@/components/ui/toast";

/*
 * The team's safe number editor in Manage, Team settings. Every team, person
 * and number here is invented.
 */

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/manage",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/components/roster/manage/roster-manage-nav-header", () => ({ RosterManageNavHeader: () => null }));

afterEach(() => {
  cleanup();
  search.value = "";
  vi.unstubAllGlobals();
});

const overview: RosterOverview = {
  service: { id: "team", name: "Example team" },
  me: { role: "manager", grade: null, rotationEndsOn: null },
  latestPublication: null,
  seenLatest: true,
  settings: { swapApproval: "auto_same_grade", rules: {}, rulesSource: null, payFortnightAnchor: null },
  sites: [],
};

const id = (n: number) => `5e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Two on each weekday day shift, plus a dated night need the editor must keep. */
const needs = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({
    id: id(weekday),
    weekday,
    date: null,
    kind: "day",
    grade: null,
    siteId: null,
    needed: 2,
  })),
  { id: id(9), weekday: null, date: "2026-12-25", kind: "night", grade: "registrar", siteId: null, needed: 1 },
];

function stubTeam(options: { post?: () => Response | Promise<Response>; maker?: () => Response } = {}) {
  const posts: unknown[] = [];
  const reads: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return options.post ? options.post() : Response.json({ result: { ok: true } });
    }
    const what = new URL(String(input), "http://localhost").searchParams.get("what") ?? "teams";
    reads.push(what);
    if (what === "maker") return options.maker ? options.maker() : Response.json({ codes: [], needs, drafts: [] });
    if (what === "teams")
      return Response.json({
        actorId: "alex",
        teams: [{ serviceId: "team", name: "Example team", enabled: true, role: "manager", grade: null }],
      });
    if (what === "overview") return Response.json(overview);
    if (what === "assignments") return Response.json({ assignments: [] });
    if (what === "requests") return Response.json({ swaps: [], openShifts: [] });
    if (what === "publications") return Response.json({ publications: [] });
    return Response.json({ swaps: [], openShifts: [], seen: null, people: [], leave: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, posts, reads };
}

it("shows nothing and reads nothing for a team member who is not its manager", () => {
  const { fetcher } = stubTeam();
  const { container } = render(
    <RosterSafeNumber serviceId="team" overview={{ ...overview, me: { ...overview.me, role: "member" } }} />,
  );
  expect(container.innerHTML).toBe("");
  expect(fetcher).not.toHaveBeenCalled();
});

it("says while loading, then shows one number for Monday to Friday and one for the weekend", async () => {
  stubTeam();
  render(<RosterSafeNumber serviceId="team" overview={overview} />);
  expect(screen.getByRole("status", { name: "Loading your safe number…" })).toBeTruthy();
  const weekdays = (await screen.findByLabelText("Day, Monday to Friday")) as HTMLInputElement;
  expect(weekdays.value).toBe("2");
  expect((screen.getByLabelText("Day, Saturday and Sunday") as HTMLInputElement).value).toBe("0");
  expect(screen.getByText(/your team's own number, set by you as its roster manager/i)).toBeTruthy();
  expect(screen.getByText(/isn't an official staffing figure/i)).toBeTruthy();
  expect(screen.getByTestId("roster-safe-number-others").textContent).toMatch(/1 other cover need/);
  // Nothing has changed yet, so there is nothing to save.
  expect((screen.getByTestId("roster-safe-number-save") as HTMLButtonElement).disabled).toBe(true);
  // Every control in a row is a 48 px tap target.
  for (const button of within(screen.getByTestId("roster-safe-number-day-weekdays")).getAllByRole("button")) {
    expect(button.className).toContain("min-h-12");
    expect(button.className).toContain("min-w-12");
  }
});

it("saves the whole list once, keeping the dated need, reading the team's needs again first", async () => {
  const { posts, reads } = stubTeam();
  const onSaved = vi.fn();
  render(<RosterSafeNumber serviceId="team" overview={overview} onSaved={onSaved} />);
  fireEvent.click(await screen.findByRole("button", { name: "One more, Day, Monday to Friday" }));
  fireEvent.change(screen.getByLabelText("Night, Saturday and Sunday"), { target: { value: "1" } });
  const before = reads.filter((what) => what === "maker").length;
  fireEvent.click(screen.getByRole("button", { name: "Save safe number" }));
  expect(await screen.findByText("Saved. The Cover tab and the staffing check now use these numbers.")).toBeTruthy();
  expect(reads.filter((what) => what === "maker").length).toBe(before + 1);
  expect(posts).toEqual([
    {
      action: "needs.set",
      needs: [
        { weekday: null, date: "2026-12-25", kind: "night", grade: "registrar", siteId: null, needed: 1 },
        ...[1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          date: null,
          kind: "day",
          grade: null,
          siteId: null,
          needed: 3,
        })),
        ...[6, 7].map((weekday) => ({ weekday, date: null, kind: "night", grade: null, siteId: null, needed: 1 })),
      ],
    },
  ]);
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect((screen.getByTestId("roster-safe-number-save") as HTMLButtonElement).disabled).toBe(true);
});

it("Undo puts back only the safe number, keeping a need another manager set after the save", async () => {
  let current: readonly object[] = needs;
  const { posts } = stubTeam({ maker: () => Response.json({ codes: [], needs: current, drafts: [] }) });
  render(
    <ToastProvider>
      <RosterSafeNumber serviceId="team" overview={overview} />
    </ToastProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "One more, Day, Monday to Friday" }));
  fireEvent.click(screen.getByRole("button", { name: "Save safe number" }));
  await screen.findByText(/^Saved\./);
  // Another manager adds a dated need between the save and the Undo.
  const added = { id: id(10), weekday: null, date: "2026-12-26", kind: "day", grade: null, siteId: null, needed: 1 };
  current = [...needs, added];
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]).toEqual({
    action: "needs.set",
    needs: [
      { weekday: null, date: "2026-12-25", kind: "night", grade: "registrar", siteId: null, needed: 1 },
      { weekday: null, date: "2026-12-26", kind: "day", grade: null, siteId: null, needed: 1 },
      ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, date: null, kind: "day", grade: null, siteId: null, needed: 2 })),
    ],
  });
  await waitFor(() => expect((screen.getByLabelText("Day, Monday to Friday") as HTMLInputElement).value).toBe("2"));
});

it("keeps a number another manager changed while this editor was open, saving only this manager's change", async () => {
  let current: readonly object[] = needs;
  const { posts } = stubTeam({ maker: () => Response.json({ codes: [], needs: current, drafts: [] }) });
  render(<RosterSafeNumber serviceId="team" overview={overview} />);
  fireEvent.click(await screen.findByRole("button", { name: "One more, Day, Monday to Friday" }));
  // Meanwhile another manager sets a weekend night number.
  const night = [6, 7].map((weekday) => ({
    id: id(20 + weekday),
    weekday,
    date: null,
    kind: "night",
    grade: null,
    siteId: null,
    needed: 1,
  }));
  current = [...needs, ...night];
  fireEvent.click(screen.getByRole("button", { name: "Save safe number" }));
  await screen.findByText(/^Saved\./);
  expect(posts[0]).toEqual({
    action: "needs.set",
    needs: [
      { weekday: null, date: "2026-12-25", kind: "night", grade: "registrar", siteId: null, needed: 1 },
      ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, date: null, kind: "day", grade: null, siteId: null, needed: 3 })),
      ...[6, 7].map((weekday) => ({ weekday, date: null, kind: "night", grade: null, siteId: null, needed: 1 })),
    ],
  });
  expect((screen.getByLabelText("Night, Saturday and Sunday") as HTMLInputElement).value).toBe("1");
});

it("shows Saving while the save is on its way and keeps the numbers locked", async () => {
  let answer: (response: Response) => void = () => {};
  stubTeam({ post: () => new Promise<Response>((resolve) => (answer = resolve)) });
  render(<RosterSafeNumber serviceId="team" overview={overview} />);
  fireEvent.click(await screen.findByRole("button", { name: "One more, Night, Monday to Friday" }));
  fireEvent.click(screen.getByRole("button", { name: "Save safe number" }));
  const saving = await screen.findByRole("button", { name: "Saving…" });
  expect((saving as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Night, Monday to Friday") as HTMLInputElement).disabled).toBe(true);
  answer(Response.json({ result: { ok: true } }));
  expect(await screen.findByText(/^Saved\./)).toBeTruthy();
});

it("says what went wrong and keeps the numbers when the save is refused", async () => {
  stubTeam({
    post: () =>
      Response.json({ code: "roster_role_denied", message: "Only a roster manager can do that." }, { status: 403 }),
  });
  render(<RosterSafeNumber serviceId="team" overview={overview} />);
  fireEvent.click(await screen.findByRole("button", { name: "One more, Evening (late), Saturday and Sunday" }));
  fireEvent.click(screen.getByRole("button", { name: "Save safe number" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Only a roster manager can do that.");
  expect((screen.getByLabelText("Evening (late), Saturday and Sunday") as HTMLInputElement).value).toBe("1");
  expect((screen.getByTestId("roster-safe-number-save") as HTMLButtonElement).disabled).toBe(false);
});

it("says nothing was saved when the connection drops, and keeps the numbers", async () => {
  const online = vi.spyOn(window.navigator, "onLine", "get");
  try {
    stubTeam({
      post: () => {
        online.mockReturnValue(false);
        throw new TypeError("Failed to fetch");
      },
    });
    render(<RosterSafeNumber serviceId="team" overview={overview} />);
    fireEvent.click(await screen.findByRole("button", { name: "One more, Day, Saturday and Sunday" }));
    fireEvent.click(screen.getByRole("button", { name: "Save safe number" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/You're offline, so nothing was saved/);
    expect((screen.getByLabelText("Day, Saturday and Sunday") as HTMLInputElement).value).toBe("1");
  } finally {
    online.mockRestore();
  }
});

it("offers Try again when the safe number can't be read", async () => {
  let fail = true;
  stubTeam({
    maker: () =>
      fail
        ? Response.json(
            { code: "roster_unavailable", message: "Roster couldn't be reached. Try again shortly." },
            { status: 503 },
          )
        : Response.json({ codes: [], needs, drafts: [] }),
  });
  render(<RosterSafeNumber serviceId="team" overview={overview} />);
  expect(await screen.findByText("Your safe number couldn't be loaded")).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("Day, Monday to Friday")).toBeTruthy();
});

it("on the example team, sends nothing and says nothing is saved", async () => {
  const { posts } = stubTeam();
  render(<RosterSafeNumber serviceId="team" overview={overview} example />);
  fireEvent.click(await screen.findByRole("button", { name: "One more, Day, Monday to Friday" }));
  fireEvent.click(screen.getByRole("button", { name: "Save safe number" }));
  expect(await screen.findByText("This is the example team, so nothing is saved.")).toBeTruthy();
  expect(posts).toEqual([]);
});

it("shows each day when the days differ, and sets one day without touching the others", async () => {
  const mixed = [
    { id: id(1), weekday: 1, date: null, kind: "day", grade: null, siteId: null, needed: 3 },
    { id: id(2), weekday: 2, date: null, kind: "day", grade: null, siteId: null, needed: 2 },
  ];
  const { posts } = stubTeam({ maker: () => Response.json({ codes: [], needs: mixed, drafts: [] }) });
  render(<RosterSafeNumber serviceId="team" overview={overview} />);
  expect(((await screen.findByLabelText("Day, Monday")) as HTMLInputElement).value).toBe("3");
  expect(screen.getByText("Your days differ, so each day is shown.")).toBeTruthy();
  expect(screen.queryByLabelText("Day, Monday to Friday")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "One fewer, Day, Tuesday" }));
  fireEvent.click(screen.getByRole("button", { name: "Save safe number" }));
  await screen.findByText(/^Saved\./);
  expect(posts).toEqual([
    {
      action: "needs.set",
      needs: [
        { weekday: 1, date: null, kind: "day", grade: null, siteId: null, needed: 3 },
        { weekday: 2, date: null, kind: "day", grade: null, siteId: null, needed: 1 },
      ],
    },
  ]);
});

it("lets a manager set each day separately, and go back while the days still match", async () => {
  stubTeam();
  render(<RosterSafeNumber serviceId="team" overview={overview} />);
  fireEvent.click(await screen.findByRole("button", { name: "Set each day separately" }));
  expect((screen.getByLabelText("Day, Wednesday") as HTMLInputElement).value).toBe("2");
  fireEvent.click(screen.getByRole("button", { name: "Set weekdays and weekends together" }));
  expect(screen.getByLabelText("Day, Monday to Friday")).toBeTruthy();
});

it("in Manage, Team settings, a save makes the calendar read the team's needs again", async () => {
  search.value = "view=team";
  const { reads } = stubTeam();
  render(<RosterManagePage />);
  const section = await screen.findByTestId("roster-safe-number");
  await within(await screen.findByTestId("roster-manage-calendar")).findByRole("radiogroup", { name: "View" });
  fireEvent.click(await within(section).findByRole("button", { name: "One more, Day, Monday to Friday" }));
  // The editor and the calendar share the first read of the team's needs.
  const makerReads = () => reads.filter((what) => what === "maker").length;
  await waitFor(() => expect(makerReads()).toBeGreaterThanOrEqual(1));
  const before = makerReads();
  fireEvent.click(within(section).getByRole("button", { name: "Save safe number" }));
  await within(section).findByText(/^Saved\./);
  // One fresh read before the save, then the calendar reads the new number for its cover counts.
  await waitFor(() => expect(makerReads()).toBe(before + 2));
});
