import { z } from "zod";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  issuedAttemptControlSchema,
} from "../src/lib/ingestion-generation-evidence";
import {
  parseIngestionFence,
  type IngestionAttempt,
  type IngestionFence,
} from "../supabase/functions/_shared/ingestion-attempt";
import { committedJson } from "./managed-vector-final";
import { prepareManagedPrivateSupplier, type ManagedPreparedSupplierInput } from "./managed-prepared-supplier";
import type { WholeOriginalRoleRequirements } from "./whole-original-supplier";

/** This identifies one server-owned fixture oracle, never a general completeness policy. */
export const PRIVATE_FIXTURE_ORACLE = "fixed-invented-three-page-core-v1" as const;
export const PRIVATE_FIXTURE_SOURCE_SHA256 = "sha256:d9f1f578c8ac377425d4bcee2ce1e4ff2f651060de363c85a1c2e731a9c83b29";
const sha = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const identitySchema = issuedAttemptControlSchema
  .extend({
    ownerId: z.uuid(),
    sourceSha256: sha,
    sourceByteLength: z.number().int().positive().safe(),
    sourceExpectationDigest: sha,
  })
  .strict();
export type ManagedPrivateTerminalIdentity = z.infer<typeof identitySchema>;
const packetSchema = z
  .object({
    version: z.literal("managed-native-private-complete-v1"),
    oracleId: z.literal(PRIVATE_FIXTURE_ORACLE),
    identity: identitySchema,
    planDigest: sha,
    nativePopulationDigest: sha,
  })
  .strict();
export type ManagedPrivateTerminalPacket = z.infer<typeof packetSchema>;
const sealSchema = z
  .object({
    version: z.literal("managed-native-private-seal-v1"),
    scope: z.literal("fixed_invented_fixture_only"),
    qualification: z.literal("checked_private_fixture_mapping"),
    activated: z.literal(false),
    packet: packetSchema,
    privatePreseal: z
      .object({
        version: z.literal("managed-native-private-preseal-v1"),
        status: z.literal("checked_private_fixture_mapping"),
        identity: identitySchema,
        nativePopulationDigest: sha,
      })
      .strict(),
    fixtureMapping: z
      .object({
        version: z.literal("managed-native-private-fixture-mapping-v1"),
        oracleId: z.literal(PRIVATE_FIXTURE_ORACLE),
        catalogueSha256: sha,
        sourceObligationIds: z.tuple([
          z.literal("E-Q01"),
          z.literal("E-Q02"),
          z.literal("E-Q03"),
          z.literal("E-Q04"),
          z.literal("E-Q05"),
          z.literal("E-Q06"),
          z.literal("E-Q07"),
          z.literal("E-Q08"),
        ]),
        sourceQualification: z.literal("fixed_invented_source_association_only"),
        generalTechnicalEligibility: z.literal("unavailable"),
      })
      .strict(),
    sourceEvidenceIds: z.array(z.never()).length(0),
    generalTechnicalEligibility: z.literal("unavailable"),
  })
  .strict();
const responseSchema = z
  .object({
    ok: z.literal(true),
    managedPrivateTerminal: z
      .object({
        version: z.literal("managed-native-private-terminal-readback-v1"),
        status: z.literal("private_fixture_completed"),
        replay: z.enum(["completed", "already_completed"]),
        activated: z.literal(false),
        identity: identitySchema,
        sealDigest: sha,
        seal: z
          .object({
            bytesHex: z.string().regex(/^(?:[0-9a-f]{2})+$/),
            sha256: sha,
            byteLength: z.number().int().positive().max(32768),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
const copy = <T>(value: T): T => JSON.parse(generationEvidenceBytes(value).toString("utf8")) as T;
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
const refuse = (reason: string): never => {
  throw new Error(`managed_private_terminal_${reason}`);
};

const fixedObligations = [
  ["E-Q01", 1, "This specimen applies only to fictional QA scenario Q-17."],
  ["E-Q02", 1, "Use SYNTH-DRUG-Q by the fictional oral route at 20:00 in this QA specimen only."],
  ["E-Q03", 2, "| Q-A | 0.5 mg/mL | 2 mg | 4 mL | 24 h |"],
  ["E-Q04", 2, "| Q-B | 0.5 mg/mL | 3.5 mg | 7 mL | 48 h |"],
  [
    "E-Q05",
    2,
    "Rows A and B are alternative QA scenarios. Do not combine them. No conversion to a real medicine is supported.",
  ],
  ["E-Q06", 1, "Accept the synthetic measurement only when 3.2 mmol/L <= x < 4.1 mmol/L."],
  [
    "E-Q07",
    1,
    "Repeat the fictional observation after 15 min; record the result at 30 min. Stop this QA sequence if the result is unavailable.",
  ],
  [
    "E-Q08",
    3,
    "END-QA-731: the final requirement is to record the specimen lot QA-L9 and the missing-result reason. This does not establish suitability for clinical use.",
  ],
] as const;

/** Exact authored words/order, allowing only whitespace differences in retained paragraphs. */
export function fixedPrivateFixtureLiteralEvidence(pages: Array<{ pageNumber: number; text: string }>) {
  return fixedObligations.map(([sourceEvidenceId, page, literal]) => {
    const texts = pages.filter((p) => p.pageNumber === page);
    if (texts.length !== 1) return refuse("source_page_mismatch");
    const expression = literal
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const matches = [...texts[0].text.matchAll(new RegExp(expression, "g"))];
    if (matches.length !== 1) return refuse(`source_obligation_${sourceEvidenceId}`);
    const match = matches[0];
    return {
      sourceEvidenceId,
      page,
      bytes: Buffer.from(match[0], "utf8"),
      byteOffset: Buffer.byteLength(texts[0].text.slice(0, match.index), "utf8"),
    };
  });
}

/** Fixed-source declarations only; existing supplier attaches these as matched/unverified associations. */
export function buildFixedPrivateFixtureSourceRoles(
  input: ManagedPreparedSupplierInput,
): WholeOriginalRoleRequirements | undefined {
  if (input.originalBytes.length !== 3300 || bytesDigest(input.originalBytes) !== PRIVATE_FIXTURE_SOURCE_SHA256)
    return undefined;
  const observations = fixedPrivateFixtureLiteralEvidence(input.extracted.pages);
  const expectedPins = [
    "b20054b6b40e8a260368e1551b4e6d850ab1823875039d983b9e959b853a9fe9",
    "411b3e42d91ac08122c0a47187ac504bab25bdda6b7e4635bf5edbb737771262",
    "5765c7d240f69fd3f707dc786c26931134268e2d078b25c4e868e8cca04c6ced",
  ];
  if (
    input.extracted.pages.length !== 3 ||
    expectedPins.some(
      (h, i) =>
        bytesDigest(Buffer.from(input.extracted.pages.find((p) => p.pageNumber === i + 1)?.text ?? "")) !==
        `sha256:${h}`,
    )
  )
    return refuse("source_page_mismatch");
  const baseline = prepareManagedPrivateSupplier({ ...input, independentSourceRoles: undefined });
  const units = baseline.producerManifests.flatMap((m) => m.units);
  const one = (predicate: (unit: (typeof units)[number]) => boolean) => {
    const matches = units.filter(predicate);
    if (matches.length !== 1) return refuse("source_role_mismatch");
    return matches[0];
  };
  const chunk = (page: number) =>
    one((u) => u.declaration.id.family === "chunks" && (u.body as Record<string, unknown>).page_number === page);
  const pin = (u: (typeof units)[number]) => ({ sha256: u.artifact.sha256, byteLength: u.artifact.byteLength });
  const image = one(
    (u) => u.declaration.id.family === "images" && (u.body as Record<string, unknown>).source_kind === "table_crop",
  );
  const columns = ["Scenario", "Concentration", "Amount", "Volume", "Interval"];
  const cells = [
    ["Q-A", "0.5 mg/mL", "2 mg", "4 mL", "24 h"],
    ["Q-B", "0.5 mg/mL", "3.5 mg", "7 mL", "48 h"],
  ];
  return freezeGenerationEvidence({
    ...baseline.roleRequirements,
    requirements: observations.map((o) => ({
      sourceEvidenceId: o.sourceEvidenceId,
      role: "fixed invented source literal; matched unverified",
      evidence: [
        {
          unitId: { family: "private_objects" as const, key: `page:${o.page}:extracted` },
          byteOffset: o.byteOffset,
          bytesHex: o.bytes.toString("hex"),
        },
      ],
      candidateUnits: [chunk(o.page).declaration.id],
    })),
    tableRows: cells.map((rowCells, i) => {
      const fact = one(
        (u) =>
          u.declaration.id.family === "table_facts" &&
          (u.body as { metadata: { row_index: number } }).metadata.row_index === i + 1,
      );
      const row = one(
        (u) =>
          u.declaration.id.family === "index_units" &&
          (u.body as Record<string, unknown>).unit_type === "table_fact" &&
          (u.body as { metadata: { row_index: number } }).metadata.row_index === i + 1,
      );
      return {
        sourceEvidenceId: i ? "E-Q04" : "E-Q03",
        candidateUnitId: row.declaration.id,
        candidateArtifact: pin(row),
        tableFactUnitId: fact.declaration.id,
        tableFactArtifact: pin(fact),
        sourceChunkId: chunk(2).declaration.id.key,
        sourceChunkArtifact: pin(chunk(2)),
        sourceImageId: image.declaration.id.key,
        sourceImageArtifact: pin(image),
        ownerId: input.job.documents.owner_id!,
        pageNumber: 2,
        tableIndex: 1,
        rowIndex: i + 1,
        columns,
        cells: rowCells,
        qualifications: ["E-Q01", "E-Q05"].map((sourceEvidenceId) => {
          const o = observations.find((o) => o.sourceEvidenceId === sourceEvidenceId)!;
          const parent = chunk(o.page);
          const literal = o.bytes;
          const body = Buffer.from((parent.body as { content: string }).content, "utf8");
          const offset = body.indexOf(literal);
          if (offset < 0) return refuse(`source_obligation_${sourceEvidenceId}`);
          return {
            sourceEvidenceId,
            chunkId: parent.declaration.id.key,
            chunkArtifact: pin(parent),
            pageNumber: o.page,
            contentByteOffset: offset,
            bytesHex: literal.toString("hex"),
          };
        }),
      };
    }),
  });
}

/** Receives the already decoded native closure. SQL independently rechecks every retained body. */
export function prepareManagedPrivateTerminalPacket(args: {
  identity: ManagedPrivateTerminalIdentity;
  planDigest: string;
  nativePopulationDigest: string;
}): ManagedPrivateTerminalPacket {
  return freezeGenerationEvidence(
    packetSchema.parse({
      version: "managed-native-private-complete-v1",
      oracleId: PRIVATE_FIXTURE_ORACLE,
      identity: copy(args.identity),
      planDigest: args.planDigest,
      nativePopulationDigest: args.nativePopulationDigest,
    }),
  );
}

export function decodeManagedPrivateTerminalReadback(args: {
  packet: ManagedPrivateTerminalPacket;
  response: unknown;
}) {
  const packet = packetSchema.parse(copy(args.packet));
  if (generationEvidenceBytes(args.response).length > 65536) return refuse("transport_limit");
  const output = responseSchema.parse(copy(args.response)).managedPrivateTerminal;
  const committed = committedJson(output.seal);
  const seal = sealSchema.parse(committed.body);
  // PostgreSQL hashes its own jsonb::text bytes; do not substitute caller canonical JSON.
  if (output.sealDigest !== output.seal.sha256) return refuse("seal_mismatch");
  if (!same(output.identity, packet.identity) || !same(seal.packet, packet)) return refuse("identity_mismatch");
  if (
    !same(seal.privatePreseal.identity, packet.identity) ||
    seal.privatePreseal.nativePopulationDigest !== packet.nativePopulationDigest
  )
    return refuse("preseal_mismatch");
  return freezeGenerationEvidence(output);
}

/** One terminal write, followed by the completed-state read even when its response was lost.
 * No automatic write retry and no processing-only check after terminal mutation.
 */
export async function completeManagedPrivateFixture(args: {
  packet: ManagedPrivateTerminalPacket;
  fence: IngestionFence;
  writeRpc: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
  readRpc: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
  check: () => void;
}) {
  const packet = freezeGenerationEvidence(packetSchema.parse(copy(args.packet)));
  const fence = parseIngestionFence(copy(args.fence));
  const identity = packet.identity;
  if (
    !same(fence, {
      job_kind: "node",
      job_id: identity.jobId,
      document_id: identity.documentId,
      worker_id: identity.workerId,
      lease_token: identity.firstLeaseToken,
      expected_generation_id: identity.predecessorGenerationId,
      authority_digest: identity.authorityDigest,
    })
  )
    return refuse("fence_mismatch");
  args.check();
  let written: ReturnType<typeof decodeManagedPrivateTerminalReadback> | undefined;
  let writeResponse: unknown;
  let responseReceived = false;
  try {
    writeResponse = await args.writeRpc("write_ingestion_base_artifacts", {
      p_fence: copy(fence),
      p_generation: identity.generationId,
      p_chunks: copy(packet),
      p_images: [],
      p_table_facts: [],
      p_embedding_fields: [],
      p_index_units: [],
    });
    responseReceived = true;
  } catch {
    // An immutable completed-state read is the only permitted lost-response recovery.
  }
  if (responseReceived) written = decodeManagedPrivateTerminalReadback({ packet, response: writeResponse });
  // The lease may now be completed/released. This read uses its independent terminal authority path.
  const response = await args.readRpc("read_ingestion_prepared_supplier_artifacts", {
    p_generation: identity.generationId,
    p_fence: { version: "managed-native-private-terminal-read-v1", fence: copy(fence), packet: copy(packet) },
  });
  const read = decodeManagedPrivateTerminalReadback({ packet, response });
  if (written && (!same(written.identity, read.identity) || !same(written.seal, read.seal)))
    return refuse("replay_mismatch");
  return read;
}

/** Drain existing processing requests before crossing the terminal boundary. */
export function completeManagedPrivateFixtureAttempt(args: {
  attempt: IngestionAttempt;
  packet: ManagedPrivateTerminalPacket;
  stopHeartbeat: () => void;
  rpc: (
    name: string,
    payload: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}) {
  args.stopHeartbeat();
  return args.attempt.serialize(async () => {
    const fence = args.attempt.fence;
    const rawRpc = async (name: string, payload: Record<string, unknown>) => {
      const { data, error } = await args.rpc(name, payload);
      if (error) throw new Error(error.message);
      return data;
    };
    try {
      return await completeManagedPrivateFixture({
        packet: args.packet,
        fence,
        writeRpc: rawRpc,
        readRpc: rawRpc,
        check: () => args.attempt.check(),
      });
    } finally {
      // Pending processing dispatches must never run after terminal success or persistence uncertainty.
      args.attempt.cancel();
    }
  });
}
