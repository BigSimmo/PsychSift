import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  answerGenerationFingerprint,
  buildAnswerGenerationFingerprint,
  scopedAnswerCacheKey,
  ragCacheFingerprint,
  type AnswerGenerationFingerprintInput,
} from "../src/lib/rag/rag-cache";

const baseline: AnswerGenerationFingerprintInput = {
  answerModel: "gpt-5.6-terra",
  fastModel: "gpt-5.6-terra",
  strongModel: "gpt-5.6-sol",
  classifierModel: "gpt-5.6-luna",
  indexingModel: "gpt-5.6-terra",
  embeddingModel: "text-embedding-3-small",
  embeddingDimensions: 1536,
  fastReasoningEffort: "low",
  strongReasoningEffort: "high",
  answerVerbosity: "medium",
  maxOutputTokens: 4000,
  providerMode: "auto",
  promptVersion: "clinical-rag-answer-v18",
  contextPackVersion: "rag-context-pack-v1",
  schemaVersion: "clinical-rag-answer-schema-v3",
  classifierPromptVersion: "clinical-rag-query-classifier-v1",
  retrievalVersion: "deep-memory-v1",
  indexingPromptVersion: "clinical-indexing-prompts-v1",
  semanticRerankEnabled: false,
  semanticRerankModel: "gpt-5.6-luna",
};

describe("RAG answer generation fingerprints", () => {
  it.each([
    ["fast model", { fastModel: "gpt-5.6-luna" }],
    ["classifier model", { classifierModel: "gpt-5.6-terra" }],
    ["indexing model", { indexingModel: "gpt-5.6-sol" }],
    ["embedding model", { embeddingModel: "text-embedding-3-large" }],
    ["embedding dimensions", { embeddingDimensions: 3072 }],
    ["strong reasoning", { strongReasoningEffort: "medium" }],
    ["answer verbosity", { answerVerbosity: "low" }],
    ["maximum output tokens", { maxOutputTokens: 6000 }],
    ["provider mode", { providerMode: "offline" }],
    ["prompt version", { promptVersion: "clinical-rag-answer-v19" }],
    ["query input version", { answerInputVersion: "clinical-rag-answer-input-v1" }],
    ["context pack version", { contextPackVersion: "rag-context-pack-v2" }],
    ["schema version", { schemaVersion: "clinical-rag-answer-schema-v4" }],
    ["classifier prompt version", { classifierPromptVersion: "clinical-rag-query-classifier-v2" }],
    ["retrieval version", { retrievalVersion: "deep-memory-v2" }],
    ["indexing prompt version", { indexingPromptVersion: "clinical-indexing-prompts-v2" }],
    ["semantic rerank enabled", { semanticRerankEnabled: true }],
    ["semantic rerank model", { semanticRerankModel: "gpt-5.6-terra" }],
  ])("changes when %s changes", (_label, override) => {
    expect(buildAnswerGenerationFingerprint({ ...baseline, ...override })).not.toBe(
      buildAnswerGenerationFingerprint(baseline),
    );
  });

  it("is stable for the same generation configuration", () => {
    expect(buildAnswerGenerationFingerprint({ ...baseline })).toBe(buildAnswerGenerationFingerprint(baseline));
  });

  it("does not reuse fingerprints made before query input versioning", () => {
    const oldFingerprint = createHash("sha256").update(JSON.stringify(baseline)).digest("hex").slice(0, 20);
    expect(buildAnswerGenerationFingerprint(baseline)).not.toBe(oldFingerprint);
  });

  it("is included in the scoped answer cache key", () => {
    const args = { query: "Clozapine monitoring", ownerId: "owner-a" };
    expect(scopedAnswerCacheKey(args)).toContain(ragCacheFingerprint(args));
  });
});

it("selects the real legacy/candidate-off/candidate-on generation tuple", async () => {
  const { decideRagProgrammeRollout, answerContractForRollout } = await import("../src/lib/rag/rag-rollout");
  const input = {
    configuredMode: "canary" as const,
    ownerId: "synthetic-owner",
    canaryBasisPoints: 10000,
    serverSalt: "synthetic-salt-01234567890123456789",
    queryPlanVersion: "q",
    sourcePolicyVersion: "p",
    indexGeneration: "i",
    publicSiteContentReleaseId: null,
    publicSiteContentStaticManifestDigest: null,
    publicSiteContentReleaseDigest: null,
    publicSiteContentChangeEpoch: null,
    publicSiteContentState: "unavailable" as const,
    governedRetrievalEnabled: true,
    siteContentEnabled: false,
    australianAugmentationEnabled: false,
    adaptiveAnswerEnabled: false,
    adaptiveRenderEnabled: false,
  };
  const legacy = decideRagProgrammeRollout({ ...input, configuredMode: "legacy", adaptiveAnswerEnabled: true });
  const off = decideRagProgrammeRollout(input);
  const on = decideRagProgrammeRollout({ ...input, adaptiveAnswerEnabled: true });
  expect(answerGenerationFingerprint(legacy)).toBe(answerGenerationFingerprint());
  expect(answerGenerationFingerprint(off)).toBe(answerGenerationFingerprint());
  expect(answerGenerationFingerprint(on)).not.toBe(answerGenerationFingerprint());
  expect(answerContractForRollout(legacy)).toEqual(answerContractForRollout(off));
  expect(answerContractForRollout(on)).toEqual({
    adaptive: true,
    promptVersion: "clinical-rag-answer-v20",
    schemaVersion: "clinical-rag-answer-schema-v5",
  });
});
