/** @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));

import { catchUpCount, catchUpSessions, TeachingCatchUp } from "@/components/teaching/teaching-catch-up";
import { TeachingResources } from "@/components/teaching/teaching-resources";
import { demoTeachingResources } from "@/lib/teaching/demo-resources";
import { RELOCATED_SERVICE_ID, type ResourceRow } from "@/lib/teaching/model";

import {
  AFTER,
  NOW,
  OCC,
  TEAM_A,
  json,
  serveFetch,
  session,
  useTeachingTestClock,
  week,
} from "./helpers/teaching-fixtures";

// `useTeachingTestClock` only registers Vitest's beforeEach/afterEach; its name trips the hooks heuristic.
// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(AFTER);

const EARLIER = "22222222-2222-4222-8222-222222222222";
const CANCELLED = "33333333-3333-4333-8333-333333333333";
const RELOCATED = "44444444-4444-4444-8444-444444444444";
const ATTENDED = "55555555-5555-4555-8555-555555555555";
const UPCOMING = "66666666-6666-4666-8666-666666666666";
const WEEK_URL = "/api/teaching?view=week&from=2026-09-28&to=2026-10-04";
const WEEK_RESOURCES_URL = "/api/teaching/resources?action=resources.read&weekStart=2026-09-28";

function resource(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    resourceId: "88888888-8888-4888-8888-888888888888",
    serviceId: TEAM_A,
    title: "Registrar teaching slides",
    kind: "slides",
    url: "https://example.org/slides",
    libraryDocumentId: null,
    collectionId: null,
    sectionId: null,
    occurrenceId: OCC,
    seriesId: null,
    addedAt: "2026-09-29T00:00:00.000Z",
    saved: false,
    ...overrides,
  };
}

// 12:30-13:30 Wednesday (ended at AFTER, 14:00), and the rest of the week around it.
const ended = session();
const earlier = session({
  occurrenceId: EARLIER,
  title: "Journal club",
  startsAt: "2026-09-28T04:30:00.000Z",
  endsAt: "2026-09-28T05:30:00.000Z",
});
const cancelled = session({ occurrenceId: CANCELLED, title: "Cancelled talk", status: "cancelled" });
const relocated = session({
  occurrenceId: RELOCATED,
  title: "On Call education",
  serviceId: RELOCATED_SERVICE_ID,
  source: "on_call_relocated",
});
const attended = session({ occurrenceId: ATTENDED, title: "Attended case conference" });
const upcoming = session({
  occurrenceId: UPCOMING,
  title: "Later today",
  startsAt: "2026-09-30T07:00:00.000Z",
  endsAt: "2026-09-30T08:00:00.000Z",
});
const fullWeek = week({
  sessions: [ended, earlier, cancelled, relocated, attended, upcoming],
  attendance: [{ occurrenceId: ATTENDED, method: "self", recordedAt: "2026-09-30T05:00:00.000Z" }],
});

describe("catchUpSessions and catchUpCount", () => {
  it("keeps ended, unmarked, running Teaching sessions in time order and pairs each with its materials", () => {
    const slides = resource();
    const other = resource({ resourceId: "99999999-9999-4999-8999-999999999999", occurrenceId: UPCOMING });
    const items = catchUpSessions(fullWeek, [slides, other], AFTER);
    expect(items.map((item) => item.session.occurrenceId)).toEqual([EARLIER, OCC]);
    expect(items[0].materials).toEqual([]);
    expect(items[1].materials).toEqual([slides]);
    expect(catchUpCount(fullWeek, AFTER)).toBe(2);
  });

  it("counts nothing before a session ends", () => {
    expect(catchUpCount(fullWeek, NOW)).toBe(1); // only Monday's journal club has ended at 11:50 Wednesday
    expect(catchUpCount(week({ sessions: [] }), AFTER)).toBe(0);
  });
});

describe("the catch-up section", () => {
  it("shows each session with its link, 'No check-in recorded' and its materials, or says none are shared", () => {
    render(<TeachingCatchUp status="ready" week={fullWeek} resources={[resource()]} now={AFTER} />);
    const section = screen.getByTestId("teaching-catch-up");
    expect(section).toHaveAttribute("id", "catch-up");
    expect(section).toHaveClass("scroll-mt-4");
    const list = within(screen.getByTestId("teaching-catch-up-list"));
    expect(screen.getByTestId(`teaching-catch-up-${OCC}`)).toHaveAttribute("href", `/teaching/session/${OCC}`);
    expect(list.getAllByText("No check-in recorded")).toHaveLength(2);
    const slides = list.getByRole("link", { name: /Registrar teaching slides/ });
    expect(slides).toHaveAttribute("href", "https://example.org/slides");
    expect(slides).toHaveAttribute("target", "_blank");
    expect(slides).toHaveTextContent("(opens in a new tab)");
    expect(list.getByText("No catch-up recording or slides yet.")).toBeInTheDocument();
    expect(screen.queryByText(/missed/i)).toBeNull();
    expect(screen.queryByText("Attended case conference")).toBeNull();
    expect(screen.queryByText("Cancelled talk")).toBeNull();
    expect(screen.queryByText("On Call education")).toBeNull();
  });

  it("waits with a skeleton, says plainly when there is nothing, and never claims that after a failed read", () => {
    const { rerender, container } = render(<TeachingCatchUp status="loading" week={null} resources={[]} now={AFTER} />);
    expect(container.querySelector("[data-skeleton-row]")).not.toBeNull();
    rerender(<TeachingCatchUp status="ready" week={week({ sessions: [] })} resources={[]} now={AFTER} />);
    expect(screen.getByText("Nothing to catch up on this week.")).toBeInTheDocument();
    rerender(<TeachingCatchUp status="error" week={null} resources={[]} now={AFTER} />);
    expect(screen.getByText("Catch-up list unavailable right now.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing to catch up on this week.")).toBeNull();
  });
});

describe("Resources with catch-up", () => {
  it("follows Saved with the catch-up list from the week and this week's resources", async () => {
    serveFetch((url) => {
      if (url === WEEK_RESOURCES_URL)
        return json(200, {
          forThisWeek: [{ ...resource(), catchUp: true }],
          collections: [],
          recordingsCount: 0,
          savedCount: 0,
        });
      if (url === WEEK_URL) return json(200, fullWeek);
      return null;
    });
    render(<TeachingResources demoMode={false} />);
    const section = await screen.findByTestId("teaching-catch-up");
    const list = within(await screen.findByTestId("teaching-catch-up-list"));
    expect(list.getByRole("link", { name: /^Journal club/ })).toBeInTheDocument();
    expect(list.getByRole("link", { name: /Registrar teaching slides/ })).toBeInTheDocument();
    // The mock-up's order: the filter and this week's materials come first, catch-up after Saved.
    const saved = screen.getByRole("region", { name: /^Saved/ });
    expect(saved.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leaves the list out, claiming nothing, when the week cannot load", async () => {
    serveFetch((url) => {
      if (url === WEEK_RESOURCES_URL)
        return json(200, { forThisWeek: [], collections: [], recordingsCount: 0, savedCount: 0 });
      if (url === WEEK_URL) return json(500, { error: "Down", message: "Down", code: "internal" });
      return null;
    });
    render(<TeachingResources demoMode={false} />);
    expect(await screen.findByText("Nothing is linked to this week's sessions yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-catch-up")).toBeNull();
    expect(screen.queryByText("Nothing to catch up on this week.")).toBeNull();
  });

  it("marks the demo's missed recording in Recordings, where Today's catch-up link lands", async () => {
    const at = (query: Parameters<typeof demoTeachingResources>[0]) => json(200, demoTeachingResources(query, AFTER));
    serveFetch((url) => {
      if (url === WEEK_RESOURCES_URL) return at({ action: "resources.read", weekStart: "2026-09-28" });
      if (url.endsWith("builtIn=recordings")) return at({ action: "collection.read", builtIn: "recordings" });
      if (url.endsWith("builtIn=saved")) return at({ action: "collection.read", builtIn: "saved" });
      return null;
    });
    const { container } = render(<TeachingResources demoMode />);
    const recordings = within(await screen.findByTestId("teaching-resources-recordings"));
    expect(recordings.getByText(/^Mon 28 Sep · no check-in recorded$/)).toBeInTheDocument();
    expect(container.querySelector("#catch-up")).toHaveAttribute("aria-label", "Recordings · 4");
    expect(screen.queryByTestId("teaching-catch-up")).toBeNull();
  });
});
