// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PostedShift, PostedShiftsState } from "@/components/open-shifts/use-posted-shifts";
import { clearAccountScopedBrowserStorage } from "@/lib/account-scoped-browser-state";
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
  window.sessionStorage.clear();
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

  it("after a post gets no answer, always sends the retry with the same postKey even when an identical shift is in the team list", async () => {
    const SAVED = "5e000000-0000-4000-8000-0000000000b2";
    mocks.state = { ...mocks.state, shifts: [] };
    mocks.post.mockResolvedValueOnce({ ok: false, code: "roster_unavailable", message: "Couldn't reach the server." });
    mocks.post.mockResolvedValueOnce({
      ok: true,
      result: { openShiftId: SAVED, status: "open", replayed: true },
    });
    const view = render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Not posted/));
    expect(mocks.state.reload).toHaveBeenCalledOnce();

    // Even if an identical shift by this manager appears in the team list (e.g. a first opening for the same
    // slot), retrying sends the saved postKey to the server rather than skipping via client similarity matching.
    mocks.state = { ...mocks.state, shifts: [liveShift()], readAt: new Date(Date.now() + 1000) };
    view.rerender(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
    expect(mocks.post).toHaveBeenCalledTimes(2);
    const [firstKey, retryKey] = mocks.post.mock.calls.map((call) => (call[1] as { postKey?: string }).postKey);
    expect(firstKey).toBeTruthy();
    expect(retryKey).toBe(firstKey);
    expect(mocks.push.mock.calls[0]![0]).toContain(SAVED);
    expect(window.sessionStorage.getItem("psychsift:open-shifts:post-keys-v1")).toBeNull();
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

  it("when the server replays an earlier post whose status is cancelled, refuses to mark it posted and rotates the postKey", async () => {
    const CANCELLED_ID = "5e000000-0000-4000-8000-0000000000b9";
    const FRESH_ID = "5e000000-0000-4000-8000-0000000000ba";
    mocks.state = { ...mocks.state, shifts: [] };
    mocks.post.mockResolvedValueOnce({ ok: false, code: "roster_unavailable", message: "Couldn't reach the server." });
    mocks.post.mockResolvedValueOnce({
      ok: true,
      result: { openShiftId: CANCELLED_ID, status: "cancelled", replayed: true },
    });
    mocks.post.mockResolvedValueOnce({
      ok: true,
      result: { openShiftId: FRESH_ID, status: "open" },
    });
    render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Not posted/));

    // Retry gets a replayed shift that has already been cancelled: not marked posted, key dropped.
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/no longer open/));
    expect(mocks.push).not.toHaveBeenCalled();

    // Trying again sends a brand-new postKey and succeeds.
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
    expect(mocks.post).toHaveBeenCalledTimes(3);
    const keys = mocks.post.mock.calls.map((call) => (call[1] as { postKey?: string }).postKey);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBeTruthy();
    expect(keys[2]).not.toBe(keys[0]);
    expect(mocks.push.mock.calls[0]![0]).toContain(FRESH_ID);
  });

  it("after a post gets no answer, a retry sends the same post key, so the server answers with the saved shift", async () => {
    const SAVED = "5e000000-0000-4000-8000-0000000000b4";
    mocks.state = { ...mocks.state, shifts: [] };
    mocks.post.mockResolvedValueOnce({ ok: false, code: "roster_unavailable", message: "Couldn't reach the server." });
    mocks.post.mockResolvedValueOnce({
      ok: true,
      result: { openShiftId: SAVED, status: "open", replayed: true },
    });
    const view = render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Not posted/));

    // The re-read doesn't show the shift yet (it went live just after the read), so the date is sent again.
    await new Promise((resolve) => setTimeout(resolve, 5));
    mocks.state = { ...mocks.state, readAt: new Date() };
    view.rerender(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());

    expect(mocks.post).toHaveBeenCalledTimes(2);
    const first = mocks.post.mock.calls[0]![1] as { postKey?: string };
    const retry = mocks.post.mock.calls[1]![1] as { postKey?: string };
    expect(first.postKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(retry.postKey).toBe(first.postKey);
    expect(mocks.push.mock.calls[0]![0]).toContain(SAVED);
  });

  it("after a post gets no answer and the page is reloaded, the retry still sends the same post key", async () => {
    const SAVED = "5e000000-0000-4000-8000-0000000000b6";
    mocks.state = { ...mocks.state, shifts: [] };
    mocks.post.mockResolvedValueOnce({ ok: false, code: "roster_unavailable", message: "Couldn't reach the server." });
    mocks.post.mockResolvedValueOnce({
      ok: true,
      result: { openShiftId: SAVED, status: "open", replayed: true },
    });
    render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Not posted/));

    // Reload: the page starts again from nothing but the tab's storage, and the same shift is posted.
    cleanup();
    render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());

    const [first, retry] = mocks.post.mock.calls.map((call) => (call[1] as { postKey?: string }).postKey);
    expect(first).toBeTruthy();
    expect(retry).toBe(first);
    expect(mocks.push.mock.calls[0]![0]).toContain(SAVED);
    // Confirmed, so the key is gone and a later post of the same shift would be a new one.
    expect(window.sessionStorage.getItem("psychsift:open-shifts:post-keys-v1")).toBeNull();
  });

  it("never reuses another person's post key after someone else signs in on the same tab", async () => {
    mocks.state = { ...mocks.state, shifts: [] };
    mocks.post.mockResolvedValue({ ok: false, code: "roster_unavailable", message: "Couldn't reach the server." });
    const view = render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());

    // A different manager signs in without the page closing, and posts the same shift.
    mocks.state = {
      ...mocks.state,
      actorId: "5e000000-0000-4000-8000-000000000002",
      readAt: new Date(Date.now() + 1000),
    };
    view.rerender(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));

    const [first, second] = mocks.post.mock.calls.map((call) => (call[1] as { postKey?: string }).postKey);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it("never replays an older post key after the same person signs out and back in on this tab", async () => {
    mocks.state = { ...mocks.state, shifts: [] };
    mocks.post.mockResolvedValue({ ok: false, code: "roster_unavailable", message: "Couldn't reach the server." });
    const view = render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());

    // Sign out and back in as the same manager without the page closing, then post the same shift.
    clearAccountScopedBrowserStorage();
    mocks.state = { ...mocks.state, readAt: new Date(Date.now() + 1000) };
    view.rerender(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));

    const [first, second] = mocks.post.mock.calls.map((call) => (call[1] as { postKey?: string }).postKey);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it("when the account changes mid-post, stops, names what went live, and never sends that date again", async () => {
    mocks.state = { ...mocks.state, shifts: [] };
    let answerFirst: (value: unknown) => void = () => undefined;
    mocks.post.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
    mocks.post.mockResolvedValue({ ok: false, code: "roster_unavailable", message: "Couldn't reach the server." });
    const view = render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add another date" }));
    fireEvent.click(screen.getByRole("button", { name: "Review and post 2 shifts" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post all 2" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());

    // Someone else signs in while the first date is still being sent, and then it goes live.
    const first = mocks.state.actorId;
    mocks.state = { ...mocks.state, actorId: "5e000000-0000-4000-8000-000000000002" };
    view.rerender(<OpenShiftsPostPage />);
    answerFirst({ ok: true, result: { openShiftId: "5e000000-0000-4000-8000-0000000000b7", status: "open" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Posting stopped.*Already posted/));
    expect(mocks.post).toHaveBeenCalledOnce();

    // The first manager signs back in and tries again: only the date that never went out is sent.
    mocks.state = { ...mocks.state, actorId: first, readAt: new Date(Date.now() + 1000) };
    view.rerender(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    const sent = mocks.post.mock.calls.map((call) => (call[1] as { startsAt: string }).startsAt);
    expect(sent[1]).not.toBe(sent[0]);
  });

  it("stops before the next date as soon as the account signs out, even before the team list catches up", async () => {
    mocks.state = { ...mocks.state, shifts: [] };
    let answerFirst: (value: unknown) => void = () => undefined;
    mocks.post.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
    render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add another date" }));
    fireEvent.click(screen.getByRole("button", { name: "Review and post 2 shifts" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post all 2" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());

    // The account signs out while the first date is still being sent; the team list has not re-read yet.
    clearAccountScopedBrowserStorage();
    answerFirst({ ok: true, result: { openShiftId: "5e000000-0000-4000-8000-0000000000b8", status: "open" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Posting stopped/));
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it("gives a deliberate new post its own key once the last one went live", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      result: { ok: true, openShiftId: "5e000000-0000-4000-8000-0000000000b5" },
    });
    render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
    cleanup();
    // A fresh visit to the post page is a new post: it never reuses an earlier visit's key.
    render(<OpenShiftsPostPage />);
    fireEvent.click(screen.getByRole("button", { name: "Review and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.post.mock.calls.map((call) => (call[1] as { postKey?: string }).postKey);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
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
