/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertOptimisticLock,
  checkOptimisticLock,
  ConcurrencyConflictError,
  executeWithOptimisticRetry,
  emptySafeNumberGrid,
  setSafeNumber,
} from "@/lib/on-call/cover";
import { SafeNumberEditor, type SafeNumberRecord } from "@/components/on-call/safe-number-editor";
import { RosterSafeNumber } from "@/components/roster/manage/roster-safe-number";
import type { RosterOverview } from "@/lib/roster/team/model";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("optimistic concurrency locking primitives", () => {
  it("matches identical version numbers", () => {
    const result = checkOptimisticLock({ version: 4 }, { expectedVersion: 4 });
    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
  });

  it("detects version mismatch when record was updated concurrently", () => {
    const result = checkOptimisticLock({ version: 5 }, { expectedVersion: 4 });
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.currentVersion).toBe(5);
    expect(result.expectedVersion).toBe(4);
    expect(result.reason).toContain("Version mismatch");
  });

  it("matches identical updated_at timestamps", () => {
    const timestamp = "2026-10-13T10:00:00.000Z";
    const result = checkOptimisticLock({ updatedAt: timestamp }, { expectedUpdatedAt: timestamp });
    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
  });

  it("detects timestamp mismatch when record was modified concurrently", () => {
    const result = checkOptimisticLock(
      { updatedAt: "2026-10-13T10:05:00.000Z" },
      { expectedUpdatedAt: "2026-10-13T10:00:00.000Z" },
    );
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.reason).toContain("Timestamp mismatch");
  });

  it("assertOptimisticLock succeeds without error when concurrency tokens match", () => {
    expect(() =>
      assertOptimisticLock(
        { version: 2, updatedAt: "2026-10-13T12:00:00Z" },
        { expectedVersion: 2, expectedUpdatedAt: "2026-10-13T12:00:00Z" },
      ),
    ).not.toThrow();
  });

  it("assertOptimisticLock throws ConcurrencyConflictError on version mismatch", () => {
    expect(() => assertOptimisticLock({ version: 3 }, { expectedVersion: 2 })).toThrowError(ConcurrencyConflictError);
  });

  it("detects ID set mismatch in expected item lists", () => {
    const result = checkOptimisticLock({ ids: ["id-1", "id-2", "id-3"] }, { expectedIds: ["id-1", "id-2"] });
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.reason).toContain("ID set mismatch");
  });
});

describe("executeWithOptimisticRetry", () => {
  it("executes successfully on the first attempt without conflict", async () => {
    const state: { version: number; data: string } = { version: 1, data: "initial" };
    const readFn = vi.fn(async () => state);
    const writeFn = vi.fn(async (fresh: typeof state) => {
      assertOptimisticLock(fresh, { expectedVersion: 1 });
      return { ok: true, version: 2 };
    });

    const result = await executeWithOptimisticRetry(readFn, writeFn, 3);
    expect(result.ok).toBe(true);
    expect(readFn).toHaveBeenCalledTimes(1);
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it("retries and succeeds when an intermediate conflict occurs", async () => {
    let version = 1;
    const readFn = vi.fn(async () => ({ version }));
    let attempts = 0;
    const writeFn = vi.fn(async (fresh: { version: number }) => {
      attempts += 1;
      if (attempts === 1) {
        // Clinician B modified version concurrently
        version = 2;
        throw new ConcurrencyConflictError("Modified concurrently", {
          currentVersion: 2,
          expectedVersion: 1,
        });
      }
      return { ok: true, savedVersion: fresh.version };
    });

    const result = await executeWithOptimisticRetry(readFn, writeFn, 3);
    expect(result.ok).toBe(true);
    expect(result.savedVersion).toBe(2);
    expect(readFn).toHaveBeenCalledTimes(2);
    expect(writeFn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting maximum retry attempts", async () => {
    const readFn = vi.fn(async () => ({ version: 1 }));
    const writeFn = vi.fn(async () => {
      throw new ConcurrencyConflictError("Persistent conflict", {
        currentVersion: 2,
        expectedVersion: 1,
      });
    });

    await expect(executeWithOptimisticRetry(readFn, writeFn, 3)).rejects.toThrow(ConcurrencyConflictError);
    expect(writeFn).toHaveBeenCalledTimes(3);
  });
});

describe("SafeNumberEditor component optimistic locking", () => {
  const initialGrid = setSafeNumber(emptySafeNumberGrid(), "day", [1], 2);
  const initialRecord: SafeNumberRecord = {
    id: "team-1",
    version: 1,
    updatedAt: "2026-10-13T09:00:00Z",
    grid: initialGrid,
  };

  it("saves successfully when no concurrent edits occurred", async () => {
    const onSave = vi.fn(async () => ({ ok: true, version: 2 }));
    const onSaved = vi.fn();

    render(
      React.createElement(SafeNumberEditor, {
        initialRecord,
        onSave,
        onSaved,
      }),
    );

    // Increase day safe number
    const plusButton = screen.getByTestId("stepper-plus-day");
    fireEvent.click(plusButton);

    const saveButton = screen.getByTestId("safe-number-save-button");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId("safe-number-status-message").textContent).toMatch(/Safe numbers saved successfully/i);
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        day: expect.arrayContaining([3]),
      }),
      { version: 1, updatedAt: "2026-10-13T09:00:00Z" },
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("blocks save and shows alert when another clinician modified the record", async () => {
    // onFetchLatest returns version 2 (while editor was opened at version 1)
    const onFetchLatest = vi.fn(async () => ({
      ...initialRecord,
      version: 2,
      updatedAt: "2026-10-13T09:30:00Z",
    }));
    const onSave = vi.fn();

    render(
      React.createElement(SafeNumberEditor, {
        initialRecord,
        onFetchLatest,
        onSave,
      }),
    );

    // Increase day safe number to make it dirty
    fireEvent.click(screen.getByTestId("stepper-plus-day"));

    // Attempt save
    fireEvent.click(screen.getByTestId("safe-number-save-button"));

    await waitFor(() => {
      expect(screen.getByTestId("safe-number-conflict-alert")).toBeTruthy();
    });

    expect(screen.getByText(/Concurrency conflict detected/i)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("allows clinician to refresh latest numbers upon concurrency conflict", async () => {
    const latestGrid = setSafeNumber(emptySafeNumberGrid(), "day", [1], 5);
    const onFetchLatest = vi
      .fn()
      .mockResolvedValueOnce({
        ...initialRecord,
        version: 2,
        grid: latestGrid,
      })
      .mockResolvedValueOnce({
        ...initialRecord,
        version: 2,
        grid: latestGrid,
      });

    render(
      React.createElement(SafeNumberEditor, {
        initialRecord,
        onFetchLatest,
      }),
    );

    // Modify and try to save, triggering conflict
    fireEvent.click(screen.getByTestId("stepper-plus-day"));
    fireEvent.click(screen.getByTestId("safe-number-save-button"));

    await waitFor(() => {
      expect(screen.getByTestId("safe-number-conflict-alert")).toBeTruthy();
    });

    // Clinician clicks refresh
    const refreshButton = screen.getByTestId("safe-number-refresh-button");
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(screen.queryByTestId("safe-number-conflict-alert")).toBeNull();
      expect(screen.getByTestId("safe-number-value-day").textContent).toBe("5");
    });
  });
});

describe("RosterSafeNumber live route cell-level conflict detection (#3B4S3Z)", () => {
  const overview: RosterOverview = {
    service: { id: "team", name: "Example team" },
    me: { role: "manager", grade: null, rotationEndsOn: null },
    latestPublication: null,
    seenLatest: true,
    settings: { swapApproval: "auto_same_grade", rules: {}, rulesSource: null, payFortnightAnchor: null },
    sites: [],
  };
  const id = (n: number) => `5e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const baselineNeeds = [1, 2, 3, 4, 5].map((weekday) => ({
    id: id(weekday),
    weekday,
    date: null,
    kind: "day",
    grade: null,
    siteId: null,
    needed: 2,
  }));

  it("surfaces safe-number-conflict-banner when a modified shift was concurrently edited, and resolves via Reload latest or Overwrite", async () => {
    let currentNeeds = baselineNeeds;
    const posts: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          return Response.json({ result: { ok: true } });
        }
        return Response.json({ codes: [], needs: currentNeeds, drafts: [] });
      }),
    );

    render(React.createElement(RosterSafeNumber, { serviceId: "team", overview }));

    const incrementBtn = await screen.findByRole("button", { name: "One more, Day, Monday to Friday" });
    fireEvent.click(incrementBtn);

    // Concurrent manager updates Monday-Friday day shift to 5 while editor is open
    currentNeeds = baselineNeeds.map((need) => ({ ...need, needed: 5 }));

    fireEvent.click(screen.getByRole("button", { name: "Save safe number" }));

    const banner = await screen.findByTestId("safe-number-conflict-banner");
    expect(banner).toBeTruthy();
    expect(posts).toHaveLength(0);

    // Clicking Reload latest adopts the concurrent 5 value and clears the conflict banner
    fireEvent.click(screen.getByTestId("safe-number-conflict-reload"));
    expect(screen.queryByTestId("safe-number-conflict-banner")).toBeNull();
    expect((screen.getByLabelText("Day, Monday to Friday") as HTMLInputElement).value).toBe("5");

    // Edit again (5 -> 6), simulate another concurrent change to 4, then click Overwrite with my changes
    fireEvent.click(screen.getByRole("button", { name: "One more, Day, Monday to Friday" }));
    currentNeeds = baselineNeeds.map((need) => ({ ...need, needed: 4 }));
    fireEvent.click(screen.getByRole("button", { name: "Save safe number" }));

    await screen.findByTestId("safe-number-conflict-banner");
    fireEvent.click(screen.getByTestId("safe-number-conflict-overwrite"));

    expect(await screen.findByText(/^Saved\./)).toBeTruthy();
    expect(posts).toHaveLength(1);
    expect((screen.getByLabelText("Day, Monday to Friday") as HTMLInputElement).value).toBe("6");
  });

  it("re-flags conflict on Overwrite with my changes if a third edit arrived on the same cell after the conflict banner opened", async () => {
    let currentNeeds = baselineNeeds;
    const posts: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          return Response.json({ result: { ok: true } });
        }
        return Response.json({ codes: [], needs: currentNeeds, drafts: [] });
      }),
    );

    render(React.createElement(RosterSafeNumber, { serviceId: "team", overview }));

    const incrementBtn = await screen.findByRole("button", { name: "One more, Day, Monday to Friday" });
    fireEvent.click(incrementBtn);

    // Second concurrent edit (2 -> 4) before initial save
    currentNeeds = baselineNeeds.map((need) => ({ ...need, needed: 4 }));
    fireEvent.click(screen.getByRole("button", { name: "Save safe number" }));

    await screen.findByTestId("safe-number-conflict-banner");
    expect(posts).toHaveLength(0);

    // Third concurrent edit (4 -> 7) arrives AFTER the conflict banner opened
    currentNeeds = baselineNeeds.map((need) => ({ ...need, needed: 7 }));
    fireEvent.click(screen.getByTestId("safe-number-conflict-overwrite"));

    // Should re-flag conflict and not clobber the unseen third edit
    await waitFor(() => {
      expect(screen.getByTestId("safe-number-conflict-banner")).toBeTruthy();
    });
    expect(posts).toHaveLength(0);

    // Now server state still matches the updated freshGrid (7), so Overwrite succeeds
    fireEvent.click(screen.getByTestId("safe-number-conflict-overwrite"));
    expect(await screen.findByText(/^Saved\./)).toBeTruthy();
    expect(posts).toHaveLength(1);
    expect((screen.getByLabelText("Day, Monday to Friday") as HTMLInputElement).value).toBe("3");
  });
});
