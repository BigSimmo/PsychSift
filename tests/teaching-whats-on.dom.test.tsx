/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));

import {
  filterWhatsOn,
  onNow,
  whatsOnFilters,
  whatsOnHeading,
  type WhatsOnRowRead,
} from "@/components/teaching/whats-on-model";
import { SeriesSheet } from "@/components/teaching/organise-sheets";
import { TeachingWhatsOn } from "@/components/teaching/teaching-whats-on";

import {
  DURING,
  TEAM_A,
  apiError,
  byId,
  fetchCalls,
  json,
  serveFetch,
  session,
  useTeachingTestClock,
} from "./helpers/teaching-fixtures";

// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(DURING);

const HOST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LATER = "22222222-2222-4222-8222-222222222222";
const URL_WEEK = "/api/teaching/whats-on?weekStart=2026-09-28";

function row(overrides: Partial<WhatsOnRowRead> = {}): WhatsOnRowRead {
  return {
    ...session({ serviceId: HOST }),
    teamName: "Hospital C psychiatry",
    joinUrl: "https://teams.microsoft.com/l/meetup-join/x",
    own: false,
    inMyWeek: false,
    audience: "all_doctors",
    ...overrides,
  };
}
const onAir = row(); // 12:30-13:30, on at 12:40
const later = row({
  occurrenceId: LATER,
  title: "Journal club",
  startsAt: "2026-09-30T07:00:00.000Z",
  endsAt: "2026-09-30T08:00:00.000Z",
  joinUrl: null,
  venue: "Library",
});

function serve(sessions: WhatsOnRowRead[], onPost?: (body: Record<string, unknown>) => Response) {
  return serveFetch((url, body) => {
    if (url === URL_WEEK) return json(200, { healthServices: ["emhs"], sessions });
    if (url === "/api/teaching/whats-on" && body && onPost) return onPost(body);
    return null;
  });
}

describe("whats-on-model", () => {
  it("names the health service, filters online sessions, and offers My level only when the server sends it", () => {
    expect(whatsOnHeading(["emhs"])).toBe("East Metropolitan Health Service");
    expect(whatsOnHeading([])).toBe("Your services");
    expect(filterWhatsOn([onAir, later], "online").map((r) => r.title)).toEqual([onAir.title]);
    expect(whatsOnFilters([onAir]).map((f) => f.label)).toEqual(["All", "Online"]);
    expect(whatsOnFilters([{ ...onAir, forMyLevel: true }]).map((f) => f.label)).toEqual(["All", "My level", "Online"]);
    expect(onNow([onAir, later], DURING).map((r) => r.occurrenceId)).toEqual([onAir.occurrenceId]);
    expect(onNow([{ ...onAir, status: "cancelled" }], DURING)).toEqual([]);
  });
});

describe("TeachingWhatsOn", () => {
  it("leads with On now and Join, then lists today's sessions with their service", async () => {
    serve([onAir, later]);
    render(<TeachingWhatsOn demoMode={false} />);
    const now = await waitFor(() => byId("teaching-whats-on-now"));
    // Work-mode redesign, owner request 6 Oct 2026: Join is a hero action that says it opens a new tab,
    // and a session row's link carries its time and service as well as its title.
    expect(within(now).getByRole("link", { name: /^Join on Teams/ })).toHaveAttribute("href", onAir.joinUrl);
    const list = byId("teaching-whats-on-list");
    expect(within(list).getByText("Journal club")).toBeInTheDocument();
    expect(within(list).getByText("Hospital C psychiatry · Library")).toBeInTheDocument();
    expect(screen.getByText("East Metropolitan Health Service")).toBeInTheDocument();
  });

  it("adds a session to my week with the plus, and takes it out again", async () => {
    const posted: Record<string, unknown>[] = [];
    serve([later], (body) => {
      posted.push(body);
      return json(200, { inMyWeek: body.action === "week_add.set" });
    });
    render(<TeachingWhatsOn demoMode={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Journal club to my week" }));
    const inWeek = await screen.findByRole("button", { name: "Remove Journal club from my week" });
    expect(inWeek).toHaveTextContent("In my week");
    fireEvent.click(inWeek);
    await screen.findByRole("button", { name: "Add Journal club to my week" });
    expect(posted).toEqual([
      { action: "week_add.set", occurrenceId: LATER },
      { action: "week_add.unset", occurrenceId: LATER },
    ]);
  });

  it("still opens a session from a row that carries the plus", async () => {
    serve([later]);
    render(<TeachingWhatsOn demoMode={false} />);
    await screen.findByRole("button", { name: "Add Journal club to my week" });
    expect(screen.getByRole("link", { name: /Journal club/ })).toHaveAttribute("href", `/teaching/session/${LATER}`);
  });

  it("puts the plus back and says why when the add fails", async () => {
    serve([later], () => apiError(403, "teaching_role_denied"));
    render(<TeachingWhatsOn demoMode={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Journal club to my week" }));
    expect(await screen.findByRole("button", { name: "Add Journal club to my week" })).toBeInTheDocument();
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
  });

  it("shows no plus on the reader's own service's sessions, which are already in Week", async () => {
    serve([{ ...later, own: true }]);
    render(<TeachingWhatsOn demoMode={false} />);
    await screen.findByText("Journal club");
    expect(screen.queryByRole("button", { name: /to my week/ })).toBeNull();
  });

  it("lets an organiser open a series to the health service, after saving the series", async () => {
    const SERIES = "44444444-4444-4444-8444-444444444444";
    const posted: string[] = [];
    serveFetch((url, body) => {
      if (url === `/api/teaching/services/${TEAM_A}` && body?.action === "series.save") {
        posted.push("series.save");
        return json(200, { seriesId: SERIES });
      }
      if (url === `/api/teaching/resources/services/${TEAM_A}` && body?.action === "series.set_open_to") {
        posted.push(`open:${String(body.openTo)}`);
        return json(200, { seriesId: SERIES, openTo: body.openTo });
      }
      return null;
    });
    const onSaved = vi.fn();
    const series = {
      seriesId: SERIES,
      title: "Registrar teaching",
      kind: "lecture",
      groupIds: [],
      repeat: "weekly",
      firstDate: "2026-09-02",
      startTime: "12:30",
      minutes: 60,
      venue: null,
      joinUrl: null,
      skipDates: [],
      endDate: "2026-12-16",
      presenterId: null,
      materials: [],
      lastConfirmedAt: null,
      openTo: "team" as const,
    };
    render(
      <SeriesSheet
        serviceId={TEAM_A}
        series={series}
        organise={{ series: [series], groups: [], members: [] }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Health service" }));
    fireEvent.click(screen.getByRole("button", { name: "Save series" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posted).toEqual(["series.save", "open:health_service"]);
  });

  // R8: What's on now serves the demo programme like any other health service's week (S9), so the
  // page always asks — it no longer shows "The demo has no health service." Only the personal write
  // (the plus) is refused in demo mode, like every Teaching write.
  it("renders the demo's health service and its sessions, unlike a signed-out or offline read", async () => {
    const fetchMock = serve([{ ...onAir, own: true, title: "Demo case conference" }]);
    render(<TeachingWhatsOn demoMode />);
    const list = await waitFor(() => byId("teaching-whats-on-list"));
    expect(within(list).getByText("Demo case conference")).toBeInTheDocument();
    expect(screen.queryByText(/made-up/)).toBeNull();
    expect(fetchCalls(fetchMock, "/api/teaching/whats-on")).toBe(1);
  });

  it("puts the plus back and says so when the demo refuses to add a session to my week", async () => {
    serve([later], () => apiError(400, "demo_mode_unavailable"));
    render(<TeachingWhatsOn demoMode />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Journal club to my week" }));
    expect(await screen.findByRole("button", { name: "Add Journal club to my week" })).toBeInTheDocument();
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
  });
});
