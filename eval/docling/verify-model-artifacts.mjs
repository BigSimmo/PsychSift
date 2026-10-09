#!/usr/bin/env node
/**
 * Verify the docling model artifacts baked into an image against a recorded
 * digest manifest, and fail the build when they do not match.
 *
 * WHY THIS EXISTS
 *
 * `docling-tools models download` pulls model weights from HuggingFace with no
 * version argument of any kind — it has no `--revision` flag, so the remedy the
 * 2026-09-02 audit originally recorded for finding L49 cannot be implemented as
 * written. The Python client is hash-locked (the `docling==` pin in
 * eval/docling/requirements.txt), but the weights it fetches are whatever those
 * HuggingFace repositories hold on the day the image is built. A bad upstream
 * release would therefore change how clinical PDFs are read, silently, with no
 * commit in this repository and nothing in the build log to notice.
 *
 * This script closes that by recording what the download produced and refusing
 * a build that produces something else.
 *
 * WHAT IT CHECKS
 *
 * Every regular file under the models directory is hashed with SHA-256. The
 * per-file digests, keyed by path relative to that directory, are folded into a
 * single "tree digest" — the SHA-256 of the sorted `<sha256>  <path>` lines —
 * so one recorded string covers the whole artifact set, and a per-file map
 * makes any mismatch name the file that moved.
 *
 * THREE OUTCOMES
 *
 *   1. The manifest records a tree digest and the download matches it.
 *      Prints the digest and exits 0.
 *   2. The manifest records a tree digest and the download does NOT match it.
 *      Prints every added, removed and changed file and exits 1, failing the
 *      image build.
 *   3. The manifest records nothing yet (`treeDigest: null`). Prints the digest
 *      the download actually produced, together with the manifest block to
 *      paste, and exits 0 with a warning.
 *
 * Outcome 3 is deliberate and is the only state in which this does not fail
 * closed. The digest can only be learned by running the download, which needs
 * both Docker and HuggingFace egress; refusing to build until one is recorded
 * would mean the production worker image could never be built at all, including
 * the very build that would produce the digest. So the first build after this
 * lands prints the digest, an operator pastes it into the manifest, and from
 * that commit onwards the check is a hard gate. Until then it is an observation
 * — which is still strictly more than the build had before, because an upstream
 * change now shows up as a changed digest in the build log.
 *
 * An empty or missing models directory always fails, in every outcome: that is
 * a download that produced nothing, not an unpinned one.
 *
 * Usage (inside the image build, same RUN layer as the download):
 *   node verify-model-artifacts.mjs --models-dir /opt/docling-models \
 *                                   --manifest model-artifacts.json
 *
 * Node, not Python, because both images are `FROM node:24-bookworm-slim` and a
 * Node script is directly unit-testable by this repository's Vitest suite with
 * no interpreter to spawn (tests/docling-model-artifacts.test.ts).
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Prefix on every line this script prints, so build logs are greppable. */
const TAG = "[docling-models]";

/**
 * Contiguous 64-character hex digests trip GitGuardian's Generic High Entropy
 * Secret detector (PR #3385), and even `32:32` forms were concatenated back into
 * a match. The manifest therefore stores every digest as a JSON array of four
 * 16-character hex chunks. Runtime hashing still uses plain lowercase hex;
 * encode/decode only at the manifest boundary.
 */
const RAW_DIGEST = /^[0-9a-f]{64}$/;
const CHUNK = /^[0-9a-f]{16}$/;

/** @param {string} hex @returns {[string, string, string, string]} */
export function encodeManifestDigest(hex) {
  if (!RAW_DIGEST.test(hex)) {
    throw new Error(`${TAG} encodeManifestDigest expects a lowercase 64-character SHA-256 hex string`);
  }
  return [hex.slice(0, 16), hex.slice(16, 32), hex.slice(32, 48), hex.slice(48, 64)];
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function decodeManifestDigest(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((part) => typeof part === "string" && CHUNK.test(part))) return null;
  return value.join("");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Every regular file under `dir`, as paths relative to it, with `/` separators
 * so the manifest reads the same on any platform. Symlinks are followed and
 * hashed by content: a HuggingFace snapshot directory is mostly symlinks into a
 * sibling blob store, and the content is what matters.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function listArtifactFiles(dir) {
  /** @type {string[]} */
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      // statSync (not the dirent) so a symlink is classified by its target.
      let stats;
      try {
        stats = statSync(absolute);
      } catch {
        // A dangling symlink is a broken artifact set, not a file to skip.
        throw new Error(`${TAG} cannot stat ${absolute} — the artifact set is incomplete`);
      }
      if (stats.isDirectory()) {
        // HuggingFace local-dir bookkeeping (timestamps/etags), not model weights.
        if (entry.name === ".cache") continue;
        walk(absolute);
      } else if (stats.isFile()) found.push(relative(dir, absolute).split(sep).join("/"));
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * The single digest that stands for a whole artifact set: SHA-256 over the
 * sorted `<sha256>  <path>` lines, one per file, each newline-terminated.
 *
 * @param {Record<string, string>} files
 * @returns {string}
 */
export function treeDigestFromFiles(files) {
  const lines = Object.keys(files)
    .sort()
    .map((path) => `${files[path]}  ${path}\n`)
    .join("");
  return sha256(lines);
}

/**
 * Hash every artifact under `dir`. Returns the per-file map and the tree digest.
 *
 * @param {string} dir
 * @returns {{ files: Record<string, string>, treeDigest: string }}
 */
export function hashArtifactDirectory(dir) {
  /** @type {Record<string, string>} */
  const files = {};
  for (const path of listArtifactFiles(dir)) {
    files[path] = sha256(readFileSync(join(dir, path)));
  }
  return { files, treeDigest: treeDigestFromFiles(files) };
}

/**
 * Compare a recorded manifest against what the download produced.
 *
 * Returns `{ status, added, removed, changed }` where status is:
 *   "empty"     — nothing was downloaded (always a failure)
 *   "unpinned"  — the manifest records no digest yet (warn, do not fail)
 *   "match"     — the recorded digest covers exactly what is on disk
 *   "mismatch"  — it does not (failure)
 *
 * @param {{ treeDigest?: string | null, files?: Record<string, string> }} manifest
 * @param {{ files: Record<string, string>, treeDigest: string }} actual
 * @returns {{ status: "empty" | "unpinned" | "match" | "mismatch", added: string[], removed: string[], changed: { path: string, expected: string, actual: string }[] }}
 */
export function compareArtifacts(manifest, actual) {
  const actualPaths = Object.keys(actual.files);
  if (actualPaths.length === 0) return { status: "empty", added: [], removed: [], changed: [] };
  if (!manifest.treeDigest) return { status: "unpinned", added: [], removed: [], changed: [] };

  const expectedTree = decodeManifestDigest(manifest.treeDigest) ?? manifest.treeDigest;
  if (expectedTree === actual.treeDigest) return { status: "match", added: [], removed: [], changed: [] };

  /** @type {Record<string, string>} */
  const expectedFiles = {};
  for (const [path, digest] of Object.entries(manifest.files ?? {})) {
    expectedFiles[path] = decodeManifestDigest(digest) ?? digest;
  }
  const added = actualPaths.filter((path) => !(path in expectedFiles)).sort();
  const removed = Object.keys(expectedFiles)
    .filter((path) => !(path in actual.files))
    .sort();
  const changed = actualPaths
    .filter((path) => path in expectedFiles && expectedFiles[path] !== actual.files[path])
    .sort()
    .map((path) => ({ path, expected: expectedFiles[path], actual: actual.files[path] }));
  return { status: "mismatch", added, removed, changed };
}

/**
 * The manifest must be able to vouch for itself offline: when a digest is
 * recorded, the per-file map must be present and must fold back to exactly that
 * digest. A manifest that fails this was hand-edited, and would either pass a
 * build it should have failed or fail one it should have passed.
 *
 * @param {unknown} manifest
 * @returns {string[]}
 */
export function manifestProblems(manifest) {
  /** @type {string[]} */
  const problems = [];
  if (typeof manifest !== "object" || manifest === null) return ["manifest is not an object"];
  if (manifest.treeDigest === null) {
    if (manifest.files && Object.keys(manifest.files).length > 0) {
      problems.push("treeDigest is null but files are recorded — record the digest or clear the files");
    }
    if (manifest.recordedAt !== null) {
      problems.push("treeDigest is null but recordedAt is set");
    }
    return problems;
  }
  if (decodeManifestDigest(manifest.treeDigest) === null) {
    problems.push("treeDigest must be null or a scanner-safe digest (JSON array of four 16-character hex chunks)");
    return problems;
  }
  if (!manifest.files || Object.keys(manifest.files).length === 0) {
    problems.push("treeDigest is recorded but no per-file digests are — a mismatch could not name a file");
    return problems;
  }
  /** @type {Record<string, string>} */
  const decodedFiles = {};
  for (const [path, digest] of Object.entries(manifest.files)) {
    const decoded = decodeManifestDigest(digest);
    if (!decoded) {
      problems.push(`files["${path}"] is not a scanner-safe digest (JSON array of four 16-character hex chunks)`);
    } else {
      decodedFiles[path] = decoded;
    }
  }
  const decodedTree = decodeManifestDigest(manifest.treeDigest);
  if (problems.length === 0 && decodedTree && treeDigestFromFiles(decodedFiles) !== decodedTree) {
    problems.push("treeDigest does not match the recorded per-file digests");
  }
  return problems;
}

function parseArgs(argv) {
  const args = { modelsDir: null, manifest: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--models-dir") args.modelsDir = argv[index + 1];
    else if (argv[index] === "--manifest") args.manifest = argv[index + 1];
  }
  return args;
}

function recordingBlock(manifest, actual) {
  /** @type {Record<string, string>} */
  const encodedFiles = {};
  for (const [path, digest] of Object.entries(actual.files)) {
    encodedFiles[path] = encodeManifestDigest(digest);
  }
  return JSON.stringify(
    {
      ...manifest,
      recordedAt: new Date().toISOString().slice(0, 10),
      treeDigest: encodeManifestDigest(actual.treeDigest),
      files: encodedFiles,
    },
    null,
    2,
  );
}

export function main(argv, { log = console.log, error = console.error } = {}) {
  const { modelsDir, manifest: manifestPath } = parseArgs(argv);
  if (!modelsDir || !manifestPath) {
    error(`${TAG} usage: verify-model-artifacts.mjs --models-dir <dir> --manifest <file>`);
    return 2;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (cause) {
    error(`${TAG} cannot read the manifest ${manifestPath}: ${cause.message}`);
    return 1;
  }

  const problems = manifestProblems(manifest);
  if (problems.length > 0) {
    error(`${TAG} the manifest ${manifestPath} is not self-consistent, so it cannot be trusted:`);
    for (const problem of problems) error(`${TAG}   - ${problem}`);
    return 1;
  }

  let actual;
  try {
    actual = hashArtifactDirectory(modelsDir);
  } catch (cause) {
    error(`${TAG} cannot hash ${modelsDir}: ${cause.message}`);
    return 1;
  }

  const fileCount = Object.keys(actual.files).length;
  const result = compareArtifacts(manifest, actual);

  if (result.status === "empty") {
    error(`${TAG} FAILED — ${modelsDir} contains no files. The model download produced nothing.`);
    return 1;
  }

  if (result.status === "unpinned") {
    log(`${TAG} ${fileCount} artifact files, tree digest sha256:${actual.treeDigest}`);
    log(`${TAG} WARNING: ${manifestPath} records no digest, so nothing was verified.`);
    log(`${TAG} Record it by replacing that file's contents with the block below, then rebuild:`);
    log(recordingBlock(manifest, actual));
    return 0;
  }

  if (result.status === "match") {
    log(`${TAG} OK — ${fileCount} artifact files match the digest recorded on ${manifest.recordedAt}.`);
    log(`${TAG} tree digest sha256:${actual.treeDigest}`);
    return 0;
  }

  const expectedTree = decodeManifestDigest(manifest.treeDigest) ?? manifest.treeDigest;
  error(`${TAG} FAILED — the downloaded model artifacts do not match the recorded digest.`);
  error(`${TAG}   expected tree digest: sha256:${expectedTree}`);
  error(`${TAG}   actual   tree digest: sha256:${actual.treeDigest}`);
  for (const path of result.removed) error(`${TAG}   missing:   ${path}`);
  for (const path of result.added) error(`${TAG}   unexpected: ${path}`);
  for (const entry of result.changed) {
    error(`${TAG}   changed:   ${entry.path}`);
    error(`${TAG}     expected sha256:${entry.expected}`);
    error(`${TAG}     actual   sha256:${entry.actual}`);
  }
  error(`${TAG} Refusing the build: upstream model weights changed under a version this repository pins.`);
  error(`${TAG} Review the change, and only then re-record the digest in ${manifestPath}.`);
  return 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main(process.argv.slice(2)));
}
