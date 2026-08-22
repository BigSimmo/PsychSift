// src/lib/caring-contacts-server/store.ts
//
// The one place route handlers ask for a caring-contact store. Picks the store the same way the
// rest of this seam works: postgres when CARING_CONTACTS_DATABASE_URL is configured (and cleared
// by assertNotClinicalKbProject), the in-memory reference store otherwise -- so the workspace runs
// with no database at all. That in-memory fallback is what the demo and this repository's offline
// test suite run against.
//
// Memoised on the first call, then reused. Two reasons, not one:
//   * the Postgres branch would otherwise build a brand-new `pg.Pool` on every call -- and once a
//     route handler calls this per request (Task 14+), that is unbounded connection growth with
//     nothing ever ending a pool;
//   * the in-memory branch holds the workspace's only copy of its data (Maps in
//     ../caring-contacts/in-memory-repository.ts). An unmemoised call would hand back a fresh,
//     empty store on every request, and nothing written by one request would ever be visible to
//     the next -- silently breaking the demo, not just wasting resources.
// Memoisation is pinned on `globalThis`, not a module-scoped `let`. Turbopack gives App Router
// pages and route handlers separate module registries under `next dev`, so a module-level
// singleton is instantiated twice: a stop posted to `/api/caring-contacts/service-state` would
// update the route-handler store while `src/app/caring-contacts/page.tsx` still read a running
// copy and omit the safety banner. `globalThis` is process-wide in the Node runtime this seam
// uses (`export const runtime = "nodejs"`), which is the same pattern `api-rate-limit.ts` and
// `upload-admission.ts` already use for cross-module process state. The production webpack
// build already shared one instance through Node's require cache; this makes the demo store
// match that under Turbopack too. The Clinical-KB-separation guard still runs before a pool is
// ever constructed, including on this first call -- memoisation only means it runs once, never
// that it is skipped.
import "server-only";

import { systemClock } from "@/lib/caring-contacts/clock";
import { createPostgresRepository } from "@/lib/caring-contacts/db/postgres-repository";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";

import { assertNotClinicalKbProject, caringContactsDatabaseUrl } from "./config";
import { createCaringContactsPool } from "./pool";

export const CARING_CONTACTS_STORE_GLOBAL_KEY = "__caringContactsCachedStore";

type GlobalWithCaringContactsStore = typeof globalThis & {
  [CARING_CONTACTS_STORE_GLOBAL_KEY]?: Promise<CaringContactRepository>;
};

export async function caringContactsStore(): Promise<CaringContactRepository> {
  const runtime = globalThis as GlobalWithCaringContactsStore;
  runtime[CARING_CONTACTS_STORE_GLOBAL_KEY] ??= buildStore();
  return runtime[CARING_CONTACTS_STORE_GLOBAL_KEY];
}

async function buildStore(): Promise<CaringContactRepository> {
  const url = caringContactsDatabaseUrl();
  if (!url) {
    return createInMemoryRepository(systemClock());
  }

  // Kept alongside createCaringContactsPool's own internal check -- defence in depth on the one
  // path that ever constructs a pool, not a substitute for it.
  assertNotClinicalKbProject(url);
  const pool = createCaringContactsPool(url);
  return createPostgresRepository(pool, systemClock());
}
