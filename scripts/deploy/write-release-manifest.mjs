#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DEFAULT_OUTPUT_PATH = join(REPO_ROOT, "deploy", "release-identity.json");
const SHA_RE = /^[0-9a-f]{40}$/i;

function normalizeCommitSha(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return SHA_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

function readGitHeadCommitSha(cwd = REPO_ROOT) {
  try {
    const stdout = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return normalizeCommitSha(stdout);
  } catch {
    return null;
  }
}

export function resolveReleaseManifestIdentity(env = process.env, options = {}) {
  const envCommitCandidate =
    env.RAILWAY_GIT_COMMIT_SHA ||
    env.GITHUB_SHA ||
    env.SOURCE_COMMIT_SHA ||
    env.COMMIT_SHA ||
    env.VERCEL_GIT_COMMIT_SHA ||
    "";
  const commitSha =
    normalizeCommitSha(envCommitCandidate) ??
    (options.resolveGitHead === false ? null : readGitHeadCommitSha(options.cwd ?? REPO_ROOT));

  const explicitRelease = (env.SENTRY_RELEASE || env.NEXT_PUBLIC_SENTRY_RELEASE || "").trim();
  const sentryRelease = explicitRelease || commitSha || "dev";

  return {
    commitSha,
    sentryRelease,
  };
}

export function writeReleaseManifest(outputPath = DEFAULT_OUTPUT_PATH, env = process.env, options = {}) {
  const payload = resolveReleaseManifestIdentity(env, options);
  mkdirSync(dirname(outputPath), { recursive: true });
  // Write to a temporary file beside the target, then rename, so a crash or a concurrent reader
  // never sees a partial manifest.
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, outputPath);
  return payload;
}

function isDirectEntrypoint(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(metaUrl) === entry;
  } catch {
    return false;
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  const payload = writeReleaseManifest();
  console.log(
    `[write-release-manifest] Wrote commitSha=${payload.commitSha ?? "null"} sentryRelease=${payload.sentryRelease} to ${DEFAULT_OUTPUT_PATH}`,
  );
}
