import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ACCOUNT_TRANSITION_EVENT, WORK_PAGE_FAVOURITES_STORAGE_KEY } from "@/lib/account-scoped-browser-state";

/**
 * The device store behind saved work pages (`work-page-stars.ts`). It reads
 * `window.localStorage` and listens for the account transition at load, so a
 * small in-memory window is installed before the module is imported.
 */

class MemoryStorage {
  private readonly map = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
const fakeWindow = Object.assign(new EventTarget(), { localStorage: storage });

type Stars = typeof import("@/lib/favourites/work-page-stars");
let stars: Stars;

beforeAll(async () => {
  vi.stubGlobal("window", fakeWindow);
  vi.resetModules();
  stars = await import("@/lib/favourites/work-page-stars");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  storage.clear();
  storage.failWrites = false;
  stars.resetWorkPageStarsForTesting();
});

function seed(value: unknown) {
  storage.setItem(WORK_PAGE_FAVOURITES_STORAGE_KEY, typeof value === "string" ? value : JSON.stringify(value));
  stars.resetWorkPageStarsForTesting();
}

function stored(): unknown {
  const raw = storage.getItem(WORK_PAGE_FAVOURITES_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe("work page stars: reading what is stored", () => {
  it("treats missing, corrupt and non-array storage as nothing saved", () => {
    expect(stars.loadWorkPageStars()).toEqual([]);
    seed("{not json");
    expect(stars.loadWorkPageStars()).toEqual([]);
    seed({ areaId: "day", itemId: "my-day-week", starredAt: 1 });
    expect(stars.loadWorkPageStars()).toEqual([]);
  });

  it("drops entries with an unknown area, a missing item, or no valid saved time", () => {
    seed([
      null,
      "text",
      { areaId: "nowhere", itemId: "my-day-week", starredAt: 10 },
      { areaId: "day", starredAt: 10 },
      { areaId: "day", itemId: "my-day-week", starredAt: -5 },
      { areaId: "day", itemId: "my-day-week", starredAt: Number.NaN },
      { areaId: "day", itemId: "my-day-hours", starredAt: 20, pinnedAt: "soon", openedAt: Infinity },
    ]);
    expect(stars.loadWorkPageStars()).toEqual([
      { areaId: "day", itemId: "my-day-hours", starredAt: 20, pinnedAt: null, openedAt: null },
    ]);
  });

  it("keeps the first of duplicate keys", () => {
    seed([
      { areaId: "day", itemId: "my-day-week", starredAt: 30, pinnedAt: 31 },
      { areaId: "day", itemId: "my-day-week", starredAt: 40 },
    ]);
    const loaded = stars.loadWorkPageStars();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ starredAt: 30, pinnedAt: 31 });
  });

  it("caps the list at the maximum when reading and when writing", () => {
    const many = Array.from({ length: stars.MAX_WORK_PAGE_STARS + 10 }, (_, index) => ({
      areaId: "day",
      itemId: `page-${index}`,
      starredAt: 100 + index,
    }));
    seed(many);
    expect(stars.loadWorkPageStars()).toHaveLength(stars.MAX_WORK_PAGE_STARS);

    stars.toggleWorkPageStar("day", "brand-new", 9_999);
    const after = stars.loadWorkPageStars();
    expect(after).toHaveLength(stars.MAX_WORK_PAGE_STARS);
    // Newest first; the oldest falls off the end.
    expect(after[0]).toMatchObject({ itemId: "brand-new" });
    expect(stored()).toHaveLength(stars.MAX_WORK_PAGE_STARS);
  });
});

describe("work page stars: changes", () => {
  it("toggles a page on and off and tells listeners each time", () => {
    const listener = vi.fn();
    const unsubscribe = stars.subscribeWorkPageStars(listener);

    expect(stars.toggleWorkPageStar("day", "my-day-week", 500)).toEqual({ starred: true, saved: true });
    expect(stars.isWorkPageStarred("day", "my-day-week")).toBe(true);
    expect(stars.loadWorkPageStars()[0]).toEqual({
      areaId: "day",
      itemId: "my-day-week",
      starredAt: 500,
      pinnedAt: null,
      openedAt: null,
    });

    expect(stars.toggleWorkPageStar("day", "my-day-week")).toEqual({ starred: false, saved: true });
    expect(stars.isWorkPageStarred("day", "my-day-week")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("reports a refused write so the caller can say it did not save", () => {
    storage.failWrites = true;
    expect(stars.toggleWorkPageStar("day", "my-day-week")).toEqual({ starred: true, saved: false });
  });

  it("pins and unpins only the chosen pages", () => {
    stars.toggleWorkPageStar("day", "my-day-week", 1);
    stars.toggleWorkPageStar("day", "my-day-hours", 2);
    const weekKey = stars.workPageStarKey("day", "my-day-week");

    stars.setWorkPageStarsPinned(new Set([weekKey]), true, 700);
    const pinned = stars.loadWorkPageStars();
    expect(pinned.find((star) => star.itemId === "my-day-week")?.pinnedAt).toBe(700);
    expect(pinned.find((star) => star.itemId === "my-day-hours")?.pinnedAt).toBeNull();

    stars.setWorkPageStarsPinned(new Set([weekKey]), false);
    expect(stars.loadWorkPageStars().every((star) => star.pinnedAt === null)).toBe(true);
  });

  it("removes pages and restores them with their pins and times kept", () => {
    stars.toggleWorkPageStar("day", "my-day-week", 1);
    stars.toggleWorkPageStar("day", "my-day-hours", 2);
    const weekKey = stars.workPageStarKey("day", "my-day-week");
    stars.setWorkPageStarsPinned(new Set([weekKey]), true, 50);
    stars.recordWorkPageOpened(weekKey, 60);

    const removed = stars.removeWorkPageStars(new Set([weekKey]));
    expect(removed).toEqual([{ areaId: "day", itemId: "my-day-week", starredAt: 1, pinnedAt: 50, openedAt: 60 }]);
    expect(stars.isWorkPageStarred("day", "my-day-week")).toBe(false);

    expect(stars.restoreWorkPageStars(removed)).toBe(true);
    expect(stars.loadWorkPageStars().find((star) => star.itemId === "my-day-week")).toEqual(removed[0]);
    // Restoring what is already there adds nothing twice.
    stars.restoreWorkPageStars(removed);
    expect(stars.loadWorkPageStars()).toHaveLength(2);
  });

  it("records an open only for a saved page", () => {
    stars.toggleWorkPageStar("day", "my-day-week", 1);
    stars.recordWorkPageOpened(stars.workPageStarKey("day", "my-day-hours"), 80);
    expect(stars.loadWorkPageStars()).toHaveLength(1);
    stars.recordWorkPageOpened(stars.workPageStarKey("day", "my-day-week"), 90);
    expect(stars.loadWorkPageStars()[0]?.openedAt).toBe(90);
  });

  it("forgets the remembered list when the account changes", () => {
    stars.toggleWorkPageStar("day", "my-day-week", 1);
    expect(stars.loadWorkPageStars()).toHaveLength(1);
    const listener = vi.fn();
    stars.subscribeWorkPageStars(listener);

    // Sign-out removes the key, then announces the transition.
    storage.removeItem(WORK_PAGE_FAVOURITES_STORAGE_KEY);
    fakeWindow.dispatchEvent(new Event(ACCOUNT_TRANSITION_EVENT));

    expect(listener).toHaveBeenCalled();
    expect(stars.loadWorkPageStars()).toEqual([]);
  });
});

describe("work page stars: resolving to real pages", () => {
  it("drops unknown items and action-only items, and keeps real links", () => {
    const resolved = stars.resolveWorkPageStars([
      { areaId: "day", itemId: "my-day-week", starredAt: 1, pinnedAt: null, openedAt: null },
      { areaId: "day", itemId: "no-such-page", starredAt: 2, pinnedAt: null, openedAt: null },
      // Reminders opens a sheet; it has nowhere to go from Favourites.
      { areaId: "day", itemId: "my-day-reminders", starredAt: 3, pinnedAt: null, openedAt: null },
    ]);
    expect(resolved.map((star) => star.key)).toEqual(["day:my-day-week"]);
    expect(resolved[0]?.item.href).toBe("/my-day/week");
    expect(resolved[0]?.area.name).toBe("My Day");
  });

  it("never offers an action-only item to add", () => {
    const day = stars.starrableWorkPages().find((group) => group.area.id === "day");
    expect(day?.items.some((item) => item.id === "my-day-reminders")).toBe(false);
    expect(day?.items.every((item) => typeof item.href === "string")).toBe(true);
  });
});
