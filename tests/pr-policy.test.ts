import { describe, expect, it } from "vitest";
import { classifyPullRequestFiles, protectedPathSample, safetyPathLists } from "../scripts/pr-policy.mjs";

const WORKER_RANKING_PRODUCERS = [
  "worker/candidate-chunks.ts",
  "worker/managed-local-memory-producer.ts",
  "worker/managed-admin-text-terminal.ts",
  "worker/managed-prepared-supplier.ts",
  "worker/published-admin-source-layout.ts",
  "worker/scoped-candidate-projection.ts",
  "worker/whole-original-supplier.ts",
] as const;

describe("PR policy worker ranking producer coverage (R23)", () => {
  it.each(WORKER_RANKING_PRODUCERS)("classifies %s as a protected ragRanking surface", (filePath) => {
    const classification = classifyPullRequestFiles([filePath]);
    expect(classification.ragRanking).toBe(true);
    expect(protectedPathSample).toContain(filePath);
    expect(safetyPathLists.ragRanking.some((pattern: RegExp) => pattern.test(filePath))).toBe(true);
  });

  it("keeps worker/main.ts orchestration out of ragRanking while protecting producer modules", () => {
    expect(classifyPullRequestFiles(["worker/main.ts"]).ragRanking).toBe(false);
    for (const samplePath of protectedPathSample) {
      expect(classifyPullRequestFiles([samplePath]).ragRanking).toBe(true);
    }
  });
});
