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

describe("therapy records edited on #3510 carry a fresh post-#3510 sign-off", () => {
  it.each(EDITED_ON_3510)("%s is reviewed with a fresh post-#3510 sign-off and content pin", (slug) => {
    const record = records.find((item) => item.slug === slug);
    expect(record, slug).toBeDefined();
    expect(record!.reviewStatus).toBe("reviewed");
    expect(record!.reviewedBy).toBe("Psych Sift");
    expect(record!.reviewedAt! >= "2026-10-15").toBe(true);
    expect(record!.reviewedContentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.values(record!.reviewChecklist).every(Boolean)).toBe(true);
  });
});
