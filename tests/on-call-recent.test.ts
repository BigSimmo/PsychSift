import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ON_CALL_RECENT_LIMIT,
  ON_CALL_USUAL_PIN_LIMIT,
  clearOnCallRecent,
  onCallRecentChangedEvent,
  onCallRecentStorageKey,
  onCallUsualOrder,
  onCallUsualShiftKey,
  readOnCallRecent,
  readOnCallUsual,
  recordOnCallRecent,
  resolveOnCallUsual,
  setOnCallUsualPinned,
} from "@/lib/on-call/recent-storage";
import { onCallUsualOrderStorageKey } from "@/lib/on-call/device-state-keys";

/**
 * A Perth wall-clock instant, with the same arguments as `new Date(y, m, d, h)`
 * (month from 0). Working hours and "today" are read in the work time zone
 * (Perth by default), never the device's, so these tests no longer depend on
 * the zone the test runner happens to be in.
 */
const perthWall = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  new Date(Date.UTC(year, month, day, hour - 8, minute, second));

/**
 * Recent is the one thing this mode remembers about what the reader did, and it
 * is the reason it must never leave the device: it is a list of the numbers a
 * doctor rang tonight, on a phone that may be a ward phone. The rules under test
 * are therefore not conveniences — they are the conditions the owner agreed the
 * feature could exist under.
 */

const NOW = new Date("2026-09-12T22:41:00.000Z");

type EventHandler = (event: Event) => void;

let storage: Map<string, string>;
let listeners: Map<string, Set<EventHandler>>;
let failOn: { getItem?: boolean; setItem?: boolean };

/** The node-project window stub, matching `tests/on-call-entry-store.test.ts`. */
beforeEach(() => {
  storage = new Map<string, string>();
  listeners = new Map<string, Set<EventHandler>>();
  failOn = {};

  vi.stubGlobal("window", {
    localStorage: {
      getItem(key: string) {
        if (failOn.getItem) throw new Error("blocked");
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (failOn.setItem) throw new Error("quota");
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
    },
    addEventListener(type: string, handler: EventHandler) {
      const existing = listeners.get(type) ?? new Set<EventHandler>();
      existing.add(handler);
      listeners.set(type, existing);
    },
    removeEventListener(type: string, handler: EventHandler) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event: Event) {
      listeners.get(event.type)?.forEach((handler) => handler(event));
      return true;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seed(count: number) {
  for (let index = 0; index < count; index += 1) {
    recordOnCallRecent({ id: `entry-${index}`, title: `Entry ${index}` }, new Date(NOW.getTime() + index * 60_000));
  }
}

describe("readOnCallRecent", () => {
  it("is empty before anything is recorded", () => {
    expect(readOnCallRecent()).toEqual([]);
  });

  it("treats unparseable storage as no history rather than throwing", () => {
    storage.set(onCallRecentStorageKey, "{not json");
    expect(readOnCallRecent()).toEqual([]);
  });

  it("treats a payload of the wrong shape as no history", () => {
    // A schema change, or another app writing the same key. Rendering half a
    // record is worse than rendering none: a row with a number and no title is
    // a number nobody can identify before dialling it.
    storage.set(onCallRecentStorageKey, JSON.stringify([{ id: 7 }, "nope"]));
    expect(readOnCallRecent()).toEqual([]);
  });

  it("returns an empty list rather than throwing when storage itself is unavailable", () => {
    failOn.getItem = true;
    expect(readOnCallRecent()).toEqual([]);
  });
});

describe("recordOnCallRecent", () => {
  it("never records an example row", () => {
    recordOnCallRecent({ id: "00000000-0000-4000-8000-000000000101", title: "Example ward" }, NOW);
    recordOnCallRecent({ id: "example:ward", title: "Example ward" }, NOW);
    expect(readOnCallRecent()).toEqual([]);
  });

  it("keeps the newest first", () => {
    recordOnCallRecent({ id: "a", title: "Ward 4B" }, NOW);
    recordOnCallRecent({ id: "b", title: "Switchboard" }, new Date(NOW.getTime() + 60_000));
    expect(readOnCallRecent().map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("moves a repeat to the front instead of listing it twice", () => {
    // The whole value of this module is the second night, when the same four
    // numbers are dialled again. Duplicates would push the other three off the
    // list within one shift.
    recordOnCallRecent({ id: "a", title: "Ward 4B" }, NOW);
    recordOnCallRecent({ id: "b", title: "Switchboard" }, new Date(NOW.getTime() + 60_000));
    recordOnCallRecent({ id: "a", title: "Ward 4B" }, new Date(NOW.getTime() + 120_000));
    expect(readOnCallRecent().map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("caps the list so it cannot grow without bound on a long shift", () => {
    seed(ON_CALL_RECENT_LIMIT + 5);
    expect(readOnCallRecent()).toHaveLength(ON_CALL_RECENT_LIMIT);
  });

  it("drops the oldest when it caps, never the newest", () => {
    seed(ON_CALL_RECENT_LIMIT + 1);
    const ids = readOnCallRecent().map((item) => item.id);
    expect(ids[0]).toBe(`entry-${ON_CALL_RECENT_LIMIT}`);
    expect(ids).not.toContain("entry-0");
  });

  it("records the time so a row can say when", () => {
    recordOnCallRecent({ id: "a", title: "Ward 4B" }, NOW);
    expect(readOnCallRecent()[0]?.at).toBe(NOW.toISOString());
  });

  it("notifies this tab, which the storage event does not", () => {
    const listener = vi.fn();
    window.addEventListener(onCallRecentChangedEvent, listener);
    recordOnCallRecent({ id: "a", title: "Ward 4B" }, NOW);
    expect(listener).toHaveBeenCalled();
    window.removeEventListener(onCallRecentChangedEvent, listener);
  });

  it("does not throw when storage refuses the write", () => {
    failOn.setItem = true;
    expect(() => recordOnCallRecent({ id: "a", title: "Ward 4B" }, NOW)).not.toThrow();
  });
});

describe("clearOnCallRecent", () => {
  it("empties the list", () => {
    recordOnCallRecent({ id: "a", title: "Ward 4B" }, NOW);
    clearOnCallRecent();
    expect(readOnCallRecent()).toEqual([]);
  });

  it("removes the key outright rather than leaving an empty list behind", () => {
    // A shared ward phone: "no history" and "an empty history object written by
    // the last user" must not be distinguishable on disk.
    recordOnCallRecent({ id: "a", title: "Ward 4B" }, NOW);
    clearOnCallRecent();
    expect(storage.has(onCallRecentStorageKey)).toBe(false);
  });

  it("notifies this tab", () => {
    const listener = vi.fn();
    window.addEventListener(onCallRecentChangedEvent, listener);
    clearOnCallRecent();
    expect(listener).toHaveBeenCalled();
    window.removeEventListener(onCallRecentChangedEvent, listener);
  });
});

describe("what is stored", () => {
  it("stores no phone number", () => {
    // The hard privacy line. A recent row shows a title and links to the entry;
    // the number is read from the live entry at render time. Persisting digits
    // would mean a personal number outliving the session on a shared device even
    // though the entry itself is withheld from a signed-out read.
    recordOnCallRecent({ id: "a", title: "Dr M. Okafor — direct" }, NOW);
    const raw = storage.get(onCallRecentStorageKey) ?? "";
    expect(raw).toContain("a");
    // "Your usual" (kit 1.4) adds a source, a tap count and a pin flag: still no digits.
    expect(Object.keys(readOnCallRecent()[0] ?? {}).sort()).toEqual(["at", "count", "id", "pinned", "source", "title"]);
  });

  it("never stores a phone number, even for a hospital row", () => {
    recordOnCallRecent({ id: "a", source: "handbook" });
    expect(window.localStorage.getItem(onCallRecentStorageKey)).not.toMatch(/\d{4}\s?\d{4}/);
  });

  it("stores a hospital row as an id, a kind and times only, never its title (review B2)", () => {
    // A caller that slips a title through anyway (a cast, plain JavaScript) still stores none.
    recordOnCallRecent({ id: "h1", source: "handbook", title: "ICU: Registrar" } as never, NOW);
    expect(storage.get(onCallRecentStorageKey) ?? "").not.toMatch(/Registrar|ICU|title/);
    recordOnCallRecent({ id: "h1", source: "handbook" }, new Date(NOW.getTime() + 60_000));
    const raw = storage.get(onCallRecentStorageKey) ?? "";
    expect(raw).not.toMatch(/Registrar|ICU|title/);
    const [stored] = JSON.parse(raw) as Record<string, unknown>[];
    expect(Object.keys(stored ?? {}).sort()).toEqual(["at", "count", "id", "pinned", "source"]);
    expect(stored).toMatchObject({ id: "h1", source: "handbook", count: 2, pinned: false });
    expect(String(stored?.at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("reads an older hospital row that held a title without it, and the next write drops it", () => {
    storage.set(
      onCallRecentStorageKey,
      JSON.stringify([
        {
          id: "h1",
          title: "ICU: Registrar",
          at: "2026-09-25T00:00:00.000Z",
          source: "handbook",
          count: 1,
          pinned: false,
        },
      ]),
    );
    expect(readOnCallRecent()).toEqual([
      { id: "h1", at: "2026-09-25T00:00:00.000Z", source: "handbook", count: 1, pinned: false },
    ]);
    recordOnCallRecent({ id: "e1", title: "My own entry" }, NOW);
    expect(storage.get(onCallRecentStorageKey)).not.toMatch(/Registrar|ICU/);
  });
});

describe("resolveOnCallUsual (review B2)", () => {
  const handbook = [
    { id: "h1", title: "ICU: Registrar" },
    { id: "h3", title: "Switchboard" },
  ];

  it("names a hospital row from the signed-in handbook, and hides one it cannot resolve", () => {
    recordOnCallRecent({ id: "h1", source: "handbook" }, NOW);
    recordOnCallRecent({ id: "h2", source: "handbook" }, new Date(NOW.getTime() + 60_000));
    recordOnCallRecent({ id: "e1", title: "My own entry" }, new Date(NOW.getTime() + 120_000));
    const rows = resolveOnCallUsual(readOnCallRecent(), handbook);
    expect(rows.map((row) => [row.item.id, row.title, row.handbook?.id ?? null])).toEqual([
      ["e1", "My own entry", null],
      ["h1", "ICU: Registrar", "h1"],
    ]);
  });

  it("hides every hospital row when no handbook is signed in", () => {
    recordOnCallRecent({ id: "h1", source: "handbook" }, NOW);
    expect(resolveOnCallUsual(readOnCallRecent(), [])).toEqual([]);
  });
});

describe("Your usual", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts repeat taps and keeps pins above the most-tapped", () => {
    recordOnCallRecent({ id: "a", source: "handbook" }, new Date("2026-09-26T01:00:00Z"));
    recordOnCallRecent({ id: "b", title: "B" }, new Date("2026-09-26T01:01:00Z"));
    recordOnCallRecent({ id: "b", title: "B" }, new Date("2026-09-26T01:02:00Z"));
    setOnCallUsualPinned("a", true);
    expect(onCallUsualOrder(readOnCallRecent()).map((item) => [item.id, item.count, item.pinned])).toEqual([
      ["a", 1, true],
      ["b", 2, false],
    ]);
  });

  it("reads a list stored before counts existed", () => {
    window.localStorage.setItem(
      onCallRecentStorageKey,
      JSON.stringify([{ id: "x", title: "X", at: "2026-09-25T00:00:00Z" }]),
    );
    expect(readOnCallRecent()).toEqual([
      { id: "x", title: "X", at: "2026-09-25T00:00:00Z", source: "entry", count: 1, pinned: false },
    ]);
  });

  it("refuses a fifth pin", () => {
    for (let index = 0; index < ON_CALL_USUAL_PIN_LIMIT + 1; index += 1) {
      recordOnCallRecent({ id: `p${index}`, title: `P${index}` }, new Date(NOW.getTime() + index * 60_000));
      setOnCallUsualPinned(`p${index}`, true);
    }
    expect(readOnCallRecent().filter((item) => item.pinned)).toHaveLength(ON_CALL_USUAL_PIN_LIMIT);
    expect(readOnCallRecent().find((item) => item.id === `p${ON_CALL_USUAL_PIN_LIMIT}`)?.pinned).toBe(false);
  });

  it("keeps a pin through the eight-item cap", () => {
    recordOnCallRecent({ id: "pinned", title: "Pinned" }, NOW);
    setOnCallUsualPinned("pinned", true);
    seed(ON_CALL_RECENT_LIMIT + 3);
    expect(readOnCallRecent().map((item) => item.id)).toContain("pinned");
    expect(readOnCallRecent()).toHaveLength(ON_CALL_RECENT_LIMIT);
  });

  it("holds one order for the whole shift: a newly frequent number joins at the end", () => {
    vi.useFakeTimers();
    // Wednesday 23 Sep 2026, 18:00 Perth (the work zone): an after-hours shift.
    vi.setSystemTime(perthWall(2026, 8, 23, 18, 0, 0));
    recordOnCallRecent({ id: "a", title: "A" });
    vi.advanceTimersByTime(60_000);
    recordOnCallRecent({ id: "a", title: "A" });
    vi.advanceTimersByTime(60_000);
    recordOnCallRecent({ id: "b", title: "B" });
    expect(readOnCallUsual().map((item) => item.id)).toEqual(["a", "b"]);

    // Later the same night "c" is tapped three times: it is now the most used,
    // but it joins at the end and nothing above it moves.
    vi.setSystemTime(perthWall(2026, 8, 24, 2, 0, 0));
    for (let tap = 0; tap < 3; tap += 1) {
      recordOnCallRecent({ id: "c", title: "C" });
      vi.advanceTimersByTime(60_000);
    }
    recordOnCallRecent({ id: "b", title: "B" });
    expect(readOnCallUsual().map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("re-sorts only when a new shift starts, with pins still on top", () => {
    vi.useFakeTimers();
    vi.setSystemTime(perthWall(2026, 8, 23, 18, 0, 0));
    recordOnCallRecent({ id: "a", title: "A" });
    recordOnCallRecent({ id: "b", title: "B" });
    expect(readOnCallUsual().map((item) => item.id)).toEqual(["b", "a"]);
    for (let tap = 0; tap < 3; tap += 1) recordOnCallRecent({ id: "c", title: "C" });
    recordOnCallRecent({ id: "d", title: "D" });
    setOnCallUsualPinned("d", true);
    expect(readOnCallUsual().map((item) => item.id)).toEqual(["d", "b", "a", "c"]);

    // Thursday 08:00: the in-hours shift starts and the list re-sorts once.
    vi.setSystemTime(perthWall(2026, 8, 24, 8, 0, 0));
    expect(onCallUsualShiftKey()).not.toBe(onCallUsualShiftKey(perthWall(2026, 8, 23, 18, 0, 0)));
    expect(readOnCallUsual().map((item) => item.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("remembers only ids for the frozen order, in a key the sign-out wipe removes", () => {
    recordOnCallRecent({ id: "a", title: "Registrar" }, NOW);
    readOnCallUsual(NOW);
    const raw = window.localStorage.getItem(onCallUsualOrderStorageKey) ?? "";
    expect(raw).toContain('"a"');
    expect(raw).not.toContain("Registrar");
  });
});
