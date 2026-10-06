import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFERENCES } from "@/lib/account-preferences";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const previousClientPayload = {
  density: "compact",
  motion: "reduced",
  jurisdiction: "nsw",
  population: "adults",
  answerStyle: "balanced",
  landing: "ask",
  showRecentOnHome: true,
  showProtocolsOnHome: true,
  compactCitations: false,
  // Intentionally omit saveRecentSearches — tabs opened before that field
  // shipped still PUT this shape.
  notifyGuidelineUpdates: true,
  notifyProductNews: false,
  notifySavedChanges: true,
} as const;

const INITIAL_UPDATED_AT = "2026-08-25T00:00:00.000Z";

function mockPreferencesRoute(
  existingPreferences: Record<string, unknown> | null,
  { synchronizeFirstReads = false }: { synchronizeFirstReads?: boolean } = {},
) {
  let row = existingPreferences
    ? { preferences: structuredClone(existingPreferences), updated_at: INITIAL_UPDATED_AT }
    : null;
  let firstReadCount = 0;
  let releaseFirstReads = () => {};
  const firstReadsReady = new Promise<void>((resolve) => {
    releaseFirstReads = resolve;
  });

  const maybeSingle = vi.fn(async () => {
    const snapshot = row ? structuredClone(row) : null;
    if (synchronizeFirstReads && firstReadCount < 2) {
      firstReadCount += 1;
      if (firstReadCount === 2) releaseFirstReads();
      await firstReadsReady;
    }
    return { data: snapshot, error: null };
  });
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }));

  const insert = vi.fn(async (value: { preferences: Record<string, unknown>; updated_at: string }) => {
    if (row) return { error: { code: "23505", message: "duplicate key" } };
    row = { preferences: structuredClone(value.preferences), updated_at: value.updated_at };
    return { error: null };
  });

  const update = vi.fn((value: { preferences: Record<string, unknown>; updated_at: string }) => {
    const filters = new Map<string, unknown>();
    const builder = {
      eq(field: string, expected: unknown) {
        filters.set(field, expected);
        return builder;
      },
      select() {
        return {
          maybeSingle: async () => {
            if (!row || filters.get("updated_at") !== row.updated_at) return { data: null, error: null };
            row = { preferences: structuredClone(value.preferences), updated_at: value.updated_at };
            return { data: { updated_at: row.updated_at }, error: null };
          },
        };
      },
    };
    return builder;
  });

  const from = vi.fn(() => ({ insert, select, update }));
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({ from }),
  }));
  vi.doMock("@/lib/supabase/auth", () => ({
    AuthenticationError: class AuthenticationError extends Error {},
    requireAuthenticatedUser: vi.fn(async () => ({ id: "user-preferences-1" })),
    unauthorizedResponse: () => new Response("unauthorized", { status: 401 }),
  }));
  return {
    currentPreferences: () => row?.preferences,
    insert,
    maybeSingle,
    update,
  };
}

describe("PUT /api/account/preferences", () => {
  it("accepts the previous client payload without saveRecentSearches and defaults it on for a new account", async () => {
    const { insert } = mockPreferencesRoute(null);

    const { PUT } = await import("@/app/api/account/preferences/route");
    const response = await PUT(
      new Request("http://local.test/api/account/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(previousClientPayload),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preferences.saveRecentSearches).toBe(DEFAULT_PREFERENCES.saveRecentSearches);
    expect(body.preferences.density).toBe("compact");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-preferences-1",
        preferences: expect.objectContaining({
          ...previousClientPayload,
          saveRecentSearches: true,
        }),
      }),
    );
  });

  it("preserves an existing saveRecentSearches opt-out when the client omits the field", async () => {
    const { update } = mockPreferencesRoute({
      ...DEFAULT_PREFERENCES,
      saveRecentSearches: false,
    });

    const { PUT } = await import("@/app/api/account/preferences/route");
    const response = await PUT(
      new Request("http://local.test/api/account/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(previousClientPayload),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preferences.saveRecentSearches).toBe(false);
    expect(body.preferences.density).toBe("compact");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          saveRecentSearches: false,
          density: "compact",
        }),
      }),
    );
    expect(Date.parse(update.mock.calls[0][0].updated_at)).toBeGreaterThan(Date.parse(INITIAL_UPDATED_AT));
  });

  it("retries a lost compare-and-swap so concurrent independent patches are both preserved", async () => {
    const database = mockPreferencesRoute(DEFAULT_PREFERENCES, { synchronizeFirstReads: true });

    const { PUT } = await import("@/app/api/account/preferences/route");
    const [densityResponse, motionResponse] = await Promise.all([
      PUT(
        new Request("http://local.test/api/account/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ density: "compact" }),
        }),
      ),
      PUT(
        new Request("http://local.test/api/account/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motion: "reduced" }),
        }),
      ),
    ]);

    expect([densityResponse.status, motionResponse.status]).toEqual([200, 200]);
    expect(database.currentPreferences()).toMatchObject({ density: "compact", motion: "reduced" });
    expect(database.update).toHaveBeenCalledTimes(3);
  });

  it("retries a duplicate insert when concurrent requests create the first preference row", async () => {
    const database = mockPreferencesRoute(null, { synchronizeFirstReads: true });

    const { PUT } = await import("@/app/api/account/preferences/route");
    const [densityResponse, motionResponse] = await Promise.all([
      PUT(
        new Request("http://local.test/api/account/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ density: "compact" }),
        }),
      ),
      PUT(
        new Request("http://local.test/api/account/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motion: "reduced" }),
        }),
      ),
    ]);

    expect([densityResponse.status, motionResponse.status]).toEqual([200, 200]);
    expect(database.currentPreferences()).toMatchObject({ density: "compact", motion: "reduced" });
    expect(database.insert).toHaveBeenCalledTimes(2);
    expect(database.update).toHaveBeenCalledTimes(1);
  });
});

describe("PUT /api/account/preferences reminders", () => {
  function put(body: unknown) {
    return new Request("http://local.test/api/account/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const storedReminders = {
    ...DEFAULT_PREFERENCES.reminders,
    types: {
      ...DEFAULT_PREFERENCES.reminders.types,
      "compliance-dates": { showInApp: true, calendarAlert: "1d", snoozedUntil: null },
    },
    maxAlertsPerDay: 5,
  };

  it("accepts a partial nested reminders patch and keeps what it omits", async () => {
    const database = mockPreferencesRoute({ ...DEFAULT_PREFERENCES, reminders: storedReminders });
    const { PUT } = await import("@/app/api/account/preferences/route");
    const response = await PUT(
      put({ reminders: { types: { teaching: { snoozedUntil: "2026-10-03" } }, quietHours: { enabled: true } } }),
    );
    expect(response.status).toBe(200);
    const saved = database.currentPreferences() as typeof DEFAULT_PREFERENCES;
    expect(saved.reminders.types.teaching).toEqual({
      showInApp: true,
      calendarAlert: "off",
      snoozedUntil: "2026-10-03",
    });
    expect(saved.reminders.types["compliance-dates"].calendarAlert).toBe("1d");
    expect(saved.reminders.quietHours).toEqual({ enabled: true, start: "21:00", end: "07:00" });
    expect(saved.reminders.maxAlertsPerDay).toBe(5);
  });

  it("keeps the stored reminders when an older client omits them", async () => {
    const database = mockPreferencesRoute({ ...DEFAULT_PREFERENCES, reminders: storedReminders });
    const { PUT } = await import("@/app/api/account/preferences/route");
    const response = await PUT(put(previousClientPayload));
    expect(response.status).toBe(200);
    expect((database.currentPreferences() as typeof DEFAULT_PREFERENCES).reminders).toEqual(storedReminders);
  });

  it.each([
    ["an unknown reminder type", { types: { "invented-type": { showInApp: false } } }],
    ["an unknown field", { types: { teaching: { volume: 11 } } }],
    ["an unknown lead time", { types: { teaching: { calendarAlert: "2d" } } }],
    ["a date that does not exist", { types: { teaching: { snoozedUntil: "2026-02-30" } } }],
    ["a time out of range", { quietHours: { start: "24:00" } }],
    ["a cap above the limit", { maxAlertsPerDay: 11 }],
    ["a cap below the limit", { maxAlertsPerDay: 0 }],
    ["a fractional cap", { maxAlertsPerDay: 2.5 }],
    ["an extra top-level key", { enabled: true }],
  ])("rejects %s", async (_label, reminders) => {
    const database = mockPreferencesRoute({ ...DEFAULT_PREFERENCES, reminders: storedReminders });
    const { PUT } = await import("@/app/api/account/preferences/route");
    const response = await PUT(put({ reminders }));
    expect(response.status).toBe(400);
    expect(database.update).not.toHaveBeenCalled();
  });
});

describe("PUT /api/account/preferences work stage", () => {
  function put(body: unknown) {
    return new Request("http://local.test/api/account/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("saves the self-reported stage and RANZCP stage, and clears them with null", async () => {
    const database = mockPreferencesRoute({ ...DEFAULT_PREFERENCES });
    const { PUT } = await import("@/app/api/account/preferences/route");
    expect((await PUT(put({ workStage: "registrar", ranzcpStage: 2 }))).status).toBe(200);
    expect(database.currentPreferences()).toMatchObject({ workStage: "registrar", ranzcpStage: 2 });
    expect((await PUT(put({ workStage: null, ranzcpStage: null }))).status).toBe(200);
    expect(database.currentPreferences()).toMatchObject({ workStage: null, ranzcpStage: null });
  });

  it.each([
    ["an unknown stage", { workStage: "chief" }],
    ["a RANZCP stage out of range", { ranzcpStage: 4 }],
    ["a RANZCP stage as text", { ranzcpStage: "2" }],
  ])("rejects %s", async (_label, body) => {
    const database = mockPreferencesRoute({ ...DEFAULT_PREFERENCES });
    const { PUT } = await import("@/app/api/account/preferences/route");
    expect((await PUT(put(body))).status).toBe(400);
    expect(database.update).not.toHaveBeenCalled();
  });
});
