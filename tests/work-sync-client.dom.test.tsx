import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_PAPERWORK_STORAGE_KEY,
  clearAccountScopedBrowserStorage,
  CPD_APPLICATIONS_STORAGE_KEY,
  MY_DAY_HIDDEN_CARDS_STORAGE_KEY,
  MY_DAY_QUICK_NOTE_STORAGE_KEY,
  TEACHING_EXAM_PREP_STORAGE_KEY,
  WORK_ACCOUNT_SYNC_MARKER_KEY,
} from "@/lib/account-scoped-browser-state";
import { setSharedDevice } from "@/lib/alerts/shared-device";
import { announceWorkSyncChange, type WorkSyncSection } from "@/lib/work-sync/sections";
import { resetWorkSyncForTesting, startWorkSync, useWorkSyncStatus } from "@/lib/work-sync/work-sync-client";

type Sections = Record<string, { value: unknown; updatedAt: string }>;

function mockServer(sections: Sections, refuse: Record<string, number> = {}) {
  const puts: { section: string; value: unknown }[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { section: string; value: unknown };
      puts.push(body);
      const status = refuse[body.section];
      if (status) return new Response(JSON.stringify({ code: "refused" }), { status });
      sections[body.section] = { value: body.value, updatedAt: new Date().toISOString() };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ sections }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { puts, fetchMock };
}

const AT = "2026-10-07T21:00:00.000Z";
const MATCHED = JSON.stringify({ matched: true, ahead: [] });
const start = () => startWorkSync({ headers: () => ({}), isCurrent: () => true });
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  // The first-match merge loads on demand.
  await vi.dynamicImportSettled();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await vi.runAllTimersAsync();
};
const readStatus = (section: WorkSyncSection) => {
  const { result, unmount } = renderHook(() => useWorkSyncStatus(section));
  const status = result.current;
  unmount();
  return status;
};

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  resetWorkSyncForTesting();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("work sync client", () => {
  it("copies a whole record down from the account and saves a change to it", async () => {
    window.localStorage.setItem(WORK_ACCOUNT_SYNC_MARKER_KEY, MATCHED);
    const record = { version: 1, requests: [], documents: [], payslips: [], tax: {} };
    const { puts } = mockServer({ adminPaperwork: { value: record, updatedAt: AT } });
    start();
    await settle();
    expect(JSON.parse(window.localStorage.getItem(ADMIN_PAPERWORK_STORAGE_KEY) ?? "null")).toEqual(record);

    const changed = { ...record, tax: { "2026": { checked: [], expenses: [] } } };
    window.localStorage.setItem(ADMIN_PAPERWORK_STORAGE_KEY, JSON.stringify(changed));
    announceWorkSyncChange(ADMIN_PAPERWORK_STORAGE_KEY);
    await settle();
    expect(puts).toEqual([{ section: "adminPaperwork", value: changed }]);
  });

  it("never copies job applications onto a device marked shared, nor saves them from it", async () => {
    window.localStorage.setItem(WORK_ACCOUNT_SYNC_MARKER_KEY, MATCHED);
    setSharedDevice(true);
    const { puts } = mockServer({
      cpdApplications: {
        value: { version: 1, dates: [], referees: [], statement: "Mine", hiddenCvLines: [] },
        updatedAt: AT,
      },
    });
    start();
    await settle();
    expect(window.localStorage.getItem(CPD_APPLICATIONS_STORAGE_KEY)).toBeNull();
    announceWorkSyncChange(CPD_APPLICATIONS_STORAGE_KEY);
    await settle();
    expect(puts).toEqual([]);
  });

  it("takes the account's copy on a device that has matched before, and tells the store", async () => {
    window.localStorage.setItem(WORK_ACCOUNT_SYNC_MARKER_KEY, MATCHED);
    window.localStorage.setItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY, JSON.stringify(["cpd"]));
    const { puts } = mockServer({ myDayHiddenCards: { value: ["hours"], updatedAt: AT } });
    const heard = vi.fn();
    window.addEventListener("storage", heard);
    start();
    await settle();
    expect(window.localStorage.getItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY)).toBe(JSON.stringify(["hours"]));
    expect(heard).toHaveBeenCalled();
    expect(puts).toEqual([]);
    window.removeEventListener("storage", heard);
  });

  it.each([
    { name: "edit", value: "Updated synthetic note" },
    { name: "deletion", value: null },
  ])("keeps a saved $name when an older account read arrives afterward", async ({ value }) => {
    window.localStorage.setItem(WORK_ACCOUNT_SYNC_MARKER_KEY, MATCHED);
    window.localStorage.setItem(MY_DAY_QUICK_NOTE_STORAGE_KEY, "Original synthetic note");
    const sections: Sections = {
      myDayQuickNote: { value: "Original synthetic note", updatedAt: AT },
      myDayHiddenCards: { value: ["hours"], updatedAt: AT },
    };
    // Freeze the GET's snapshot before the later PUT changes the account.
    const olderResponse = new Response(JSON.stringify({ sections }), { status: 200 });
    let releaseRead: (response: Response) => void = () => {};
    const pendingRead = new Promise<Response>((resolve) => (releaseRead = resolve));
    let reads = 0;
    const puts: { section: string; value: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { section: string; value: unknown };
          puts.push(body);
          sections[body.section] = { value: body.value, updatedAt: AT };
          return new Response("{}", { status: 200 });
        }
        reads += 1;
        return reads === 1 ? pendingRead : new Response(JSON.stringify({ sections }), { status: 200 });
      }),
    );
    start();
    if (value === null) window.localStorage.removeItem(MY_DAY_QUICK_NOTE_STORAGE_KEY);
    else window.localStorage.setItem(MY_DAY_QUICK_NOTE_STORAGE_KEY, value);
    announceWorkSyncChange(MY_DAY_QUICK_NOTE_STORAGE_KEY);
    await settle();
    expect(puts).toEqual([{ section: "myDayQuickNote", value }]);
    expect(sections.myDayQuickNote?.value).toBe(value);
    expect(JSON.parse(window.localStorage.getItem(WORK_ACCOUNT_SYNC_MARKER_KEY) ?? "{}")).toMatchObject({ ahead: [] });

    releaseRead(olderResponse);
    await settle();
    expect(window.localStorage.getItem(MY_DAY_QUICK_NOTE_STORAGE_KEY)).toBe(value);
    // A section untouched since that GET still adopts the account update.
    expect(window.localStorage.getItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY)).toBe(JSON.stringify(["hours"]));
    expect(readStatus("myDayQuickNote")).toBe("account");

    sections.myDayQuickNote = { value: "Fresh synthetic account note", updatedAt: AT };
    vi.setSystemTime(Date.now() + 60_000);
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(reads).toBe(2);
    expect(window.localStorage.getItem(MY_DAY_QUICK_NOTE_STORAGE_KEY)).toBe("Fresh synthetic account note");
  });

  it("keeps a carried change saved while its first account read is in flight", async () => {
    window.localStorage.setItem(
      WORK_ACCOUNT_SYNC_MARKER_KEY,
      JSON.stringify({ matched: ["myDayQuickNote"], ahead: ["myDayQuickNote"] }),
    );
    window.localStorage.setItem(MY_DAY_QUICK_NOTE_STORAGE_KEY, "Carried synthetic note");
    let releaseRead: (response: Response) => void = () => {};
    const pendingRead = new Promise<Response>((resolve) => (releaseRead = resolve));
    const puts: { section: string; value: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "PUT") return pendingRead;
        puts.push(JSON.parse(String(init.body)) as { section: string; value: unknown });
        return new Response("{}", { status: 200 });
      }),
    );
    start();
    await settle();
    expect(puts).toEqual([{ section: "myDayQuickNote", value: "Carried synthetic note" }]);
    expect(JSON.parse(window.localStorage.getItem(WORK_ACCOUNT_SYNC_MARKER_KEY) ?? "{}")).toMatchObject({ ahead: [] });

    releaseRead(
      new Response(JSON.stringify({ sections: { myDayQuickNote: { value: "Older synthetic note", updatedAt: AT } } })),
    );
    await settle();
    expect(window.localStorage.getItem(MY_DAY_QUICK_NOTE_STORAGE_KEY)).toBe("Carried synthetic note");
    expect(readStatus("myDayQuickNote")).toBe("account");
  });

  it.each([
    { name: "first match", matched: false, fullStorage: false, expected: ["hours", "cpd"] },
    { name: "matched download", matched: true, fullStorage: false, expected: ["hours"] },
    { name: "first match with full storage", matched: false, fullStorage: true, expected: ["hours", "cpd"] },
  ])(
    "retries a refused local write during $name without uploading the older device copy",
    async ({ matched, fullStorage, expected }) => {
      if (matched) window.localStorage.setItem(WORK_ACCOUNT_SYNC_MARKER_KEY, MATCHED);
      window.localStorage.setItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY, JSON.stringify(["cpd"]));
      const sections: Sections = { myDayHiddenCards: { value: ["hours"], updatedAt: AT } };
      const { puts } = mockServer(sections);
      const originalSetItem = Storage.prototype.setItem;
      let blocked = true;
      const refused = vi.fn();
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, next: string) {
        if (blocked && (fullStorage || key === MY_DAY_HIDDEN_CARDS_STORAGE_KEY)) {
          refused();
          throw new DOMException("Synthetic full storage", "QuotaExceededError");
        }
        originalSetItem.call(this, key, next);
      });
      start();
      await settle();
      expect(refused).toHaveBeenCalled();
      expect(puts).toEqual([]);
      expect(sections.myDayHiddenCards?.value).toEqual(["hours"]);
      expect(window.localStorage.getItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY)).toBe(JSON.stringify(["cpd"]));
      expect(readStatus("myDayHiddenCards")).toBe("device");
      if (!fullStorage) {
        const marker = JSON.parse(window.localStorage.getItem(WORK_ACCOUNT_SYNC_MARKER_KEY) ?? "{}") as {
          matched: string[];
          ahead: string[];
        };
        expect(marker.matched.includes("myDayHiddenCards")).toBe(matched);
        expect(marker.ahead).not.toContain("myDayHiddenCards");
      }

      blocked = false;
      vi.setSystemTime(Date.now() + 60_000);
      window.dispatchEvent(new Event("online"));
      await settle();
      expect(JSON.parse(window.localStorage.getItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY) ?? "null")).toEqual(expected);
      expect(sections.myDayHiddenCards?.value).toEqual(expected);
      expect(puts).toEqual(matched ? [] : [{ section: "myDayHiddenCards", value: expected }]);
      expect(readStatus("myDayHiddenCards")).toBe("account");
      expect(JSON.parse(window.localStorage.getItem(WORK_ACCOUNT_SYNC_MARKER_KEY) ?? "{}")).toMatchObject({
        matched: expect.arrayContaining(["myDayHiddenCards"]) as unknown,
        ahead: [],
      });
    },
  );

  it("retries a refused local removal instead of reporting an account deletion as applied", async () => {
    window.localStorage.setItem(WORK_ACCOUNT_SYNC_MARKER_KEY, MATCHED);
    window.localStorage.setItem(MY_DAY_QUICK_NOTE_STORAGE_KEY, "Original synthetic note");
    const { puts } = mockServer({ myDayQuickNote: { value: null, updatedAt: AT } });
    const originalRemoveItem = Storage.prototype.removeItem;
    let blocked = true;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (blocked && key === MY_DAY_QUICK_NOTE_STORAGE_KEY) {
        throw new DOMException("Synthetic storage refusal", "SecurityError");
      }
      originalRemoveItem.call(this, key);
    });
    start();
    await settle();
    expect(window.localStorage.getItem(MY_DAY_QUICK_NOTE_STORAGE_KEY)).toBe("Original synthetic note");
    expect(readStatus("myDayQuickNote")).toBe("device");
    expect(puts).toEqual([]);

    blocked = false;
    vi.setSystemTime(Date.now() + 60_000);
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(window.localStorage.getItem(MY_DAY_QUICK_NOTE_STORAGE_KEY)).toBeNull();
    expect(readStatus("myDayQuickNote")).toBe("account");
    expect(puts).toEqual([]);
  });

  it("merges a device's own choices with the account's on its first match, then saves the result", async () => {
    window.localStorage.setItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY, JSON.stringify(["cpd"]));
    const { puts } = mockServer({ myDayHiddenCards: { value: ["hours"], updatedAt: AT } });
    start();
    await settle();
    expect(JSON.parse(window.localStorage.getItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY) ?? "[]")).toEqual(["hours", "cpd"]);
    expect(puts).toContainEqual({ section: "myDayHiddenCards", value: ["hours", "cpd"] });
    expect(JSON.parse(window.localStorage.getItem(WORK_ACCOUNT_SYNC_MARKER_KEY) ?? "{}")).toMatchObject({
      matched: expect.arrayContaining(["myDayHiddenCards"]) as unknown,
    });
  });

  it("still merges a record new to sync on a device that matched the first release", async () => {
    window.localStorage.setItem(WORK_ACCOUNT_SYNC_MARKER_KEY, MATCHED);
    const prep = (topics: { id: string; name: string; percent: number }[]) => ({
      version: 1,
      exam: null,
      study: {},
      topics,
      group: null,
    });
    const mine = { id: "t-1", name: "Mood disorders", percent: 40 };
    const theirs = { id: "t-2", name: "Psychopharmacology", percent: 10 };
    window.localStorage.setItem(TEACHING_EXAM_PREP_STORAGE_KEY, JSON.stringify(prep([mine])));
    const { puts } = mockServer({ teachingExamPrep: { value: prep([theirs]), updatedAt: AT } });
    start();
    await settle();
    const kept = JSON.parse(window.localStorage.getItem(TEACHING_EXAM_PREP_STORAGE_KEY) ?? "null") as {
      topics: unknown[];
    };
    expect(kept.topics).toEqual(expect.arrayContaining([mine, theirs]));
    expect(puts).toContainEqual({ section: "teachingExamPrep", value: kept });
  });

  it("drops a queued save of job applications once the device is marked shared", async () => {
    window.localStorage.setItem(WORK_ACCOUNT_SYNC_MARKER_KEY, MATCHED);
    const { puts } = mockServer({});
    start();
    await settle();
    window.localStorage.setItem(
      CPD_APPLICATIONS_STORAGE_KEY,
      JSON.stringify({ version: 1, dates: [], referees: [], statement: "Mine", hiddenCvLines: [] }),
    );
    announceWorkSyncChange(CPD_APPLICATIONS_STORAGE_KEY);
    setSharedDevice(true);
    await settle();
    expect(puts.filter((body) => body.section === "cpdApplications")).toEqual([]);
  });

  it("saves a change made on this device to the account", async () => {
    const { puts } = mockServer({});
    start();
    await settle();
    window.localStorage.setItem(MY_DAY_QUICK_NOTE_STORAGE_KEY, "Ring pharmacy");
    announceWorkSyncChange(MY_DAY_QUICK_NOTE_STORAGE_KEY);
    await settle();
    expect(puts).toContainEqual({ section: "myDayQuickNote", value: "Ring pharmacy" });
  });

  it("keeps a note the account refused on this device, even when the account holds an older one", async () => {
    window.localStorage.setItem(WORK_ACCOUNT_SYNC_MARKER_KEY, MATCHED);
    const server = { myDayQuickNote: { value: "Older note", updatedAt: AT } };
    mockServer(server, { myDayQuickNote: 422 });
    start();
    await settle();
    window.localStorage.setItem(MY_DAY_QUICK_NOTE_STORAGE_KEY, "Mr Smith bed 12");
    announceWorkSyncChange(MY_DAY_QUICK_NOTE_STORAGE_KEY);
    await settle();
    // Coming back to the app re-reads the account copy; the refused note must survive it.
    vi.setSystemTime(Date.now() + 60_000);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(window.localStorage.getItem(MY_DAY_QUICK_NOTE_STORAGE_KEY)).toBe("Mr Smith bed 12");
  });

  it("stops at an account transition and never saves the last person's change", async () => {
    const { puts } = mockServer({});
    start();
    await settle();
    window.localStorage.setItem(MY_DAY_HIDDEN_CARDS_STORAGE_KEY, JSON.stringify(["cpd"]));
    announceWorkSyncChange(MY_DAY_HIDDEN_CARDS_STORAGE_KEY);
    clearAccountScopedBrowserStorage();
    await settle();
    expect(puts).toEqual([]);
    expect(window.localStorage.getItem(WORK_ACCOUNT_SYNC_MARKER_KEY)).toBeNull();
  });

  it("keeps a refused note through a reload instead of taking the account's older copy", async () => {
    window.localStorage.setItem(WORK_ACCOUNT_SYNC_MARKER_KEY, MATCHED);
    const server = { myDayQuickNote: { value: "Older note", updatedAt: AT } };
    mockServer(server, { myDayQuickNote: 422 });
    const stop = start();
    await settle();
    window.localStorage.setItem(MY_DAY_QUICK_NOTE_STORAGE_KEY, "Mr Smith bed 12");
    announceWorkSyncChange(MY_DAY_QUICK_NOTE_STORAGE_KEY);
    await settle();
    // A reload: the session ends and a new one starts from what the device kept.
    stop();
    resetWorkSyncForTesting();
    start();
    await settle();
    expect(window.localStorage.getItem(MY_DAY_QUICK_NOTE_STORAGE_KEY)).toBe("Mr Smith bed 12");
  });

  it("saves changes to one section in order, so a slow older save never wins", async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    const sections: Sections = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "PUT") return new Response(JSON.stringify({ sections }), { status: 200 });
        const body = JSON.parse(String(init.body)) as { section: string; value: unknown };
        order.push(`start ${String(body.value)}`);
        if (body.value === "First") await new Promise<void>((resolve) => (releaseFirst = resolve));
        sections[body.section] = { value: body.value, updatedAt: AT };
        order.push(`end ${String(body.value)}`);
        return new Response("{}", { status: 200 });
      }),
    );
    start();
    await settle();
    window.localStorage.setItem(MY_DAY_QUICK_NOTE_STORAGE_KEY, "First");
    announceWorkSyncChange(MY_DAY_QUICK_NOTE_STORAGE_KEY);
    await vi.advanceTimersByTimeAsync(1000);
    window.localStorage.setItem(MY_DAY_QUICK_NOTE_STORAGE_KEY, "Second");
    announceWorkSyncChange(MY_DAY_QUICK_NOTE_STORAGE_KEY);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(["start First"]);
    releaseFirst();
    await settle();
    expect(order).toEqual(["start First", "end First", "start Second", "end Second"]);
    expect(sections.myDayQuickNote?.value).toBe("Second");
  });
});
