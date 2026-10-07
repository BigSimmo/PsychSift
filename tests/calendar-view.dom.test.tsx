import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CalendarView } from "@/components/calendar/calendar-view";
import type { CalendarEvent } from "@/lib/calendar/calendar-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/cme/calendar" }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const EVENTS: CalendarEvent[] = [
  { id: "jc", title: "Journal club", date: "2026-09-15", kind: "due", recurrence: "monthly", href: "/cme/routines" },
  { id: "end", title: "End of the 2026 CPD year", date: "2026-12-31", kind: "deadline" },
  { id: "today", title: "Grand round", date: "2026-09-25", startTime: "12:30", kind: "logged" },
];

describe("calendar view", () => {
  it("opens on today's month with today's events listed under the grid", () => {
    render(<CalendarView events={EVENTS} today="2026-09-25" exportName="CME 2026" />);
    expect(screen.getByRole("heading", { level: 2, name: "September 2026" })).toBeInTheDocument();
    const day = screen.getByTestId("calendar-view-day");
    expect(day).toHaveTextContent("Friday 25 September · Today");
    expect(day).toHaveTextContent("Grand round");
    expect(day).toHaveTextContent("12:30");
    expect(screen.getByRole("button", { name: "Tuesday 15 September, 1 event" })).toBeInTheDocument();
  });

  it("changes month with the arrows, expanding repeats into the new month", async () => {
    const user = userEvent.setup();
    render(<CalendarView events={EVENTS} today="2026-09-25" exportName="CME 2026" />);
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { level: 2, name: "October 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Thursday 15 October, 1 event" }));
    expect(screen.getByTestId("calendar-view-day")).toHaveTextContent("Journal club");
    expect(screen.getByTestId("calendar-view-day")).toHaveTextContent("Every month");
    await user.click(screen.getByRole("button", { name: "Back to today" }));
    expect(screen.getByRole("heading", { level: 2, name: "September 2026" })).toBeInTheDocument();
  });

  it("offers a file, Google and Outlook for one event, and says what each sends", async () => {
    const user = userEvent.setup();
    render(<CalendarView events={EVENTS} today="2026-09-25" exportName="CME 2026" />);
    await user.click(screen.getByRole("button", { name: "Add Grand round to your calendar" }));
    const sheet = await screen.findByTestId("calendar-view-add-sheet");
    expect(within(sheet).getByTestId("calendar-add-google")).toHaveAttribute(
      "href",
      expect.stringContaining("calendar.google.com"),
    );
    expect(within(sheet).getByTestId("calendar-add-outlook")).toHaveAttribute(
      "href",
      expect.stringContaining("outlook.office.com"),
    );
    expect(sheet).toHaveTextContent("The calendar file stays on this device.");
  });

  it("downloads one calendar file for the export set", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:calendar");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<CalendarView events={EVENTS} exportEvents={[EVENTS[1]]} today="2026-09-25" exportName="CME 2026" />);
    await user.click(screen.getByTestId("calendar-view-export"));
    expect(click).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    const text = await blob.text();
    expect(text).toContain("SUMMARY:End of the 2026 CPD year");
    expect(text).not.toContain("Journal club");
  });

  it("says the downloaded file is a one-off copy", () => {
    render(<CalendarView events={EVENTS} today="2026-09-25" exportName="CME 2026" />);
    expect(screen.getByTestId("calendar-view-export-snapshot")).toHaveTextContent("one-off copy");
  });

  it("lets the owner leave a kind of date out, and hides what an expiry is for by default", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:calendar");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const events: CalendarEvent[] = [
      { id: "teach", title: "Registrar teaching", date: "2026-09-29", kind: "teaching" },
      {
        id: "police",
        title: "Police check expires",
        date: "2026-10-10",
        kind: "expiry",
        notes: "National police certificate",
      },
    ];
    render(<CalendarView events={events} today="2026-09-25" exportName="On Call" />);

    await user.click(screen.getByTestId("calendar-view-export"));
    const first = await (createObjectURL.mock.calls[0] as unknown as [Blob])[0].text();
    expect(first).toContain("SUMMARY:Registrar teaching");
    expect(first).toContain("SUMMARY:Expiry date");
    expect(first).not.toContain("Police");

    await user.click(screen.getByTestId("calendar-view-export-plain-expiry"));
    await user.click(screen.getByTestId("calendar-view-export"));
    const named = await (createObjectURL.mock.calls[1] as unknown as [Blob])[0].text();
    expect(named).toContain("SUMMARY:Police check expires");

    await user.click(screen.getByTestId("calendar-view-export-kind-expiry"));
    expect(screen.queryByTestId("calendar-view-export-plain-expiry")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("calendar-view-export"));
    const teachingOnly = await (createObjectURL.mock.calls[2] as unknown as [Blob])[0].text();
    expect(teachingOnly).toContain("SUMMARY:Registrar teaching");
    expect(teachingOnly).not.toContain("Expir");
  });
});

describe("calendar marks", () => {
  /** The class of each mark inside a day button, in grid order. */
  function dayMarkClasses(name: string): string[] {
    const marks = screen.getByRole("button", { name }).querySelector('span[aria-hidden="true"]')!;
    return [...marks.children].map((mark) => mark.className);
  }

  it("keeps the default dot marks exactly as they were, so On Call's calendar does not change", () => {
    const { container } = render(<CalendarView events={EVENTS} today="2026-09-25" exportName="On Call" />);
    expect(dayMarkClasses("Friday 25 September, today, 1 event")).toEqual([
      "size-1.5 rounded-full forced-colors:bg-[CanvasText] bg-[color:var(--tone-indigo)]",
    ]);
    expect(dayMarkClasses("Tuesday 15 September, 1 event")).toEqual([
      "size-1.5 rounded-full forced-colors:bg-[CanvasText] bg-[color:var(--tone-purple)]",
    ]);
    const legend = screen.getByRole("list", { name: "What the dots mean" });
    expect([...legend.querySelectorAll('li > span[aria-hidden="true"]')].map((mark) => mark.className)).toEqual([
      "size-2 rounded-full bg-[color:var(--tone-indigo)]",
      "size-2 rounded-full bg-[color:var(--tone-purple)]",
      "size-2 rounded-full bg-[color:var(--tone-rose)]",
    ]);
    const row = screen
      .getByTestId("calendar-view-day")
      .querySelector('li[data-kind="logged"] > span[aria-hidden="true"]')!;
    expect(row.className).toBe("mt-1.5 size-2.5 shrink-0 rounded-full bg-[color:var(--tone-indigo)]");
    expect(container.querySelector("[data-mark]")).toBeNull();
    expect(screen.queryByRole("list", { name: "What the marks mean" })).toBeNull();
  });

  it("draws grey shapes, with the kinds in words, when CPD asks for them", () => {
    const events: CalendarEvent[] = [
      { id: "logged", title: "Demo journal club", date: "2026-09-25", kind: "logged" },
      { id: "due", title: "Demo peer review group", date: "2026-09-15", kind: "due", recurrence: "monthly" },
      { id: "deadline", title: "Demo closing date", date: "2026-09-30", kind: "deadline" },
    ];
    render(<CalendarView events={events} today="2026-09-25" exportName="CPD 2026" markStyle="shape" />);

    const today = screen.getByRole("button", { name: "Friday 25 September, today, 1 event: Logged" });
    expect(today.className).toContain("min-h-12");
    expect(today.className).toContain("ring-[color:var(--clinical-accent)]");
    const marks = today.querySelector('span[aria-hidden="true"]')!;
    expect(marks.className).toContain("text-[color:var(--text-muted)]");
    expect(marks.querySelector('[data-mark="dot"]')!.className).toContain("bg-current");
    const due = screen.getByRole("button", { name: "Tuesday 15 September, 1 event: Due" });
    expect(due.querySelector('[data-mark="ring"]')!.className).toContain("border-current");
    const deadline = screen.getByRole("button", { name: "Wednesday 30 September, 1 event: Deadline" });
    expect(deadline.querySelector('[data-mark="diamond"]')!.className).toContain("rotate-45");

    const legend = screen.getByRole("list", { name: "What the marks mean" });
    expect([...legend.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["Logged", "Due", "Deadline"]);
    expect([...legend.querySelectorAll("[data-mark]")].map((mark) => mark.getAttribute("data-mark"))).toEqual([
      "dot",
      "ring",
      "diamond",
    ]);
    expect(screen.queryByRole("list", { name: "What the dots mean" })).toBeNull();
    expect(screen.getByTestId("calendar-view-later").querySelector('[data-mark="diamond"]')).not.toBeNull();
    expect(screen.getByTestId("calendar-view-grid").innerHTML).not.toContain("--tone-");
    expect(legend.innerHTML).not.toContain("--tone-");
  });
});
