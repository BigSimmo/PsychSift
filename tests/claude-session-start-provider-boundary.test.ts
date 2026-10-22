import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function captureStartupCommands() {
  const filename = resolve("scripts/claude-session-start.mjs");
  const source = readFileSync(filename, "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replaceAll("import.meta.url", JSON.stringify(pathToFileURL(filename).href));
  const commands: Array<{ args: string[]; options: { env?: Record<string, string> } }> = [];
  const environment = { CLAUDE_PROJECT_DIR: "/fixture/project", BASE_FRESHNESS_NO_FETCH: "0", FIXTURE: "kept" };
  runInNewContext(source, {
    dirname,
    join,
    resolve,
    fileURLToPath,
    process: {
      env: environment,
      argv: ["node", filename, "/fixture/scratch"],
      execPath: "fixture-node",
      stderr: { write() {} },
    },
    console: { log() {} },
    readFileSync: (file: string) => (file.endsWith("payload") ? "{}" : file.endsWith("bootstrap-status") ? "1" : ""),
    spawnSync: (_command: string, args: string[], options: { env?: Record<string, string> }) => {
      commands.push({ args, options });
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  return { commands, environment };
}

describe("automatic Claude startup provider boundary", () => {
  it("forces the freshness child to use cached refs even when the inherited value permits fetch", () => {
    const { commands } = captureStartupCommands();
    const freshness = commands.find(({ args }) => args.includes("scripts/check-base-freshness.mjs"));
    expect(freshness).toBeDefined();
    expect(freshness?.options.env?.BASE_FRESHNESS_NO_FETCH).toBe("1");
    expect(freshness?.options.env?.FIXTURE).toBe("kept");
  });

  it("does not change the caller's environment or run cloud setup after failed bootstrap", () => {
    const { commands, environment } = captureStartupCommands();
    expect(environment.BASE_FRESHNESS_NO_FETCH).toBe("0");
    expect(commands.some(({ args }) => args.includes("scripts/setup-claude-cloud.sh"))).toBe(false);
  });
});
