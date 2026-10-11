import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static contract for the course bookings retention purge. Courses keep 12 months after the
 * course day, the same span as Roster and the window work_bookings_visible reads, and bookings
 * go with their course through the cascade. Pins the span, the schedule and the grants.
 */

const sql = readFileSync("supabase/migrations/20261009225900_work_bookings_retention.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");

describe("course bookings retention purge", () => {
  it("deletes courses more than 365 days before today in Perth", () => {
    expect(sql).toContain(
      "delete from public.work_booking_courses where course_date < public.work_bookings_today() - 365;",
    );
  });

  it("relies on the booking cascade from the course", () => {
    expect(schema).toMatch(/course_id uuid not null references public\.work_booking_courses \(id\) on delete cascade/);
  });

  it("is callable only by the service role", () => {
    expect(sql).toContain(
      "revoke all on function public.work_bookings_retention_purge() from public, anon, authenticated;",
    );
    expect(sql).toContain("grant execute on function public.work_bookings_retention_purge() to service_role;");
  });

  it("runs nightly from pg_cron and is mirrored in schema.sql", () => {
    expect(sql).toContain("'work-bookings-retention-purge', '30 3 * * *'");
    expect(schema).toContain("'work-bookings-retention-purge', '30 3 * * *'");
  });
});
