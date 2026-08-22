### Task 12: Database configuration that can never point at the Clinical KB project

**Files:**

- Create: `src/lib/caring-contacts-server/config.ts`
- Create: `src/lib/caring-contacts-server/pool.ts`
- Create: `src/lib/caring-contacts-server/store.ts`
- Test: `tests/caring-contacts-server-config.test.ts` (new)

**Interfaces:**

```ts
// config.ts
export type CaringContactsDataMode = "postgres" | "in-memory";
export function caringContactsDatabaseUrl(): string | null;
export function caringContactsDataMode(): CaringContactsDataMode;
export function assertNotClinicalKbProject(url: string): void; // throws CaringContactsProjectSeparationError
export class CaringContactsProjectSeparationError extends Error {}

// pool.ts
export function createCaringContactsPool(url: string): SqlConnectionPool;

// store.ts
export async function caringContactsStore(): Promise<CaringContactRepository>;
```

**Rules:** the only environment variable read is `CARING_CONTACTS_DATABASE_URL`. It shares **no** value with any `NEXT_PUBLIC_SUPABASE_*` or `SUPABASE_*`. `assertNotClinicalKbProject` throws if the URL contains the pinned Clinical KB reference `sjrfecxgysukkwxsowpy`, or if it equals `process.env.SUPABASE_DB_URL`/`DATABASE_URL`. When the variable is absent, `caringContactsDataMode()` is `"in-memory"` and `caringContactsStore()` returns `createInMemoryRepository(systemClock())` so the workspace runs with no database at all — this is the mode the demo and the tests use.

**Never print a value.** Error messages name the variable, never its contents.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CaringContactsProjectSeparationError,
  assertNotClinicalKbProject,
  caringContactsDataMode,
} from "@/lib/caring-contacts-server/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("caring-contacts database configuration", () => {
  it("falls back to the in-memory store when unconfigured", () => {
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "");
    expect(caringContactsDataMode()).toBe("in-memory");
  });

  it("refuses the pinned Clinical KB project reference", () => {
    expect(() =>
      assertNotClinicalKbProject("postgres://user@db.sjrfecxgysukkwxsowpy.supabase.co:5432/postgres"),
    ).toThrow(CaringContactsProjectSeparationError);
  });

  it("refuses a URL that is byte-identical to the Clinical KB connection", () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://shared@example.invalid:5432/postgres");
    expect(() => assertNotClinicalKbProject("postgres://shared@example.invalid:5432/postgres")).toThrow(
      CaringContactsProjectSeparationError,
    );
  });

  it("never puts a connection string into its error message", () => {
    try {
      assertNotClinicalKbProject("postgres://secret@db.sjrfecxgysukkwxsowpy.supabase.co:5432/postgres");
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret");
      expect((error as Error).message).toContain("CARING_CONTACTS_DATABASE_URL");
    }
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement the three modules.** `pool.ts` imports `pg` — already a devDependency from Phase 1. If the workspace is to run against Postgres outside tests, promote `pg` to a runtime dependency in the same commit and say so; otherwise keep the in-memory default and leave `pg` where it is.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line. Then run `npm run check:supabase-project` — it must still pass unchanged, and it is a local static check, not a provider call.
- [ ] **Step 5: Prove it can fail.** Remove the Clinical KB reference check → the second test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts-server/ tests/caring-contacts-server-config.test.ts
git commit -m "feat(caring-contacts): database configuration that cannot resolve to the Clinical KB project"
```

---
