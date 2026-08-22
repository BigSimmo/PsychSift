// tests/caring-contacts-server-store.test.ts
//
// Review round 1, Important 3 and Minor 2: caringContactsStore() must select the Postgres
// repository when a database URL is configured (the brief's own four config.ts tests only pin the
// unconfigured/in-memory branch, so an implementation that ignored the URL entirely would still
// pass all of them), and it must memoise the result -- an unmemoised Postgres branch would build
// a brand-new pg.Pool on every call with nothing ever ending one, and an unmemoised in-memory
// branch would hand back a fresh, empty store on every call, silently breaking the demo (nothing
// written by one call would ever be visible to the next).
//
// Memoisation is process-wide via globalThis, not a module-scoped let: Turbopack evaluates this
// module once for pages and once for route handlers under `next dev`. A module-level cache would
// give each boundary its own empty in-memory workspace.
//
// createCaringContactsPool and createPostgresRepository are both mocked so this proves store.ts's
// own selection/memoisation logic without touching a database or the pg driver.
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCaringContactsPool: vi.fn((url: string) => ({ url, withConnection: vi.fn() })),
  createPostgresRepository: vi.fn(() => ({ instance: Symbol("postgres-repository-instance") })),
}));

vi.mock("@/lib/caring-contacts-server/pool", () => ({
  createCaringContactsPool: mocks.createCaringContactsPool,
}));

vi.mock("@/lib/caring-contacts/db/postgres-repository", () => ({
  createPostgresRepository: mocks.createPostgresRepository,
}));

import { demoActorForRole } from "@/lib/caring-contacts-server/session";
import { CARING_CONTACTS_STORE_GLOBAL_KEY, caringContactsStore } from "@/lib/caring-contacts-server/store";
import { idempotencyKey } from "@/lib/caring-contacts/ids";

function clearCachedStore(): void {
  Reflect.deleteProperty(globalThis, CARING_CONTACTS_STORE_GLOBAL_KEY);
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearCachedStore();
  mocks.createCaringContactsPool.mockClear();
  mocks.createPostgresRepository.mockClear();
});

describe("caringContactsStore", () => {
  it("selects the Postgres repository when a database URL is configured, and memoises it across calls", async () => {
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "postgres://demo@example.invalid:5432/postgres");

    const first = await caringContactsStore();
    const second = await caringContactsStore();

    expect(second).toBe(first);
    expect(mocks.createCaringContactsPool).toHaveBeenCalledTimes(1);
    expect(mocks.createCaringContactsPool).toHaveBeenCalledWith("postgres://demo@example.invalid:5432/postgres");
    expect(mocks.createPostgresRepository).toHaveBeenCalledTimes(1);
  });

  it("shares the in-memory store across separate module evaluations so a stop is visible to a later import", async () => {
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "");

    const actor = demoActorForRole("teamLead");
    const first = await caringContactsStore();
    const stopped = await first.stopService(
      { reason: "privacy-or-security-incident", note: "synthetic incident for store sharing" },
      { actor, idempotencyKey: idempotencyKey("store-share-stop") },
    );
    expect(stopped.ok).toBe(true);

    vi.resetModules();
    const { caringContactsStore: pageCopy } = await import("@/lib/caring-contacts-server/store");
    const second = await pageCopy();

    expect(second).toBe(first);
    expect((await second.getServiceState({ actor })).stopped).toBe(true);
  });
});
