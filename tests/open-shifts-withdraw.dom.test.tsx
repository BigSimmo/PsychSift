/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenShiftsState } from "@/components/open-shifts/use-open-shifts";
import type { OpenShiftListing } from "@/lib/open-shifts/model";
import { sampleListings, sampleRoster } from "@/lib/open-shifts/sample";

// Mon 5 Oct 2026, 08:00 Perth.
const NOW = new Date("2026-10-05T00:00:00.000Z");

const mocks = vi.hoisted(() => ({
  state: null as unknown as OpenShiftsState,
  post: vi.fn(),
}));
vi.mock("@/components/open-shifts/use-open-shifts", () => ({ useOpenShifts: () => mocks.state }));
vi.mock("@/components/mode-kit/use-signed-out-sample", () => ({ useSignedOut: () => false }));
vi.mock("@/components/roster/roster-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/roster/roster-format")>()),
  useRosterNow: () => NOW,
}));
vi.mock("@/components/roster/use-roster-team", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/roster/use-roster-team")>()),
  postRosterAction: mocks.post,
}));

import { OpenShiftsAdvertPage } from "@/components/open-shifts/open-shifts-advert-page";

function waiting(overrides: Partial<OpenShiftListing> = {}): OpenShiftListing {
  const future = sampleListings(NOW).find((row) => Date.parse(row.startsAt) > NOW.getTime() + 86_400_000)!;
  return { ...future, status: "claimed", claimedByMe: true, mine: false, ...overrides };
}

function stateWith(listing: OpenShiftListing, overrides: Partial<OpenShiftsState> = {}): OpenShiftsState {
  return {
    status: "ready",
    listings: [listing],
    teams: [],
    roster: sampleRoster(NOW),
    rosterStatus: "ready",
    readAt: NOW,
    sample: null,
    offline: false,
    failedTeams: [],
    refreshFailed: false,
    actorId: null,
    message: null,
    reload: vi.fn(),
    ...overrides,
  };
}

function renderFor(listing: OpenShiftListing) {
  return render(<OpenShiftsAdvertPage serviceId={listing.serviceId} openShiftId={listing.id} />);
}

beforeEach(() => mocks.post.mockReset());
afterEach(cleanup);

describe("Open shifts, taking back a waiting request", () => {
  it("takes back a waiting request after the doctor confirms, and says the shift is open again", async () => {
    const listing = waiting();
    mocks.state = stateWith(listing);
    mocks.post.mockResolvedValue({ ok: true, result: { ok: true, openShiftId: listing.id, status: "open" } });
    renderFor(listing);
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take back my request" }));
    // Nothing is sent until the doctor confirms.
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, take it back" }));
    await waitFor(() => expect(screen.getByText("Request taken back. The shift is open again.")).toBeTruthy());
    expect(mocks.post).toHaveBeenCalledWith(listing.serviceId, { action: "open.withdraw", openShiftId: listing.id });
    expect(mocks.state.reload).toHaveBeenCalledOnce();
    expect(screen.queryByText("Waiting for approval")).toBeNull();
    expect(screen.queryByText(/Someone else has it now/)).toBeNull();
  });

  it("explains a request decided before it could be taken back, and keeps it", async () => {
    const listing = waiting();
    mocks.state = stateWith(listing);
    mocks.post.mockResolvedValue({ ok: false, code: "roster_conflict", message: "Already decided." });
    renderFor(listing);
    fireEvent.click(screen.getByRole("button", { name: "Take back my request" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, take it back" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/decided before it could be taken back/));
    // The page reads the request again, so it shows what the manager decided.
    expect(mocks.state.reload).toHaveBeenCalledOnce();
  });

  it("never offers to take back an approved shift, or while offline", () => {
    const approved = waiting({ status: "approved" });
    mocks.state = stateWith(approved);
    renderFor(approved);
    expect(screen.queryByRole("button", { name: "Take back my request" })).toBeNull();
    cleanup();

    const listing = waiting();
    mocks.state = stateWith(listing, { offline: true });
    renderFor(listing);
    expect(screen.queryByRole("button", { name: "Take back my request" })).toBeNull();
  });
});
