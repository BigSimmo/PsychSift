/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { CalendarDays } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { modeIconTile, modeSummarySurface } from "@/components/mode-kit/recipes";
import { AttendanceChart, attendanceSentence, attendanceWeeks } from "@/components/teaching/attendance-chart";
import { defaultCpdHours, LogToCpdSheet, parseCpdHours } from "@/components/teaching/log-to-cpd-sheet";
import { ActionStrip } from "@/components/teaching/teaching-actions";
import { timeRange } from "@/components/teaching/teaching-dates";
import { TeachingHero } from "@/components/teaching/teaching-hero";
import {
  DayRail,
  DrainingHairline,
  LogbookLedger,
  SessionTimeline,
  TeachingContextBar,
  TeachingModule,
  TeachingSwitch,
} from "@/components/teaching/teaching-modules";
import { withUnit } from "@/components/teaching/teaching-number";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";

import { json, NB, OCC, serveFetch, teamA, teamB, useTeachingTestClock } from "./helpers/teaching-fixtures";

// A shared fixture, not a component hook: it only registers Vitest's
// `beforeEach`/`afterEach`. The `use*` name is the contract (every later
// Teaching test file calls it the same way), so the lint rule that assumes
// a React hook is silenced here, not renamed away.
// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock();

describe("numbers and times", () => {
  it("joins a number to its unit with a non-breaking space, and writes a time range with an en dash", () => {
    expect(withUnit(14, "h")).toBe(`14${NB}h`);
    expect(withUnit("68", "of 86")).toBe(`68${NB}of 86`);
    expect(timeRange("2026-09-30T04:30:00.000Z", "2026-09-30T05:30:00.000Z")).toBe("12:30–13:30");
  });
});

describe("TeachingContextBar", () => {
  it("names one service without a switch, and offers each service when there are two (review focus 4)", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TeachingContextBar teams={[teamA]} value="all" onChange={onChange} demoTag />);
    expect(screen.getByText("Hospital A psychiatry")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Demo · made-up people")).toBeInTheDocument();
    rerender(<TeachingContextBar teams={[teamA, teamB]} value="all" onChange={onChange} demoTag={false} />);
    const select = screen.getByRole("combobox", { name: "Service" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All services", "Hospital A psychiatry", "Hospital B psychiatry"]);
    fireEvent.change(select, { target: { value: teamB.id } });
    expect(onChange).toHaveBeenCalledWith(teamB.id);
  });

  it("renders nothing without a service", () => {
    const { container } = render(<TeachingContextBar teams={[]} value="all" onChange={vi.fn()} demoTag={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TeachingModule", () => {
  it("heads a module with a small label, a plum icon tile and an aside", () => {
    render(
      <TeachingModule title="Needs you" icon={CalendarDays} aside="2 things" testId="probe">
        <p>body</p>
      </TeachingModule>,
    );
    const moduleEl = screen.getByTestId("probe");
    expect(within(moduleEl).getByRole("heading", { name: "Needs you" })).toBeInTheDocument();
    const tile = moduleEl.querySelector("[data-icon-tile]")!;
    expect(tile.className).toBe(modeIconTile);
    expect(tile).toHaveAttribute("data-mode-identity", "teaching");
    expect(within(moduleEl).getByText("2 things")).toBeInTheDocument();
  });

  it("leads a live module with its state instead of an icon tile", () => {
    render(
      <TeachingModule title="On now" live freshKey="on" aside="Check-in open until 13:45" testId="phase">
        <p>body</p>
      </TeachingModule>,
    );
    const moduleEl = screen.getByTestId("phase");
    expect(moduleEl.querySelector("[data-icon-tile]")).toBeNull();
    expect(within(moduleEl).getByRole("heading", { name: "On now" })).toBeInTheDocument();
    const dot = moduleEl.querySelector("[data-live-dot]")!;
    expect(dot.className).toContain("bg-[color:var(--success)]");
    expect(dot.className).toContain("motion-safe:animate-[teaching-live-pulse_600ms_ease-out_1]");
  });
});

describe("SessionTimeline", () => {
  const row = { id: "r", href: null, timeTop: "12:30", timeBottom: "13:30", title: "Registrar teaching", meta: "" };

  it("links rows, strikes a moved session's old time and a cancelled title, and opens a sheet on onSelect", () => {
    const onSelect = vi.fn();
    render(
      <SessionTimeline
        testId="list"
        groups={[
          {
            id: "g",
            label: "Thursday 1 October",
            count: `2${NB}sessions`,
            rows: [
              {
                ...row,
                id: "one",
                href: "/teaching/session/one",
                timeTop: "13:30",
                timeBottom: "14:30",
                was: "12:30",
                title: "Grand round",
                meta: "Moved from 12:30",
              },
              { ...row, id: "c", title: "Case conference", meta: "Cancelled", cancelled: true },
              { ...row, id: "s", onSelect, title: "Tutorial", meta: "Room 4" },
            ],
          },
        ]}
      />,
    );
    const list = screen.getByTestId("list");
    expect(within(list).getByRole("link", { name: /Grand round/ })).toHaveAttribute("href", "/teaching/session/one");
    const was = within(list).getByTestId("teaching-was-one");
    expect(was).toHaveTextContent("was 12:30");
    expect(was.className).toContain("line-through");
    expect(within(list).getByText("Case conference").className).toContain("line-through");
    fireEvent.click(within(list).getByRole("button", { name: /Tutorial/ }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("stacks the time above the title until the list is 17rem wide (review focus 1)", () => {
    render(<SessionTimeline testId="list" groups={[{ id: "g", label: "Today", count: null, rows: [row] }]} />);
    const time = screen.getByTestId("teaching-row-r").querySelector("[data-row-time]")!;
    expect(time.className).toContain("flex");
    expect(time.className).toContain("@min-[17rem]:grid");
  });
});

describe("LogbookLedger", () => {
  it("puts the month total in the label and moves the hours under a long title (review focus 1)", () => {
    const { container } = render(
      <LogbookLedger
        groups={[
          {
            id: "2026-09",
            label: "September 2026",
            total: `2.0${NB}h`,
            rows: [
              {
                id: "r1",
                day: "28",
                weekday: "Mon",
                title: "Grand round",
                status: "Checked in by code",
                hours: "1.0",
                href: null,
              },
              {
                id: "r2",
                day: "30",
                weekday: "Wed",
                title: "Individual · case review, psychotherapy, formulation and medication",
                status: "Self-reported",
                hours: "1.0",
                href: null,
              },
            ],
          },
        ]}
      />,
    );
    // `toHaveTextContent` folds a real non-breaking space in the DOM to a
    // plain one before comparing (jest-dom's own "replace &nbsp; with normal
    // spaces"), so it can never match an expected string that still carries
    // the NBSP; an exact `textContent` comparison is the one that proves it.
    expect(screen.getByTestId("teaching-ledger-total-2026-09").textContent).toBe(`2.0${NB}h`);
    // The long row shows its hours WITH the unit ("1.0 h"), so `getByText`'s
    // exact match on the bare figure only ever finds the short row's; querying
    // both `[data-ledger-hours]` nodes directly is what actually proves each
    // row's own shape.
    const [short, long] = [...container.querySelectorAll<HTMLElement>("[data-ledger-hours]")];
    expect(short.getAttribute("data-below")).toBe("false");
    expect(short.textContent).toBe("1.0");
    expect(long.getAttribute("data-below")).toBe("true");
    expect(long.textContent).toBe(`1.0${NB}h`);
  });
});

describe("DayRail", () => {
  it("names each day with its count, mutes past days and reports the pick", () => {
    const onChange = vi.fn();
    render(
      <DayRail
        label="Days this week"
        value="2026-09-30"
        onChange={onChange}
        days={[
          { key: "2026-09-29", weekday: "Tue", day: "29", count: 0, past: true },
          { key: "2026-09-30", weekday: "Wed", day: "30", count: 2, past: false },
        ]}
      />,
    );
    const wednesday = screen.getByRole("button", { name: "Wed 30, 2 sessions" });
    expect(wednesday).toHaveAttribute("aria-pressed", "true");
    expect(wednesday.className).toContain("text-[color:var(--primary)]");
    const tuesday = screen.getByRole("button", { name: "Tue 29, no sessions" });
    expect(tuesday.className).toContain("text-[color:var(--text-muted)]");
    fireEvent.click(tuesday);
    expect(onChange).toHaveBeenCalledWith("2026-09-29");
  });
});

describe("TeachingSwitch", () => {
  const options = [
    { value: "all", label: "Whole service" },
    { value: "presenting", label: "Presenting" },
  ] as const;

  it("is the live segmented control, recoloured, and scrolls with a fade only while there is more (review focus 1)", () => {
    const onChange = vi.fn();
    render(<TeachingSwitch label="Show" value="all" onChange={onChange} options={options} />);
    fireEvent.click(screen.getByRole("radio", { name: "Presenting" }));
    expect(onChange).toHaveBeenCalledWith("presenting");
    const scroller = screen.getByTestId("teaching-switch");
    expect(scroller.className).toContain("[--clinical-accent-soft:var(--teaching-segment-on)]");
    expect(scroller.className).toContain("overflow-x-auto");
    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 600 });
    Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 358 });
    fireEvent.scroll(scroller);
    expect(scroller).toHaveAttribute("data-fade", "true");
    Object.defineProperty(scroller, "scrollLeft", { configurable: true, value: 242 });
    fireEvent.scroll(scroller);
    expect(scroller).toHaveAttribute("data-fade", "false");
  });
});

describe("DrainingHairline", () => {
  it("drains as a currentColor stroke that forced colours keep (review focus 2)", () => {
    const { container, rerender } = render(<DrainingHairline windowStartMs={0} windowMs={30_000} nowMs={0} />);
    expect(container.querySelector("line")!.getAttribute("stroke")).toBe("currentColor");
    expect(container.querySelector("line")!.getAttribute("x2")).toBe("100");
    rerender(<DrainingHairline windowStartMs={0} windowMs={30_000} nowMs={15_000} />);
    expect(container.querySelector("line")!.getAttribute("x2")).toBe("50");
    rerender(<DrainingHairline windowStartMs={0} windowMs={30_000} nowMs={45_000} />);
    expect(container.querySelector("line")!.getAttribute("x2")).toBe("0");
    expect(container.querySelector("svg")!.getAttribute("style")).toBeNull();
  });
});

describe("ActionStrip", () => {
  it("renders each action as a link or a button, in order, and says when one is busy", () => {
    render(
      <ActionStrip
        layout="stack"
        actions={[
          { id: "scan", label: "Check in with code", href: `/teaching/session/${OCC}?check-in=scan` },
          {
            id: "self",
            label: "Check in without code",
            onClick: vi.fn(),
            emphasis: "text",
            busy: true,
            busyLabel: "Saving",
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Check in with code" })).toHaveAttribute(
      "href",
      `/teaching/session/${OCC}?check-in=scan`,
    );
    expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
  });
});

describe("TeachingHero", () => {
  it("shows the start as one regular-weight figure with its end, and its two actions", () => {
    render(
      <TeachingHero
        eyebrowRight={`Starts in 40${NB}min`}
        figure="12:30"
        figureEnd="–13:30"
        title="Registrar teaching"
        meta="Seminar room 1 · check-in opens 12:15"
        status={null}
        actions={[
          { id: "join", label: "Join on Teams", href: "https://teams.example.test/x", external: true },
          { id: "details", label: "Details", href: `/teaching/session/${OCC}` },
        ]}
      />,
    );
    const hero = screen.getByTestId("teaching-hero");
    expect(within(hero).getByText("12:30").className).toContain("font-normal");
    expect(within(hero).getByText("Next up")).toBeInTheDocument();
    expect(within(hero).getByRole("link", { name: /^Join on Teams/ })).toHaveAttribute(
      "href",
      "https://teams.example.test/x",
    );
    expect(hero.className).toContain(modeSummarySurface);
    expect(hero.className).not.toContain("dark:");
  });

  it("leads with the date on a day with no teaching", () => {
    render(
      <TeachingHero
        eyebrowRight="No teaching today"
        figureDate="Tue 6 Oct"
        figure="08:00"
        figureEnd="–08:45"
        title="Case-based discussion"
        meta="Tutorial room"
        status={null}
        actions={[{ id: "calendar", label: "Add to calendar", onClick: vi.fn(), emphasis: "secondary" }]}
      />,
    );
    const line = within(screen.getByTestId("teaching-hero")).getByText("08:00").closest("p")!;
    expect(line.textContent).toBe("Tue 6 Oct · 08:00–08:45");
    expect(screen.getByRole("button", { name: "Add to calendar" })).toBeInTheDocument();
  });

  it("says so plainly and shows no figure when nothing is coming", () => {
    render(
      <TeachingHero
        eyebrowRight={null}
        figure={null}
        figureEnd={null}
        title="Nothing more this week"
        meta=""
        status={null}
        actions={[]}
      />,
    );
    expect(screen.getByText("Nothing more this week")).toBeInTheDocument();
    expect(screen.getByTestId("teaching-hero").querySelector("[data-hero-figure]")).toBeNull();
  });
});

describe("AttendanceChart", () => {
  it("counts twelve weeks, marks this week, and says the same in words", () => {
    const weeks = attendanceWeeks(
      ["2026-09-28T04:30:00.000Z", "2026-09-29T04:30:00.000Z", "2026-07-14T04:30:00.000Z", "2026-01-01T04:30:00.000Z"],
      "2026-09-30",
    );
    expect(weeks).toHaveLength(12);
    expect(weeks[0]).toMatchObject({ key: "2026-07-13", count: 1 });
    expect(weeks.at(-1)).toMatchObject({ key: "2026-09-28", count: 2 });
    render(<AttendanceChart weeks={weeks} currentKey="2026-09-28" />);
    const chart = screen.getByTestId("teaching-attendance-chart");
    expect(chart.querySelectorAll("rect[data-week]")).toHaveLength(12);
    expect(chart.querySelector("rect[data-current='true']")!.getAttribute("class")).toContain("--primary");
    expect(attendanceSentence(weeks)).toBe(`Attended in 2${NB}of the last 12${NB}weeks.`);
  });

  it("names a single missed week", () => {
    const startsAt = Array.from({ length: 12 }, (_, index) => index)
      .filter((index) => index !== 2)
      .map((index) => new Date(Date.parse("2026-07-14T04:30:00.000Z") + index * 7 * 86_400_000).toISOString());
    expect(attendanceSentence(attendanceWeeks(startsAt, "2026-09-30"))).toBe(
      `Attended in 11${NB}of the last 12${NB}weeks. None in the week of 27 Jul.`,
    );
  });
});

describe("TeachingStateNotice", () => {
  it.each([
    ["empty", "No sessions yet", "Nothing published by Demo service."],
    ["no-team", "You're not in a teaching service yet", "Ask your service's organiser to invite you."],
    ["signed-out", "Sign in to see your teaching", "Sessions, check-ins and your logbook."],
    [
      "offline",
      "You're offline",
      "Reconnect, then try again. A check-in you couldn't record can still be added for 7 days.",
    ],
    ["error", "Teaching couldn't load", "Nothing changed. Your records are safe."],
    ["setup", "Teaching is being set up", "It will appear here when it's ready."],
  ] as const)("words the %s state as one module", (state, title, body) => {
    render(
      <TeachingStateNotice
        state={state}
        serviceName="Demo service"
        onRetry={vi.fn()}
        onSignIn={vi.fn()}
        onOpenDemo={vi.fn()}
      />,
    );
    const moduleEl = screen.getByTestId(`teaching-state-${state}`);
    expect(within(moduleEl).getByText(title)).toBeInTheDocument();
    expect(within(moduleEl).getByText(body)).toBeInTheDocument();
    expect(moduleEl.textContent).not.toMatch(/Demo · made-up people|teaching_|\d{3}/);
  });

  it("offers Try again on error and offline, and announces offline as a status", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<TeachingStateNotice state="error" onRetry={onRetry} />);
    fireEvent.click(within(screen.getByTestId("teaching-state-error")).getByRole("button", { name: "Try again" }));
    rerender(<TeachingStateNotice state="offline" onRetry={onRetry} />);
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("offers Sign in then the demo when signed out, Switch service only when there is one, and how to join", () => {
    const onSignIn = vi.fn();
    const onOpenDemo = vi.fn();
    const { rerender } = render(<TeachingStateNotice state="signed-out" onSignIn={onSignIn} onOpenDemo={onOpenDemo} />);
    const names = screen.getAllByRole("button").map((button) => button.textContent);
    expect(names).toEqual(["Sign in", "Open the demo"]);
    fireEvent.click(screen.getByRole("button", { name: "Open the demo" }));
    expect(onOpenDemo).toHaveBeenCalledOnce();
    rerender(
      <TeachingStateNotice state="signed-out" onSignIn={onSignIn} demoHref="/teaching/sample?next=%2Fteaching" />,
    );
    expect(screen.getByRole("link", { name: "Open the demo" })).toHaveAttribute(
      "href",
      "/teaching/sample?next=%2Fteaching",
    );
    rerender(<TeachingStateNotice state="empty" serviceName="Demo service" />);
    expect(screen.queryByRole("button", { name: "Switch service" })).toBeNull();
    rerender(<TeachingStateNotice state="no-team" />);
    fireEvent.click(screen.getByRole("button", { name: "How to join a service" }));
    expect(screen.getByRole("dialog", { name: "How to join a service" })).toHaveTextContent("invitation code");
  });
});

describe("LogToCpdSheet", () => {
  it("defaults to the scheduled length in quarter hours and refuses anything else before sending", async () => {
    expect(defaultCpdHours({ startsAt: "2026-09-30T04:30:00.000Z", endsAt: "2026-09-30T05:30:00.000Z" })).toBe("1");
    expect(parseCpdHours("1.25")).toBe(1.25);
    expect(parseCpdHours("1.1")).toBeNull();
    expect(parseCpdHours("8")).toBe(8);
    expect(parseCpdHours("8.25")).toBeNull();
    const fetchMock = serveFetch((url, body) => {
      if (url !== "/api/teaching/cpd") return null;
      expect(body).toMatchObject({ occurrenceId: OCC, hours: 1 });
      expect(String(body!.requestId)).toMatch(/^[0-9a-f-]{36}$/);
      return json(200, { entryId: "e1", created: true });
    });
    render(
      <LogToCpdSheet
        open
        onClose={vi.fn()}
        occurrenceId={OCC}
        startsAt="2026-09-30T04:30:00.000Z"
        endsAt="2026-09-30T05:30:00.000Z"
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Log to CPD" });
    // Work-mode redesign, owner request 6 Oct 2026: the save button says what it logs ("Log 1 h to
    // CPD"), falling back to "Log to CPD" while the typed hours are not valid quarter hours.
    fireEvent.change(within(dialog).getByLabelText("Hours"), { target: { value: "1.1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Log to CPD" }));
    expect(
      await within(dialog).findByText("Use quarter hours between 0.25 and 8, for example 1.25."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Hours"), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Log 1\u00a0h to CPD" }));
    const link = await within(dialog).findByRole("link", { name: "Add a reflection in CPD" });
    expect(link).toHaveAttribute("href", "/cme/log/e1");
    // Work-mode redesign, owner request 6 Oct 2026: links inside Teaching take the area colour.
    expect(link.className).toContain("text-[color:var(--mode-identity)]");
  });
});
