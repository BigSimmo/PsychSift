import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planLocalAgent } from "../scripts/lib/rag-local-agent-policy.mjs";

const manifest = JSON.parse(readFileSync("docs/superpowers/rag-upgrade/canonical/programme-manifest.json", "utf8"));
const input = { phase: "P10", task: 6, role: "writer", risk: "routine" };
const plan = (overrides = {}) => planLocalAgent(manifest, { ...input, ...overrides });
const cli = (file: string, args: string[]) =>
  execFileSync(process.execPath, [file, ...args], { encoding: "utf8", stdio: "pipe" });

describe("local smart allocation", () => {
  it.each([
    ["mechanical", "gpt-5.6-terra", "medium"],
    ["routine", "gpt-5.6-sol", "high"],
    ["integration", "gpt-6-astra", "high"],
    ["clinical", "gpt-6-astra", "high"],
    ["privacy", "gpt-6-astra", "high"],
    ["security", "gpt-6-astra", "high"],
    ["concurrency", "gpt-6-astra", "high"],
    ["ambiguous", "gpt-6-astra", "high"],
  ])("routes %s explicitly without launching", (risk, model, effort) => {
    const result = plan({ risk });
    expect(result.controller).toEqual({ model: "gpt-6-astra", reasoning_effort: "high" });
    expect(result.dispatch).toMatchObject({
      model,
      reasoning_effort: effort,
      fork_turns: "none",
      agent_type: "worker",
    });
    expect(result).toMatchObject({
      evidenceKind: "intended-local-dispatch",
      executionAuthorized: false,
      runtimeVerified: false,
    });
  });
  it("keeps P08B Task6 sensitive despite understated risk", () => {
    expect(plan({ phase: "P08B", task: 6, risk: "mechanical" }).dispatch).toMatchObject({
      model: "gpt-6-astra",
      reasoning_effort: "high",
    });
  });
  it.each([
    ["retrieval-review", "gpt-6-astra", "rag-retrieval-reviewer"],
    ["governance-review", "gpt-6-astra", "clinical-governance-reviewer"],
    ["ui-review", "gpt-5.6-sol", "frontend-ui-reviewer"],
  ])("preserves P08B formal %s", (role, model, agentType) => {
    expect(plan({ phase: "P08B", task: 6, role, writerFrozen: true }).dispatch).toMatchObject({
      model,
      reasoning_effort: "xhigh",
      agent_type: agentType,
    });
  });
  it("distinguishes readiness from formal acceptance and retains P17 floor", () => {
    expect(plan({ phase: "P08B", task: 6, role: "scout", risk: "routine" }).dispatch.reasoning_effort).toBe("high");
    expect(plan({ phase: "P17", task: 6, role: "final-review", writerFrozen: true }).dispatch).toMatchObject({
      model: "gpt-6-astra",
      reasoning_effort: "xhigh",
    });
  });
  it("preserves a generic phase review floor regardless of understated risk", () => {
    expect(
      plan({ phase: "P12A", task: 1, role: "reviewer", risk: "mechanical", writerFrozen: true }).dispatch
        .reasoning_effort,
    ).toBe("xhigh");
  });
  it.each([
    { phase: "P99" },
    { task: 99 },
    { task: "6x" },
    { role: "invented" },
    { risk: "unknown" },
    { model: "auto" },
    { model: "gpt-5.6-terra" },
    { effort: "ultra" },
    { forkTurns: "all" },
    { profile: "unknown" },
    { extra: true },
    { activeWriters: 1 },
    { activeReviewers: 3 },
    { activeScouts: 3 },
    { role: "reviewer" },
    { role: "reviewer", writerFrozen: true, activeWriters: 1 },
    { role: "reviewer", writerFrozen: true, reuseAgentId: "writer-1", writerAgentId: "writer-1" },
  ])("rejects invalid or unsafe inputs %j", (overrides) => {
    expect(() => plan(overrides)).toThrow();
  });
  it("retains one spare child slot by default and allows explicit third slot", () => {
    expect(plan({ role: "reviewer", writerFrozen: true, activeReviewers: 1 }).capacity.remaining).toBe(1);
    expect(() => plan({ role: "reviewer", writerFrozen: true, activeReviewers: 2 })).toThrow(/spare/);
    expect(
      plan({ role: "reviewer", writerFrozen: true, activeReviewers: 2, useSpareSlot: true }).capacity.remaining,
    ).toBe(0);
  });
  it("repairs context first and does not treat environment failure as model failure", () => {
    expect(() => plan({ correctionRound: 4, failureKind: "substantive" })).toThrow(/context/);
    expect(() => plan({ correctionRound: 4, contextRepairCompleted: true, failureKind: "environment" })).toThrow(
      /environment/,
    );
    expect(
      plan({
        correctionRound: 2,
        reuseAgentId: "writer-1",
        writerAgentId: "writer-1",
        previousModel: "gpt-5.6-sol",
        previousEffort: "high",
      }).continuation,
    ).toBe("resume-writer");
  });
  it.each([
    { writerAgentId: undefined },
    { reuseAgentId: undefined },
    { reuseAgentId: "other-agent" },
    { previousModel: undefined, previousEffort: undefined },
    { previousModel: undefined },
    { previousEffort: undefined },
    { previousModel: "unknown" },
    { previousEffort: "ultra" },
    { previousModel: "gpt-5.6-terra", previousEffort: "medium" },
  ])("rejects unproven or inadequate resume configuration %j", (override) => {
    expect(() =>
      plan({
        correctionRound: 2,
        writerAgentId: "actual-writer",
        reuseAgentId: "actual-writer",
        previousModel: "gpt-5.6-sol",
        previousEffort: "high",
        ...override,
      }),
    ).toThrow();
  });
  it("preserves a stronger existing route on resume and rejects an inadequate sensitive writer", () => {
    const resume = {
      correctionRound: 3,
      writerAgentId: "actual-writer",
      reuseAgentId: "actual-writer",
      previousModel: "gpt-6-astra",
      previousEffort: "xhigh",
    };
    expect(plan(resume).dispatch).toMatchObject({ model: "gpt-6-astra", reasoning_effort: "xhigh" });
    expect(() =>
      plan({
        ...resume,
        phase: "P08B",
        task: 6,
        risk: "mechanical",
        previousModel: "gpt-5.6-sol",
        previousEffort: "high",
      }),
    ).toThrow(/fresh controlled escalation/);
  });
  it.each([
    ["gpt-5.6-terra", "medium", "gpt-5.6-sol", "high"],
    ["gpt-5.6-sol", "high", "gpt-6-astra", "high"],
    ["gpt-6-astra", "high", "gpt-6-astra", "xhigh"],
  ])("records fresh escalation from %s", (previousModel, previousEffort, model, effort) => {
    const result = plan({
      correctionRound: 4,
      failureKind: "substantive",
      contextRepairCompleted: true,
      previousModel,
      previousEffort,
    });
    expect(result.dispatch).toMatchObject({ model, reasoning_effort: effort });
    expect(result.continuation).toBe("fresh-escalation");
    expect(result.escalation).toMatchObject({ previousModel, reason: "substantive" });
  });
  it("blocks acceptance and another writer at the correction breaker", () => {
    const result = plan({ correctionRound: 6, unresolvedSeverities: ["Important"] });
    expect(result).toMatchObject({ status: "BLOCKED_CORRECTION_BREAKER", dispatch: null, acceptanceAllowed: false });
  });
  it("cannot downgrade a sensitive phase during fresh escalation", () => {
    expect(
      plan({
        phase: "P08B",
        task: 6,
        risk: "clinical",
        correctionRound: 4,
        failureKind: "substantive",
        contextRepairCompleted: true,
        previousModel: "gpt-5.6-terra",
        previousEffort: "medium",
      }).dispatch.model,
    ).toBe("gpt-6-astra");
    expect(() =>
      plan({
        correctionRound: 4,
        failureKind: "substantive",
        contextRepairCompleted: true,
        previousModel: "unknown",
        previousEffort: "medium",
      }),
    ).toThrow();
  });
  it("rejects malformed policy instead of falling back", () => {
    const corrupt = structuredClone(manifest);
    corrupt.localAgentPolicy = { schemaVersion: 99 };
    expect(() => planLocalAgent(corrupt, input)).toThrow();
  });
  it("integrates local launch planning without changing Cloud launch behavior", () => {
    const result = JSON.parse(
      cli("scripts/rag-phase-launch-check.mjs", [
        "--mode",
        "local-smart",
        "--target",
        "P08B",
        "--task",
        "6",
        "--role",
        "writer",
        "--risk",
        "clinical",
      ]),
    );
    expect(result.dispatch.model).toBe("gpt-6-astra");
    expect(cli("scripts/rag-phase-launch-check.mjs", ["--target", "P01", "--effort", "xhigh"])).toContain("PASS");
    expect(() => cli("scripts/rag-phase-launch-check.mjs", ["--target", "P01", "--effort", "high"])).toThrow();
  });
  it("local task briefs carry honest provenance and R3 continuation constraints", () => {
    const brief = cli("scripts/rag-task-brief.mjs", [
      "--variant",
      "local",
      "--phase",
      "P08B",
      "--task",
      "6",
      "--role",
      "writer",
      "--risk",
      "clinical",
    ]);
    expect(brief).toContain("gpt-6-astra");
    expect(brief).toContain('"fork_turns": "none"');
    expect(brief).toContain("P08B-task-6-correction-r3-brief.md");
    expect(brief).toContain("working-tree");
    expect(brief).toMatch(/Source SHA-256: [a-f0-9]{64}/);
    expect(brief).not.toContain("copied verbatim from the committed");
    expect(() => cli("scripts/rag-task-brief.mjs", ["--variant", "local", "--phase", "P08B", "--task", "6"])).toThrow();
  });
  it("requires declared matching identity and prior route through the local CLI", () => {
    const flags = [
      "--mode",
      "local-smart",
      "--target",
      "P08B",
      "--task",
      "6",
      "--role",
      "writer",
      "--risk",
      "clinical",
      "--correction-round",
      "2",
      "--reuse-agent-id",
      "actual-writer",
    ];
    expect(() => cli("scripts/rag-phase-launch-check.mjs", flags)).toThrow();
    const result = JSON.parse(
      cli("scripts/rag-phase-launch-check.mjs", [
        ...flags,
        "--writer-agent-id",
        "actual-writer",
        "--previous-model",
        "gpt-6-astra",
        "--previous-effort",
        "high",
      ]),
    );
    expect(result).toMatchObject({
      continuation: "resume-writer",
      reuseAgentId: "actual-writer",
      runtimeVerified: false,
    });
  });
});
