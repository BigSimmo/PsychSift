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
  it("never sends a shift the team already shows, and opens the one that is live", async () => {
    render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.push.mock.calls[0]![0]).toContain(liveShift().id);
  });
});

describe("Share and calendar", () => {
  it("are never offered for an example shift", () => {
    const listing = { ...sampleListings(NOW)[0]!, status: "open" as const, claimedByMe: false };
    render(<OpenShiftsAdvertActions listing={listing} booked sample />);
    expect(screen.queryByTestId("open-shifts-advert-actions")).toBeNull();
  });
});
