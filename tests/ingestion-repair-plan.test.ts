import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ingestion repair planner", () => {
  it("provides the bounded dry-run planner contract", async () => {
    const modulePath = resolve(process.cwd(), "src/lib/ingestion-repair-plan.ts");
    expect(existsSync(modulePath), "U03 bounded repair planner is absent").toBe(true);
  });
});

// These cases exercise the pure planner, never an operational repair entry point.
import { createHash } from "node:crypto";
import {
  createIngestionRepairPlan,
  ingestionRepairPlanDigestBytes,
  parseIngestionRepairPlan,
} from "../src/lib/ingestion-repair-plan";
const first = {
  documentId: "11111111-1111-4111-8111-111111111111",
  reasonCodes: ["summary_missing", "lease_abandoned"],
  expectedStateDigest: `sha256:${"a".repeat(64)}`,
};
const second = {
  documentId: "22222222-2222-4222-8222-222222222222",
  reasonCodes: ["generation_mismatch"],
  expectedStateDigest: `sha256:${"b".repeat(64)}`,
};
it("canonicalises order with the exact shared UTF-8 encoding and never mutates input", () => {
  const input = [second, first];
  const before = structuredClone(input);
  const plan = createIngestionRepairPlan(input);
  const bytes = `ingestion-repair-plan-v1\n${first.documentId}\tlease_abandoned,summary_missing\t${first.expectedStateDigest}\n${second.documentId}\tgeneration_mismatch\t${second.expectedStateDigest}\n`;
  expect(ingestionRepairPlanDigestBytes(plan.documents)).toBe(bytes);
  expect(plan.planDigest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  expect(createIngestionRepairPlan([first, second])).toEqual(plan);
  expect(parseIngestionRepairPlan(plan)).toEqual(plan);
  expect(input).toEqual(before);
});
it.each(
  [
    [],
    Array.from({ length: 101 }, () => first),
    [first, first],
    [{ ...first, documentId: first.documentId.toUpperCase().replace("1", "A") }],
    [{ ...first, documentId: "bad" }],
    [{ ...first, reasonCodes: [] }],
    [{ ...first, reasonCodes: ["apply"] }],
    [{ ...first, reasonCodes: ["summary_missing", "summary_missing"] }],
    [{ ...first, expectedStateDigest: "sha256:" }],
    [{ ...first, expectedStateDigest: `sha256:${"A".repeat(64)}` }],
    [{ ...first, extra: true }],
  ].map((documents) => ({ documents })),
)("rejects invalid bounded plan input %#", ({ documents }) => {
  expect(() => createIngestionRepairPlan(documents)).toThrow("invalid_ingestion_repair_plan");
});
it("rejects changed state/digest, unknown fields and execution mode", () => {
  const plan = createIngestionRepairPlan([first]);
  expect(() => parseIngestionRepairPlan({ ...plan, dryRun: false })).toThrow();
  expect(() => parseIngestionRepairPlan({ ...plan, apply: true })).toThrow();
  expect(() => parseIngestionRepairPlan({ ...plan, documents: [second] })).toThrow();
});
it("accepts exactly one hundred unique canonical documents", () => {
  const documents = Array.from({ length: 100 }, (_, i) => ({
    ...first,
    documentId: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
  }));
  expect(createIngestionRepairPlan(documents).documents).toHaveLength(100);
});
