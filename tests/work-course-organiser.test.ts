import { describe, expect, it } from "vitest";

import { canManageCourses } from "@/components/work-screens/admin/use-course-organiser";

const nobody = { administrator: false, teamManager: false };

describe("who runs the Courses page", () => {
  it("lets in the administrator and a roster manager", () => {
    expect(canManageCourses({ administrator: true, teamManager: false })).toBe(true);
    expect(canManageCourses({ administrator: false, teamManager: true })).toBe(true);
  });

  it("lets in Medical Workforce and the DCT with no team of their own", () => {
    expect(canManageCourses({ ...nobody, heldRoles: ["workforce"] })).toBe(true);
    expect(canManageCourses({ ...nobody, heldRoles: ["dct"] })).toBe(true);
    expect(canManageCourses({ ...nobody, heldRoles: ["supervisor", "dct"] })).toBe(true);
  });

  it("keeps everyone else out, a supervisor included", () => {
    expect(canManageCourses(nobody)).toBe(false);
    expect(canManageCourses({ ...nobody, heldRoles: [] })).toBe(false);
    expect(canManageCourses({ ...nobody, heldRoles: ["supervisor"] })).toBe(false);
  });
});
