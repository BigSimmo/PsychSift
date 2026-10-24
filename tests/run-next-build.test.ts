import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runNextBuild } from "../scripts/run-next-build.mjs";

describe("cross-platform Next build launcher", () => {
  it.each([undefined, "", "--trace-warnings"])(
    "runs from a path containing spaces and preserves caller options (%s)",
    async (nodeOptions) => {
      const root = mkdtempSync(path.join(tmpdir(), "next build launcher "));
      try {
        const entry = path.join(root, "node_modules/next/dist/bin/next");
        mkdirSync(path.dirname(entry), { recursive: true });
        const output = path.join(root, "invocation.json");
        writeFileSync(
          entry,
          'require("node:fs").writeFileSync(process.env.BUILD_TEST_OUTPUT, JSON.stringify({ args: process.argv.slice(2), execArgs: process.execArgv, options: process.env.NODE_OPTIONS })); process.exit(7);',
        );
        expect(
          await runNextBuild({
            rootDir: root,
            env: { ...process.env, NODE_OPTIONS: nodeOptions, BUILD_TEST_OUTPUT: output },
          }),
        ).toBe(7);
        expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({
          args: ["build", "--webpack"],
          execArgs: ["--max-old-space-size=8192"],
          options: nodeOptions || "--max-old-space-size=8192",
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
