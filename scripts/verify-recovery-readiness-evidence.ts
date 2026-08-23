import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertRecoveryReadinessForOperation,
  parseRecoveryReadinessEvidence,
  type RecoveryOperation,
} from "../src/lib/recovery-readiness-evidence";

type VerifyRecoveryReadinessDependencies = {
  readText?: (path: string) => Promise<string>;
  stdout?: (line: string) => void;
  now?: Date;
};

function parseArguments(argv: readonly string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--") || values.has(flag)) {
      throw new Error("Recovery readiness verifier arguments are invalid.");
    }
    values.set(flag, value);
  }
  const allowed = new Set(["--input", "--operation", "--project-ref", "--digest"]);
  if ([...values.keys()].some((flag) => !allowed.has(flag))) {
    throw new Error("Recovery readiness verifier arguments are invalid.");
  }
  const input = values.get("--input");
  const operation = values.get("--operation");
  const projectRef = values.get("--project-ref");
  const digest = values.get("--digest");
  if (!input || !projectRef || !digest || (operation !== "site-release" && operation !== "document-generation")) {
    throw new Error("Recovery readiness verifier requires input, operation, project identity, and digest.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Recovery readiness digest is invalid.");
  return { input, operation: operation as RecoveryOperation, projectRef, digest };
}

export async function runVerifyRecoveryReadinessEvidenceCli(
  argv: readonly string[],
  dependencies: VerifyRecoveryReadinessDependencies = {},
) {
  const args = parseArguments(argv);
  const readText = dependencies.readText ?? ((path: string) => readFile(path, "utf8"));
  const stdout = dependencies.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  let evidence;
  try {
    evidence = parseRecoveryReadinessEvidence(JSON.parse(await readText(resolve(args.input))));
  } catch {
    throw new Error("Recovery readiness evidence is invalid and contains no usable provider output.");
  }
  if (evidence.digest !== args.digest) throw new Error("Recovery readiness evidence digest mismatch.");
  assertRecoveryReadinessForOperation(evidence, args.operation, args.projectRef, dependencies.now);
  const result = {
    status: "valid" as const,
    version: evidence.version,
    evidenceId: evidence.evidenceId,
    projectRef: evidence.projectRef,
    operation: evidence.operation,
    digest: evidence.digest,
  };
  stdout(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runVerifyRecoveryReadinessEvidenceCli(process.argv.slice(2)).catch(() => {
    process.stderr.write('{"status":"invalid","code":"RECOVERY_READINESS_INVALID"}\n');
    process.exitCode = 1;
  });
}
