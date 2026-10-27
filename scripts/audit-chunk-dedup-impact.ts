/**
 * Offline comparison of explicitly supplied PUBLIC/SYNTHETIC pre-dedup candidates.
 * Does not fetch/parse originals, query a corpus, or infer impact from producer versions.
 * Section hashes must hash the runtime's sectionPath.join(" > "); page/span fields
 * must be captured at its dedup boundary. This tool cannot independently prove that capture.
 *
 * node scripts/run-tsx.mjs scripts/audit-chunk-dedup-impact.ts --input candidates.json [--output new-report.json]
 * Default stdout/file output contains only opaque identities, hashes, counts and fixed qualifications.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { assertNoIngestionCredentialShape, parseIngestionAuditIdentifier } from "../src/lib/ingestion-audit";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const MAX_BYTES = 1_048_576;
const MAX_CANDIDATES = 10_000;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INVALID = "chunk_dedup_impact_input_invalid";
type Scope =
  { pageNumber: number | null } | { sectionPathSha256: string; pageStart: number | null; pageEnd: number | null };
type Candidate = { candidateId: string; scope: Scope; content: string };
type Evidence = {
  schemaVersion: 1;
  evidenceKind: "public_pre_dedup_candidates" | "synthetic_pre_dedup_candidates";
  sourceId: string;
  generationId: string;
  sourceSha256: string;
  scopeMode: "page" | "document";
  candidates: Candidate[];
};

function invalid(): never {
  throw new Error(INVALID);
}
function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) invalid();
  return record;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) invalid();
  return value;
}
function page(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 100_000) invalid();
  return value;
}
function identity(value: unknown, kind: "document" | "generation"): string {
  const id = parseIngestionAuditIdentifier(value, kind, "Opaque target identifier");
  // UUIDs avoid accidentally reporting names/titles passed as ordinary ASCII slugs.
  if (!UUID.test(id)) invalid();
  return id;
}

function parseEvidence(value: unknown): Evidence {
  try {
    const root = object(value, [
      "schemaVersion",
      "evidenceKind",
      "sourceId",
      "generationId",
      "sourceSha256",
      "scopeMode",
      "candidates",
    ]);
    if (
      root.schemaVersion !== 1 ||
      !["public_pre_dedup_candidates", "synthetic_pre_dedup_candidates"].includes(String(root.evidenceKind))
    )
      invalid();
    if (root.scopeMode !== "page" && root.scopeMode !== "document") invalid();
    const sourceId = identity(root.sourceId, "document");
    const generationId = identity(root.generationId, "generation");
    const sourceSha256 = digest(root.sourceSha256);
    if (!Array.isArray(root.candidates) || root.candidates.length > MAX_CANDIDATES) invalid();
    const ids = new Set<string>();
    // Validate ALL descriptors before touching any body, even when an earlier row is valid.
    const descriptors = root.candidates.map((value) => {
      const candidate = object(value, ["candidateId", "scope", "content"]);
      const candidateId = parseIngestionAuditIdentifier(candidate.candidateId, "case", "Opaque candidate identifier");
      if (!/^candidate-(?:0|[1-9][0-9]{0,8})$/.test(candidateId) || ids.has(candidateId)) invalid();
      ids.add(candidateId);
      let scope: Scope;
      if (root.scopeMode === "page") {
        const raw = object(candidate.scope, ["pageNumber"]);
        scope = { pageNumber: page(raw.pageNumber) };
      } else {
        const raw = object(candidate.scope, ["sectionPathSha256", "pageStart", "pageEnd"]);
        const pageStart = page(raw.pageStart),
          pageEnd = page(raw.pageEnd);
        if (
          (pageStart === null) !== (pageEnd === null) ||
          (pageStart !== null && pageEnd !== null && pageEnd < pageStart)
        )
          invalid();
        scope = { sectionPathSha256: digest(raw.sectionPathSha256), pageStart, pageEnd };
      }
      return { candidateId, scope, candidate };
    });
    let bodyBytes = 0;
    const candidates = descriptors.map(({ candidateId, scope, candidate }) => {
      const content = candidate.content;
      if (typeof content !== "string" || !content.trim()) invalid();
      bodyBytes += Buffer.byteLength(content, "utf8");
      if (bodyBytes > MAX_BYTES) invalid();
      // A public/synthetic declaration is required, not automatic privacy certification.
      // Refuse recognizable credential shapes; neither failures nor reports echo the body.
      assertNoIngestionCredentialShape(content, "Candidate body");
      for (const word of content.split(/\s+/)) assertNoIngestionCredentialShape(word, "Candidate body");
      return { candidateId, scope, content };
    });
    return {
      schemaVersion: 1,
      evidenceKind: root.evidenceKind as Evidence["evidenceKind"],
      sourceId,
      generationId,
      sourceSha256,
      scopeMode: root.scopeMode,
      candidates,
    };
  } catch {
    invalid();
  }
}

/** Pinned legacy helper from src/lib/chunking.ts:130,443 at this exact audited source. */
function legacyFingerprint(content: string): string {
  // 60c342b497f985eb0eb6d527fa0223f8c664e68c: normalizeLookupText(text).replace(/\s+/g," ").trim()
  return content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:table|figure|appendix)\b/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .trim();
}
function currentFingerprint(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export function auditChunkDedupImpact(value: unknown) {
  const evidence = parseEvidence(value);
  type Group = {
    scopeSha256: string;
    legacyFingerprintSha256: string;
    candidateIds: string[];
    contentSha256: string[];
    currentFingerprintSha256: Set<string>;
  };
  const groups = new Map<string, Group>();
  const legacySeen = new Set<string>(),
    currentSeen = new Set<string>();
  let legacyRetained = 0,
    currentRetained = 0;
  for (const candidate of evidence.candidates) {
    const scopeSha256 = hash(JSON.stringify({ mode: evidence.scopeMode, ...candidate.scope }));
    const legacy = legacyFingerprint(candidate.content),
      current = currentFingerprint(candidate.content);
    const legacyKey = `${scopeSha256}:${hash(legacy)}`,
      currentKey = `${scopeSha256}:${hash(current)}`;
    // Empty legacy keys were never inserted into the runtime's seen map and retain every row.
    if (!legacy || !legacySeen.has(legacyKey)) legacyRetained += 1;
    if (legacy) legacySeen.add(legacyKey);
    if (!current || !currentSeen.has(currentKey)) currentRetained += 1;
    if (current) currentSeen.add(currentKey);
    if (!legacy) continue;
    const group = groups.get(legacyKey) ?? {
      scopeSha256,
      legacyFingerprintSha256: hash(legacy),
      candidateIds: [],
      contentSha256: [],
      currentFingerprintSha256: new Set<string>(),
    };
    group.candidateIds.push(candidate.candidateId);
    group.contentSha256.push(hash(candidate.content));
    group.currentFingerprintSha256.add(hash(current));
    groups.set(legacyKey, group);
  }
  const collisions = [...groups.values()]
    .filter((group) => group.currentFingerprintSha256.size > 1)
    .map((group) => ({
      scopeSha256: group.scopeSha256,
      legacyFingerprintSha256: group.legacyFingerprintSha256,
      candidateIds: group.candidateIds,
      contentSha256: group.contentSha256,
      currentFingerprintSha256: [...group.currentFingerprintSha256],
      candidates: group.candidateIds.length,
      legacyRetained: 1,
      currentRetained: group.currentFingerprintSha256.size,
    }));
  return {
    schemaVersion: 1,
    evidenceKind: evidence.evidenceKind,
    evidenceLimit: "supplied_pre_dedup_candidates_only_not_corpus_prevalence_completeness_or_provider_proof",
    legacySourceCommit: "60c342b497f985eb0eb6d527fa0223f8c664e68c",
    currentFingerprintVersion: "1.3.4",
    sourceId: evidence.sourceId,
    generationId: evidence.generationId,
    sourceSha256: evidence.sourceSha256,
    candidatePopulationSha256: hash(JSON.stringify(evidence)),
    counts: {
      candidates: evidence.candidates.length,
      legacyRetained,
      currentRetained,
      collisionGroups: collisions.length,
      distinctCandidatesLostByLegacy: collisions.reduce(
        (sum, group) => sum + group.currentRetained - group.legacyRetained,
        0,
      ),
    },
    collisions,
  };
}

async function readEvidence(filePath: string): Promise<unknown> {
  try {
    const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) invalid();
      const bytes = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset !== stat.size) invalid();
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset));
      return JSON.parse(source) as unknown;
    } finally {
      await handle.close();
    }
  } catch {
    invalid();
  }
}

export async function runOfflineChunkDedupImpactAudit(argv: string[]) {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]!,
      value = argv[index + 1];
    if (!["--input", "--output"].includes(flag) || args.has(flag) || !value || value.startsWith("--"))
      throw new Error("chunk_dedup_impact_arguments_invalid");
    args.set(flag, value);
  }
  const inputPath = args.get("--input");
  if (!inputPath) throw new Error("chunk_dedup_impact_arguments_invalid");
  const report = auditChunkDedupImpact(await readEvidence(inputPath));
  const outputPath = args.get("--output");
  if (outputPath) {
    try {
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch {
      throw new Error("chunk_dedup_impact_output_refused");
    }
  }
  return report;
}

if (isDirectEntrypoint(import.meta.url)) {
  runOfflineChunkDedupImpactAudit(process.argv.slice(2))
    .then((report) => {
      if (!process.argv.slice(2).includes("--output")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error &&
          [INVALID, "chunk_dedup_impact_arguments_invalid", "chunk_dedup_impact_output_refused"].includes(error.message)
          ? error.message
          : INVALID,
      );
      process.exitCode = 1;
    });
}
