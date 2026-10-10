import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static contract for organiser access to course bookings. Booked names and drafts follow the
 * Courses role, not who posted the course, so an organiser who loses the role stops seeing them.
 */

const sql = readFileSync("supabase/migrations/20261010011100_work_bookings_organiser_role.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");

function latestVisible(text: string): string {
  const start = text.lastIndexOf("function public.work_bookings_visible(p_actor_id uuid)");
  expect(start).toBeGreaterThan(-1);
  return text.slice(start, text.indexOf("$$;", start));
}

describe("course bookings organiser access", () => {
  it("manages a course only as the site administrator or a current Courses manager", () => {
    for (const body of [latestVisible(sql), latestVisible(schema)]) {
      expect(body).toContain(
        "select c.id, (me.admin or (c.service_id is not null and public.work_bookings_can_post(p_actor_id, c.service_id)))",
      );
      expect(body).not.toContain("organiser_id");
    }
  });

  it("replaces the function in place so its service_role-only grant stays", () => {
    expect(sql).toContain("create or replace function public.work_bookings_visible(p_actor_id uuid)");
    expect(sql).not.toMatch(/^\s*(grant|revoke)\b/im);
  });
});
