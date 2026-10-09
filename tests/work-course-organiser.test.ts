import { describe, expect, it } from "vitest";

import { canManageCourses } from "@/components/work-screens/admin/use-course-organiser";

describe("who runs the Courses page", () => {
  it("lets in the administrator, a roster manager, and Medical Workforce or the DCT", () => {
    expect(canManageCourses({ administrator: true, teamManager: false })).toBe(true);
    expect(canManageCourses({ administrator: false, teamManager: true })).toBe(true);
    expect(canManageCourses({ administrator: false, teamManager: false, hospitalRole: true })).toBe(true);
  });

  it("keeps everyone else out", () => {
    expect(canManageCourses({ administrator: false, teamManager: false })).toBe(false);
    expect(canManageCourses({ administrator: false, teamManager: false, hospitalRole: false })).toBe(false);
  });
});
