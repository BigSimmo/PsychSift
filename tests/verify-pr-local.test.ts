import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEV_SERVER_BUILD_REFUSED_EXIT_CODE } from "../scripts/guard-next-build.mjs";
import { checkDevServerPreflight, runPrLocalScripts, summarizePrLocalRun } from "../scripts/verify-pr-local.mjs";

const script = path.resolve("scripts/verify-pr-local.mjs");

function dryRun(files: string, ...args: string[]) {
  return execFileSync(process.execPath, [script, "--dry-run", "--files", files, ...args], {
    encoding: "utf8",
  });
}

describe("verify-pr-local CLI", () => {
  it("lets each selected stage acquire its own run lease", () => {
    const source = readFileSync(script, "utf8");
    const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(source).not.toContain("acquireHeavyRunLock");
    expect(source).not.toContain("lock.environment");
    expect(packageJson.scripts["verify:cheap"]).toBe("npm run test:codex-hooks && npm run verify:cheap:internal");
    expect(packageJson.scripts["test:codex-hooks"]).toBe("node --test .codex/hooks/dispatch.test.mjs");
  });

  it("uses the explicit file list and does not execute checks in dry-run mode", () => {
    const output = dryRun("docs/frontend-architecture.md");

    expect(output).toContain("Changed files: docs/frontend-architecture.md");
    expect(output).toContain("PR-local verification plan (dry run)");
    expect(output).toContain("- npm run check:runtime");
    expect(output).toContain("- npm run check:installed-lock-parity");
    expect(output).toContain("- npm run format:changed");
    // Unconditional even for a docs-only change: a committed tool-truncation banner can
    // land in any file, not only a spec (#Y30AXB).
    expect(output).toContain("- npm run check:diff-integrity");
    expect(output).toContain("- build skipped");
    expect(output).not.toContain("\n> npm run ");
  });

  it("selects build and offline RAG contracts for API answer routes without UI", () => {
    const output = dryRun("src/app/api/answer/stream/route.ts", "--extended");

    expect(output).toContain("- npm run build");
    expect(output).toContain("- npm run eval:rag:offline");
    expect(output).not.toContain("- npm run check:rag:fixtures");
    expect(output).toContain("- Chromium UI gate skipped: no UI-affecting changes detected");
    expect(output).not.toContain("- npm run verify:ui");
  });

  it("selects extended UI checks for component changes", () => {
    const output = dryRun("src/components/clinical-dashboard/answer-content.tsx", "--extended");

    expect(output).toContain("- npm run build");
    expect(output).toContain("- npm run eval:rag:offline");
    expect(output).toContain("- npm run verify:ui");
  });

  it("fails fast on package and lockfile install drift before broad PR-local checks (#204)", () => {
    for (const file of ["package.json", "package-lock.json"]) {
      const output = dryRun(file);
      expect(output).toContain("- npm run check:npm-ci-dry-run");
      expect(output.indexOf("- npm run check:npm-ci-dry-run")).toBeLessThan(output.indexOf("- npm run lint"));
    }
  });

  it("does not repeat focused workflow contracts inside the full unit suite", () => {
    const output = dryRun(".github/workflows/ci.yml,package.json");
    expect(output).toContain("- npm run test");
    expect(output).not.toContain("- npm run test:ci-workflows");
  });

  it("requires explicit approval before executing the extended plan", () => {
    const result = spawnSync(process.execPath, [script, "--extended", "--files", "docs/frontend-architecture.md"], {
      encoding: "utf8",
      env: { ...process.env, ALLOW_EXTENDED_PR_LOCAL: "" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ALLOW_EXTENDED_PR_LOCAL=true");
  });

  it("treats a refused build as a failed selected step, not a green skip (#167)", () => {
    const error = vi.fn();
    const runScript = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(DEV_SERVER_BUILD_REFUSED_EXIT_CODE);
    const scripts = ["check:runtime", "format:changed", "build", "check:rag:fixtures"];

    const exitCode = runPrLocalScripts(scripts, { runScript, log: () => undefined, error });

    expect(exitCode).toBe(DEV_SERVER_BUILD_REFUSED_EXIT_CODE);
    expect(runScript).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledOnce();
    const summary = String(error.mock.calls[0]?.[0] ?? "");
    expect(summary).toContain("failed: build");
    expect(summary).toContain("BUILD_REFUSED_DEV_SERVER");
    expect(summary).toContain("not reached: check:rag:fixtures");
    expect(summary).not.toMatch(/Skipping build/);
  });

  it("summarizes completed scripts when the whole plan passes", () => {
    const summary = summarizePrLocalRun(["check:runtime", "build"], {
      completed: ["check:runtime", "build"],
      failedScript: null,
      failedExitCode: 0,
    });
    expect(summary).toContain("completed: check:runtime, build");
    expect(summary).toContain("failed: (none)");
    expect(summary).toContain("not reached: (none)");
  });

  it("selects extended UI checks for mode configuration, routing, and UI copy changes (#0HFDWD)", () => {
    for (const file of [
      "src/lib/app-modes.ts",
      "src/lib/search-route-ownership.ts",
      "src/lib/ui-copy.ts",
      "src/lib/therapies.ts",
    ]) {
      const output = dryRun(file, "--extended");
      expect(output).toContain("- npm run verify:ui");
    }
  });

  it("preflights running dev server before build step and emits clear advice (#G4M3DV)", async () => {
    const warn = vi.fn();
    const findServer = vi.fn().mockResolvedValue(3000);

    const port = await checkDevServerPreflight(["check:runtime", "build"], {
      findServer,
      warn,
      env: {} as unknown as NodeJS.ProcessEnv,
    });

    expect(port).toBe(3000);
    expect(findServer).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    const warningMessage = String(warn.mock.calls[0]?.[0] ?? "");
    expect(warningMessage).toContain("http://localhost:3000");
    expect(warningMessage).toContain("BUILD_REFUSED_DEV_SERVER");
    expect(warningMessage).toContain("ALLOW_BUILD_WITH_DEV_SERVER=1");
  });

  it("skips dev server preflight when build is absent or ALLOW_BUILD_WITH_DEV_SERVER is set", async () => {
    const warn = vi.fn();
    const findServer = vi.fn().mockResolvedValue(3000);

    const noBuildPort = await checkDevServerPreflight(["check:runtime", "lint"], {
      findServer,
      warn,
      env: {} as unknown as NodeJS.ProcessEnv,
    });
    expect(noBuildPort).toBeNull();
    expect(findServer).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();

    const allowedPort = await checkDevServerPreflight(["build"], {
      findServer,
      warn,
      env: { ALLOW_BUILD_WITH_DEV_SERVER: "1" } as unknown as NodeJS.ProcessEnv,
    });
    expect(allowedPort).toBeNull();
    expect(findServer).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
