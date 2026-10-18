/** @vitest-environment jsdom */
// Regression from the audit: real component/hooks, intercepted APIs with the 21-day cutoff.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/pay",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "authenticated",
    authEpoch: 1,
    session: { user: { id: "synthetic-A", created_at: "2020-01-01T00:00:00Z" } },
  }),
  hasSupabaseAuthSession: () => true,
}));
vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true }),
  useOptionalAccountData: () => ({ isAuthenticated: true }),
}));
vi.mock("@/lib/on-call/entry-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/on-call/entry-store")>()),
  useOnCallEntries: () => ({
    entries: [],
    loading: false,
    isOffline: false,
    loadError: null,
    signedOut: false,
    demoMode: false,
    cachedAt: null,
    retry: () => undefined,
  }),
}));
import { AdminPayPage } from "@/components/work-screens/admin/pay-page";
import { resetSharedGets } from "@/lib/shared-get";
import { resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";
import { forgetAdminPaperworkOnDevice } from "@/lib/work-screens/admin/paperwork-store";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";
const now = new Date("2026-10-17T01:00:00Z");
const allShifts = ["2026-09-22", "2026-09-28"].map((date, index) => ({
  id: `synthetic-pay-${index}`,
  startsAt: `${date}T00:00:00Z`,
  endsAt: `${date}T08:00:00Z`,
  title: "Synthetic shift",
  location: null,
  sourceUid: null,
  kind: "day",
  source: "import",
  seriesId: null,
  workplace: "Synthetic workplace",
}));
beforeEach(() => {
  forgetAdminPaperworkOnDevice();
  window.localStorage.clear();
  resetExampleDataForTests();
  setExampleDataOn(false);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  resetSharedGets();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetSharedGets();
});
const teamId = "51000000-0000-4000-8000-000000000001";

function serve({
  anchor = null,
  empty = false,
  fail = () => false,
  shifts = allShifts,
}: {
  anchor?: string | null;
  empty?: boolean;
  fail?: () => boolean;
  shifts?: typeof allShifts;
} = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://offline.invalid");
      calls.push(url.pathname + url.search);
      if (url.pathname === "/api/roster/shifts") {
        const from = url.searchParams.get("from");
        if (from && fail()) return Response.json({ error: "temporarily unavailable" }, { status: 503 });
        const cutoff = from ? Date.parse(`${from}T00:00:00Z`) : now.getTime() - 21 * 24 * 60 * 60 * 1000;
        const to = url.searchParams.get("to");
        const end = to ? Date.parse(`${addDaysToDate(to, 1)}T00:00:00Z`) : Infinity;
        return Response.json({
          shifts: empty
            ? []
            : shifts.filter((shift) => Date.parse(shift.endsAt) > cutoff && Date.parse(shift.startsAt) < end),
          latestImport: null,
        });
      }
      if (url.pathname === "/api/roster/team")
        return Response.json({
          teams: anchor
            ? [{ serviceId: teamId, name: "Synthetic team", enabled: true, role: "member", grade: "registrar" }]
            : [],
          actorId: "synthetic-A",
        });
      if (url.pathname === `/api/roster/team/${teamId}`)
        return Response.json(
          url.searchParams.get("what") === "overview"
            ? {
                service: { id: teamId, name: "Synthetic team" },
                me: { role: "member", grade: "registrar", rotationEndsOn: null },
                latestPublication: null,
                seenLatest: true,
                sites: [],
                settings: { swapApproval: "auto_same_grade", rules: {}, rulesSource: null, payFortnightAnchor: anchor },
              }
            : { assignments: [] },
        );
      if (url.pathname === "/api/roster/extra-time") return Response.json({ records: [] });
      return Response.json({});
    }),
  );
  return calls;
}

it.each([
  { anchor: null, from: "2026-09-21", to: "2026-10-18", expected: "16", empty: false },
  { anchor: "2026-10-07", from: "2026-09-23", to: "2026-10-20", expected: "8", empty: false },
  { anchor: null, from: "2026-09-21", to: "2026-10-18", expected: "0", empty: true },
])(
  "fills the entire preceding fortnight with $expected hours (anchor $anchor, empty $empty)",
  async ({ anchor, from, to, expected, empty }) => {
    const calls = serve({ anchor, empty });
    render(<AdminPayPage now={now} />);
    await screen.findByTestId("admin-pay-hero");
    fireEvent.click(screen.getByTestId("admin-pay-check"));
    // Default is Sep21-Oct4. Both known shifts are within it (16h); main GET only supplies Sep28 (8h).
    await waitFor(() => expect(screen.getByTestId("admin-pay-rostered")).toHaveValue(expected));
    const readFrom = addDaysToDate(from, -1);
    expect(calls.some((url) => url.includes(`/api/roster/shifts?from=${readFrom}`))).toBe(true);
    if (anchor) expect(calls.some((url) => url.includes(`from=${readFrom}&to=${to}`))).toBe(true);
  },
);

it("includes a midnight shift on the first local fortnight day without counting padded outside days or overlap twice", async () => {
  const shift = (id: string, startsAt: string, endsAt: string) => ({ ...allShifts[0]!, id, startsAt, endsAt });
  serve({
    shifts: [
      // Previous fortnight starts21Sep00:00 AWST. Its first8h end exactly at the old UTC lower bound.
      shift("first-local-day", "2026-09-20T16:00:00Z", "2026-09-21T00:00:00Z"),
      // Padding may fetch this preceding-local-day shift, but it contributes no period hours.
      shift("outside-period", "2026-09-20T00:00:00Z", "2026-09-20T08:00:00Z"),
      // Both default and historical reads contain this row; count its8h once.
      shift("overlap", "2026-09-26T08:00:00Z", "2026-09-26T16:00:00Z"),
    ],
  });
  render(<AdminPayPage now={now} />);
  await screen.findByTestId("admin-pay-hero");
  fireEvent.click(screen.getByTestId("admin-pay-check"));
  await waitFor(() => expect(screen.getByTestId("admin-pay-rostered")).toHaveValue("16"));
});

it("does not prefill a partial total when older days fail, and recovers on retry", async () => {
  let fail = true;
  serve({ fail: () => fail });
  render(<AdminPayPage now={now} />);
  const warning = await screen.findByTestId("admin-pay-roster-failed");
  expect(warning).toHaveTextContent("Couldn't load your roster");
  expect(screen.queryByTestId("admin-pay-hero")).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByTestId("admin-pay-hero");
  fireEvent.click(screen.getByTestId("admin-pay-check"));
  await waitFor(() => expect(screen.getByTestId("admin-pay-rostered")).toHaveValue("16"));
});
