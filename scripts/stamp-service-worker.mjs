#!/usr/bin/env node
/**
 * stamp-service-worker — give `public/sw.js` a different body on every deploy.
 *
 * A browser decides whether a service worker has changed by byte-comparing the script it
 * fetches against the one it installed. `CACHE_VERSION` in `public/sw.js` is a hand-edited
 * literal, so between releases the file is byte-identical — which means no `updatefound`, no
 * waiting worker, no `activate`, and therefore none of the events `pwa-lifecycle.tsx` builds
 * its "update available, reload" prompt from. An installed home-screen app can sit on the
 * version it first loaded indefinitely and is never told otherwise. That is the bug this
 * closes, and it is worth more than any single feature: it is the difference between shipping
 * a fix and the reader receiving it.
 *
 * Deliberately a no-op without a release identity. `RAILWAY_GIT_COMMIT_SHA` is set in the
 * Docker build (declared at `Dockerfile:54`) and absent locally, so `npm run build` on a
 * developer machine leaves the committed file untouched and cannot leave a dirty tree or
 * commit a machine-specific version string.
 *
 * The stamped value only ever appends: the hand-edited date stays legible in the cache name,
 * so an operator reading CacheStorage still sees which release line a cache belongs to.
 *
 * REPRODUCIBILITY: This process is intentionally non-deterministic — the stamped suffix
 * includes the commit SHA, which uniquely identifies a release. For supply-chain verification
 * or reproducible builds, note that two images built from the same commit will have identical
 * sw.js bytes, but different commits will always produce different cache versions. This is
 * by design: service worker updates are keyed on byte differences, so the non-determinism
 * *enables* update detection for end users, which is required for security.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceWorkerPath = path.join(repoRoot, "public", "sw.js");
const versionPattern = /^const CACHE_VERSION = "([^"]+)";$/m;

/** Short, filesystem-safe, and stable for a given release. */
export function releaseSuffix(commitSha) {
  const trimmed = String(commitSha ?? "").trim();
  if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) return null;
  return trimmed.slice(0, 12).toLowerCase();
}

export function stampServiceWorkerSource(source, commitSha) {
  const suffix = releaseSuffix(commitSha);
  if (!suffix) return { source, stamped: false, version: null };

  const match = source.match(versionPattern);
  if (!match) throw new Error("public/sw.js no longer declares a single CACHE_VERSION literal.");

  // Idempotent: re-running against an already stamped file replaces the suffix rather than
  // appending a second one, so a rebuilt layer cannot grow the version without bound.
  const base = match[1].replace(/-build-[0-9a-f]{7,40}$/i, "");
  const version = `${base}-build-${suffix}`;
  return {
    source: source.replace(versionPattern, `const CACHE_VERSION = "${version}";`),
    stamped: true,
    version,
  };
}

function main() {
  const original = readFileSync(serviceWorkerPath, "utf8");
  const result = stampServiceWorkerSource(original, process.env.RAILWAY_GIT_COMMIT_SHA);
  if (!result.stamped) {
    console.log("[stamp-service-worker] no release SHA; leaving public/sw.js unchanged.");
    return;
  }
  if (result.source !== original) writeFileSync(serviceWorkerPath, result.source);
  console.log(`[stamp-service-worker] CACHE_VERSION = ${result.version}`);
}

if (isDirectEntrypoint(import.meta.url)) main();
