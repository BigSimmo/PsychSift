/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="sign-in-dialog" /> : null),
}));
vi.mock("@/components/calendar/calendar-subscribe", () => ({
  CalendarSubscribe: () => <div data-testid="calendar-link" />,
}));
vi.mock("@/components/on-call/on-call-entry-editor", () => ({
  OnCallEntryEditor: () => null,
}));

import { TeachingPresenting } from "@/components/teaching/teaching-presenting";
import { TeachingThisWeek } from "@/components/teaching/teaching-this-week";

import {
  DURING,
  OCC,
  TEAM_A,
  json,
  serveFetch,
  session,
  useTeachingTestClock,
  week,
} from "./helpers/teaching-fixtures";

// A shared fixture, not a component hook: it only registers Vitest's `beforeEach`/`afterEach`.
// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock();

/** The reads This week makes besides the week itself: no On Call access and nothing open elsewhere. */
function sideReads(url: string) {
  if (url.startsWith("/api/teaching/whats-on")) return json(200, { healthServices: [], sessions: [] });
  if (url.startsWith("/api/on-call/")) return json(403, {});
  return null;
}

describe("This week", () => {
  it("checks in with one tap while check-in is open, and offers the code instead", async () => {
    vi.setSystemTime(DURING);
    const posts: Array<Record<string, unknown> | null> = [];
    serveFetch((url, body) => {
      if (url === `/api/teaching/services/${TEAM_A}` && body) {
        posts.push(body);
        return json(200, { occurrenceId: OCC, method: "self", recordedAt: DURING.toISOString(), serviceId: TEAM_A });
      }
      if (url.startsWith("/api/teaching?view=week")) return json(200, week());
      return sideReads(url);
    });
    render(<TeachingThisWeek demoMode={false} />);
    const hero = await screen.findByTestId("teaching-hero");
    expect(within(hero).getByRole("link", { name: "Type the code instead" })).toHaveAttribute(
      "href",
      `/teaching/session/${OCC}?check-in=scan`,
    );
    fireEvent.click(within(hero).getByRole("button", { name: "Check in" }));
    await waitFor(() => expect(posts).toEqual([{ action: "attendance.self", occurrenceId: OCC }]));
    expect(await within(hero).findByRole("status")).toHaveTextContent("Checked in.");
  });

  it("puts Mine first and selected when the reader presents, and Whole service when they do not", async () => {
    vi.setSystemTime(DURING);
    const other = session({ occurrenceId: "99999999-9999-4999-8999-999999999999", title: "Grand rounds" });
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week")
        ? json(200, week({ sessions: [session({ isPresenter: true }), other] }))
        : sideReads(url),
    );
    const first = render(<TeachingThisWeek demoMode={false} />);
    const list = await screen.findByTestId("teaching-week-list");
    const buttons = screen.getAllByRole("button", { name: /^(Mine|Whole service)$/ });
    expect(buttons.map((b) => b.textContent)).toEqual(["Mine", "Whole service"]);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    expect(within(list).queryByText("Grand rounds")).toBeNull();
    fireEvent.click(buttons[1]);
    expect(within(screen.getByTestId("teaching-week-list")).getByText("Grand rounds")).toBeInTheDocument();
    first.unmount();

    serveFetch((url) => (url.startsWith("/api/teaching?view=week") ? json(200, week()) : sideReads(url)));
    render(<TeachingThisWeek demoMode={false} />);
    await screen.findByTestId("teaching-week-list");
    expect(screen.getByRole("button", { name: "Whole service" })).toHaveAttribute("aria-pressed", "true");
  });

  it("offers only the code in the 15 minutes before the start, when the server refuses one tap", async () => {
    vi.setSystemTime(new Date("2026-09-30T04:20:00Z"));
    serveFetch((url) => (url.startsWith("/api/teaching?view=week") ? json(200, week()) : sideReads(url)));
    render(<TeachingThisWeek demoMode={false} />);
    const hero = await screen.findByTestId("teaching-hero");
    expect(within(hero).getByRole("link", { name: "Check in with the code" })).toHaveAttribute(
      "href",
      `/teaching/session/${OCC}?check-in=scan`,
    );
    expect(within(hero).queryByRole("button", { name: "Check in" })).toBeNull();
    expect(hero).toHaveTextContent("One-tap check in opens when it starts at 12:30.");
  });

  it("keeps a checked-in row a link to its session", async () => {
    vi.setSystemTime(DURING);
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week")
        ? json(200, week({ attendance: [{ occurrenceId: OCC, method: "self", recordedAt: DURING.toISOString() }] }))
        : sideReads(url),
    );
    render(<TeachingThisWeek demoMode={false} />);
    const list = await screen.findByTestId("teaching-week-list");
    expect(within(list).getByRole("link", { name: /Registrar teaching/ })).toHaveAttribute(
      "href",
      `/teaching/session/${OCC}`,
    );
  });

  it("shows the partial notice, not the no-service notice, when the On Call read failed", async () => {
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week")
        ? json(200, week({ teams: [], sessions: [], relocated: [], relocatedUnavailable: true }))
        : sideReads(url),
    );
    render(<TeachingThisWeek demoMode={false} />);
    expect(await screen.findByTestId("teaching-week-partial")).toBeInTheDocument();
  });

  it("says sessions from On Call are missing instead of claiming the week is empty", async () => {
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week")
        ? json(200, week({ sessions: [], relocated: [], relocatedUnavailable: true }))
        : sideReads(url),
    );
    render(<TeachingThisWeek demoMode={false} />);
    expect(await screen.findByTestId("teaching-week-partial")).toBeInTheDocument();
    const list = screen.getByTestId("teaching-week-list");
    expect(list).toHaveTextContent("None loaded. Sessions shared from On Call are missing. Try again.");
    expect(list).not.toHaveTextContent(/No sessions are booked/);
  });

  it("words a fully loaded empty week by when it is", async () => {
    serveFetch((url) =>
      url.startsWith("/api/teaching?view=week") ? json(200, week({ sessions: [], relocated: [] })) : sideReads(url),
    );
    render(<TeachingThisWeek demoMode={false} />);
    expect(await screen.findByTestId("teaching-week-list")).toHaveTextContent(
      /No sessions are booked for .+ yet\. They appear here as soon as an organiser adds them\./,
    );
    expect(screen.queryByTestId("teaching-week-partial")).toBeNull();
  });
});

describe("Presenting", () => {
  const talk = {
    occurrenceId: OCC,
    serviceId: TEAM_A,
    title: "Registrar teaching",
    startsAt: "2026-10-01T04:30:00.000Z",
    endsAt: "2026-10-01T05:15:00.000Z",
    venue: "Seminar room 1",
    status: "scheduled",
    items: ["reading_list", "aims", "slides_link", "room"],
    deidConfirmedAt: null,
  };

  it("keeps the patient-details check first and open, even with every prep item ticked", async () => {
    const posts: Array<Record<string, unknown> | null> = [];
    serveFetch((url, body) => {
      if (url === "/api/teaching/depth?view=teach") return json(200, { upcoming: [talk], taught: [] });
      if (url === "/api/teaching/depth?view=supervision") return json(200, { pairings: [] });
      if (url === `/api/teaching/services/${TEAM_A}/depth` && body) {
        posts.push(body);
        return json(200, { items: talk.items, deidConfirmedAt: DURING.toISOString() });
      }
      return null;
    });
    render(<TeachingPresenting demoMode={false} />);
    const panel = await screen.findByTestId("teaching-next-talk");
    expect(panel).toHaveTextContent(/Ready to present\s*4\sof 4 · patient check open/);
    fireEvent.click(within(panel).getByRole("button", { name: "I have checked: no patient details" }));
    await waitFor(() => expect(posts).toEqual([{ action: "readiness.deid.confirm", occurrenceId: OCC }]));
    await waitFor(() => expect(panel).not.toHaveTextContent("patient check open"));
    expect(panel).toHaveTextContent(/No patient details in the slides\. You confirmed this on \d+\s\w{3}\./);
  });

  it("opens a later talk in place, so its patient check can be done there too", async () => {
    const later = {
      ...talk,
      occurrenceId: "44444444-4444-4444-8444-444444444444",
      title: "Journal club",
      startsAt: "2026-10-07T04:30:00.000Z",
      endsAt: "2026-10-07T05:15:00.000Z",
      items: [],
    };
    serveFetch((url) => {
      if (url === "/api/teaching/depth?view=teach") return json(200, { upcoming: [talk, later], taught: [] });
      if (url === "/api/teaching/depth?view=supervision") return json(200, { pairings: [] });
      return null;
    });
    render(<TeachingPresenting demoMode={false} talkId={later.occurrenceId} />);
    const panel = await screen.findByTestId("teaching-next-talk");
    expect(panel).toHaveTextContent("Journal club");
    expect(panel).toHaveTextContent(/^Your talk/);
    expect(within(panel).getByRole("button", { name: "I have checked: no patient details" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Registrar teaching/ }));
    await waitFor(() => expect(screen.getByTestId("teaching-next-talk")).toHaveTextContent("Registrar teaching"));
    expect(screen.getByTestId("teaching-next-talk")).toHaveTextContent(/^Your next talk/);
  });

  it("follows a new ?talk= without leaving the old talk selected", async () => {
    const later = {
      ...talk,
      occurrenceId: "44444444-4444-4444-8444-444444444444",
      title: "Journal club",
      startsAt: "2026-10-07T04:30:00.000Z",
      endsAt: "2026-10-07T05:15:00.000Z",
    };
    serveFetch((url) => {
      if (url === "/api/teaching/depth?view=teach") return json(200, { upcoming: [talk, later], taught: [] });
      if (url === "/api/teaching/depth?view=supervision") return json(200, { pairings: [] });
      return null;
    });
    const view = render(<TeachingPresenting demoMode={false} talkId={later.occurrenceId} />);
    expect(await screen.findByTestId("teaching-next-talk")).toHaveTextContent("Journal club");
    view.rerender(<TeachingPresenting demoMode={false} talkId={null} />);
    await waitFor(() => expect(screen.getByTestId("teaching-next-talk")).toHaveTextContent("Registrar teaching"));
    // Later talks carry their full date for screen readers, since the date block is hidden from them.
    expect(screen.getByRole("button", { name: /Journal club, \w{3} 7 Oct/ })).toBeInTheDocument();
  });

  it("explains when feedback totals appear, as the server releases them", async () => {
    const taught = { ...talk, startsAt: "2026-09-28T04:30:00.000Z", endsAt: "2026-09-28T05:15:00.000Z" };
    const older = {
      ...taught,
      occurrenceId: "55555555-5555-4555-8555-555555555555",
      title: "Journal club",
      startsAt: "2026-09-14T04:30:00.000Z",
      endsAt: "2026-09-14T05:15:00.000Z",
    };
    serveFetch((url) => {
      if (url === "/api/teaching/depth?view=teach") return json(200, { upcoming: [], taught: [taught, older] });
      if (url === "/api/teaching/depth?view=supervision") return json(200, { pairings: [] });
      if (url.startsWith(`/api/teaching/services/${TEAM_A}/depth?`)) return json(200, { released: false });
      return null;
    });
    render(<TeachingPresenting demoMode={false} />);
    // The totals arrive after the block renders, so wait for the words rather than the block.
    await waitFor(() =>
      expect(screen.getByTestId("teaching-feedback-totals")).toHaveTextContent(
        "No totals yet. They show 7 days after the talk, once at least 5 people have answered.",
      ),
    );
    // The older talks stay folded under "All 2" until asked for, as in the mock-up.
    expect(screen.queryByRole("button", { name: "Feedback on Journal club" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All 2" }));
    const toggle = screen.getByRole("button", { name: "Feedback on Journal club" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide feedback on Journal club" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
