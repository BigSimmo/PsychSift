import { coverForDay, coverText, isoWeekday, needsOn, type CoverCount } from "@/lib/roster/team/cover";
import {
  SAFE_NUMBER_GROUPS,
  SAFE_NUMBER_KINDS,
  SAFE_NUMBER_MAX,
  SAFE_NUMBER_WEEKDAYS,
  applySafeNumberChanges,
  emptySafeNumberGrid,
  otherNeedCount,
  safeNumberGrid,
  safeNumberIsGrouped,
  safeNumberNeeds,
  sameSafeNumbers,
  setSafeNumber,
  undoSafeNumberChanges,
  type SafeNumberGrid,
  type SafeNumberGroupId,
  type SafeNumberKind,
} from "@/lib/roster/team/safe-number";

export {
  coverForDay,
  coverText,
  isoWeekday,
  needsOn,
  type CoverCount,
  SAFE_NUMBER_GROUPS,
  SAFE_NUMBER_KINDS,
  SAFE_NUMBER_MAX,
  SAFE_NUMBER_WEEKDAYS,
  applySafeNumberChanges,
  emptySafeNumberGrid,
  otherNeedCount,
  safeNumberGrid,
  safeNumberIsGrouped,
  safeNumberNeeds,
  sameSafeNumbers,
  setSafeNumber,
  undoSafeNumberChanges,
  type SafeNumberGrid,
  type SafeNumberGroupId,
  type SafeNumberKind,
};

/**
 * Optimistic concurrency error thrown when an edit target was modified
 * by another clinician or process since it was read.
 */
export class ConcurrencyConflictError extends Error {
  readonly code = "concurrency_conflict" as const;
  readonly status = 409 as const;
  readonly currentVersion?: number | null;
  readonly expectedVersion?: number | null;
  readonly currentUpdatedAt?: string | null;
  readonly expectedUpdatedAt?: string | null;
  readonly currentIds?: readonly string[] | null;
  readonly expectedIds?: readonly string[] | null;

  constructor(
    message: string = "The record was modified by another clinician. Refresh and try again.",
    details?: {
      currentVersion?: number | null;
      expectedVersion?: number | null;
      currentUpdatedAt?: string | null;
      expectedUpdatedAt?: string | null;
      currentIds?: readonly string[] | null;
      expectedIds?: readonly string[] | null;
    },
  ) {
    super(message);
    this.name = "ConcurrencyConflictError";
    this.currentVersion = details?.currentVersion;
    this.expectedVersion = details?.expectedVersion;
    this.currentUpdatedAt = details?.currentUpdatedAt;
    this.expectedUpdatedAt = details?.expectedUpdatedAt;
    this.currentIds = details?.currentIds;
    this.expectedIds = details?.expectedIds;
  }
}

export type OptimisticLockState = {
  readonly version?: number | null;
  readonly updated_at?: string | null;
  readonly updatedAt?: string | null;
  readonly ids?: readonly string[] | null;
};

export type OptimisticLockExpectation = {
  readonly expectedVersion?: number | null;
  readonly version?: number | null;
  readonly expectedUpdatedAt?: string | null;
  readonly updated_at?: string | null;
  readonly updatedAt?: string | null;
  readonly expectedIds?: readonly string[] | null;
};

export type OptimisticLockCheckResult = {
  readonly ok: boolean;
  readonly conflict: boolean;
  readonly reason?: string;
  readonly currentVersion?: number | null;
  readonly expectedVersion?: number | null;
  readonly currentUpdatedAt?: string | null;
  readonly expectedUpdatedAt?: string | null;
};

/**
 * Check whether a current record state matches the expected concurrency token
 * (version number, updated_at timestamp, or expected ID list).
 */
export function checkOptimisticLock(
  current: OptimisticLockState,
  expected: OptimisticLockExpectation,
): OptimisticLockCheckResult {
  const expectedVer = expected.expectedVersion !== undefined ? expected.expectedVersion : expected.version;
  const currentVer = current.version;

  if (expectedVer !== undefined && expectedVer !== null) {
    // An expected token with no current token cannot prove the record is unchanged: fail closed.
    if (currentVer === undefined || currentVer === null || currentVer !== expectedVer) {
      return {
        ok: false,
        conflict: true,
        reason: `Version mismatch: current is ${currentVer}, expected ${expectedVer}`,
        currentVersion: currentVer,
        expectedVersion: expectedVer,
      };
    }
  }

  const expectedTime =
    expected.expectedUpdatedAt !== undefined
      ? expected.expectedUpdatedAt
      : expected.updatedAt !== undefined
        ? expected.updatedAt
        : expected.updated_at;
  const currentTime = current.updatedAt !== undefined ? current.updatedAt : current.updated_at;

  if (expectedTime !== undefined && expectedTime !== null && (currentTime === undefined || currentTime === null)) {
    return {
      ok: false,
      conflict: true,
      reason: `Timestamp missing on the current record; expected ${expectedTime}`,
      expectedUpdatedAt: expectedTime,
    };
  }
  if (expectedTime !== undefined && expectedTime !== null && currentTime !== undefined && currentTime !== null) {
    const expMillis = new Date(expectedTime).getTime();
    const currMillis = new Date(currentTime).getTime();

    const matches =
      !Number.isNaN(expMillis) && !Number.isNaN(currMillis) ? expMillis === currMillis : currentTime === expectedTime;

    if (!matches) {
      return {
        ok: false,
        conflict: true,
        reason: `Timestamp mismatch: current is ${currentTime}, expected ${expectedTime}`,
        currentUpdatedAt: currentTime,
        expectedUpdatedAt: expectedTime,
      };
    }
  }

  if (
    expected.expectedIds !== undefined &&
    expected.expectedIds !== null &&
    current.ids !== undefined &&
    current.ids !== null
  ) {
    const currentIdSet = new Set(current.ids);
    const expectedIdSet = new Set(expected.expectedIds);
    const match = currentIdSet.size === expectedIdSet.size && [...expectedIdSet].every((id) => currentIdSet.has(id));

    if (!match) {
      return {
        ok: false,
        conflict: true,
        reason: `ID set mismatch: concurrent changes detected in item list`,
      };
    }
  }

  return { ok: true, conflict: false };
}

/**
 * Asserts that the optimistic lock matches. Throws `ConcurrencyConflictError` if
 * the current version or updated_at timestamp differs from expected.
 */
export function assertOptimisticLock(current: OptimisticLockState, expected: OptimisticLockExpectation): void {
  const result = checkOptimisticLock(current, expected);
  if (result.conflict) {
    throw new ConcurrencyConflictError(
      result.reason ?? "Concurrency conflict detected: record was modified concurrently.",
      {
        currentVersion: result.currentVersion,
        expectedVersion: result.expectedVersion,
        currentUpdatedAt: result.currentUpdatedAt,
        expectedUpdatedAt: result.expectedUpdatedAt,
        currentIds: current.ids,
        expectedIds: expected.expectedIds,
      },
    );
  }
}

/**
 * Execute an optimistic mutation with auto-retry when a concurrency conflict occurs.
 * Re-reads fresh state and retries writeFn up to `maxAttempts`.
 */
export async function executeWithOptimisticRetry<TState extends OptimisticLockState, TResult>(
  readFn: () => Promise<TState>,
  writeFn: (fresh: TState) => Promise<TResult>,
  maxAttempts = 3,
): Promise<TResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const fresh = await readFn();
    try {
      return await writeFn(fresh);
    } catch (error: unknown) {
      lastError = error;
      const isConflict =
        error instanceof ConcurrencyConflictError ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error.code === "concurrency_conflict" || error.code === "roster_conflict"));

      if (isConflict && attempt < maxAttempts) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
