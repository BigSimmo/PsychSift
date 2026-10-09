import { afterEach, describe, expect, it, vi } from "vitest";

import { watchBookingCalendar } from "@/components/work-calendar/booking-calendar-feed";
import type { WorkCalendarSourceRead } from "@/components/work-calendar/sources";
import { resetBookings } from "@/lib/work-screens/admin/bookings-store";

afterEach(() => {
  resetBookings();
  vi.unstubAllGlobals();
});

function watch(input: Parameters<typeof watchBookingCalendar>[0]) {
  const reads: WorkCalendarSourceRead[] = [];
  const stop = watchBookingCalendar(input, (read) => reads.push(read));
  return { reads, stop };
}

describe("watchBookingCalendar", () => {
  it("seeds the example and passes on the reader's booked courses", async () => {
    const { reads, stop } = watch({ active: true, signedIn: false, headers: {}, zone: "Australia/Perth" });
    expect(reads[0]?.status).toBe("loading");
    await vi.waitFor(() => expect(reads.at(-1)?.status).toBe("ready"));
    const entries = reads.at(-1)?.entries ?? [];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.id.startsWith("example:") && entry.kind === "course")).toBe(true);
    stop();
  });

  it("asks a signed-out reader to sign in without fetching", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { reads } = watch({ active: false, signedIn: false, headers: {}, zone: "Australia/Perth" });
    expect(reads).toEqual([{ status: "signed-out", entries: [] }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the saved courses, and says unavailable before the tables exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "not-set-up" }), { status: 200 })),
    );
    const { reads } = watch({
      active: false,
      signedIn: true,
      headers: { Authorization: "Bearer x" },
      zone: "Australia/Perth",
    });
    await vi.waitFor(() => expect(reads.at(-1)?.status).toBe("unavailable"));
  });

  it("passes nothing on after it is stopped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const { reads, stop } = watch({ active: false, signedIn: true, headers: {}, zone: "Australia/Perth" });
    stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads).toEqual([{ status: "loading", entries: [] }]);
  });
});
