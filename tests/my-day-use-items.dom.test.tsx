/** @vitest-environment jsdom */

// The shared My Day hook with each source hook mocked: demo label and signed-out mapping.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MyDayItem, MyDaySourceResult } from "@/lib/my-day/model";

const mocks = vi.hoisted(() => ({
  entries: undefined as unknown as { admin: MyDaySourceResult; onCall: MyDaySourceResult },
  roster: undefined as unknown as MyDaySourceResult,
  cme: undefined as unknown as MyDaySourceResult,
  teaching: undefined as unknown as MyDaySourceResult,
}));
const retry = vi.fn();
vi.mock("@/components/my-day/sources/entries", () => ({
  useEntriesMyDaySources: () => ({ ...mocks.entries, retry }),
}));
vi.mock("@/components/my-day/sources/roster", () => ({
  useRosterMyDaySource: () => ({ result: mocks.roster, retry }),
}));
vi.mock("@/components/my-day/sources/cme", () => ({ useCmeMyDaySource: () => ({ result: mocks.cme, retry }) }));
vi.mock("@/components/my-day/sources/teaching", () => ({
  useTeachingMyDaySource: () => ({ result: mocks.teaching, retry }),
}));

import { useMyDayItems } from "@/components/my-day/use-my-day-items";

const NOW = new Date("2026-09-26T01:00:00Z");
const item = (mode: MyDayItem["mode"], id: string): MyDayItem => ({
  id,
  mode,
  title: id,
  due: "2026-09-27",
  severity: "soon",
  href: "/x",
});

beforeEach(() => {
  mocks.entries = {
    onCall: { mode: "on-call", status: "ready", items: [item("on-call", "oc")] },
    admin: { mode: "my-work", status: "ready", items: [item("my-work", "ad")] },
  };
  mocks.roster = { mode: "roster", status: "ready", items: [] };
  mocks.cme = { mode: "cme", status: "ready", items: [item("cme", "cm")] };
  mocks.teaching = { mode: "teaching", status: "ready", items: [] };
});

describe("useMyDayItems", () => {
  it("is not demo mode when Roster is unavailable (held release) and the others hold the reader's own items", () => {
    mocks.roster = { mode: "roster", status: "unavailable", items: [] };
    const { result } = renderHook(() => useMyDayItems({ enabled: true, now: NOW }));
    expect(result.current.demoMode).toBe(false);
    expect(result.current.status).toBe("ready");
    expect(result.current.items.map((entry) => entry.id).sort()).toEqual(["ad", "cm", "oc"]);
  });

  it("is demo mode when a source that loaded holds sample data", () => {
    mocks.cme = { ...mocks.cme, sample: true };
    const { result } = renderHook(() => useMyDayItems({ enabled: true, now: NOW }));
    expect(result.current.demoMode).toBe(true);
  });

  it("ignores a sample flag on a source that did not load", () => {
    mocks.cme = { mode: "cme", status: "failed", items: [], sample: true };
    const { result } = renderHook(() => useMyDayItems({ enabled: true, now: NOW }));
    expect(result.current.demoMode).toBe(false);
  });

  it("counts a source answering 'signed out' as failed while enabled, so it is not 'checked'", () => {
    mocks.teaching = { mode: "teaching", status: "signed-out", items: [] };
    const { result } = renderHook(() => useMyDayItems({ enabled: true, now: NOW }));
    expect(result.current.status).toBe("ready");
    expect(result.current.sources.find((source) => source.mode === "teaching")?.status).toBe("failed");
  });

  it("is signed out when every source says signed out while auth still says authenticated", () => {
    mocks.entries = {
      onCall: { mode: "on-call", status: "signed-out", items: [] },
      admin: { mode: "my-work", status: "signed-out", items: [] },
    };
    mocks.roster = { mode: "roster", status: "signed-out", items: [] };
    mocks.cme = { mode: "cme", status: "signed-out", items: [] };
    mocks.teaching = { mode: "teaching", status: "signed-out", items: [] };
    const { result } = renderHook(() => useMyDayItems({ enabled: true, now: NOW }));
    expect(result.current.status).toBe("signed-out");
    expect(result.current.items).toEqual([]);
  });

  it("is signed out, with no items, when not enabled", () => {
    mocks.entries = {
      onCall: { mode: "on-call", status: "signed-out", items: [] },
      admin: { mode: "my-work", status: "signed-out", items: [] },
    };
    const { result } = renderHook(() => useMyDayItems({ enabled: false, now: NOW }));
    expect(result.current.status).toBe("signed-out");
    expect(result.current.items).toEqual([]);
  });
});
