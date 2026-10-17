import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetReleaseManifestCacheForTests,
  resolveDeploymentCommitSha,
  resolveSentryRelease,
} from "../src/lib/observability/sentry-release";
import { resolveReleaseManifestIdentity, writeReleaseManifest } from "../scripts/deploy/write-release-manifest.mjs";

describe("sentry-release and release-identity manifest", () => {
  const tempDirs: string[] = [];

  function makeTempDir() {
    const dir = mkdtempSync(path.join(os.tmpdir(), "psychsift-release-identity-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    resetReleaseManifestCacheForTests();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  });

  it("resolves SENTRY_RELEASE, COMMIT_SHA, and SOURCE_COMMIT_SHA from environment variables", () => {
    const shaA = "a".repeat(40);
    const shaB = "B".repeat(40);

    expect(resolveSentryRelease({ COMMIT_SHA: shaA }, { useManifestFallback: false })).toBe(shaA);

    expect(resolveSentryRelease({ SOURCE_COMMIT_SHA: shaB, COMMIT_SHA: shaA }, { useManifestFallback: false })).toBe(
      shaB,
    );

    expect(resolveDeploymentCommitSha({ COMMIT_SHA: shaB }, { useManifestFallback: false })).toBe(shaB.toLowerCase());

    expect(resolveDeploymentCommitSha({ SOURCE_COMMIT_SHA: shaA }, { useManifestFallback: false })).toBe(shaA);
  });

  it("falls back to deploy/release-identity.json when runtime env vars are unset", () => {
    const dir = makeTempDir();
    const manifestPath = path.join(dir, "release-identity.json");
    const commitSha = "0123456789abcdef0123456789abcdef01234567";

    const written = writeReleaseManifest(
      manifestPath,
      {
        GITHUB_SHA: commitSha.toUpperCase(),
        SENTRY_RELEASE: "psychsift@2026.10.16",
      } as unknown as NodeJS.ProcessEnv,
      { resolveGitHead: false },
    );

    expect(written).toEqual({
      commitSha,
      sentryRelease: "psychsift@2026.10.16",
    });

    const onDisk = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      commitSha: string | null;
      sentryRelease: string;
    };
    expect(onDisk).toEqual(written);

    expect(resolveSentryRelease({}, { manifestPath })).toBe("psychsift@2026.10.16");
    expect(resolveDeploymentCommitSha({}, { manifestPath })).toBe(commitSha);
  });

  it("fails open to 'dev' and null when neither env vars nor release-identity.json exist", () => {
    const dir = makeTempDir();
    const missingManifest = path.join(dir, "missing-release-identity.json");

    expect(resolveSentryRelease({}, { manifestPath: missingManifest })).toBe("dev");
    expect(resolveDeploymentCommitSha({}, { manifestPath: missingManifest })).toBeNull();
  });

  it("ignores malformed manifest JSON and non-SHA commit strings safely", () => {
    const dir = makeTempDir();
    const badJsonPath = path.join(dir, "bad.json");
    writeFileSync(badJsonPath, "{not-valid-json", "utf8");

    expect(resolveSentryRelease({}, { manifestPath: badJsonPath })).toBe("dev");
    expect(resolveDeploymentCommitSha({}, { manifestPath: badJsonPath })).toBeNull();

    const nonHexManifestPath = path.join(dir, "non-hex.json");
    writeFileSync(nonHexManifestPath, JSON.stringify({ commitSha: "not-a-40-char-sha", sentryRelease: "" }), "utf8");

    expect(resolveSentryRelease({}, { manifestPath: nonHexManifestPath })).toBe("dev");
    expect(resolveDeploymentCommitSha({}, { manifestPath: nonHexManifestPath })).toBeNull();

    expect(
      resolveReleaseManifestIdentity({ COMMIT_SHA: "short-sha" } as unknown as NodeJS.ProcessEnv, {
        resolveGitHead: false,
      }),
    ).toEqual({
      commitSha: null,
      sentryRelease: "dev",
    });
  });

  it("declares release identity build args and copies deploy/release-identity.json in both Dockerfiles", () => {
    const appDockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
    const workerDockerfile = readFileSync(new URL("../Dockerfile.worker", import.meta.url), "utf8");

    for (const dockerfile of [appDockerfile, workerDockerfile]) {
      expect(dockerfile).toContain("RUN node scripts/deploy/write-release-manifest.mjs");
      expect(dockerfile).toContain(
        "COPY --from=build /app/deploy/release-identity.json ./deploy/release-identity.json",
      );
      expect(dockerfile).toContain("ARG RAILWAY_GIT_COMMIT_SHA=");
      expect(dockerfile).toContain("ARG GITHUB_SHA=");
      expect(dockerfile).toContain("ARG SOURCE_COMMIT_SHA=");
      expect(dockerfile).toContain("ARG COMMIT_SHA=");
      expect(dockerfile).toContain("ARG SENTRY_RELEASE=");
      expect(dockerfile).toContain("ENV RAILWAY_GIT_COMMIT_SHA=${RAILWAY_GIT_COMMIT_SHA}");
      expect(dockerfile).toContain("ENV COMMIT_SHA=${COMMIT_SHA}");
      expect(dockerfile).toContain("ENV SENTRY_RELEASE=${SENTRY_RELEASE}");
    }
  });
});
