import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDoclingShadowEnvironment, runDoclingShadowScript } from "../worker/shadow-extraction";

// Launches a real task-owned child process, standing in for the Docling interpreter. It
// records booleans and synthetic paths only. This proves process-environment/cleanup wiring,
// not Docling compatibility, PDF parsing or an OS filesystem/network sandbox.
describe.skipIf(process.platform === "win32")("shadow child environment and owned-directory cleanup", () => {
  let fixture: string;
  let ambientTemp: string;
  let artifacts: string;
  let launcher: string;
  let trace: string;

  beforeEach(async () => {
    fixture = await mkdtemp(path.join(tmpdir(), "psychsift-shadow-env-test-"));
    ambientTemp = path.join(fixture, "ambient-temp");
    artifacts = path.join(fixture, "model-artifacts");
    launcher = path.join(fixture, "fake-python");
    trace = path.join(fixture, "child-trace.json");
    await mkdir(ambientTemp);
    await mkdir(artifacts);
    await writeFile(path.join(artifacts, "retain-model.txt"), "synthetic retained model");
    await mkdir(path.join(fixture, "outside-artifact-cache"));
    await writeFile(path.join(fixture, "outside-artifact-cache", "retain.txt"), "synthetic external cache");
    vi.stubEnv("TMPDIR", ambientTemp);
    vi.stubEnv("HOME", path.join(fixture, "ambient-home"));
    vi.stubEnv("DOCLING_ARTIFACTS_PATH", artifacts);
    vi.stubEnv("HF_HOME", path.join(artifacts, "hf-home"));
    vi.stubEnv("HF_HUB_CACHE", path.join(artifacts, "hub"));
    vi.stubEnv("TRANSFORMERS_CACHE", path.join(artifacts, "transformers"));
    vi.stubEnv("HF_DATASETS_CACHE", path.join(fixture, "outside-artifact-cache"));
    vi.stubEnv("HF_HUB_OFFLINE", "0");
    vi.stubEnv("TRANSFORMERS_OFFLINE", "0");
    vi.stubEnv("HF_DATASETS_OFFLINE", "0");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-shadow-test-secret");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-shadow-test-secret");
    vi.stubEnv("SENTRY_AUTH_TOKEN", "synthetic-shadow-test-secret");
    vi.stubEnv("HTTPS_PROXY", "https://synthetic.invalid");
    vi.stubEnv("PYTHONPATH", "/synthetic/injection");
    vi.stubEnv("NODE_OPTIONS", "--stack-trace-limit=15");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(fixture, { recursive: true, force: true });
  });

  async function fakeInterpreter(mode: "success" | "crash" | "timeout") {
    await writeFile(
      launcher,
      `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const [, pdfPath, resultPath] = process.argv.slice(2);
const workDir = path.dirname(pdfPath);
const state = {
  workDir,
  home: process.env.HOME,
  tmp: process.env.TMPDIR,
  cache: process.env.XDG_CACHE_HOME,
  artifacts: process.env.DOCLING_ARTIFACTS_PATH,
  hfHome: process.env.HF_HOME,
  hubCache: process.env.HF_HUB_CACHE,
  transformersCache: process.env.TRANSFORMERS_CACHE,
  datasetCache: process.env.HF_DATASETS_CACHE,
  hasPath: Boolean(process.env.PATH),
  hasCredentials: ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SENTRY_AUTH_TOKEN"].some(key => Boolean(process.env[key])),
  hasInjection: ["PYTHONPATH", "NODE_OPTIONS", "HTTPS_PROXY"].some(key => Boolean(process.env[key])),
  offline: ["HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE"].every(key => process.env[key] === "1"),
  privateDirectoriesExist: ["HOME", "TMPDIR", "XDG_CACHE_HOME"].every(key => Boolean(process.env[key]) && fs.existsSync(process.env[key])),
};
fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify(state));
fs.writeFileSync(resultPath, JSON.stringify({ engine: "docling", ok: true, state }));
${mode === "timeout" ? "setInterval(() => {}, 1000);" : `process.exit(${mode === "crash" ? 7 : 0});`}
`,
    );
    await chmod(launcher, 0o700);
  }

  it.each(["success", "crash", "timeout"] as const)(
    "isolates credentials/cache config and cleans only owned files after %s",
    async (mode) => {
      await fakeInterpreter(mode);
      const result = await runDoclingShadowScript({
        pythonBin: launcher,
        buffer: Buffer.from("synthetic PDF bytes"),
        timeoutMs: mode === "timeout" ? 1000 : 5000,
      });
      const state = JSON.parse(await readFile(trace, "utf8"));
      expect(result).toMatchObject({
        timedOut: mode === "timeout",
        exitCode: mode === "timeout" ? null : mode === "crash" ? 7 : 0,
      });
      expect(state).toMatchObject({
        hasCredentials: false,
        hasInjection: false,
        offline: true,
        hasPath: true,
        privateDirectoriesExist: true,
        home: path.join(state.workDir, "home"),
        tmp: path.join(state.workDir, "tmp"),
        cache: path.join(state.workDir, "cache"),
        artifacts,
        hfHome: path.join(artifacts, "hf-home"),
        hubCache: path.join(artifacts, "hub"),
        transformersCache: path.join(artifacts, "transformers"),
      });
      expect(state.datasetCache).toBe(path.join(state.workDir, "cache", "huggingface", "datasets"));
      await expect(stat(state.workDir)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(ambientTemp)).toEqual([]);
      expect(await readFile(path.join(artifacts, "retain-model.txt"), "utf8")).toBe("synthetic retained model");
      expect(await readFile(path.join(fixture, "outside-artifact-cache", "retain.txt"), "utf8")).toBe(
        "synthetic external cache",
      );
    },
    10_000,
  );

  it("removes its generated directories on spawn failure without touching artifact caches", async () => {
    const result = await runDoclingShadowScript({
      pythonBin: launcher,
      buffer: Buffer.from("synthetic PDF bytes"),
      timeoutMs: 1000,
    });
    expect(result.spawnErrorCode).toBe("ENOENT");
    expect(await readdir(ambientTemp)).toEqual([]);
    expect(await readFile(path.join(artifacts, "retain-model.txt"), "utf8")).toBe("synthetic retained model");
  });

  it("does not confuse sibling/traversal cache paths with the configured artifact tree", () => {
    const workDir = path.join(fixture, "owned-run");
    for (const cachePath of [`${artifacts}-sibling/hub`, path.join(artifacts, "..", "outside"), "/outside/hub"]) {
      const environment = buildDoclingShadowEnvironment(workDir, {
        NODE_ENV: "test",
        DOCLING_ARTIFACTS_PATH: artifacts,
        HF_HUB_CACHE: cachePath,
        UNRECOGNIZED_CREDENTIAL: "synthetic credential",
        HF_TOKEN: "synthetic token",
        LD_PRELOAD: "/synthetic/injection",
      });
      expect(environment.HF_HUB_CACHE).toBe(path.join(workDir, "cache", "huggingface", "hub"));
      expect(environment.NODE_ENV).toBe("production");
      expect(environment.UNRECOGNIZED_CREDENTIAL).toBeUndefined();
      expect(environment.HF_TOKEN).toBeUndefined();
      expect(environment.LD_PRELOAD).toBeUndefined();
    }
  });
});
