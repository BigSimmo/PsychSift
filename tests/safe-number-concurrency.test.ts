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

afterEach(() => {
  cleanup();
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

  it("steps every weekday, not just Monday, and shows a mixed week as a range", async () => {
    const onSave = vi.fn(async () => ({ ok: true, version: 2 }));
    const mixed = setSafeNumber(initialGrid, "night", [6, 7], 4);
    render(React.createElement(SafeNumberEditor, { initialRecord: { ...initialRecord, grid: mixed }, onSave }));

    const before = mixed.night;
    expect(screen.getByTestId("safe-number-value-night").textContent).toBe(
      `${Math.min(...before)}–${Math.max(...before)}`,
    );
    fireEvent.click(screen.getByTestId("stepper-plus-night"));
    fireEvent.click(screen.getByTestId("safe-number-save-button"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = (onSave.mock.calls[0] as unknown as [{ night: number[] }])[0];
    expect(saved.night).toEqual(before.map((value) => value + 1));
  });

  it("steps a total already above the cap by one instead of collapsing it to the cap", async () => {
    const onSave = vi.fn(async () => ({ ok: true, version: 2 }));
    const overCap = setSafeNumber(setSafeNumber(initialGrid, "night", [1, 2, 3, 4, 5, 6, 7], 3), "night", [1], 3);
    const grid = { ...overCap, night: overCap.night.map((value, index) => (index === 0 ? 350 : value)) };
    render(React.createElement(SafeNumberEditor, { initialRecord: { ...initialRecord, grid }, onSave }));
    fireEvent.click(screen.getByTestId("stepper-minus-night"));
    fireEvent.click(screen.getByTestId("safe-number-save-button"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = (onSave.mock.calls[0] as unknown as [{ night: number[] }])[0];
    expect(saved.night[0]).toBe(349);
    expect(saved.night[1]).toBe(2);
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
    const latestGrid = setSafeNumber(emptySafeNumberGrid(), "day", [1, 2, 3, 4, 5, 6, 7], 5);
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

describe("checkOptimisticLock fails closed on a missing current token", () => {
  it("reports a conflict when the expected version or timestamp has no current counterpart", () => {
    expect(checkOptimisticLock({}, { expectedVersion: 3 }).conflict).toBe(true);
    expect(checkOptimisticLock({}, { expectedUpdatedAt: "2026-10-13T00:00:00Z" }).conflict).toBe(true);
    expect(checkOptimisticLock({ version: 3 }, { expectedVersion: 3 }).ok).toBe(true);
  });
});
