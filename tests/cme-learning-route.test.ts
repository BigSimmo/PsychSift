import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, createServer, createAdmin, fetchYear, demoMode } = vi.hoisted(() => ({
  getUser: vi.fn(),
  createServer: vi.fn(),
  createAdmin: vi.fn(),
  fetchYear: vi.fn(),
  demoMode: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));
vi.mock("@/lib/cme/learning-directory", () => ({
  loadLearningDirectory: () => ({ lastCheckedOn: "2026-09-26", items: [] }),
}));
vi.mock("@/lib/cme/demo-year", () => ({ DEMO_CME_YEAR: { confirmedSource: "au-ranzcp-2026-v1; demo" } }));
vi.mock("@/lib/cme/repository", () => ({ fetchOwnerCmeYear: fetchYear }));
vi.mock("@/lib/env", () => ({ isDemoMode: demoMode }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdmin }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createServer }));

import CmeLearningRoute from "@/app/(search-app)/cme/learning/page";

const admin = { id: "private-admin-client" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T04:00:00Z"));
  vi.clearAllMocks();
  demoMode.mockReturnValue(false);
  getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  createServer.mockResolvedValue({ auth: { getUser } });
  createAdmin.mockReturnValue(admin);
  fetchYear.mockResolvedValue(null);
});

afterEach(() => vi.useRealTimers());

describe("Learning route CPD-home default", () => {
  it("uses the owner's current confirmed home and passes no private records to the page", async () => {
    fetchYear.mockResolvedValueOnce({ confirmedSource: "au-ranzcp-2026-v1; confirmed" });
    const page = await CmeLearningRoute({ searchParams: Promise.resolve({ view: "past" }) });
    expect(fetchYear).toHaveBeenCalledTimes(1);
    expect(fetchYear).toHaveBeenCalledWith(admin, "owner-1", 2026);
    expect(page.props.homeSource).toBe("au-ranzcp-2026-v1; confirmed");
    expect(page.props.view).toBe("past");
    expect(Object.keys(page.props).sort()).toEqual([
      "homeSource",
      "hospitalTeachingHref",
      "items",
      "lastCheckedOn",
      "nowIso",
      "view",
    ]);
  });

  it("uses next year's confirmed home only when the current year is absent", async () => {
    fetchYear.mockResolvedValueOnce(null).mockResolvedValueOnce({ confirmedSource: "Next year CPD home" });
    const page = await CmeLearningRoute({ searchParams: Promise.resolve({}) });
    expect(fetchYear.mock.calls.map((call) => call[2])).toEqual([2026, 2027]);
    expect(page.props.homeSource).toBe("Next year CPD home");
  });

  it("defaults safely to All when signed out or the owner read fails", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const signedOut = await CmeLearningRoute({ searchParams: Promise.resolve({}) });
    expect(signedOut.props.homeSource).toBeNull();
    expect(fetchYear).not.toHaveBeenCalled();

    getUser.mockResolvedValueOnce({ data: { user: { id: "owner-1" } }, error: null });
    fetchYear.mockRejectedValueOnce(new Error("Unavailable"));
    const unavailable = await CmeLearningRoute({ searchParams: Promise.resolve({}) });
    expect(unavailable.props.homeSource).toBeNull();
  });

  it("uses the synthetic demo home without an owner or provider read", async () => {
    demoMode.mockReturnValue(true);
    const page = await CmeLearningRoute({ searchParams: Promise.resolve({}) });
    expect(page.props.homeSource).toBe("au-ranzcp-2026-v1; demo");
    expect(createServer).not.toHaveBeenCalled();
    expect(fetchYear).not.toHaveBeenCalled();
  });
});
