import { describe, expect, it } from "vitest";

import type { WorkRoleGrant } from "@/lib/work-roles/model";
import { can, canReviewAssessments, requireWorkCapability, type WorkRoleContext } from "@/lib/work-roles/server";

const dct: WorkRoleGrant = { role: "dct", hospitalId: "hosp-1", serviceIds: ["team-a"] };
const teamSupervisor: WorkRoleGrant = { role: "supervisor", serviceId: "team-a" };

describe("work roles server check", () => {
  it("never lets anyone review their own assessments, whichever check a route uses", () => {
    const context: WorkRoleContext = { userId: "me", grants: [dct, teamSupervisor], ready: true };
    const self = { kind: "trainee", userId: "me", serviceId: "team-a" } as const;
    const other = { kind: "trainee", userId: "sam", serviceId: "team-a" } as const;
    expect(can(context, "assessments.review", self)).toBe(false);
    expect(() => requireWorkCapability(context, "assessments.review", self)).toThrow();
    expect(canReviewAssessments(context, "me", "team-a")).toBe(false);
    expect(can(context, "assessments.review", other)).toBe(true);
    expect(canReviewAssessments(context, "sam", "team-a")).toBe(true);
  });
});
