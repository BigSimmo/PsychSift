import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchCalendarLink,
  normaliseCalendarLink,
  pinnedLookup,
  type LinkRequest,
  type LinkResolver,
} from "@/lib/roster/calendar-link-fetch";

vi.mock("server-only", () => ({}));

/* The calendar-link fetch refuses anything but a public https calendar. No network is used. */

const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 as const }];
const ICS = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";

afterEach(() => vi.useRealTimers());

function reply(status: number, body = "", location: string | null = null): ReturnType<LinkRequest> {
  return Promise.resolve({
    status,
    location,
    body: (async function* () {
      yield new TextEncoder().encode(body);
    })(),
    cancel: () => undefined,
  });
}

describe("normaliseCalendarLink", () => {
  it("reads webcal links as https and refuses http, other ports and passwords", () => {
    expect(normaliseCalendarLink("webcal://roster.example.org/feed.ics?t=abc").toString()).toBe(
      "https://roster.example.org/feed.ics?t=abc",
    );
    for (const bad of [
      "http://roster.example.org/a.ics",
      "https://roster.example.org:8443/a.ics",
      "https://u:p@roster.example.org/a.ics",
      "not a link",
    ]) {
      expect(() => normaliseCalendarLink(bad)).toThrow(expect.objectContaining({ reason: "not_https" }));
    }
  });
});

describe("pinnedLookup", () => {
  const lookup = pinnedLookup({ address: "93.184.216.34", family: 4 });

  it("answers with a list when the connection asks for every address (Node 24's default)", () => {
    const callback = vi.fn();
    lookup("roster.example.org", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });

  it("answers with the single address and its family otherwise", () => {
    const callback = vi.fn();
    lookup("roster.example.org", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });
});

describe("fetchCalendarLink", () => {
  it.each(["resolve", "reject"])(
    "times out stalled DNS and owns its late %s without dispatching HTTP",
    async (outcome) => {
      vi.useFakeTimers();
      let release!: () => void;
      const resolve: LinkResolver = () =>
        new Promise((resolve, reject) => {
          release = () =>
            outcome === "resolve"
              ? resolve([{ address: "93.184.216.34", family: 4 }])
              : reject(new Error("synthetic resolver failure"));
        });
      const request = vi.fn<LinkRequest>(async ({ signal }) => {
        signal.throwIfAborted();
        return reply(200, ICS);
      });
      let failure: unknown;
      const pending = fetchCalendarLink("https://roster.example.org/a.ics", { resolve, request }).catch(
        (error: unknown) => {
          failure = error;
        },
      );
      try {
        await vi.advanceTimersByTimeAsync(10_000);
        expect(failure).toMatchObject({ reason: "timeout" });
        expect(request).not.toHaveBeenCalled();
      } finally {
        release();
        await pending;
      }
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("returns a calendar from a public address, pinned to the checked address", async () => {
    const request = vi.fn<LinkRequest>(() => reply(200, ICS));
    await expect(fetchCalendarLink("https://roster.example.org/a.ics", { resolve: PUBLIC, request })).resolves.toBe(
      ICS,
    );
    expect(request.mock.calls[0]![0].address.address).toBe("93.184.216.34");
  });

  it("refuses a name that resolves to any private address", async () => {
    const resolve = async () => [
      { address: "93.184.216.34", family: 4 as const },
      { address: "10.0.0.5", family: 4 as const },
    ];
    await expect(
      fetchCalendarLink("https://roster.example.org/a.ics", { resolve, request: () => reply(200, ICS) }),
    ).rejects.toMatchObject({
      reason: "private_address",
    });
  });

  it("checks a redirect again and refuses one to plain http", async () => {
    const request = vi.fn<LinkRequest>(() => reply(302, "", "http://roster.example.org/b.ics"));
    await expect(
      fetchCalendarLink("https://roster.example.org/a.ics", { resolve: PUBLIC, request }),
    ).rejects.toMatchObject({ reason: "not_https" });
  });

  it("refuses a body that isn't a calendar, or is too big", async () => {
    await expect(
      fetchCalendarLink("https://roster.example.org/a.ics", { resolve: PUBLIC, request: () => reply(200, "<html>") }),
    ).rejects.toMatchObject({
      reason: "not_calendar",
    });
    const big = "BEGIN:VCALENDAR" + "x".repeat(2 * 1024 * 1024);
    await expect(
      fetchCalendarLink("https://roster.example.org/a.ics", { resolve: PUBLIC, request: () => reply(200, big) }),
    ).rejects.toMatchObject({
      reason: "too_big",
    });
  });

  it("never puts the link in an error", async () => {
    const error = await fetchCalendarLink("https://roster.example.org/a.ics?token=SECRET", {
      resolve: PUBLIC,
      request: () => reply(500),
    }).catch((caught) => caught);
    expect(String(error.message)).not.toContain("SECRET");
  });
});
