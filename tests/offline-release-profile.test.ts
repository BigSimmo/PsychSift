import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { offlineSentryControlFlags, offlineUrlValues, providerEnvironmentKeys } from "../scripts/test-environment.mjs";

describe("offline release profile wiring", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("preserves the provider-backed release gate and adds explicit offline commands", () => {
    expect(packageJson.scripts["eval:quality:release"]).not.toContain("offline");
    expect(packageJson.scripts["eval:quality:release:offline"]).toContain("--provider-mode offline");
    expect(packageJson.scripts["verify:release"]).toContain("eval:quality:release");
    expect(packageJson.scripts["verify:release"]).not.toContain("eval:quality:release:offline");
    expect(packageJson.scripts["verify:release:offline"]).toContain("verify-release-offline.mjs");
  });

  it("sanitizes provider credentials and keeps staging workflow variables OpenAI-free", () => {
    const evalRunner = readFileSync(join(process.cwd(), "scripts", "run-eval-safe.mjs"), "utf8");
    const releaseRunner = readFileSync(join(process.cwd(), "scripts", "verify-release-offline.mjs"), "utf8");
    const stagingWorkflow = readFileSync(join(process.cwd(), ".github", "workflows", "staging-tenancy.yml"), "utf8");
    expect(evalRunner).toContain('RAG_PROVIDER_MODE: "offline"');
    expect(evalRunner).toContain('OPENAI_API_KEY: ""');
    expect(evalRunner).toContain('OPENAI_ORG_ID: ""');
    expect(evalRunner).toContain('OPENAI_PROJECT_ID: ""');
    expect(releaseRunner).toContain("offlineTestEnvironment(process.env");
    expect(releaseRunner).toContain('NEXT_PUBLIC_SUPABASE_URL: "https://offline.invalid"');
    expect(releaseRunner).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "offline-placeholder"');
    expect(releaseRunner).toContain('SUPABASE_SERVICE_ROLE_KEY: "offline-placeholder"');
    const offlineDatabaseUrl = ["postgresql://offline", "offline@offline.invalid:5432/offline"].join(":");
    expect(releaseRunner).toContain(
      'SUPABASE_DB_URL: ["postgresql://offline", "offline@offline.invalid:5432/offline"].join(":"),',
    );
    expect(releaseRunner).not.toContain(`SUPABASE_DB_URL: "${offlineDatabaseUrl}"`);
    expect(releaseRunner).not.toContain('"check:production-readiness"');
    expect(releaseRunner).not.toContain('"governance:release"');
    expect(releaseRunner).not.toContain('"eval:quality:release:offline"');
    expect(releaseRunner).toContain('"eval:rag:offline"');
    expect(stagingWorkflow).not.toMatch(/OPENAI_(?:API_KEY|ORG_ID|PROJECT_ID)/);
  });

  it("isolates every release child and prevents env-file reload from restoring provider access", () => {
    const root = mkdtempSync(join(tmpdir(), "offline-release-profile-"));
    try {
      const capturePath = join(root, "children.jsonl");
      const npmPath = join(root, "npm-stub.cjs");
      const envLoaderPath = import.meta.resolve("@next/env");
      const synthetic = Object.fromEntries(providerEnvironmentKeys.map((key) => [key, `synthetic-inherited-${key}`]));
      writeFileSync(
        join(root, ".env.local"),
        [
          ...providerEnvironmentKeys.map((key) => `${key}=synthetic-file-${key}`),
          "OFFLINE_ENV_RELOAD_SENTINEL=synthetic-loaded",
        ].join("\n"),
      );
      writeFileSync(
        npmPath,
        `
        const { appendFileSync } = require("node:fs");
        const { fileURLToPath } = require("node:url");
        const nextEnv = require(fileURLToPath(${JSON.stringify(envLoaderPath)}));
        nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
        appendFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ step: process.argv[3], env: process.env }) + "\\n");
      `,
      );
      const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/verify-release-offline.mjs")], {
        cwd: root,
        env: { ...process.env, ...synthetic, NODE_ENV: "development", npm_execpath: npmPath },
        encoding: "utf8",
        timeout: 30000,
        shell: false,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const children = readFileSync(capturePath, "utf8")
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              step: string;
              env: Record<string, string>;
            },
        );
      expect(children.map(({ step }) => step)).toEqual([
        "check:runtime",
        "lint",
        "typecheck",
        "test",
        "build",
        "test:e2e",
        "check:function-grants",
        "check:owner-scope",
        "check:rag:fixtures",
        "eval:rag:offline",
      ]);
      const stagingValues: Record<string, string> = {
        NEXT_PUBLIC_SUPABASE_URL: "https://offline.invalid",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "offline-placeholder",
        SUPABASE_SERVICE_ROLE_KEY: "offline-placeholder",
        SUPABASE_DB_URL: ["postgresql://offline", "offline@offline.invalid:5432/offline"].join(":"),
        CROSS_TENANT_SUPABASE_URL: "https://offline.invalid",
        CROSS_TENANT_SUPABASE_SERVICE_ROLE_KEY: "offline-placeholder",
      };
      const expectedProviderValues: Readonly<Partial<Record<string, string>>> = {
        ...offlineUrlValues,
        ...stagingValues,
      };
      const nextConfig = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
      const uploadPredicate = nextConfig.match(/function shouldUploadSentrySourceMaps\(\) \{[\s\S]*?\n\}/)?.[0];
      expect(uploadPredicate).toBeTruthy();
      for (const { env } of children) {
        expect(env.OFFLINE_ENV_RELOAD_SENTINEL).toBe("synthetic-loaded");
        for (const key of providerEnvironmentKeys) {
          expect(env[key], key).toBe(expectedProviderValues[key] ?? "");
        }
        expect(env).toMatchObject({
          RAG_PROVIDER_MODE: "offline",
          NEXT_PUBLIC_DEMO_MODE: "true",
          ...offlineSentryControlFlags,
        });
        expect(runInNewContext(`${uploadPredicate}; shouldUploadSentrySourceMaps()`, { process: { env } })).toBe(false);
      }
      expect(
        runInNewContext(`${uploadPredicate}; shouldUploadSentrySourceMaps()`, { process: { env: synthetic } }),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
