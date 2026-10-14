import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { bytesDigest, generationEvidenceBytes } from "../src/lib/ingestion-generation-evidence";
import {
  completeManagedPrivateFixture,
  completeManagedPrivateFixtureAttempt,
  buildFixedPrivateFixtureSourceRoles,
  fixedPrivateFixtureLiteralEvidence,
  decodeManagedPrivateTerminalReadback,
  prepareManagedPrivateTerminalPacket,
  type ManagedPrivateTerminalPacket,
} from "../worker/managed-private-terminal";
import type { ManagedPreparedSupplierInput } from "../worker/managed-prepared-supplier";
vi.mock("../src/lib/openai", () => {
  throw new Error("provider import forbidden");
});
vi.mock("../src/lib/supabase/admin", () => {
  throw new Error("database import forbidden");
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (n: string) => `sha256:${n.repeat(64)}`;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
function fixture() {
  const identity = {
    documentId: id(1),
    generationId: id(2),
    jobId: id(3),
    workerId: "private-worker",
    firstLeaseToken: id(4),
    attemptNumber: 1,
    batchId: null,
    authorityDigest: digest("a"),
    predecessorGenerationId: null,
    ownerId: id(5),
    sourceSha256: digest("b"),
    sourceByteLength: 3300,
    sourceExpectationDigest: digest("c"),
  };
  const packet = prepareManagedPrivateTerminalPacket({
    identity,
    planDigest: digest("d"),
    nativePopulationDigest: digest("e"),
  });
  const fence = {
    job_kind: "node" as const,
    job_id: identity.jobId,
    document_id: identity.documentId,
    worker_id: identity.workerId,
    lease_token: identity.firstLeaseToken,
    expected_generation_id: null,
    authority_digest: identity.authorityDigest,
  };
  const response = (p: ManagedPrivateTerminalPacket = packet, replay = "already_completed") => {
    const bytes = generationEvidenceBytes({
      version: "managed-native-private-seal-v1",
      scope: "fixed_invented_fixture_only",
      qualification: "checked_private_fixture_mapping",
      activated: false,
      packet: p,
      privatePreseal: {
        version: "managed-native-private-preseal-v1",
        status: "checked_private_fixture_mapping",
        identity: p.identity,
        nativePopulationDigest: p.nativePopulationDigest,
      },
      fixtureMapping: {
        version: "managed-native-private-fixture-mapping-v1",
        oracleId: p.oracleId,
        catalogueSha256: digest("f"),
        sourceObligationIds: ["E-Q01", "E-Q02", "E-Q03", "E-Q04", "E-Q05", "E-Q06", "E-Q07", "E-Q08"],
        sourceQualification: "fixed_invented_source_association_only",
        generalTechnicalEligibility: "unavailable",
      },
      sourceEvidenceIds: [],
      generalTechnicalEligibility: "unavailable",
    });
    return {
      ok: true,
      managedPrivateTerminal: {
        version: "managed-native-private-terminal-readback-v1",
        status: "private_fixture_completed",
        replay,
        activated: false,
        identity: clone(p.identity),
        sealDigest: bytesDigest(bytes),
        seal: { bytesHex: bytes.toString("hex"), sha256: bytesDigest(bytes), byteLength: bytes.length },
      },
    };
  };
  return { packet, fence, response };
}
describe("private fixture terminal caller", () => {
  it("binds all eight full original obligations and refuses partial qualifiers or missing page-three tail", () => {
    const pages = [
      {
        pageNumber: 1,
        text: "This specimen applies only to fictional QA scenario Q-17.\nUse SYNTH-DRUG-Q by the fictional oral route at 20:00 in this QA specimen only.\nAccept the synthetic measurement only when 3.2 mmol/L <= x < 4.1 mmol/L.\nRepeat the fictional observation after 15 min; record the result\nat 30 min. Stop this QA sequence if the result is unavailable.",
      },
      {
        pageNumber: 2,
        text: "| Q-A | 0.5 mg/mL | 2 mg | 4 mL | 24 h |\n| Q-B | 0.5 mg/mL | 3.5 mg | 7 mL | 48 h |\nRows A and B are alternative QA scenarios. Do not combine them.\nNo conversion to a real medicine is supported.",
      },
      {
        pageNumber: 3,
        text: "END-QA-731: the final requirement is to record the specimen lot QA-L9\nand the missing-result reason. This does not establish suitability\nfor clinical use.",
      },
    ];
    const observations = fixedPrivateFixtureLiteralEvidence(pages);
    expect(observations.map((o) => o.sourceEvidenceId)).toEqual([
      "E-Q01",
      "E-Q02",
      "E-Q03",
      "E-Q04",
      "E-Q05",
      "E-Q06",
      "E-Q07",
      "E-Q08",
    ]);
    expect(observations[4].bytes.toString("utf8")).toContain("No conversion to a real medicine is supported.");
    for (const [page, missing, expected] of [
      [2, "No conversion to a real medicine is supported.", "E-Q05"],
      [3, "for clinical use.", "E-Q08"],
      [1, "This specimen applies only to fictional QA scenario Q-17.", "E-Q01"],
    ] as const) {
      expect(() =>
        fixedPrivateFixtureLiteralEvidence(
          pages.map((p) => ({ ...p, text: p.pageNumber === page ? p.text.replace(missing, "") : p.text })),
        ),
      ).toThrow(`source_obligation_${expected}`);
    }
  });
  it("supplies no fixed source roles to another original", () => {
    expect(
      buildFixedPrivateFixtureSourceRoles({
        originalBytes: Buffer.from("a different source"),
      } as ManagedPreparedSupplierInput),
    ).toBeUndefined();
  });
  it("drains prior processing work, stops periodic heartbeat and revokes queued dispatches after terminal read", async () => {
    const f = fixture();
    const attempt = new IngestionAttempt(f.fence);
    const events: string[] = [];
    const prior = attempt.serialize(async () => {
      events.push("prior_processing");
    });
    const terminal = completeManagedPrivateFixtureAttempt({
      attempt,
      packet: f.packet,
      stopHeartbeat: () => events.push("stop_heartbeat"),
      rpc: async (name) => {
        events.push(name);
        return {
          data: f.response(f.packet, name === "write_ingestion_base_artifacts" ? "completed" : "already_completed"),
          error: null,
        };
      },
    });
    const queuedHeartbeat = attempt.serialize(async () => {
      events.push("forbidden_heartbeat");
    });
    await prior;
    await terminal;
    await expect(queuedHeartbeat).rejects.toThrow("lease_lost");
    expect(events).toEqual([
      "stop_heartbeat",
      "prior_processing",
      "write_ingestion_base_artifacts",
      "read_ingestion_prepared_supplier_artifacts",
    ]);
    expect(attempt.signal.aborted).toBe(true);
  });
  it("wires only the exact source private native path to terminal return before ordinary completion or cache mutation", () => {
    const main = readFileSync("worker/main.ts", "utf8");
    const start = main.indexOf("const nativeReadback = await stageManagedNativeParentClosure");
    const end = main.indexOf("// Prepared bodies and private candidate rows", start);
    const hook = main.slice(start, end);
    expect(hook).toContain("nativeReadback.identity.sourceSha256 === PRIVATE_FIXTURE_SOURCE_SHA256");
    expect(hook).toContain("nativeReadback.identity.sourceByteLength === 3300");
    expect(hook).toContain("nativePopulationDigest: nativeReadback.sqlPopulationDigest");
    expect(hook).toContain("stopHeartbeat: () => clearInterval(heartbeat)");
    expect(hook).toMatch(/await completeManagedPrivateFixtureAttempt\([\s\S]*?\);\s*return;/);
    expect(hook).not.toMatch(/completeJob\(|invalidateRagCaches|refreshRagTableStats/);
    expect(main.slice(end, end + 560)).toContain("technical_supplier_not_implemented");
  });
  it("uses a single tagged write and terminal read after the processing lease ends", async () => {
    const f = fixture();
    let completed = false;
    const check = vi.fn(() => {
      if (completed) throw new Error("processing lease ended");
    });
    const writeRpc = vi.fn(async () => {
      completed = true;
      return f.response(f.packet, "completed");
    });
    const readRpc = vi.fn(async () => f.response());
    const out = await completeManagedPrivateFixture({ ...f, writeRpc, readRpc, check });
    expect(out.status).toBe("private_fixture_completed");
    expect(out.activated).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
    expect(writeRpc).toHaveBeenCalledTimes(1);
    expect(writeRpc.mock.calls[0]).toEqual([
      "write_ingestion_base_artifacts",
      {
        p_fence: f.fence,
        p_generation: f.packet.identity.generationId,
        p_chunks: f.packet,
        p_images: [],
        p_table_facts: [],
        p_embedding_fields: [],
        p_index_units: [],
      },
    ]);
    expect(readRpc.mock.calls[0]).toEqual([
      "read_ingestion_prepared_supplier_artifacts",
      {
        p_generation: f.packet.identity.generationId,
        p_fence: { version: "managed-native-private-terminal-read-v1", fence: f.fence, packet: f.packet },
      },
    ]);
  });
  it("resolves a lost response through one immutable completed read without retrying the write", async () => {
    const f = fixture();
    const writeRpc = vi.fn(async () => {
      throw new Error("response lost after commit");
    });
    const readRpc = vi.fn(async () => f.response());
    expect((await completeManagedPrivateFixture({ ...f, writeRpc, readRpc, check: vi.fn() })).replay).toBe(
      "already_completed",
    );
    expect(writeRpc).toHaveBeenCalledTimes(1);
    expect(readRpc).toHaveBeenCalledTimes(1);
  });
  it("does not reinterpret malformed positive write data as a lost response", async () => {
    const f = fixture();
    const bad = f.response();
    bad.managedPrivateTerminal.activated = true;
    const readRpc = vi.fn(async () => f.response());
    await expect(
      completeManagedPrivateFixture({ ...f, writeRpc: async () => bad, readRpc, check: vi.fn() }),
    ).rejects.toThrow();
    expect(readRpc).not.toHaveBeenCalled();
  });
  it("refuses pending, general eligibility, fabricated source credits and corrupt seals", () => {
    const f = fixture();
    for (const change of [
      (r: ReturnType<typeof f.response>) => {
        r.managedPrivateTerminal.status = "pending";
      },
      (r: ReturnType<typeof f.response>) => {
        r.managedPrivateTerminal.seal.byteLength++;
      },
      (r: ReturnType<typeof f.response>) => {
        r.managedPrivateTerminal.sealDigest = digest("f");
      },
    ]) {
      const bad = f.response();
      change(bad);
      expect(() => decodeManagedPrivateTerminalReadback({ packet: f.packet, response: bad })).toThrow();
    }
    const raw = JSON.parse(Buffer.from(f.response().managedPrivateTerminal.seal.bytesHex, "hex").toString("utf8"));
    for (const patch of [{ sourceEvidenceIds: ["invented-credit"] }, { generalTechnicalEligibility: "eligible" }]) {
      const bytes = generationEvidenceBytes({ ...raw, ...patch });
      const bad = f.response();
      bad.managedPrivateTerminal.seal = {
        bytesHex: bytes.toString("hex"),
        sha256: bytesDigest(bytes),
        byteLength: bytes.length,
      };
      bad.managedPrivateTerminal.sealDigest = bytesDigest(bytes);
      expect(() => decodeManagedPrivateTerminalReadback({ packet: f.packet, response: bad })).toThrow();
    }
  });
  it("refuses source, owner, attempt, generation and plan drift even with a valid alternative seal", () => {
    const f = fixture();
    for (const patch of [
      { ownerId: id(9) },
      { sourceSha256: digest("f") },
      { attemptNumber: 2 },
      { generationId: id(9) },
      { authorityDigest: digest("f") },
    ]) {
      const changed = { ...clone(f.packet), identity: { ...f.packet.identity, ...patch } };
      expect(() => decodeManagedPrivateTerminalReadback({ packet: f.packet, response: f.response(changed) })).toThrow(
        "identity_mismatch",
      );
    }
    expect(() =>
      decodeManagedPrivateTerminalReadback({
        packet: f.packet,
        response: f.response({ ...f.packet, planDigest: digest("f") }),
      }),
    ).toThrow("identity_mismatch");
  });
  it("refuses a fence mismatch before any request and requires completed read proof after lost response", async () => {
    const f = fixture();
    const writeRpc = vi.fn(async () => f.response());
    const readRpc = vi.fn(async () => ({ ok: false, reason: "lease_lost" }));
    await expect(
      completeManagedPrivateFixture({
        ...f,
        fence: { ...f.fence, lease_token: id(9) },
        writeRpc,
        readRpc,
        check: vi.fn(),
      }),
    ).rejects.toThrow("fence_mismatch");
    expect(writeRpc).not.toHaveBeenCalled();
    await expect(
      completeManagedPrivateFixture({
        ...f,
        writeRpc: async () => {
          throw new Error("lost");
        },
        readRpc,
        check: vi.fn(),
      }),
    ).rejects.toThrow();
  });
});
