import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";

import {
  assertRecoveryReadinessForOperation,
  parseActivationReceipt,
  parseRecoveryReadinessEvidence,
  type RecoveryOperation,
} from "../src/lib/recovery-readiness-evidence";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const MAX_ARTIFACT_BYTES = 65_536;
const MAX_OPERATION_MANIFEST_VALIDITY_SECONDS = 86_400;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PROJECT_REF_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;

type BoundedUtf8File = Readonly<{ bytes: Buffer; text: string }>;

type CliDependencies = {
  readFile?: (path: string) => string | Uint8Array;
  cwd?: () => string;
  now?: () => Date;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
};

const canonicalTimestampSchema = z.string().refine(
  (value) => {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
  },
  { message: "Timestamp must be a canonical ISO-8601 UTC value." },
);

function safeRelativeManifestPath(value: string): boolean {
  if (value.length < 1 || value.length > 500 || value.trim() !== value || isAbsolute(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const parts = value.split(/[\\/]/);
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

const manifestPathSchema = z.string().refine(safeRelativeManifestPath, {
  message: "Manifest paths must be bounded safe relative paths.",
});

const reindexOperationManifestSchema = z
  .object({
    version: z.literal(1),
    operation: z.enum(["stage", "evaluate", "promote", "rollback"]),
    targetProjectRef: z.string().regex(PROJECT_REF_PATTERN),
    planPath: manifestPathSchema,
    reportOrReceiptPath: manifestPathSchema.nullable(),
    recoveryEvidencePath: manifestPathSchema,
    recoveryEvidenceSha256: z.string().regex(SHA256_PATTERN),
    expectedDocumentCount: z.number().int().positive().max(10_000),
    confirmationSha256: z.string().regex(SHA256_PATTERN),
    authorizedAt: canonicalTimestampSchema,
    expiresAt: canonicalTimestampSchema,
  })
  .strict();

export type ReindexOperationManifestV1 = z.infer<typeof reindexOperationManifestSchema>;

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Artifact is not valid UTF-8.");
  }
}

export function readBoundedUtf8File(path: string): BoundedUtf8File {
  const descriptor = openSync(path, "r");
  const allocation = Buffer.allocUnsafe(MAX_ARTIFACT_BYTES + 1);
  let bytesRead = 0;
  try {
    while (bytesRead < allocation.length) {
      const count = readSync(descriptor, allocation, bytesRead, allocation.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
  } finally {
    closeSync(descriptor);
  }
  if (bytesRead > MAX_ARTIFACT_BYTES) throw new Error("Artifact is too large.");
  const bytes = Buffer.from(allocation.subarray(0, bytesRead));
  return { bytes, text: decodeUtf8(bytes) };
}

function readArtifact(path: string, dependencies: CliDependencies): BoundedUtf8File {
  if (!dependencies.readFile) return readBoundedUtf8File(path);
  const input = dependencies.readFile(path);
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error("Artifact is too large.");
  return { bytes, text: decodeUtf8(bytes) };
}

type DirectArgs = {
  mode: "direct";
  file: string;
  operation: RecoveryOperation;
  projectRef: string;
};

type ManifestArgs = { mode: "operation_manifest"; operationManifestPath: string };

function requiredArgumentValue(argv: readonly string[], index: number): string {
  const value = argv[index];
  if (!value || value.startsWith("--") || value.length > 1_000 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Recovery readiness verifier argument is missing or unsafe.");
  }
  return value;
}

function parseArgs(argv: readonly string[]): DirectArgs | ManifestArgs {
  if (argv[0] === "--operation-manifest") {
    if (argv.length !== 2) throw new Error("--operation-manifest is mutually exclusive with direct mode.");
    return { mode: "operation_manifest", operationManifestPath: requiredArgumentValue(argv, 1) };
  }

  let file: string | undefined;
  let operation: RecoveryOperation | undefined;
  let projectRef: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    if (!token || seen.has(token)) throw new Error("Recovery readiness verifier arguments must be unique.");
    seen.add(token);
    const value = requiredArgumentValue(argv, index + 1);
    if (token === "--file") file = value;
    else if (token === "--operation") {
      if (value !== "site_release" && value !== "document_generation") {
        throw new Error("--operation must be site_release or document_generation.");
      }
      operation = value;
    } else if (token === "--project-ref") projectRef = value;
    else throw new Error("Unsupported recovery readiness verifier argument.");
  }
  if (argv.length !== 6 || !file || !operation || !projectRef) {
    throw new Error("--file, --operation, and --project-ref are required in direct mode.");
  }
  return { mode: "direct", file, operation, projectRef };
}

function parseOperationManifest(input: unknown, now: Date): ReindexOperationManifestV1 {
  const parsed = reindexOperationManifestSchema.safeParse(input);
  if (!parsed.success) throw new Error("Operation manifest has a missing, extra, or invalid shape.");
  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) throw new Error("Operation manifest evaluation clock is invalid.");
  const authorizedAt = Date.parse(parsed.data.authorizedAt);
  const expiresAt = Date.parse(parsed.data.expiresAt);
  if (authorizedAt > nowMilliseconds) throw new Error("Operation manifest authorization is in the future.");
  if (expiresAt <= nowMilliseconds) throw new Error("Operation manifest is expired.");
  if (expiresAt <= authorizedAt || expiresAt - authorizedAt > MAX_OPERATION_MANIFEST_VALIDITY_SECONDS * 1_000) {
    throw new Error("Operation manifest validity window is invalid.");
  }
  if (parsed.data.operation === "rollback" && parsed.data.reportOrReceiptPath === null) {
    throw new Error("Rollback operation manifest requires a promotion receipt path.");
  }
  return parsed.data;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation.length > 0 && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

function resolveExistingReferencedPath(root: string, manifestPath: string): string {
  if (!safeRelativeManifestPath(manifestPath)) throw new Error("Operation manifest contains an unsafe path.");
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, manifestPath);
  if (!pathIsWithin(resolvedRoot, candidate)) throw new Error("Operation manifest path escapes its root.");
  const canonicalRoot = realpathSync.native(resolvedRoot);
  const canonicalCandidate = realpathSync.native(candidate);
  if (!pathIsWithin(canonicalRoot, canonicalCandidate)) throw new Error("Operation manifest path escapes its root.");
  return canonicalCandidate;
}

function exactBytesSha256(file: BoundedUtf8File): string {
  return createHash("sha256").update(file.bytes).digest("hex");
}

function assertManifestRecoveryBinding(
  manifest: ReindexOperationManifestV1,
  evidenceFile: BoundedUtf8File,
  dependencies: CliDependencies,
  evaluationTime: Date,
) {
  if (exactBytesSha256(evidenceFile) !== manifest.recoveryEvidenceSha256) {
    throw new Error("Recovery evidence file digest does not match the operation manifest.");
  }
  const evidence = parseRecoveryReadinessEvidence(JSON.parse(evidenceFile.text));
  if (evidence.projectRef !== manifest.targetProjectRef || evidence.operation !== "document_generation") {
    throw new Error("Recovery evidence does not match the operation manifest binding.");
  }
  if (manifest.operation !== "rollback") {
    assertRecoveryReadinessForOperation(evidence, "document_generation", manifest.targetProjectRef, {
      now: () => evaluationTime,
    });
    return evidence;
  }

  const root = dependencies.cwd?.() ?? process.cwd();
  const receiptPath = resolveExistingReferencedPath(root, manifest.reportOrReceiptPath!);
  const receiptFile = readArtifact(receiptPath, dependencies);
  if (exactBytesSha256(receiptFile) !== manifest.confirmationSha256) {
    throw new Error("Promotion receipt file digest does not match the rollback operation manifest.");
  }
  const activation = parseActivationReceipt(JSON.parse(receiptFile.text), { now: () => evaluationTime });
  if (
    activation.projectRef !== manifest.targetProjectRef ||
    activation.operation !== "document_generation" ||
    activation.recoveryReadinessDigest !== evidence.digest
  ) {
    throw new Error("Promotion receipt does not bind the rollback recovery evidence.");
  }
  return evidence;
}

function safeSummary(
  evidence: ReturnType<typeof parseRecoveryReadinessEvidence>,
  manifestOperation?: ReindexOperationManifestV1["operation"],
) {
  return JSON.stringify({
    status: "pass",
    version: evidence.version,
    operation: evidence.operation,
    ...(manifestOperation ? { manifestOperation } : {}),
    projectRefDigest: createHash("sha256").update(evidence.projectRef, "utf8").digest("hex"),
    evidenceDigest: evidence.digest,
    validUntil: evidence.validUntil,
  });
}

export function runRecoveryReadinessEvidenceCli(argv: readonly string[], dependencies: CliDependencies = {}): number {
  const stdout = dependencies.stdout ?? ((line: string) => console.log(line));
  const stderr = dependencies.stderr ?? ((line: string) => console.error(line));
  const now = dependencies.now ?? (() => new Date());
  try {
    const args = parseArgs(argv);
    if (args.mode === "direct") {
      const artifact = readArtifact(args.file, dependencies);
      const evidence = parseRecoveryReadinessEvidence(JSON.parse(artifact.text));
      assertRecoveryReadinessForOperation(evidence, args.operation, args.projectRef, { now });
      stdout(safeSummary(evidence));
      return 0;
    }

    const evaluationTime = now();
    const manifestFile = readArtifact(args.operationManifestPath, dependencies);
    const manifest = parseOperationManifest(JSON.parse(manifestFile.text), evaluationTime);
    const root = dependencies.cwd?.() ?? process.cwd();
    const evidencePath = resolveExistingReferencedPath(root, manifest.recoveryEvidencePath);
    const evidenceFile = readArtifact(evidencePath, dependencies);
    const evidence = assertManifestRecoveryBinding(manifest, evidenceFile, dependencies, evaluationTime);
    stdout(safeSummary(evidence, manifest.operation));
    return 0;
  } catch {
    stderr("FAIL: recovery readiness evidence rejected.");
    return 1;
  }
}

const isDirectExecution = isDirectEntrypoint(import.meta.url);
if (isDirectExecution) process.exitCode = runRecoveryReadinessEvidenceCli(process.argv.slice(2));
