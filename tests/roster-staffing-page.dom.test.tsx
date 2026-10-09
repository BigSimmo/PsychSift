// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reads: [] as { what: string; range?: { from: string; to: string } | null }[],
  announce: vi.fn(),
  reload: vi.fn(),
  status: "ready" as string,
  teams: { status: "ready" as string, message: null as string | null, reload: vi.fn(), data: null as unknown },
}));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => mocks.teams,
  useRosterRead: (serviceId: string | null, what: string, range?: { from: string; to: string } | null) => {
    if (!serviceId) return { status: "loading", data: null, message: null, readAt: null, reload: vi.fn() };
    mocks.reads.push({ what, range });
    if (mocks.status !== "ready")
      return {
        status: mocks.status,
        data: null,
        message: "Roster couldn't be reached.",
        readAt: null,
        reload: vi.fn(),
      };
    const data =
      what === "assignments"
        ? { assignments: rows.filter((row) => row.date >= range!.from && row.date <= range!.to).map((row) => row.a) }
        : {
            service: { id: SERVICE, name: "Ward 4" },
            me: { role: "member", grade: "registrar", rotationEndsOn: null },
            latestPublication: {
              id: PUB,
              version: 1,
              publishedAt: "2026-10-01T00:00:00Z",
              periodStart: "2026-10-05",
              periodEnd,
            },
            seenLatest: true,
            settings: { swapApproval: "auto_same_grade", rules: {}, rulesSource: null, payFortnightAnchor: null },
            sites: [],
          };
    return { status: "ready", data, message: null, readAt: new Date("2026-10-06T11:30:00Z"), reload: mocks.reload };
  },
}));
vi.mock("@/components/roster/ask/roster-ask-box", () => ({ RosterAskButton: () => null }));
vi.mock("@/components/ui/live-announcer", () => ({ announce: mocks.announce }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/roster/staffing",
}));
const copied = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>(async () => undefined));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyTextToClipboard: (text: string) => copied(text) }));

import { RosterStaffingPage } from "@/components/roster/staffing/roster-staffing-page";

const NOW = new Date("2026-10-06T11:30:00Z"); // Tue 6 Oct, 19:30 Perth
const ME = "5e000000-0000-4000-8000-000000000001";
const SERVICE = "5e000000-0000-4000-8000-000000000003";
const PUB = "5e000000-0000-4000-8000-000000000004";
const team = { serviceId: SERVICE, name: "Ward 4", enabled: true, role: "member", grade: "registrar" };
let periodEnd = "2026-10-25";

const people = [2, 3, 4, 5].map((n) => `5e000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`);
type Row = { date: string; a: Record<string, unknown> };
const rows: Row[] = [];
let n = 100;
function add(userId: string, date: string, kind = "day") {
  n += 1;
  rows.push({
    date,
    a: {
      id: `5e000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      userId,
      name: null,
      grade: "registrar",
      siteId: null,
      siteName: null,
      startsAt: `${date}T00:00:00Z`,
      endsAt: `${date}T08:30:00Z`,
      shiftCode: kind === "day" ? "D" : kind === "night" ? "N" : "OC",
      kind,
    },
  });
}
for (let day = 5; day <= 31; day += 1) {
  const date = `2026-10-${String(day).padStart(2, "0")}`;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const on = weekday === 0 || weekday === 6 ? people.slice(0, 2) : people;
  // Fri 23 is short one.
  for (const person of date === "2026-10-23" ? on.slice(0, 3) : on) add(person, date);
}
for (const date of ["2026-10-21", "2026-10-22", "2026-10-23"]) add(ME, date);
// Mon 19 also has a night registrar and a consultant on call: neither counts as on.
add("5e000000-0000-4000-8000-000000000006", "2026-10-19", "night");
add("5e000000-0000-4000-8000-000000000007", "2026-10-19", "on_call");

beforeEach(() => {
  mocks.reads.length = 0;
  mocks.status = "ready";
  mocks.announce.mockReset();
  periodEnd = "2026-10-25";
  mocks.teams = { status: "ready", message: null, reload: vi.fn(), data: { teams: [team], actorId: ME } };
  window.history.replaceState(null, "", "/roster/staffing");
});
afterEach(cleanup);

const column = (date: string) => document.querySelector(`[data-staffing-day="${date}"]`)!.firstElementChild!;

it("shows the next three weeks, each day read out in words, and says no safe number is set", () => {
  render(<RosterStaffingPage now={NOW} />);
  expect(screen.getByRole("heading", { name: "Team staffing", level: 1 })).toBeTruthy();
  expect(document.querySelectorAll("[data-staffing-day]")).toHaveLength(21);
  expect(column("2026-10-22").getAttribute("aria-label")).toBe("Thu 22: 5 on, including you");
  expect(column("2026-10-24").getAttribute("aria-label")).toBe("Sat 24: 2 on");
  expect(screen.getByTestId("staffing-safe-note").textContent).toContain("safe number isn't set in PsychSift");
  expect(document.body.textContent).not.toMatch(/\bsafe to\b|is safe|stays safe/i);
  // One assignments read, inside the read's 62-day limit.
  const read = mocks.reads.find((item) => item.what === "assignments")!;
  expect(read.range).toEqual({ from: "2026-10-05", to: "2026-10-25" });
  expect(screen.queryByTestId("staffing-plan")).toBeNull();
});

it("has a visible way back to Roster, and the span sits on its own line under the head", () => {
  render(<RosterStaffingPage now={NOW} />);
  const back = screen.getByTestId("roster-staffing-back");
  expect(back.getAttribute("href")).toBe("/roster");
  expect(back.textContent).toBe("Roster");
  const meta = screen.getByTestId("staffing-meta");
  expect(meta.textContent).toContain("Next 3 weeks");
  expect(meta.textContent).toContain("Rechecked");
  expect(meta.closest("h2")).toBeNull();
});

it("typed dates show your leave, the fewest on, other dates and a Plan this leave hand-off", async () => {
  render(<RosterStaffingPage now={NOW} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("First day"), "2026-10-22");
  await user.clear(screen.getByLabelText("Last day"));
  await user.type(screen.getByLabelText("Last day"), "2026-10-23");
  expect(screen.getByTestId("staffing-result").textContent).toBe(
    "Fewest on: 3 people, Fri 23. You're rostered on 2 of these days.",
  );
  expect(column("2026-10-23").getAttribute("aria-label")).toBe(
    "Fri 23: 3 on, you off on leave, fewest on, in your leave",
  );
  expect(column("2026-10-23").getAttribute("aria-pressed")).toBe("true");
  const options = screen.getByTestId("staffing-options");
  expect(options.textContent).toContain("Wed 21 to Thu 22 Oct");
  expect(screen.getByTestId("staffing-plan").getAttribute("href")).toBe(
    "/roster/requests?start=leave&date=2026-10-22&to=2026-10-23",
  );
  await user.click(within(options).getByRole("button", { name: "Use Wed 21 to Thu 22 Oct" }));
  expect(screen.getByTestId("staffing-result").textContent).toBe(
    "Fewest on: 4 people, Wed 21 and Thu 22. You're rostered on 2 of these days.",
  );
  expect(mocks.announce).toHaveBeenCalledWith("Wed 21 to Thu 22 Oct picked");
});

it("tapping a day then a later day picks the run, and a third tap starts again", async () => {
  render(<RosterStaffingPage now={NOW} />);
  const user = userEvent.setup();
  await user.click(column("2026-10-14") as HTMLElement);
  expect((screen.getByLabelText("First day") as HTMLInputElement).value).toBe("2026-10-14");
  await user.click(column("2026-10-16") as HTMLElement);
  expect((screen.getByLabelText("Last day") as HTMLInputElement).value).toBe("2026-10-16");
  expect(screen.getByText("3 days. Tap a day to start again.")).toBeTruthy();
  await user.click(column("2026-10-15") as HTMLElement);
  expect((screen.getByLabelText("First day") as HTMLInputElement).value).toBe("2026-10-15");
  expect((screen.getByLabelText("Last day") as HTMLInputElement).value).toBe("2026-10-15");
  // Past days are not buttons.
  expect(column("2026-10-05").tagName).toBe("SPAN");
});

it("days the published roster does not reach are not checked, never shown as fine", () => {
  periodEnd = "2026-10-15";
  window.history.replaceState(null, "", "/roster/staffing?from=2026-10-20&to=2026-10-21");
  render(<RosterStaffingPage now={NOW} />);
  expect(screen.getByTestId("staffing-result").textContent).toBe(
    "Can't check yet. The roster isn't published for these dates.",
  );
  expect(column("2026-10-20").getAttribute("aria-label")).toContain("not checked, roster not published");
  expect(screen.queryByTestId("staffing-options")).toBeNull();
});

it("says plainly when the last day is before the first", async () => {
  window.history.replaceState(null, "", "/roster/staffing?from=2026-10-22&to=2026-10-20");
  render(<RosterStaffingPage now={NOW} />);
  expect(screen.getByTestId("staffing-problem").textContent).toBe("The last day is before the first.");
  expect(screen.queryByTestId("staffing-plan")).toBeNull();
  // A bad address date is ignored rather than trusted.
  cleanup();
  window.history.replaceState(null, "", "/roster/staffing?from=2026-02-30");
  render(<RosterStaffingPage now={NOW} />);
  expect((screen.getByLabelText("First day") as HTMLInputElement).value).toBe("");
});

it("Clear empties the dates", async () => {
  window.history.replaceState(null, "", "/roster/staffing?from=2026-10-22&to=2026-10-23");
  render(<RosterStaffingPage now={NOW} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Clear the dates" }));
  expect((screen.getByLabelText("First day") as HTMLInputElement).value).toBe("");
  expect(screen.queryByTestId("staffing-result")).toBeNull();
});

it("a failed read fails closed with Try again", () => {
  mocks.status = "error";
  render(<RosterStaffingPage now={NOW} />);
  expect(screen.getByRole("alert").textContent).toContain("Team staffing couldn't be checked.");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(document.querySelectorAll("[data-staffing-day]")).toHaveLength(0);
});

it("with no team it links Join a team", () => {
  mocks.teams = { ...mocks.teams, data: { teams: [], actorId: ME } };
  render(<RosterStaffingPage now={NOW} />);
  const join = within(screen.getByTestId("staffing-no-team")).getByRole("link", { name: "Join a team" });
  expect(join.getAttribute("href")).toBe("/roster/join");
  // A 48px tap area round the short link, without changing how the note looks.
  expect(join).toHaveClass("work-hit");
});

it("carries no per-page label for the example team (the example data banner says it once)", () => {
  mocks.teams = { ...mocks.teams, data: { teams: [team], actorId: ME, sample: true } };
  render(<RosterStaffingPage now={NOW} />);
  expect(screen.queryByTestId("roster-sample-notice")).toBeNull();
});

it("copies a note asking the roster manager for the team's number, naming only the dates", async () => {
  render(<RosterStaffingPage now={NOW} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("First day"), "2026-10-22");
  await user.clear(screen.getByLabelText("Last day"));
  await user.type(screen.getByLabelText("Last day"), "2026-10-23");
  await user.click(screen.getByTestId("staffing-ask-copy"));
  expect(copied).toHaveBeenCalledWith(
    "Hi, I am thinking of leave Thu 22 to Fri 23 Oct. What is the fewest doctors Ward 4 needs on each day? I would like to pick dates that suit the team.\n\nThanks",
  );
  expect(screen.getByTestId("staffing-ask-copy").textContent).toBe("Copied");
});

it("Recheck reads the team roster again", async () => {
  render(<RosterStaffingPage now={NOW} />);
  mocks.reload.mockClear();
  await userEvent.setup().click(screen.getByTestId("staffing-recheck"));
  expect(mocks.reload).toHaveBeenCalled();
  expect(mocks.announce).toHaveBeenCalledWith("Checking the roster again");
});

it("counts only Day and Evening shifts as on, and says so under the strip", () => {
  render(<RosterStaffingPage now={NOW} />);
  expect(column("2026-10-19").getAttribute("aria-label")).toBe("Mon 19: 4 on");
  expect(screen.getByTestId("staffing-counts").textContent).toBe(
    "Counts Day and Evening (late) shifts only. Night, on call and other work aren't counted.",
  );
  expect(
    screen.getByRole("list", { name: "How many of the team are on a Day or Evening shift each day" }),
  ).toBeTruthy();
});

it("on a 320 px phone each day stays a 48 px button and the week scrolls inside its own row", () => {
  render(<RosterStaffingPage now={NOW} />);
  const week = screen.getByRole("list", { name: "How many of the team are on a Day or Evening shift each day" });
  expect(week.className).toContain("overflow-x-auto");
  expect(week.className).toContain("grid-flow-col");
  expect(week.className).not.toContain("grid-cols-7");
  expect(week.hasAttribute("data-no-tab-swipe")).toBe(true);
  for (const item of week.querySelectorAll("li")) expect(item.className).toContain("min-w-12");
  expect(column("2026-10-14").className).toContain("min-h-12");
  // The two date fields stack on a phone and only sit side by side from the small breakpoint.
  const fields = screen.getByTestId("staffing-date-fields");
  expect(fields.className).toContain("sm:grid-cols-2");
  expect(fields.className.split(/\s+/)).not.toContain("grid-cols-2");
});
