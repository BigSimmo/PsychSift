import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { DEFAULT_NODE_OPTIONS, nextBuildArguments, nextBuildEnvironment } from "../scripts/run-next-build.mjs";
import { offlineTestEnvironment } from "../scripts/test-environment.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

describe("cross-platform next build step (#NM9S1V)", () => {
  it("defaults NODE_OPTIONS to the 8 GiB heap when it is unset or empty", () => {
    expect(DEFAULT_NODE_OPTIONS).toBe("--max-old-space-size=8192");
    expect(nextBuildEnvironment({}).NODE_OPTIONS).toBe("--max-old-space-size=8192");
    expect(nextBuildEnvironment({ NODE_OPTIONS: "" }).NODE_OPTIONS).toBe("--max-old-space-size=8192");
  });

  it("keeps an existing NODE_OPTIONS exactly, as the POSIX default expansion did", () => {
    const env = nextBuildEnvironment({ NODE_OPTIONS: "--max-old-space-size=6144", PATH: "/bin" });
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=6144");
    expect(env.PATH).toBe("/bin");
  });

  it("runs next build --webpack under the same 8 GiB parent heap flag", () => {
    const root = path.join("repo", "root");
    expect(nextBuildArguments(root)).toEqual([
      "--max-old-space-size=8192",
      path.join(root, "node_modules", "next", "dist", "bin", "next"),
      "build",
      "--webpack",
    ]);
  });

  it("keeps POSIX-only inline environment assignments out of the build scripts", () => {
    const build = packageJson.scripts["build:internal"];
    expect(build).toContain("node scripts/run-next-build.mjs");
    expect(build).not.toMatch(/NODE_OPTIONS=/);
    expect(build).not.toContain("${");
  });
});

/** Evaluate only the runner's real environment initializer: importing its module would start a build. */
function playwrightBuildEnvironment(
  environment: Record<string, string>,
): Record<string, string> & { NODE_ENV: "production" } {
  const source = readFileSync(new URL("../scripts/run-playwright.mjs", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("run-playwright.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let initializer: string | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "offlineEnv" &&
      node.initializer
    ) {
      initializer = node.initializer.getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (!initializer) throw new Error("Playwright build environment initializer was not found.");
  const result = runInNewContext(
    initializer,
    {
      offlineTestEnvironment,
      nextBuildEnvironment,
      lock: { environment },
      port: 3131,
      baseUrl: "http://127.0.0.1:3131",
      relativeDistDir: ".next-playwright/synthetic-heap/dist",
      relativeTsConfigPath: ".next-playwright/synthetic-heap/tsconfig.json",
      mockupProjectRequested: false,
    },
    { timeout: 1000 },
  ) as Record<string, string>;
  if (result.NODE_ENV !== "production") throw new Error("Expected the runner's production environment.");
  return { ...result, NODE_ENV: result.NODE_ENV };
}

describe("Playwright build child-process heap", () => {
  it.each<{
    name: string;
    input: Record<string, string>;
    expectedOptions: string;
    heapMiB: number;
  }>([
    { name: "unset", input: {}, expectedOptions: "--max-old-space-size=8192", heapMiB: 8192 },
    { name: "blank", input: { NODE_OPTIONS: "" }, expectedOptions: "--max-old-space-size=8192", heapMiB: 8192 },
    {
      name: "explicit caller budget",
      input: { NODE_OPTIONS: "--max-old-space-size=6144" },
      expectedOptions: "--max-old-space-size=6144",
      heapMiB: 6144,
    },
  ])(
    "propagates $name heap settings to a real child without provider access",
    ({ input, expectedOptions, heapMiB }) => {
      const environment = playwrightBuildEnvironment({
        ...input,
        OPENAI_API_KEY: "synthetic-provider-sentinel",
        SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-sentinel",
        KEEP_SYNTHETIC_VALUE: "kept",
      });
      const child = spawnSync(
        process.execPath,
        ["-e", 'console.log(JSON.stringify({heap:require("node:v8").getHeapStatistics().heap_size_limit}))'],
        { env: environment, encoding: "utf8", timeout: 10000 },
      );
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      const observed = JSON.parse(child.stdout) as { heap: number };
      expect(observed.heap).toBeGreaterThanOrEqual(heapMiB * 1024 ** 2);
      expect(observed.heap).toBeLessThan((heapMiB + 256) * 1024 ** 2);
      expect(environment.NODE_OPTIONS).toBe(expectedOptions);
      expect(environment.KEEP_SYNTHETIC_VALUE).toBe("kept");
      expect(environment.OPENAI_API_KEY).toBe("");
      expect(environment.SUPABASE_SERVICE_ROLE_KEY).toBe("");
      expect(environment.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:1");
      expect(environment.PLAYWRIGHT_OFFLINE_MODE).toBe("true");
      expect(environment.NEXT_DIST_DIR).toBe(".next-playwright/synthetic-heap/dist");
    },
  );
});
