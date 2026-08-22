// tests/caring-contacts-server-pool.test.ts
//
// Review round 1, Important 2 and Important 3: createCaringContactsPool is itself an exported
// entry point, so it must refuse a Clinical KB URL on its own -- not only when store.ts happens to
// check first -- and it must never leave the underlying pg.Pool without an 'error' listener, since
// an unhandled 'error' event on a Node pool crashes the process outright.
//
// pg's Pool never opens a real connection from its constructor (only .connect()/.query() do), so
// this mocks "pg" entirely: it proves createCaringContactsPool's own wiring without touching a
// database.
import { describe, expect, it, vi } from "vitest";

const poolInstances: Array<{ calls: Array<[string, (...args: unknown[]) => void]> }> = [];

vi.mock("pg", () => {
  class FakePool {
    calls: Array<[string, (...args: unknown[]) => void]> = [];
    constructor() {
      poolInstances.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.calls.push([event, handler]);
      return this;
    }
    async connect(): Promise<never> {
      throw new Error("connect() must not be called by createCaringContactsPool itself");
    }
  }
  return { Pool: FakePool };
});

import { CaringContactsProjectSeparationError } from "@/lib/caring-contacts-server/config";
import { createCaringContactsPool } from "@/lib/caring-contacts-server/pool";

describe("createCaringContactsPool", () => {
  it("refuses the pinned Clinical KB project reference on its own, not only through the store", () => {
    expect(() => createCaringContactsPool("postgres://user@db.sjrfecxgysukkwxsowpy.supabase.co:5432/postgres")).toThrow(
      CaringContactsProjectSeparationError,
    );
  });

  it("attaches an error listener to the underlying pg pool so an idle-client error cannot crash the process", () => {
    poolInstances.length = 0;
    createCaringContactsPool("postgres://demo@example.invalid:5432/postgres");
    expect(poolInstances).toHaveLength(1);
    expect(poolInstances[0].calls.some(([event]) => event === "error")).toBe(true);
  });
});
