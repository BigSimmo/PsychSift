import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultReindexGateConfig } from "../src/lib/reindex-eval-gate";

const h = vi.hoisted(() => ({
  prepare: vi.fn(),
  readWave: vi.fn(),
  runRuntime: vi.fn(),
  readArguments: vi.fn((_operation: unknown, value: unknown) => value),
  readCandidate: vi.fn(),
  parseProfile: vi.fn(),
  validateEnvelope: vi.fn((input: unknown) => ({ envelope: input })),
  capture: vi.fn((input: unknown) => ({ input, ownUndefinedPaths: [] })),
  restore: vi.fn((input: { input: unknown }) => ({ nativeInput: input.input })),
}));

vi.mock("../scripts/lib/reindex-eval-runtime", () => ({
  runShadowEvaluationRuntimeV1: h.runRuntime,
}));
vi.mock("../scripts/lib/reindex-eval-session", () => ({
  encodeShadowNodeJsonCanonicalPayload: (value: unknown) => JSON.stringify(value),
  readShadowEvaluationArgumentsV1: h.readArguments,
  readShadowCandidateCaseReportV1: h.readCandidate,
  createShadowNodeJsonByteEnvelope: (value: unknown, domain: string) => ({
    envelope: {
      version: 1,
      domain,
      encoding: "node-json-v1",
      canonicalPayload: JSON.stringify(value),
      digest: `sha256:${"a".repeat(64)}`,
    },
  }),
  prepareShadowPersistenceV1: h.prepare,
  readShadowWaveReadbackV1: h.readWave,
  validateShadowEnvelopeBytes: h.validateEnvelope,
  captureShadowProducerInputV1: h.capture,
  parseShadowExecutionProfileEnvelope: h.parseProfile,
  readShadowProducerInputV1: h.restore,
}));

import {
  buildShadowEvaluationCaseReportV1,
  runShadowReindexEvaluationV1,
  stageShadowReindexV1,
} from "../scripts/reindex-shadow";

const documentId = "00000000-0000-4000-8000-000000000001";
const candidateGenerationId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const digest = `sha256:${"b".repeat(64)}`;

function profile() {
  const envelope = { digest: `sha256:${"c".repeat(64)}` };
  return {
    payload: {
      documentIds: [documentId],
      manualAliasIds: [],
      evidenceMode: "mocked",
      providerMode: "offline",
      comparisonClock: "2026-09-13T00:00:00.000000Z",
    },
    bytes: { envelope },
    cases: { bytes: { envelope: { digest: `sha256:${"d".repeat(64)}` } } },
    configuration: { bytes: { envelope: { digest: `sha256:${"e".repeat(64)}` } } },
  };
}

function report(recall: number) {
  return {
    retrieval: {
      summary: {
        case_count: 1,
        failed_cases: [],
        document_recall_at_5: recall,
        content_recall_at_5: recall,
        top_k_hit_rate: recall,
        content_mrr_at_10: recall,
        content_mrr_case_count: 1,
        mrr_at_10: recall,
        p90_latency_ms: 10,
      },
      source_governance: { stale_review_unknown_rate: 0, review_required_rate: 0 },
    },
    rag: {
      summary: {
        case_count: 1,
        grounded_supported_rate: 1,
        unsupported_count: 0,
        unsupported_correct_rate: 1,
        expected_hit_rate: 1,
        citation_failure_rate: 0,
        numeric_grounding_failure_rate: 0,
        source_governance_danger_failure_rate: 0,
        expected_danger_warning_missing_count: 0,
        p95_latency_ms: 10,
      },
    },
    accepted_threshold_failures: [],
    blocking_threshold_failures: [],
    source_metadata_debt_acceptance: { status: "not_requested" },
  };
}

function validatedGateInput(candidateRecall = 0.5) {
  const casePayload = (recall: number) => ({ report: report(recall), executions: [{ outcome: "complete", limitations: [] }] });
  return {
    executionProfile: { payload: { cases: { digest: `sha256:${"d".repeat(64)}` } } },
    baselineCaseReport: { payload: casePayload(1) },
    candidateCaseReport: { payload: casePayload(candidateRecall) },
    plan: {
      envelope: { digest },
      payload: { plan: { chunkingExperiment: false, populationFingerprint: `sha256:${"f".repeat(64)}` } },
    },
    waveReceipt: {
      envelope: { digest: `sha256:${"1".repeat(64)}` },
      payload: { recoveryEvidenceDigest: `sha256:${"2".repeat(64)}`, candidateGenerationId },
    },
    configuration: { payload: { gate: defaultReindexGateConfig } },
  };
}

function capturedEnvelope(payload: unknown) {
  return {
    input: {
      version: 1,
      domain: "u04-retained-evidence-v1",
      encoding: "node-json-v1",
      canonicalPayload: JSON.stringify(payload),
      digest: `sha256:${"3".repeat(64)}`,
    },
    ownUndefinedPaths: [],
  };
}

function runtime(side: "baseline" | "candidate", complete = true) {
  return {
    kind: "u04-evaluation-runtime-result-v1",
    complete,
    failureLatched: !complete,
    requestEnvelope: { ...capturedEnvelope({ originalOriginDigest: digest, sourceBindings: [] }).input,
      domain: "u04-evaluation-request-v1" },
    authorityEnvelope: { authority: side },
    executionProfileEnvelope: { profile: side },
    ragContextSnapshot: {},
    indexingVersionAtRequestStart: "synthetic-index",
    readOccurrences: [],
    completionRead: side === "candidate" && complete ? {
      address: { kind: "retrieval", ordinal: 0, id: "retrieval-case" },
      operation: "aliases",
      readOrdinal: 9,
      preparedContext: {},
      startedAt: "2026-09-13T00:00:02.000000Z",
      finishedAt: "2026-09-13T00:00:03.000000Z",
      resultEnvelope: capturedEnvelope({
        observedAt: "2026-09-13T00:00:03.000000Z",
        guard: { ok: true },
        environment: { fixed: true },
      }),
      status: "complete",
      error: null,
    } : null,
    providerOccurrences: [],
    failures: complete ? [] : [{ code: "dependency_error", operation: "aliases" }],
    workload: {
      complete,
      failureLatched: !complete,
      error: complete ? null : { name: "Error", message: "synthetic failure" },
      report: complete ? report(1) : null,
      retrieval: {
        occurrences: complete ? [{
          address: { ordinal: 0, id: "retrieval-case" },
          output: { results: [{ document_id: documentId }] },
        }] : [],
      },
      rag: { occurrences: [] },
    },
  };
}

const expectations = [{
  kind: "retrieval" as const,
  index: 0,
  caseId: "retrieval-case",
  documentId,
  expectedDocumentRank: 1,
}];

beforeEach(() => {
  vi.clearAllMocks();
  h.parseProfile.mockReturnValue(profile());
  h.prepare.mockReturnValue({
    plan: {
      targetProjectRef: "project-ref",
      candidateGenerationId,
      digest,
      documents: [{ documentId }],
    },
    parameters: { p_plan: { digest } },
  });
  h.readCandidate.mockReturnValue(validatedGateInput());
});

describe("U04 shadow driver lifecycle", () => {
  it("records only a reservation and keeps terminal acceptance unavailable", async () => {
    const abortSignal = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        kind: "reserved",
        candidate_generation_id: candidateGenerationId,
        plan_digest: digest,
        jobs: [{ document_id: documentId, job_id: jobId }],
        terminal_acceptance: "unavailable",
      },
      error: null,
    });
    const rpc = vi.fn(() => ({ abortSignal }));

    const result = await stageShadowReindexV1(
      { parameters: {}, independentlyAdmitted: {}, trustedNow: () => "2026-09-13T00:00:00.000000Z" },
      { projectRef: "project-ref", client: { rpc } as never },
    );

    expect(result).toMatchObject({
      kind: "shadow-reservation-recorded",
      terminalAcceptance: "unavailable",
    });
    expect(result).not.toHaveProperty("stageReceipt");
    expect(result).not.toHaveProperty("decision");
  });

  it("accepts the exact SQL reservation replay without implying a terminal receipt", async () => {
    const abortSignal = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        kind: "existing_reservation",
        candidate_generation_id: candidateGenerationId,
        plan_digest: digest,
        terminal_acceptance: "unavailable",
      },
      error: null,
    });
    const rpc = vi.fn(() => ({ abortSignal }));

    await expect(stageShadowReindexV1(
      { parameters: {}, independentlyAdmitted: {}, trustedNow: () => "2026-09-13T00:00:00.000000Z" },
      { projectRef: "project-ref", client: { rpc } as never },
    )).resolves.toMatchObject({ kind: "shadow-reservation-recorded", terminalAcceptance: "unavailable" });
  });

  it("retains a malformed reservation response on the thrown error", async () => {
    const rpc = vi.fn(() => ({ abortSignal: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }) }));

    const error = await stageShadowReindexV1(
      { parameters: {}, independentlyAdmitted: {}, trustedNow: () => "2026-09-13T00:00:00.000000Z" },
      { projectRef: "project-ref", client: { rpc } as never },
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("retainedResponse");
  });

  it("returns retained evidence and NO_GO when runtime failure is latched", async () => {
    h.runRuntime.mockResolvedValue(runtime("baseline", false));

    const result = await runShadowReindexEvaluationV1({ independentlyAdmitted: {} } as never, expectations);

    expect(result).toMatchObject({ kind: "shadow-evaluation-incomplete", decision: "NO_GO" });
    expect(result).toHaveProperty("evidence");
    expect(h.readCandidate).not.toHaveBeenCalled();
  });

  it("records a baseline report without calling the candidate gate", async () => {
    h.runRuntime.mockResolvedValue(runtime("baseline"));

    const result = await runShadowReindexEvaluationV1({ independentlyAdmitted: {} } as never, expectations);

    expect(result).toMatchObject({
      kind: "shadow-baseline-evaluation-recorded",
      acceptance: "requires-complete-audit-consumer",
    });
    expect(h.readCandidate).not.toHaveBeenCalled();
  });

  it("retains complete runtime evidence when report accounting rejects expectations", async () => {
    h.runRuntime.mockResolvedValue(runtime("baseline"));

    const error = await runShadowReindexEvaluationV1(
      { independentlyAdmitted: {} } as never,
      [],
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("retainedEvidence");
    expect(h.readCandidate).not.toHaveBeenCalled();
  });

  it("uses the final candidate observation before invoking the actual gate", async () => {
    const candidate = runtime("candidate");
    h.runRuntime.mockResolvedValue(candidate);
    h.readCandidate.mockReturnValue(validatedGateInput(0.5));
    const candidateEvidence = { wave: "complete" };

    const result = await runShadowReindexEvaluationV1(
      { independentlyAdmitted: {}, candidateEvidence } as never,
      expectations,
    );

    expect(result).toMatchObject({
      kind: "shadow-candidate-evaluation-recorded",
      evaluated: { decision: { decision: "NO_GO" } },
    });
    const call = h.readCandidate.mock.calls[0]!;
    expect(call[4]).toEqual({
      observedAt: "2026-09-13T00:00:03.000000Z",
      guard: { ok: true },
      environment: { fixed: true },
    });
    expect(call.slice(5, 8)).toEqual([
      "aliases",
      "2026-09-13T00:00:02.000000Z",
      "2026-09-13T00:00:03.000000Z",
    ]);
    expect(call[8]).toEqual(candidateEvidence);
  });
});
