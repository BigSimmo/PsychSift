// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PostedShift, PostedShiftsState } from "@/components/open-shifts/use-posted-shifts";
import { gapTimes } from "@/lib/open-shifts/model";
import { sampleListings } from "@/lib/open-shifts/sample";

/*
 * Posting a shift when an earlier answer was lost on the way back: the team
 * already shows the shift, so "Yes" never sends it a second time. And an
 * example shift is never offered for sharing or a real calendar. Every team
 * and person here is invented.
 */

const NOW = new Date("2026-10-07T01:00:00Z");
const TEAM = "5e000000-0000-4000-8000-000000000010";

const mocks = vi.hoisted(() => ({
  state: null as unknown as PostedShiftsState,
  post: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/open-shifts/post/new",
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/components/roster/roster-format", async (original) => ({
  ...(await original<typeof import("@/components/roster/roster-format")>()),
  useRosterNow: () => NOW,
}));
vi.mock("@/components/roster/use-roster-team", async (original) => ({
  ...(await original<typeof import("@/components/roster/use-roster-team")>()),
  postRosterAction: mocks.post,
}));
vi.mock("@/components/open-shifts/use-posted-shifts", () => ({ usePostedShifts: () => mocks.state }));

import { OpenShiftsAdvertActions } from "@/components/open-shifts/open-shifts-advert-actions";
import { OpenShiftsPostPage } from "@/components/open-shifts/open-shifts-post-page";

function liveShift(): PostedShift {
  // The form's default: tomorrow's day shift, 08:00 to 16:30, code D.
  const times = gapTimes("2026-10-08", "08:00", "16:30")!;
  return {
    id: "5e000000-0000-4000-8000-0000000000a1",
    status: "open",
    urgent: false,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    shiftCode: "D",
    kind: "day",
    minGrade: "registrar",
    siteId: null,
    postedBy: "5e000000-0000-4000-8000-000000000001",
    claimedBy: null,
    claimedAt: null,
    serviceId: TEAM,
    teamName: "Example team",
    siteName: null,
    claimantName: null,
    claimantGrade: null,
    postedByName: "Dr Example Manager",
  };
}

beforeEach(() => {
  mocks.post.mockReset();
  mocks.push.mockReset();
  mocks.state = {
    status: "ready",
    shifts: [liveShift()],
    teams: [{ serviceId: TEAM, name: "Example team", sites: [] }],
    failedTeams: [],
    readAt: NOW,
    refreshFailed: false,
    offline: false,
    actorId: "5e000000-0000-4000-8000-000000000001",
    message: null,
    reload: vi.fn(),
  };
});
afterEach(cleanup);

describe("Posting a shift", () => {
  it("still sends a deliberate second opening for a slot the team already has", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      result: { ok: true, openShiftId: "5e000000-0000-4000-8000-0000000000b2" },
    });
    render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
  });

  it("after a post gets no answer, never sends it again once the team shows it went live", async () => {
    mocks.state = { ...mocks.state, shifts: [] };
    mocks.post.mockResolvedValue({ ok: false, code: "roster_unavailable", message: "Couldn't reach the server." });
    const view = render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Not posted/));
    expect(mocks.state.reload).toHaveBeenCalledOnce();

    // Tapping again before the team's shifts are read again holds the post rather than risk a second copy.
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Still checking/));
    expect(mocks.post).toHaveBeenCalledOnce();

    // The re-read shows the post did go live before its answer was lost.
    mocks.state = { ...mocks.state, shifts: [liveShift()], readAt: new Date(Date.now() + 1000) };
    view.rerender(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.push.mock.calls[0]![0]).toContain(liveShift().id);
  });

  it("after a post gets no answer, still sends it when the matching new shift was posted by someone else", async () => {
    mocks.state = { ...mocks.state, shifts: [] };
    mocks.post.mockResolvedValueOnce({ ok: false, code: "roster_unavailable", message: "Couldn't reach the server." });
    mocks.post.mockResolvedValueOnce({
      ok: true,
      result: { ok: true, openShiftId: "5e000000-0000-4000-8000-0000000000b3" },
    });
    const view = render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Not posted/));

    // Another manager posted the same opening in the meantime.
    mocks.state = {
      ...mocks.state,
      shifts: [{ ...liveShift(), postedBy: "5e000000-0000-4000-8000-000000000002" }],
      readAt: new Date(Date.now() + 1000),
    };
    view.rerender(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  });

  it("after a post gets no answer, doesn't post to another team while the first team can't be read", async () => {
    const OTHER = "5e000000-0000-4000-8000-000000000020";
    mocks.state = { ...mocks.state, shifts: [] };
    mocks.post.mockResolvedValue({ ok: false, code: "roster_unavailable", message: "Couldn't reach the server." });
    const view = render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Not posted/));

    // The re-read reaches only another team, so the form would fall back to it.
    mocks.state = {
      ...mocks.state,
      teams: [{ serviceId: OTHER, name: "Other example team", sites: [] }],
      failedTeams: ["Example team"],
      readAt: new Date(Date.now() + 1000),
    };
    view.rerender(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Still checking/));
    expect(mocks.post).toHaveBeenCalledOnce();
  });
});

describe("Share and calendar", () => {
  it("are never offered for an example shift", () => {
    const listing = { ...sampleListings(NOW)[0]!, status: "open" as const, claimedByMe: false };
    render(<OpenShiftsAdvertActions listing={listing} booked sample />);
    expect(screen.queryByTestId("open-shifts-advert-actions")).toBeNull();
  });
});
