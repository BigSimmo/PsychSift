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

import { TeachingThisWeek } from "@/components/teaching/teaching-this-week";
import { otherServiceMeta, otherServiceSessions } from "@/components/teaching/this-week-model";
import type { WhatsOnRowRead } from "@/components/teaching/whats-on-model";

import {
  DURING,
  apiError,
  fetchCalls,
  json,
  serveFetch,
  session,
  useTeachingTestClock,
  week,
} from "./helpers/teaching-fixtures";

/*
 * Week's third filter, Other services (owner-approved mock-up, Oct 2026), which took over the separate
 * What's on page. Its own file, because Week remembers the chosen filter for the visit in module state.
 */

// A shared fixture, not a component hook: it only registers Vitest's `beforeEach`/`afterEach`.
// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(DURING);

const HOST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLUB = "22222222-2222-4222-8222-222222222222";
const ROUNDS = "33333333-3333-4333-8333-333333333333";
const WHATS_ON = "/api/teaching/whats-on?weekStart=2026-09-28";

function row(overrides: Partial<WhatsOnRowRead> = {}): WhatsOnRowRead {
  return {
    ...session({ serviceId: HOST }),
    teamName: "Hospital C psychiatry",
    joinUrl: null,
    own: false,
    inMyWeek: false,
    audience: "all_doctors",
    ...overrides,
  };
}
// Wednesday 30 September 12:30 to 13:30 in Perth, on now at 12:40, online only.
const onAir = row({ title: "Case conference", venue: null, joinUrl: "https://teams.microsoft.com/l/meetup-join/x" });
// Thursday 1 October, in a room.
const club = row({
  occurrenceId: CLUB,
  title: "Journal club",
  startsAt: "2026-10-01T07:00:00.000Z",
  endsAt: "2026-10-01T08:00:00.000Z",
  venue: "Library",
});
// The reader's own service: already under Whole service, so never listed again here.
const own = row({ occurrenceId: ROUNDS, title: "Grand rounds", own: true, inMyWeek: true });

function serve(sessions: WhatsOnRowRead[], onPost?: (body: Record<string, unknown>) => Response) {
  return serveFetch((url, body) => {
    if (url.startsWith("/api/teaching?view=week")) return json(200, week());
    if (url === WHATS_ON) return json(200, { healthServices: ["emhs"], sessions });
    if (url === "/api/teaching/whats-on" && body && onPost) return onPost(body);
    if (url.startsWith("/api/teaching/whats-on")) return json(200, { healthServices: ["emhs"], sessions: [] });
    if (url.startsWith("/api/on-call/")) return json(403, {});
    return null;
  });
}

function segments() {
  return within(screen.getByRole("group", { name: "Show" })).getAllByRole("button");
}

describe("this-week-model: Other services", () => {
  it("leaves out the reader's own service and puts the rest in time order", () => {
    expect(otherServiceSessions([club, own, onAir]).map((r) => r.title)).toEqual(["Case conference", "Journal club"]);
  });

  it("reads Service · place, says Online when there is no room, and leads with On now or Cancelled", () => {
    expect(otherServiceMeta(club, DURING)).toBe("Hospital C psychiatry · Library");
    expect(otherServiceMeta(onAir, DURING)).toBe("On now · Hospital C psychiatry · Online");
    expect(otherServiceMeta({ ...club, status: "cancelled" }, DURING)).toBe("Cancelled · Hospital C psychiatry");
  });
});

describe("Week: Other services", () => {
  it("offers three filters, whose full words stay their names while narrow phones show short ones", async () => {
    serve([club]);
    render(<TeachingThisWeek demoMode={false} />);
    await screen.findByTestId("teaching-week-list");
    const buttons = segments();
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Mine",
      "Whole service",
      "Other services",
    ]);
    expect(screen.getByRole("button", { name: "Other services" })).toHaveTextContent("Other");
    expect(screen.getByRole("button", { name: "Whole service" })).toHaveTextContent("Service");
  });

  it("switches from the card under the week instead of leaving for What's on, and lists by day", async () => {
    serve([onAir, club, own]);
    render(<TeachingThisWeek demoMode={false} />);
    const card = await screen.findByTestId("teaching-week-whats-on");
    expect(card).toHaveTextContent("2 sessions from other services are open to you");
    expect(within(card).queryByRole("link")).toBeNull();
    fireEvent.click(within(card).getByRole("button"));

    expect(screen.getByRole("button", { name: "Other services" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("teaching-week-list")).toBeNull();
    expect(screen.queryByTestId("teaching-week-whats-on")).toBeNull();
    const other = screen.getByTestId("teaching-week-other");
    // Week's own day headings, the time, the title and "Service · place" with the live cue.
    expect(within(other).getByRole("heading", { name: "Wednesday 30 · today" })).toBeInTheDocument();
    expect(within(other).getByRole("heading", { name: "Thursday 1" })).toBeInTheDocument();
    const live = screen.getByTestId(`teaching-week-other-row-${onAir.occurrenceId}`);
    expect(live).toHaveTextContent("12:30");
    expect(live).toHaveTextContent("On now · Hospital C psychiatry · Online");
    const later = screen.getByTestId(`teaching-week-other-row-${CLUB}`);
    expect(later).toHaveTextContent("Hospital C psychiatry · Library");
    expect(within(later).getByRole("link", { name: /Journal club/ })).toHaveAttribute(
      "href",
      `/teaching/session/${CLUB}`,
    );
    expect(within(other).queryByText("Grand rounds")).toBeNull();
    expect(other).toHaveTextContent(/This week · 2\ssessions/);
    // What's on's privacy note stays under the list.
    expect(screen.getByText("Organisers of each session see who checked in")).toBeInTheDocument();
  });

  it("opens on Other services from ?view=other, and adds and removes exactly as What's on did", async () => {
    const posted: Record<string, unknown>[] = [];
    serve([club], (body) => {
      posted.push(body);
      return json(200, { inMyWeek: body.action === "week_add.set" });
    });
    render(<TeachingThisWeek demoMode={false} view="other" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Journal club to my week" }));
    const added = await screen.findByRole("button", { name: "Remove Journal club from my week" });
    expect(added).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(added);
    await screen.findByRole("button", { name: "Add Journal club to my week" });
    expect(posted).toEqual([
      { action: "week_add.set", occurrenceId: CLUB },
      { action: "week_add.unset", occurrenceId: CLUB },
    ]);
  });

  it("puts the plus back and says why when the add fails", async () => {
    serve([club], () => apiError(403, "teaching_role_denied"));
    render(<TeachingThisWeek demoMode={false} view="other" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Journal club to my week" }));
    expect(await screen.findByRole("button", { name: "Add Journal club to my week" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).not.toBeEmptyDOMElement());
  });

  it("keeps Week's arrows: the next week asks for that week's open sessions, and says when there are none", async () => {
    const fetchMock = serve([club]);
    render(<TeachingThisWeek demoMode={false} view="other" />);
    await screen.findByTestId(`teaching-week-other-row-${CLUB}`);
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(fetchCalls(fetchMock, "/api/teaching/whats-on?weekStart=2026-10-05")).toBe(1));
    expect(await screen.findByText(/No other service has opened a session to you for 5 to 9 October\./)).toBeVisible();
    expect(screen.getByRole("button", { name: "Other services" })).toHaveAttribute("aria-pressed", "true");
  });

  it("remembers Other services for the visit, like Mine and Whole service", async () => {
    serve([club]);
    const first = render(<TeachingThisWeek demoMode={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Whole service" }));
    expect(await screen.findByTestId("teaching-week-list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Other services" }));
    first.unmount();
    serve([club]);
    render(<TeachingThisWeek demoMode={false} />);
    expect(await screen.findByTestId(`teaching-week-other-row-${CLUB}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Other services" })).toHaveAttribute("aria-pressed", "true");
  });

  it("offers Other services to a reader in no teaching service", async () => {
    serveFetch((url) => {
      if (url.startsWith("/api/teaching?view=week")) return json(200, week({ teams: [], sessions: [] }));
      if (url.startsWith("/api/teaching/whats-on")) return json(200, { healthServices: ["emhs"], sessions: [club] });
      if (url.startsWith("/api/on-call/")) return json(403, {});
      return null;
    });
    // The last test left Other services remembered; Whole service shows this reader the no-service notice.
    render(<TeachingThisWeek demoMode={false} />);
    await screen.findByTestId(`teaching-week-other-row-${CLUB}`);
    fireEvent.click(screen.getByRole("button", { name: "Whole service" }));
    expect(await screen.findByTestId("teaching-state-no-team")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("teaching-week-whats-on")).getByRole("button"));
    expect(await screen.findByTestId(`teaching-week-other-row-${CLUB}`)).toBeInTheDocument();
  });
});
