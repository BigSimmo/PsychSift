import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { isNamedPerson } from "@/lib/admin/rule-sign-off";

// Owner decision, 13 Oct 2026 10:23 PM AWST: therapy records whose clinical or source text
// was edited on #3510 went back to needs_review so their old sign-off hash and date were not
// re-pinned. On 15–16 Oct 2026 the five records with references were corrected and freshly
// signed off by "Psych Sift" in #3562; those sign-offs were not the owner's and went back to
// needs_review on 21 Oct 2026 (owner ruling). wake-therapy stays needs_review until the owner signs
// it with therapy:review (owner ruling, 17 Oct 2026 22:12 AWST).
const CORRECTED_AFTER_3510 = [
  "adolescent-focused-psychotherapy-for-anorexia-nervosa",
  "advocacy-informed-therapeutic-work",
  "habit-reversal-training-cbit",
  "stair-skills-training-in-affective-and-interpersonal-regulation",
  "structured-clinical-management",
];

type TherapyRecord = {
  slug: string;
  reviewStatus: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewedContentSha256: string | null;
  reviewChecklist: Record<string, boolean>;
};

const raw = JSON.parse(readFileSync("src/data/therapies-source.json", "utf8")) as
  TherapyRecord[] | { therapies: TherapyRecord[] };
const records = Array.isArray(raw) ? raw : raw.therapies;

describe("therapy records edited on #3510", () => {
  it.each(CORRECTED_AFTER_3510)("%s waits in needs_review with no reviewer, date or pin", (slug) => {
    const record = records.find((item) => item.slug === slug);
    expect(record, slug).toBeDefined();
    expect(record!.reviewStatus).toBe("needs_review");
    expect(isNamedPerson(record!.reviewedBy)).toBe(false);
    expect(record!.reviewedAt ?? null).toBeNull();
    expect(record!.reviewedContentSha256 ?? null).toBeNull();
    expect(Object.values(record!.reviewChecklist).some(Boolean)).toBe(false);
  });

  it("keeps wake-therapy-sleep-deprivation-chronotherapy in needs_review until the owner signs it", () => {
    const record = records.find((item) => item.slug === "wake-therapy-sleep-deprivation-chronotherapy");
    expect(record).toBeDefined();
    expect(record!.reviewStatus).toBe("needs_review");
    expect(isNamedPerson(record!.reviewedBy)).toBe(false);
  });
});
