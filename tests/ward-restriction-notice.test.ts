import { describe, expect, it } from "vitest";

import { restrictionNotice } from "../src/components/ward-management/ward-derivations";
import { wardMovements } from "../src/components/ward-management/ward-movements";
import { allUnits } from "../src/components/ward-management/ward-sites";

const unit = (id: string) => allUnits().find((candidate) => candidate.id === id)!;

describe("restriction notice", () => {
  it("says nothing when the ward's security matches what the patient needs", () => {
    const open = wardMovements.find((m) => m.security === "Open" && m.legalStatus !== "Voluntary")!;
    expect(restrictionNotice(open, unit("scgh-adult-open"))).toBeUndefined();
  });

  it("flags a secure ward for an open-security patient as more restrictive than required", () => {
    const open = wardMovements.find((m) => m.security === "Open" && m.legalStatus !== "Voluntary")!;
    const notice = restrictionNotice(open, unit("rph-adult-secure"));
    expect(notice?.level).toBe("more_restrictive");
    expect(notice?.text).toMatch(/more restrictive/i);
  });

  it("flags a voluntary patient on a locked ward separately and more prominently", () => {
    const voluntary = wardMovements.find((m) => m.legalStatus === "Voluntary")!;
    const notice = restrictionNotice(voluntary, unit("rph-adult-secure"));
    expect(notice?.level).toBe("voluntary_on_locked");
    expect(notice?.text).toMatch(/voluntary/i);
    // It prompts a review; it never asserts that anything unlawful has happened.
    expect(notice?.text).not.toMatch(/unlawful|illegal|breach/i);
  });

  it("prefers the voluntary warning when both would apply", () => {
    const voluntaryOpen = wardMovements.find((m) => m.legalStatus === "Voluntary" && m.security === "Open")!;
    expect(restrictionNotice(voluntaryOpen, unit("rph-adult-secure"))?.level).toBe("voluntary_on_locked");
  });
});
