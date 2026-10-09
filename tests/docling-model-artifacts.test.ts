import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  compareArtifacts,
  decodeManifestDigest,
  encodeManifestDigest,
  hashArtifactDirectory,
  listArtifactFiles,
  main,
  manifestProblems,
  treeDigestFromFiles,
} from "../eval/docling/verify-model-artifacts.mjs";

/**
 * `docling-tools models download` takes no version argument — there is no
 * --revision flag, so the 2026-09-02 audit's recorded remedy for L49 cannot be
 * implemented as written. The weights it pulls are whatever HuggingFace holds
 * on build day, while the Python client alone is hash-locked. The replacement
 * remedy is a recorded digest plus a build step that refuses a download which
 * does not match it, and this file is what holds that remedy in place: the
 * image build itself cannot run here, so the verifier is exercised directly and
 * both Dockerfiles are read as text to prove the step is still wired in.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(repoRoot, "eval/docling/model-artifacts.json");
type ManifestDigestChunks = [string, string, string, string];

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  doclingVersion: string;
  recordedAt: string | null;
  treeDigest: ManifestDigestChunks | string | null;
  files: Record<string, ManifestDigestChunks | string>;
};

const temporaryDirectories: string[] = [];

function makeModelDirectory(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "docling-models-"));
  temporaryDirectories.push(dir);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return dir;
}

function makeManifestFile(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "docling-manifest-"));
  temporaryDirectories.push(dir);
  const path = join(dir, "model-artifacts.json");
  writeFileSync(path, typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  return path;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Run the CLI with output captured, so an assertion can read what a build log would show. */
function runMain(modelsDir: string, manifestFile: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(["--models-dir", modelsDir, "--manifest", manifestFile], {
    log: (line: string) => out.push(line),
    error: (line: string) => err.push(line),
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    // Bounded retries are required of every recursive fixture cleanup here, and
    // tests/test-runner-safety.test.ts fails the suite without them: an unbounded
    // recursive remove races antivirus and indexer handles on Windows and turns
    // teardown into an intermittent red.
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("the recorded docling model manifest", () => {
  it("is self-consistent, so it can neither pass a build it should fail nor fail one it should pass", () => {
    expect(manifestProblems(manifest)).toEqual([]);
  });

  it("names the docling version the hashed lock actually pins", () => {
    // The manifest is only meaningful alongside a fixed client: a different
    // docling legitimately fetches a different artifact set, so a recorded
    // digest taken under one version says nothing about another. Deriving the
    // expected value from the lock rather than hardcoding it means bumping
    // docling turns this red and forces the digest to be re-recorded — and it
    // is why this is not asserted against a literal, which is exactly how the
    // surrounding comments came to say 2.120.2 long after the lock moved on.
    const locked = readFileSync(join(repoRoot, "eval/docling/requirements.txt"), "utf8").match(/^docling==(\S+)/m);
    expect(locked, "eval/docling/requirements.txt has no docling== pin").not.toBeNull();
    expect(manifest.doclingVersion).toBe(locked![1]);
  });

  it("states how to pin it, because an unpinned manifest is the one state that does not fail closed", () => {
    const readme = (manifest as unknown as { _readme: string[] })._readme.join("\n");
    expect(readme).toContain("docker build -f Dockerfile.worker");
    expect(readme).toMatch(/no --revision/);
  });
});

describe("hashing an artifact directory", () => {
  it("covers nested files and reports paths relative to the models directory", () => {
    const dir = makeModelDirectory({ "a.bin": "one", "nested/b.bin": "two" });
    expect(listArtifactFiles(dir)).toEqual(["a.bin", "nested/b.bin"]);
    expect(hashArtifactDirectory(dir).files).toEqual({ "a.bin": sha256("one"), "nested/b.bin": sha256("two") });
  });

  it("hashes a symlink by its target's content, because a HuggingFace snapshot is mostly symlinks", () => {
    const dir = makeModelDirectory({ "blobs/weight": "payload" });
    mkdirSync(join(dir, "snapshots"), { recursive: true });
    symlinkSync(join(dir, "blobs/weight"), join(dir, "snapshots/weight"));
    const { files } = hashArtifactDirectory(dir);
    expect(files["snapshots/weight"]).toBe(sha256("payload"));
    expect(files["blobs/weight"]).toBe(sha256("payload"));
  });

  it("folds the per-file digests into one tree digest that does not depend on key order", () => {
    const forward = treeDigestFromFiles({ "a.bin": sha256("one"), "b.bin": sha256("two") });
    const reversed = treeDigestFromFiles({ "b.bin": sha256("two"), "a.bin": sha256("one") });
    expect(forward).toBe(reversed);
  });

  it("changes the tree digest when a file's content changes, which is the whole point", () => {
    const before = treeDigestFromFiles({ "a.bin": sha256("one") });
    const after = treeDigestFromFiles({ "a.bin": sha256("ONE") });
    expect(after).not.toBe(before);
  });

  it("changes the tree digest when a file is renamed but its content is not", () => {
    const before = treeDigestFromFiles({ "a.bin": sha256("one") });
    const after = treeDigestFromFiles({ "b.bin": sha256("one") });
    expect(after).not.toBe(before);
  });
});

describe("comparing a download against the recorded digest", () => {
  const recordedFiles = { "a.bin": sha256("one") };
  const recorded = {
    doclingVersion: "2.124.0",
    recordedAt: "2026-09-19",
    files: { "a.bin": encodeManifestDigest(recordedFiles["a.bin"]) },
  };
  const pinned = {
    ...recorded,
    treeDigest: encodeManifestDigest(treeDigestFromFiles(recordedFiles)),
  };

  it("accepts an identical download", () => {
    const actual = hashArtifactDirectory(makeModelDirectory({ "a.bin": "one" }));
    expect(compareArtifacts(pinned, actual).status).toBe("match");
  });

  it("rejects a changed file and names it with both digests", () => {
    const actual = hashArtifactDirectory(makeModelDirectory({ "a.bin": "tampered" }));
    const result = compareArtifacts(pinned, actual);
    expect(result.status).toBe("mismatch");
    expect(result.changed).toEqual([{ path: "a.bin", expected: sha256("one"), actual: sha256("tampered") }]);
  });

  it("rejects an extra artifact the recorded set does not contain", () => {
    const actual = hashArtifactDirectory(makeModelDirectory({ "a.bin": "one", "extra.bin": "surprise" }));
    const result = compareArtifacts(pinned, actual);
    expect(result.status).toBe("mismatch");
    expect(result.added).toEqual(["extra.bin"]);
  });

  it("rejects a download that dropped a recorded artifact", () => {
    const actual = hashArtifactDirectory(makeModelDirectory({ "b.bin": "two" }));
    const result = compareArtifacts(pinned, actual);
    expect(result.status).toBe("mismatch");
    expect(result.removed).toEqual(["a.bin"]);
  });

  it("reports an empty models directory as empty rather than as a match", () => {
    const actual = hashArtifactDirectory(makeModelDirectory({}));
    expect(compareArtifacts(pinned, actual).status).toBe("empty");
  });

  it("reports an unrecorded manifest as unpinned rather than silently matching", () => {
    const actual = hashArtifactDirectory(makeModelDirectory({ "a.bin": "one" }));
    expect(compareArtifacts({ ...recorded, treeDigest: null, files: {} }, actual).status).toBe("unpinned");
  });
});

describe("the manifest's own self-consistency check", () => {
  it("rejects a digest that does not fold back from the per-file map", () => {
    const problems = manifestProblems({
      doclingVersion: "2.124.0",
      recordedAt: "2026-09-19",
      treeDigest: encodeManifestDigest(sha256("not the right fold")),
      files: { "a.bin": encodeManifestDigest(sha256("one")) },
    });
    expect(problems).toContain("treeDigest does not match the recorded per-file digests");
  });

  it("rejects a digest recorded with no per-file map, which could not name a changed file", () => {
    const problems = manifestProblems({
      doclingVersion: "2.124.0",
      recordedAt: "2026-09-19",
      treeDigest: encodeManifestDigest(sha256("anything")),
      files: {},
    });
    expect(problems).toContain("treeDigest is recorded but no per-file digests are — a mismatch could not name a file");
  });

  it("rejects a half-cleared manifest that kept files without a digest", () => {
    const problems = manifestProblems({
      doclingVersion: "2.124.0",
      recordedAt: null,
      treeDigest: null,
      files: { "a.bin": encodeManifestDigest(sha256("one")) },
    });
    expect(problems).toContain("treeDigest is null but files are recorded — record the digest or clear the files");
  });

  it("rejects a contiguous 64-hex digest so secret scanners cannot be re-tripped", () => {
    const problems = manifestProblems({
      doclingVersion: "2.124.0",
      recordedAt: "2026-09-19",
      treeDigest: sha256("one"),
      files: { "a.bin": sha256("one") },
    });
    expect(problems.some((problem) => problem.includes("scanner-safe digest"))).toBe(true);
  });

  it("round-trips encode/decode without changing the SHA-256 value", () => {
    const raw = sha256("payload");
    const encoded = encodeManifestDigest(raw);
    expect(encoded).toHaveLength(4);
    expect(encoded.every((part) => part.length === 16)).toBe(true);
    expect(decodeManifestDigest(encoded)).toBe(raw);
  });
});

describe("the verifier as the image build runs it", () => {
  const recordedFiles = { "a.bin": sha256("one") };
  const pinnedManifest = {
    doclingVersion: "2.124.0",
    recordedAt: "2026-09-19",
    treeDigest: encodeManifestDigest(treeDigestFromFiles(recordedFiles)),
    files: { "a.bin": encodeManifestDigest(recordedFiles["a.bin"]) },
  };

  it("exits 0 on a matching download", () => {
    const result = runMain(makeModelDirectory({ "a.bin": "one" }), makeManifestFile(pinnedManifest));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[docling-models] OK");
  });

  it("exits non-zero on a mismatch, which is what fails the image build", () => {
    const result = runMain(makeModelDirectory({ "a.bin": "tampered" }), makeManifestFile(pinnedManifest));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[docling-models] FAILED");
    expect(result.stderr).toContain("Refusing the build");
    expect(result.stderr).toContain("changed:   a.bin");
  });

  it("exits non-zero when the download produced nothing, pinned or not", () => {
    const empty = makeModelDirectory({});
    expect(runMain(empty, makeManifestFile(pinnedManifest)).code).toBe(1);
    const unpinned = { ...pinnedManifest, recordedAt: null, treeDigest: null, files: {} };
    const result = runMain(empty, makeManifestFile(unpinned));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("produced nothing");
  });

  it("exits non-zero on a manifest that is not self-consistent, rather than trusting it", () => {
    const broken = { ...pinnedManifest, treeDigest: encodeManifestDigest(sha256("wrong")) };
    const result = runMain(makeModelDirectory({ "a.bin": "one" }), makeManifestFile(broken));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not self-consistent");
  });

  it("exits non-zero when the manifest is missing or unparseable", () => {
    const dir = makeModelDirectory({ "a.bin": "one" });
    expect(runMain(dir, join(dir, "there-is-no-manifest.json")).code).toBe(1);
    expect(runMain(dir, makeManifestFile("{ not json")).code).toBe(1);
  });

  it("warns and prints a recordable block when nothing is pinned yet, without failing the build", () => {
    const unpinned = { ...pinnedManifest, recordedAt: null, treeDigest: null, files: {} };
    const result = runMain(makeModelDirectory({ "a.bin": "one" }), makeManifestFile(unpinned));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("records no digest, so nothing was verified");
    // The printed block must be the file an operator can paste back, and it
    // must itself pass the self-consistency check — otherwise pinning it would
    // immediately break every build.
    const block = result.stdout.slice(result.stdout.indexOf("{"));
    const recorded = JSON.parse(block);
    expect(manifestProblems(recorded)).toEqual([]);
    expect(recorded.treeDigest).toStrictEqual(
      encodeManifestDigest(treeDigestFromFiles({ "a.bin": sha256("one") })),
    );
    expect(recorded.files["a.bin"]).toStrictEqual(encodeManifestDigest(sha256("one")));
  });
});

describe("both images still run the check in the same layer as the download", () => {
  /** The whole `RUN` instruction (with its `\` continuations) that downloads the models. */
  function downloadRunLayer(dockerfile: string): string {
    const lines = dockerfile.split("\n");
    const start = lines.findIndex((line) => line.startsWith("RUN ") && line.includes("docling-tools models download"));
    expect(start, "no RUN layer downloads the docling models").toBeGreaterThan(-1);
    let end = start;
    while (lines[end].trimEnd().endsWith("\\")) end += 1;
    return lines.slice(start, end + 1).join("\n");
  }

  const dockerfiles = {
    "Dockerfile.worker": readFileSync(join(repoRoot, "Dockerfile.worker"), "utf8"),
    "eval/docling/Dockerfile": readFileSync(join(repoRoot, "eval/docling/Dockerfile"), "utf8"),
  };

  for (const [name, source] of Object.entries(dockerfiles)) {
    it(`${name} verifies the download it just performed`, () => {
      // Same layer, not a later one: a separate RUN could be satisfied from a
      // stale cache while the download layer rebuilt, and the point is that an
      // unverified download never becomes an image.
      const layer = downloadRunLayer(source);
      expect(layer).toContain("verify-model-artifacts.mjs");
      expect(layer).toContain("--manifest /tmp/docling-verify/model-artifacts.json");
      expect(layer).toContain("--models-dir /opt/docling-models");
    });

    it(`${name} copies the verifier and the manifest in before that layer`, () => {
      const copyLine =
        "COPY eval/docling/verify-model-artifacts.mjs eval/docling/model-artifacts.json /tmp/docling-verify/";
      expect(source).toContain(copyLine);
      // Against the RUN layer itself, not the first textual mention of the
      // download — both files discuss it in comments well above the layer.
      expect(source.indexOf(copyLine)).toBeLessThan(source.indexOf(downloadRunLayer(source)));
    });
  }

  it("does not claim anywhere that the requirement hash pins the model weights", () => {
    // eval/docling/Dockerfile used to say "Model weights are pinned via the
    // exact hash-locked docling==<version> requirement". That was false — the
    // lock pins the client, not the weights — and it contradicted the accurate
    // note in Dockerfile.worker. It is exactly the belief that would let an
    // upstream weight change pass unexamined.
    for (const [name, source] of Object.entries(dockerfiles)) {
      expect(source, `${name} claims the weights are pinned by the requirement lock`).not.toMatch(
        /Model weights\s+(?:#\s*)?are pinned via/,
      );
    }
    expect(dockerfiles["eval/docling/Dockerfile"]).toContain(
      "The model weights are NOT pinned by the hash-locked docling==",
    );
  });
});

describe("maintained docs do not restate a docling version (#XSZ4XV part 2)", () => {
  // The lock moves; prose copies of it do not. Both docs below said 2.120.2 long
  // after the hashed lock pinned 2.124.0. They now point at the lock instead, and
  // this keeps any literal they grow honest. The Gate B decision record is
  // historical and deliberately not in this list.
  it.each(["eval/docling/README.md", "docs/worker-deploy-runbook.md"])("%s", (path) => {
    const locked = readFileSync(join(repoRoot, "eval/docling/requirements.txt"), "utf8").match(/^docling==(\S+)/m);
    expect(locked).not.toBeNull();
    const text = readFileSync(join(repoRoot, path), "utf8");
    const stated = Array.from(text.matchAll(/docling==(\d[\w.]*)/g), (match) => match[1]);
    expect(stated.filter((version) => version !== locked![1])).toEqual([]);
    expect(text).toContain("eval/docling/requirements.txt");
  });
});
