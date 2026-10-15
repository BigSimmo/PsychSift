import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Owner decision, 13 Oct 2026 10:23 PM AWST: therapy records whose clinical or source text
// was edited on #3510 go back to needs_review. They are not re-signed, and their old
// sign-off hash and date are not re-pinned.
const EDITED_ON_3510 = [
  "adolescent-focused-psychotherapy-for-anorexia-nervosa",
  "advocacy-informed-therapeutic-work",
  "habit-reversal-training-cbit",
  "stair-skills-training-in-affective-and-interpersonal-regulation",
  "structured-clinical-management",
  // Reset in the same change (#3538) as the records above, so it carries the same guard.
  "wake-therapy-sleep-deprivation-chronotherapy",
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

describe("therapy records edited on #3510 await a fresh sign-off", () => {
  it.each(EDITED_ON_3510)("%s is needs_review with no carried-over sign-off", (slug) => {
    const record = records.find((item) => item.slug === slug);
    expect(record, slug).toBeDefined();
    expect(record!.reviewStatus).toBe("needs_review");
    expect(record!.reviewedBy).toBeNull();
    expect(record!.reviewedAt).toBeNull();
    expect(record!.reviewedContentSha256).toBeNull();
    expect(Object.values(record!.reviewChecklist).some(Boolean)).toBe(false);
  });
});
