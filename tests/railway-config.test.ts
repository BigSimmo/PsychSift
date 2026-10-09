import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type RailwayConfig = {
  build?: {
    dockerfilePath?: string;
    watchPatterns?: string[];
  };
  deploy?: {
    healthcheckPath?: string;
    healthcheckTimeout?: number;
    restartPolicyType?: string;
    restartPolicyMaxRetries?: number;
    preDeployCommand?: string[];
  };
};

function readConfig(fileName: string): RailwayConfig {
  return JSON.parse(readFileSync(new URL(`../${fileName}`, import.meta.url), "utf8")) as RailwayConfig;
}

function watchPatternMatches(pattern: string, filePath: string) {
  const normalizedPattern = pattern.replace(/^\/+/, "");
  const normalizedPath = filePath.replace(/^\/+/, "");
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  return normalizedPath === normalizedPattern;
}

// Gitignore-style, as Railway documents: a "!" pattern excludes files a preceding rule
// included, and the last matching pattern wins.
function triggersDeploy(config: RailwayConfig, filePath: string) {
  let included = false;
  for (const pattern of config.build?.watchPatterns ?? []) {
    const negated = pattern.startsWith("!");
    if (watchPatternMatches(negated ? pattern.slice(1) : pattern, filePath)) included = !negated;
  }
  return included;
}

describe("Railway config as code", () => {
  const app = readConfig("railway.app.json");
  const worker = readConfig("railway.worker.json");
  const appDockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

  it("lets the app image shell expand Railway PORT instead of overriding it in exec form", () => {
    expect(app.deploy).not.toHaveProperty("startCommand");
    expect(appDockerfile).toContain(
      'CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]',
    );
  });

  it("retains worker readiness with supported Railway configuration", () => {
    expect(worker.deploy).toMatchObject({ healthcheckPath: "/health", healthcheckTimeout: 300 });
    expect(worker.deploy).not.toHaveProperty("healthcheckPort");
    expect(worker.deploy).not.toHaveProperty("env");
  });

  it.each(["railway.app.json", "railway.worker.json"])("uses supported deploy keys and one replica in %s", (file) => {
    const deploy = readConfig(file).deploy;
    const supportedKeys = [
      "healthcheckPath",
      "healthcheckTimeout",
      "restartPolicyType",
      "restartPolicyMaxRetries",
      "preDeployCommand",
      "multiRegionConfig",
    ];
    expect(Object.keys(deploy ?? {}).every((key) => supportedKeys.includes(key))).toBe(true);
    expect(deploy).toHaveProperty("multiRegionConfig.asia-southeast1-eqsg3a.numReplicas", 1);
  });

  it("ships the local modules imported by next.config.ts in the app runner", () => {
    expect(appDockerfile).toContain("COPY --from=build /app/src/lib/security-headers.ts ./src/lib/security-headers.ts");
    expect(appDockerfile).toContain(
      "COPY --from=build /app/src/lib/observability/sentry-release.ts ./src/lib/observability/sentry-release.ts",
    );
    expect(appDockerfile).toContain("COPY --from=build /app/src/lib/supabase/project.ts ./src/lib/supabase/project.ts");
    expect(appDockerfile).toContain(
      "COPY --from=build /app/src/components/therapy-compass/data/generated-assets.ts ./src/components/therapy-compass/data/generated-assets.ts",
    );
    expect(appDockerfile).toContain(
      "COPY --from=build /app/src/data/therapy-catalogue-assets.ts ./src/data/therapy-catalogue-assets.ts",
    );
  });

  it("admits Railway's non-secret deployment SHA into the build release", () => {
    expect(appDockerfile).toContain("ARG RAILWAY_GIT_COMMIT_SHA=");
    expect(appDockerfile).toContain("ENV RAILWAY_GIT_COMMIT_SHA=${RAILWAY_GIT_COMMIT_SHA}");
  });

  it("admits non-secret staging identity metadata into the browser build", () => {
    expect(appDockerfile).toContain("ARG NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_REF=");
    expect(appDockerfile).toContain("ARG NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_NAME=");
    expect(appDockerfile).toContain(
      "ENV NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_REF=${NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_REF}",
    );
    expect(appDockerfile).toContain(
      "ENV NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_NAME=${NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_NAME}",
    );
  });

  it("declares the Sentry source-map build arguments so a Railway variable can reach the build", () => {
    // next.config.ts gates withSentryConfig on all three being present at build time, and a build
    // argument the Dockerfile does not declare is not in the build environment at all — so
    // dropping any of these makes an operator's Railway variable a silent no-op.
    expect(appDockerfile).toContain("ARG SENTRY_AUTH_TOKEN=");
    expect(appDockerfile).toContain("ARG SENTRY_ORG=");
    expect(appDockerfile).toContain("ARG SENTRY_PROJECT=");
    // The token must not be promoted into stage ENV metadata.
    expect(appDockerfile).not.toContain("ENV SENTRY_AUTH_TOKEN=");
  });

  it("uses the deep readiness endpoint for app rolling deploys", () => {
    expect(app.deploy).toMatchObject({
      healthcheckPath: "/api/health/ready",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    });
  });

  it("keeps the queue-draining worker alive after repeated failures", () => {
    expect(worker.deploy).toMatchObject({ restartPolicyType: "ALWAYS" });
    expect(worker.deploy).not.toHaveProperty("restartPolicyMaxRetries");
  });

  it("gates both services' deploys behind the pre-deploy migration check (docs/worker-deploy-runbook.md §0)", () => {
    // deploy.preDeployCommand blocks (report mode: only observes) the deploy
    // until scripts/deploy/await-migrations.mjs confirms this build's expected
    // migrations are present in live history — see tests/deploy-migration-gate.test.ts
    // for the gate's own behaviour.
    expect(app.deploy?.preDeployCommand).toEqual(["node /app/scripts/deploy/await-migrations.mjs"]);
    expect(worker.deploy?.preDeployCommand).toEqual(["node /app/scripts/deploy/await-migrations.mjs"]);
  });

  it("rebuilds both services when the deploy migration gate's scripts change", () => {
    expect(triggersDeploy(app, "scripts/deploy/await-migrations.mjs")).toBe(true);
    expect(triggersDeploy(app, "scripts/deploy/migration-versions.mjs")).toBe(true);
    expect(triggersDeploy(worker, "scripts/deploy/await-migrations.mjs")).toBe(true);
    expect(triggersDeploy(worker, "scripts/deploy/migration-versions.mjs")).toBe(true);
  });

  it.each([
    "Dockerfile",
    ".dockerignore",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "tsconfig.json",
    "railway.app.json",
    "data/services-snapshot.json",
    "public/logo.svg",
    "src/app/page.tsx",
    "scripts/run-heavy.mjs",
    "scripts/guard-next-build.mjs",
    "scripts/check-client-bundle-secrets.mjs",
    "scripts/check-upload-limit-parity.mjs",
    "scripts/stamp-service-worker.mjs",
  ])("deploys the app for runtime input %s", (filePath) => {
    expect(triggersDeploy(app, filePath)).toBe(true);
  });

  it.each([
    "Dockerfile.worker",
    ".dockerignore",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "railway.worker.json",
    "data/services-snapshot.json",
    "src/lib/rag/rag.ts",
    "src/data/dsm-clinical-content.json",
    "worker/main.ts",
    "worker/python/requirements.txt",
    // B4: the worker image builds its docling venv from the Gate B lab lock.
    "eval/docling/requirements.txt",
    "scripts/build-worker.mjs",
    "scripts/enable-server-only-stub.mjs",
    "scripts/register-server-only.mjs",
    "scripts/resolve-tsx-cli.mjs",
    "scripts/run-tsx.mjs",
    "tests/stubs/server-only.ts",
  ])("deploys the worker for runtime input %s", (filePath) => {
    expect(triggersDeploy(worker, filePath)).toBe(true);
  });

  it.each([
    ".github/workflows/pr-policy.yml",
    "AGENTS.md",
    "README.md",
    "docs/deployment-architecture.md",
    "tests/rag-trust.test.ts",
    "scripts/pr-policy.mjs",
  ])("does not deploy either service for non-runtime input %s", (filePath) => {
    expect(triggersDeploy(app, filePath)).toBe(false);
    expect(triggersDeploy(worker, filePath)).toBe(false);
  });

  it.each(["data/repo-awareness-snapshot.json", "data/outstanding-issues-snapshot.json"])(
    "does not redeploy either service for the developer-area metadata snapshot %s",
    (filePath) => {
      expect(triggersDeploy(app, filePath)).toBe(false);
      expect(triggersDeploy(worker, filePath)).toBe(false);
    },
  );

  it("places each exclusion after the rule it narrows, which Railway requires", () => {
    for (const config of [app, worker]) {
      const patterns = config.build?.watchPatterns ?? [];
      for (const [index, pattern] of patterns.entries()) {
        if (!pattern.startsWith("!")) continue;
        const target = pattern.slice(1);
        expect(
          patterns.slice(0, index).some((earlier) => !earlier.startsWith("!") && watchPatternMatches(earlier, target)),
        ).toBe(true);
      }
    }
  });

  it("keeps service-specific inputs isolated", () => {
    expect(triggersDeploy(app, "Dockerfile.worker")).toBe(false);
    expect(triggersDeploy(app, "worker/main.ts")).toBe(false);
    expect(triggersDeploy(worker, "Dockerfile")).toBe(false);
    expect(triggersDeploy(worker, "next.config.ts")).toBe(false);
    expect(triggersDeploy(worker, "public/logo.svg")).toBe(false);
  });

  it.each(["src/components/ui/button.tsx", "src/app/globals.css"])(
    "does not rebuild the worker for UI-only input %s",
    (filePath) => {
      expect(triggersDeploy(worker, filePath)).toBe(false);
    },
  );
});
