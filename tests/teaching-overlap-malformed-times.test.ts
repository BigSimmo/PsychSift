import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The overlap RPC must skip a booking whose stored time is malformed, as the app check it
// replaced did (Date.parse -> NaN -> no overlap), rather than abort with a cast error.
const migrations = path.join(process.cwd(), "supabase/migrations");
const latest = readdirSync(migrations)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .filter((file) =>
    /create (or replace )?function public\.teaching_find_supervisor_overlap_v1\(/.test(
      readFileSync(path.join(migrations, file), "utf8"),
    ),
  )
  .at(-1);

describe("teaching_find_supervisor_overlap_v1", () => {
  it("guards every stored-time cast in its latest definition", () => {
    expect(latest).toBe("20261107000900_audit_overlap_skip_malformed_booking_times.sql");
    const sql = readFileSync(path.join(migrations, latest!), "utf8");
    for (const field of ["startsAt", "endsAt"]) {
      const casts = sql.split(`(r.ratings->>'${field}')::timestamptz`).length - 1;
      const guards = sql.split(`pg_input_is_valid(r.ratings->>'${field}', 'timestamptz')`).length - 1;
      expect(casts).toBe(1);
      expect(guards).toBe(casts);
    }
  });
});
