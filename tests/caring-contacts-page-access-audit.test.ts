// tests/caring-contacts-page-access-audit.test.ts
//
// `/caring-contacts` (`src/app/caring-contacts/page.tsx`) reads the service-wide safety stop
// directly from the repository before rendering anything, and that read carries a patient-data-
// bearing incident note (see the page's own module note). Every other server-side read in this
// seam is audited through `readHandler`'s `recordAccess` call; this page render used to be the one
// exception, because a Server Component render has no `NextRequest` for `readHandler` to key an
// event on. It now goes through the same `auditedRead` helper `readHandler` itself is built on
// (`src/lib/caring-contacts-server/handler.ts`), so this pins that the render produces an
// administrative access event and fails closed the same way a read through `readHandler` does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: { current: null as unknown } }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";

let mockCookies: Record<string, { value: string } | undefined> = {};

const NOW = "2026-03-02T03:00:00.000Z";

/** A fresh in-memory store, wired in behind `caringContactsStore()`, with every `recordAccess`
 * call captured -- the same helper shape `caring-contacts-api-handler.test.ts` uses to prove the
 * API boundary audits reads, applied here to the page render instead. */
function inMemoryStoreWithSpy(): { store: CaringContactRepository; recorded: () => AccessRecord[] } {
  mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };

  const repository = createInMemoryRepository(fixedClock(NOW));
  const records: AccessRecord[] = [];
  const store: CaringContactRepository = {
    ...repository,
    async recordAccess(record: AccessRecord) {
      // The real store first, then the spy: recording only what actually entered the trail.
      await repository.recordAccess(record);
      records.push(record);
    },
  };

  mocks.store.current = store;
  return { store, recorded: () => records };
}

beforeEach(() => {
  mockCookies = {};
  mocks.store.current = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the /caring-contacts page render", () => {
  it("records an administrative access event for the service-state read, same as the API route", async () => {
    const { recorded } = inMemoryStoreWithSpy();

    const { default: CaringContactsTodayPage } = await import("@/app/caring-contacts/page");
    const element = await CaringContactsTodayPage();

    expect(element).toBeTruthy();
    expect(recorded()).toContainEqual(
      expect.objectContaining({
        kind: "administrative",
        objectType: "serviceState",
        outcome: "allowed",
        actorId: demoActorForRole("coordinator").id,
      }),
    );
  });

  it("fails closed -- throws rather than rendering -- when the access trail cannot take the event", async () => {
    const { store } = inMemoryStoreWithSpy();
    vi.spyOn(store, "recordAccess").mockRejectedValue(new Error("access trail unavailable"));

    const { default: CaringContactsTodayPage } = await import("@/app/caring-contacts/page");

    await expect(CaringContactsTodayPage()).rejects.toThrow(/access trail is unavailable/i);
  });

  it("fails closed -- throws rather than rendering -- when the underlying read itself fails", async () => {
    const { store, recorded } = inMemoryStoreWithSpy();
    vi.spyOn(store, "getServiceState").mockRejectedValue(new Error("store unreachable"));

    const { default: CaringContactsTodayPage } = await import("@/app/caring-contacts/page");

    await expect(CaringContactsTodayPage()).rejects.toThrow("store unreachable");
    // The failed attempt is still recorded -- an event nobody wrote is worse than a refused read.
    expect(recorded()).toContainEqual(expect.objectContaining({ objectType: "serviceState", outcome: "failed" }));
  });
});
