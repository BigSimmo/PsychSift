import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { DifferentialSnapshot } from "@/lib/differential-snapshot";

/** The generated export on disk, read raw: this guard asserts what the export writes. */
const rawSnapshot = JSON.parse(readFileSync("data/differentials-snapshot.json", "utf8")) as DifferentialSnapshot;

/**
 * Diagnoses are keyed by `slug` and presentation workflows by `id`, in two separate
 * families of one generated file.
 *
 * Previously (#HNJF5X), three presentation workflows ('depression',
 * 'substance-intoxication', 'substance-withdrawal') collided with diagnosis
 * slugs of the exact same name. A collection that flattened both families into
 * a single identifier-keyed structure silently dropped three records (229 kept
 * out of 232).
 *
 * Presentation workflow IDs have been namespaced (prefixed with 'presentation-')
 * so that diagnoses and presentations share zero identifiers. This test guards
 * against any future identifier collisions across both families.
 */
describe("differential snapshot identifiers (#HNJF5X)", () => {
  const diagnosisSlugs = rawSnapshot.diagnoses.map((record) => record.slug);
  const presentationIds = rawSnapshot.presentations.map((workflow) => workflow.id);

  it("keeps every identifier unique inside its own family", () => {
    expect(new Set(diagnosisSlugs).size).toBe(diagnosisSlugs.length);
    expect(diagnosisSlugs.length).toBe(201);

    expect(new Set(presentationIds).size).toBe(presentationIds.length);
    expect(presentationIds.length).toBe(31);
  });

  it("has zero collisions between diagnosis slugs and presentation IDs", () => {
    const slugs = new Set(diagnosisSlugs);
    const collisions = presentationIds.filter((id) => slugs.has(id)).sort();

    expect(
      collisions,
      "A diagnosis slug and a presentation id share a value. Anything keying both families " +
        "by identifier will drop one of the records without reporting it. Namespace the " +
        "identifier in scripts/lib/parse-differentials-export.ts and data/differentials-snapshot.json.",
    ).toEqual([]);
  });

  it("retains all 232 distinct records when flattened into a single identifier key space", () => {
    const total = diagnosisSlugs.length + presentationIds.length;
    const flattened = new Set([...diagnosisSlugs, ...presentationIds]);

    expect(total).toBe(232);
    expect(flattened.size).toBe(232);
  });
});
