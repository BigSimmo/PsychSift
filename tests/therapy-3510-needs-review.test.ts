import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { isNamedPerson } from "@/lib/admin/rule-sign-off";

// Owner decision, 13 Oct 2026 10:23 PM AWST: therapy records whose clinical or source text
// was edited on #3510 went back to needs_review so their old sign-off hash and date were not
// re-pinned. On 15–16 Oct 2026 the five records with references were corrected and freshly
// signed off by "Psych Sift"; wake-therapy has no references and remains needs_review.
const SIGNED_AFTER_3510_CORRECTIONS = [
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
  it.each(SIGNED_AFTER_3510_CORRECTIONS)("%s carries a fresh post-#3510 sign-off", (slug) => {
    const record = records.find((item) => item.slug === slug);
    expect(record, slug).toBeDefined();
    expect(record!.reviewStatus).toBe("reviewed");
    expect(isNamedPerson(record!.reviewedBy)).toBe(true);
    expect(Date.parse(record!.reviewedAt ?? "")).toBeGreaterThan(Date.parse("2026-10-14T00:00:00.000Z"));
  });

  it("keeps wake-therapy-sleep-deprivation-chronotherapy in needs_review while it has no references", () => {
    const record = records.find((item) => item.slug === "wake-therapy-sleep-deprivation-chronotherapy");
    expect(record).toBeDefined();
    expect(record!.reviewStatus).toBe("needs_review");
    expect(isNamedPerson(record!.reviewedBy)).toBe(false);
  });
});
