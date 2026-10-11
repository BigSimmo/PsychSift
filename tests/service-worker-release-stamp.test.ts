import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { releaseSuffix, stampServiceWorkerSource } from "../scripts/stamp-service-worker.mjs";

const serviceWorker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function navigationDeploymentId(commitSha?: string, explicitId?: string) {
  vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", commitSha ?? "");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
  vi.stubEnv("GITHUB_SHA", "");
  vi.stubEnv("NEXT_DEPLOYMENT_ID", explicitId ?? "");
  vi.stubEnv("SENTRY_AUTH_TOKEN", "");
  vi.stubEnv("ANALYZE", "false");
  vi.resetModules();
  const { default: loadNextConfig } = await import("../next.config");
  return (await loadNextConfig()).deploymentId;
}

describe("navigation release identity", () => {
  it("gives Next navigation a different identity for each deployed release", async () => {
    const first = "a5c56cee5de2f014338b61e47c69aa8eb33a30cb";
    const second = "cc1379790fae317a454832202c4b70d01d8f803b";
    expect(await navigationDeploymentId(first)).toBe(first);
    expect(await navigationDeploymentId(second)).toBe(second);
  });

  it("keeps local builds unversioned when no release is configured", async () => {
    expect(await navigationDeploymentId()).toBeUndefined();
    expect(await navigationDeploymentId("not-a-sha")).toBeUndefined();
  });

  it("honours an explicitly configured Next deployment identity", async () => {
    expect(await navigationDeploymentId("a5c56cee5de2f014338b61e47c69aa8eb33a30cb", "release-42")).toBe("release-42");
  });
});

/**
 * A browser decides a service worker has changed by byte-comparing the script. `CACHE_VERSION`
 * was a hand-edited literal, so between releases `sw.js` was byte-identical: no `updatefound`,
 * no waiting worker, and therefore none of the events `pwa-lifecycle.tsx` builds its "update
 * available" prompt from. An installed home-screen app could sit on the version it first loaded
 * indefinitely and never be told otherwise.
 */
describe("service worker release stamp", () => {
  it("changes the cache version when a release SHA is present", () => {
    const first = stampServiceWorkerSource(serviceWorker, "a5c56cee5de2f014338b61e47c69aa8eb33a30cb");
    const second = stampServiceWorkerSource(serviceWorker, "cc1379790fae317a454832202c4b70d01d8f803b");

    expect(first.stamped).toBe(true);
    expect(second.stamped).toBe(true);
    expect(first.source).not.toBe(serviceWorker);
    // The whole point: two releases must not produce byte-identical workers.
    expect(first.source).not.toBe(second.source);
  });

  it("leaves the committed file untouched without a release SHA", () => {
    // Keeps `npm run build` on a developer machine from dirtying the tree or committing a
    // machine-specific version string.
    for (const value of [undefined, "", "   ", "not-a-sha"]) {
      const result = stampServiceWorkerSource(serviceWorker, value);
      expect(result.stamped).toBe(false);
      expect(result.source).toBe(serviceWorker);
    }
    expect(releaseSuffix("deadbeef")).toBe("deadbeef");
    expect(releaseSuffix("xyz")).toBeNull();
  });

  it("is idempotent, so a rebuilt layer cannot grow the version without bound", () => {
    const once = stampServiceWorkerSource(serviceWorker, "a5c56cee5de2f014338b61e47c69aa8eb33a30cb");
    const twice = stampServiceWorkerSource(once.source, "a5c56cee5de2f014338b61e47c69aa8eb33a30cb");
    expect(twice.source).toBe(once.source);
    expect(twice.version).toBe(once.version);
  });

  // The stamp is worthless if the runtime image takes public/ from the build CONTEXT instead
  // of the build STAGE: the deployed worker would be the unstamped original and the update
  // prompt would stay broken while every test here still passed. Caught in review, not by me.
  it("ships the stamped worker in the runtime image, not the unstamped original", () => {
    const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain("COPY --from=build /app/public ./public");
    expect(dockerfile).not.toMatch(/^COPY public \.\/public$/m);
  });

  it("runs in the production build, before Next copies public/", () => {
    // Stamping after `next build` would miss the standalone output entirely.
    const build = packageJson.scripts["build:internal"];
    expect(build).toContain("stamp-service-worker.mjs");
    expect(build.indexOf("stamp-service-worker.mjs")).toBeLessThan(build.indexOf("next/dist/bin/next build"));
  });
});
