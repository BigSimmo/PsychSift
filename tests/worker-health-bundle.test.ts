import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { workerBuildOptions } from "../scripts/build-worker.mjs";

it(
  "binds health once when its module is included in a direct Node ESM worker bundle",
  { timeout: 60_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "worker-health-bundle-"));
    const bundlePath = join(directory, "health-entry.mjs");
    const mocks: Record<string, string> = {
      "node:http":
        "export function createServer() { return { listen() { console.log('HEALTH_BIND'); }, close() {} }; }",
      "../src/lib/supabase/admin": "export function createAdminClient() { return {}; }",
      "../src/lib/supabase/health": "export async function probeSupabaseHealth() { return { ok: true }; }",
      "../src/lib/privacy": "export function safeErrorLogDetails() { return 'offline fixture'; }",
    };
    try {
      await build({
        ...workerBuildOptions,
        entryPoints: undefined,
        stdin: {
          contents:
            'import { startWorkerHealthServerIfConfigured } from "./worker/health.ts"; startWorkerHealthServerIfConfigured();',
          resolveDir: fileURLToPath(new URL("..", import.meta.url)),
          loader: "ts",
        },
        outfile: bundlePath,
        sourcemap: false,
        logLevel: "silent",
        plugins: [
          {
            name: "offline-health-dependencies",
            setup(builder) {
              builder.onResolve(
                { filter: /^node:http$|^\.\.\/src\/lib\/(supabase\/(admin|health)|privacy)$/ },
                (args) => ({ path: args.path, namespace: "health-fixture" }),
              );
              builder.onLoad({ filter: /.*/, namespace: "health-fixture" }, (args) => ({
                contents: mocks[args.path],
                loader: "js",
              }));
            },
          },
        ],
      });
      const stdout = execFileSync(process.execPath, [bundlePath], {
        env: { ...process.env, PORT: "8080", WORKER_HEALTH_PORT: "" },
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(stdout.trim().split(/\r?\n/)).toEqual(["HEALTH_BIND"]);
    } finally {
      rmSync(bundlePath, { force: true });
      rmdirSync(directory);
    }
  },
);
