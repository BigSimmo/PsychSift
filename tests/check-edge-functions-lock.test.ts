import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("edge typecheck dependency lock", () => {
  it("keeps the edge dependency lock independent of the Next package workspace", () => {
    const lock = JSON.parse(readFileSync(new URL("../deno.lock", import.meta.url), "utf8"));
    expect(lock.workspace).toBeUndefined();
    expect(lock.specifiers["npm:postgres@3.4.7"]).toBe("3.4.7");
    expect(lock.npm["postgres@3.4.7"].integrity).toMatch(/^sha512-/);
  });
  // This fixture relies on POSIX executable/shebang lookup; Windows does not
  // launch extensionless scripts through spawnSync's shell-free PATH lookup.
  it.skipIf(process.platform === "win32")(
    "requires frozen checked-in lock resolution and propagates a frozen-check failure",
    () => {
      const root = mkdtempSync(path.join(os.tmpdir(), "edge-lock-"));
      try {
        mkdirSync(path.join(root, "supabase/functions/example"), { recursive: true });
        writeFileSync(path.join(root, "supabase/functions/example/index.ts"), "export {};");
        const binary = path.join(root, "deno");
        const argsFile = path.join(root, "args.json");
        writeFileSync(
          binary,
          `#!${process.execPath}\nconst fs=require('node:fs'); if(process.argv.includes('--version')) console.log('deno 2.8.0'); else {fs.writeFileSync(${JSON.stringify(argsFile)},JSON.stringify({args:process.argv.slice(2),noPackageJson:process.env.DENO_NO_PACKAGE_JSON})); process.exit(23);}`,
        );
        chmodSync(binary, 0o755);
        const script = new URL("../scripts/check-edge-functions.mjs", import.meta.url);
        const result = spawnSync(process.execPath, [fileURLToPath(script)], {
          cwd: root,
          env: { ...process.env, PATH: root, CI: "true" },
          encoding: "utf8",
        });
        expect(result.status).toBe(23);
        expect(JSON.parse(readFileSync(argsFile, "utf8"))).toEqual({
          args: [
            "check",
            "--node-modules-dir=false",
            "--lock=deno.lock",
            "--frozen",
            "supabase/functions/example/index.ts",
          ],
          noPackageJson: "1",
        });
      } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  );
});
