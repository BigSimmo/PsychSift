import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildDifferentialStreamModel } from "@/lib/differential-stream";
import { differentialPresentations, differentialRecords, getDifferentialRecord } from "@/lib/differentials";
import { differentialRouteWithQuery } from "@/lib/differentials-navigation";

describe("differential stream model", () => {
  it("ranks and flags matches when a query is present", () => {
    const model = buildDifferentialStreamModel("diagnoses", "delirium");
    expect(model.matchCount).toBeGreaterThan(0);
    expect(model.items.some((item) => item.isMatch)).toBe(true);
    expect(model.items[0]?.isMatch).toBe(true);
    expect(
      model.items
        .filter((item) => item.isMatch)
        .every((item, index, list) => {
          if (index === 0) return true;
          return list[index - 1]!.score >= item.score;
        }),
    ).toBe(true);
    expect(model.chapters).toEqual([]);
    expect(model.items.find((item) => item.slug === "delirium")?.matchReasons.length).toBeGreaterThan(0);
  });

  it("keeps non-matches after matches so the stream can dim rather than drop them", () => {
    const model = buildDifferentialStreamModel("diagnoses", "delirium");
    const firstNonMatch = model.items.findIndex((item) => !item.isMatch);
    expect(firstNonMatch).toBeGreaterThan(0);
    expect(model.items.slice(0, firstNonMatch).every((item) => item.isMatch)).toBe(true);
    expect(model.items.length).toBe(differentialRecords.length);
  });

  it("ships related refs for cluster highlighting without the full record graph", () => {
    const dystonia = getDifferentialRecord("acute-dystonia");
    expect(dystonia).not.toBeNull();
    const model = buildDifferentialStreamModel("diagnoses", "acute dystonia");
    const card = model.items.find((item) => item.slug === "acute-dystonia");
    expect(card?.related.map((node) => node.slug)).toEqual(
      expect.arrayContaining(["akathisia", "drug-induced-parkinsonism"]),
    );
  });

  it("groups empty-query browse by urgency and presentation families", () => {
    const model = buildDifferentialStreamModel("diagnoses", "");
    expect(model.matchCount).toBe(0);
    expect(model.chapters.map((chapter) => chapter.id)).toEqual(["status-emergent", "status-urgent", "status-routine"]);
    expect(model.presentationChapters.length).toBeGreaterThan(0);
    expect(model.safetyShelfIds.length).toBeGreaterThan(0);
    expect(model.presets.length).toBeGreaterThan(0);
    const chapterIds = new Set(model.chapters.flatMap((chapter) => chapter.itemIds));
    expect(chapterIds.size).toBe(model.items.length);
  });

  it("builds presentation pathways from supported priority, candidate, and overlap data", () => {
    const presentations = differentialPresentations();
    const model = buildDifferentialStreamModel("presentations", "");
    expect(model.chapters.map((chapter) => chapter.id)).toEqual(["status-emergent", "status-urgent", "status-routine"]);

    const item = model.items.find((candidate) => candidate.relatedPathways.length > 0);
    expect(item).toBeTruthy();
    const workflow = presentations.find((candidate) => candidate.id === item!.slug);
    expect(item?.candidateCount).toBe(workflow?.candidates.length);

    const related = item!.relatedPathways[0]!;
    const relatedWorkflow = presentations.find((candidate) => candidate.id === related.slug);
    const sourceSlugs = new Set(workflow!.candidates.map((candidate) => candidate.slug));
    const exactOverlap = relatedWorkflow!.candidates.filter((candidate) => sourceSlugs.has(candidate.slug)).length;
    expect(related.sharedCandidateCount).toBe(exactOverlap);
    expect(exactOverlap).toBeGreaterThan(0);
  });

  it("exposes exclusion previews from overlap sections when present", () => {
    const model = buildDifferentialStreamModel("diagnoses", "delirium");
    const delirium = model.items.find((item) => item.slug === "delirium");
    expect(delirium?.exclusionPreview).toBeTruthy();
  });
  it("auto-seeds compare ticks only for diagnosis pairs that share a presentation workflow", async () => {
    const { getPresentationWorkflowSelectionForDiagnosisIds } = await import("@/lib/differentials");
    const model = buildDifferentialStreamModel("diagnoses", "pain");
    expect(model.compareSeedIds.length).toBeGreaterThan(0);
    expect(model.compareSeedIds.length).toBeLessThanOrEqual(2);
    if (model.compareSeedIds.length === 2) {
      const selection = getPresentationWorkflowSelectionForDiagnosisIds(model.compareSeedIds);
      expect(selection?.diagnosisIds.length).toBeGreaterThanOrEqual(2);
      for (const id of model.compareSeedIds) {
        expect(selection?.diagnosisIds).toContain(id);
      }
    }
  });

  it("treats punctuation-only queries as empty browse mode", () => {
    const model = buildDifferentialStreamModel("diagnoses", "!!!");
    expect(model.matchCount).toBe(0);
    expect(model.presets.length).toBeGreaterThan(0);
    expect(model.chapters.length).toBeGreaterThan(0);
    expect(model.compareSeedIds).toEqual([]);
  });
});

describe("differential stream navigation helpers", () => {
  it("can deep-link a focused diagnosis on the diagnoses stream", () => {
    expect(differentialRouteWithQuery("/differentials/diagnoses", "Pain", undefined, "acute-dystonia")).toBe(
      "/differentials/diagnoses?q=Pain&focus=acute-dystonia",
    );
  });

  it("keeps the stream workspace client-safe from the snapshot loader", () => {
    const workspace = readFileSync(
      new URL("../src/components/differentials/differential-stream-workspace.tsx", import.meta.url),
      "utf8",
    );
    const modelTypes = readFileSync(new URL("../src/lib/differential-stream-model.ts", import.meta.url), "utf8");
    expect(workspace).not.toMatch(/from\s+["']@\/lib\/differentials["']/);
    expect(workspace).not.toMatch(/loadDifferentialSnapshot|differentials-snapshot/);
    expect(modelTypes).not.toMatch(/from\s+["']@\/lib\/differentials["']/);
    expect(modelTypes).not.toMatch(/loadDifferentialSnapshot/);
  });
});

describe("differential stream compare CTA contracts", () => {
  it("requires two selections before enabling compare in the shared tray", () => {
    const workspace = readFileSync(
      new URL("../src/components/differentials/differential-stream-workspace.tsx", import.meta.url),
      "utf8",
    );
    const tray = readFileSync(new URL("../src/components/compare/shared-compare-tray.tsx", import.meta.url), "utf8");
    expect(workspace).toContain("<SharedCompareTray");
    expect(tray).toContain("minToCompare = 2");
    expect(tray).toContain("const ready = count >= minToCompare");
    expect(workspace).toContain("normalizeSearchText(query)");
    expect(workspace).toContain("model.compareSeedIds");
  });
});
