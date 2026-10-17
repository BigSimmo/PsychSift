import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  anonymousFetchEnvironment,
  checkCloudContracts,
  inspectCheckout,
  repositoryMatrix,
} from "../scripts/check-cross-repo-cloud-contracts.mjs";

const temporaryRoots: string[] = [];
afterEach(() =>
  temporaryRoots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
);
const sourceRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(sourceRoot, "scripts/check-cross-repo-cloud-contracts.mjs");

function fixture() {
  // Small synthetic surfaces exercise the actual shared contracts; no copied global policy.
  return {
    "AGENTS.md":
      "# Yarn\n[portable workflow](docs/portable-workflow.md)\nNo external memory namespace is approved for Yarn.",
    "CLAUDE.md": "@AGENTS.md\nA client-specific orientation can differ.",
    "GEMINI.md": "Read [project instructions](AGENTS.md) before work.",
    "README.md": "# Yarn\n[portable workflow](docs/portable-workflow.md)",
    "docs/portable-workflow.md": "Use direct Node entry before setup. Native loading requires a fresh session.",
    "package.json": JSON.stringify({
      name: "workspace",
      packageManager: "pnpm@11.1.1",
      engines: { node: ">=24.16.0 <25" },
      scripts: {
        "check:checkout": "node scripts/portable-workflow.mjs identity",
        "preview:cloud": "node scripts/portable-workflow.mjs run",
        "preview:guard": "node scripts/portable-workflow.mjs guard",
      },
    }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'",
    "pnpm-workspace.yaml": "verifyDepsBeforeRun: error",
    "scripts/portable-workflow.mjs": `export const config = { repository: "BigSimmo/Yarn", port: 24443 };
      export function assertCheckout() { return realpathSync(git(["rev-parse", "--show-toplevel"])); }
      export function validateReply(reply, state, challenge) {
        if (reply.challenge !== challenge || reply.pid !== state.pid || reply.port !== state.port || reply.rootId !== state.rootId) throw Error("identity");
      }
      const policy = { npm_config_verify_deps_before_run: "error", pnpm_config_verify_deps_before_run: "error" };
      const option = "--config.verify-deps-before-run=error";`,
    "scripts/portable-preview.mjs": "// Synthetic server surface; never executed by the checker.",
  };
}

function failures(files: Record<string, string>, repo = "Yarn") {
  return checkCloudContracts(repo, (file: string) => files[file] ?? null);
}

function checkout(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cloud-contracts-"));
  temporaryRoots.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  const env = {
    NODE_ENV: "test" as const,
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  git("init", "--quiet");
  git("config", "user.name", "Synthetic fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("remote", "add", "origin", "https://github.com/BigSimmo/Yarn.git");
  git("add", ".");
  git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "Synthetic fixture");
  return { root, git, revision: git("rev-parse", "HEAD") };
}

describe("cross-repository Cloud contracts", () => {
  it("preserves Windows transport/runtime environment names regardless of their casing", () => {
    const source = {
      Path: "C:\\Synthetic\\bin",
      SYSTEMROOT: "C:\\Windows",
      TmpDir: "C:\\Synthetic\\temp",
      Temp: "C:\\Synthetic\\temp",
      Tmp: "C:\\Synthetic\\temp",
      Https_Proxy: "https://proxy.example.invalid",
      Http_Proxy: "http://proxy.example.invalid",
      All_Proxy: "http://proxy.example.invalid",
      No_Proxy: "localhost",
      Ssl_Cert_File: "C:\\Synthetic\\ca.pem",
      Ssl_Cert_Dir: "C:\\Synthetic\\certs",
      Git_Ssl_CaInfo: "C:\\Synthetic\\git-ca.pem",
      Git_Ssl_CaPath: "C:\\Synthetic\\git-certs",
    };
    expect(anonymousFetchEnvironment(source, "win32")).toEqual({
      ...source,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: os.devNull,
    });
  });

  it.each(["linux", "darwin"])("retains existing case-sensitive environment filtering on %s", (platform) => {
    const allowed = {
      PATH: "/synthetic/bin",
      SystemRoot: "synthetic-system-root",
      TMPDIR: "/synthetic/temp",
      HTTPS_PROXY: "https://upper-proxy.example.invalid",
      https_proxy: "https://lower-proxy.example.invalid",
      ALL_PROXY: "http://upper-proxy.example.invalid",
      all_proxy: "http://lower-proxy.example.invalid",
      NO_PROXY: "localhost",
      no_proxy: "127.0.0.1",
      SSL_CERT_FILE: "/synthetic/ca.pem",
      GIT_SSL_CAINFO: "/synthetic/git-ca.pem",
    };
    expect(
      anonymousFetchEnvironment(
        { ...allowed, Path: "excluded", SYSTEMROOT: "excluded", Https_Proxy: "excluded", Git_Ssl_CaInfo: "excluded" },
        platform,
      ),
    ).toEqual({
      ...allowed,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: os.devNull,
    });
  });

  it.each(["win32", "linux", "darwin"])("blocks credentials and inherited Git config on %s", (platform) => {
    const source = Object.fromEntries(
      [
        "GH_TOKEN",
        "Github_Token",
        "OPENAI_API_KEY",
        "SUPABASE_ACCESS_TOKEN",
        "DATABASE_URL",
        "HOME",
        "USERPROFILE",
        "CODEX_HOME",
        "NODE_OPTIONS",
        "GIT_ASKPASS",
        "SSH_ASKPASS",
        "GIT_CONFIG",
        "GIT_CONFIG_SYSTEM",
        "Git_Config_Global",
        "Git_Config_NoSystem",
        "Git_Terminal_Prompt",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_KEY_0",
        "GIT_CONFIG_VALUE_0",
        "GIT_SSH_COMMAND",
        "GIT_SSL_NO_VERIFY",
      ].map((key) => [key, "synthetic-blocked-value"]),
    );
    expect(anonymousFetchEnvironment(source, platform)).toEqual({
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: os.devNull,
    });
  });

  it("maintains six active repository adapters and an explicitly inactive backup", () => {
    expect(repositoryMatrix.map((entry: { name: string }) => entry.name)).toEqual([
      "PsychSift",
      "Communication",
      "Medications",
      "Ward-Flow",
      "Yarn",
      "caring-contacts",
      "ward-flow-backup",
    ]);
    expect(repositoryMatrix.filter((entry: { active: boolean }) => entry.active)).toHaveLength(6);
  });

  it("accepts different native adapter prose and markdown Gemini entry links", () => {
    expect(failures(fixture())).toEqual([]);
  });

  it.each(["AGENTS.md", "CLAUDE.md", "GEMINI.md", "pnpm-lock.yaml", "scripts/portable-preview.mjs"])(
    "fails closed when %s is missing",
    (file) => {
      const files: Record<string, string> = fixture();
      delete files[file];
      expect(failures(files).some((failure: { file: string }) => failure.file === file)).toBe(true);
    },
  );

  it("catches broken rule imports without requiring adapter equality", () => {
    const files = fixture();
    files["GEMINI.md"] = "@../PsychSift/AGENTS.md";
    expect(failures(files)).toContainEqual(expect.objectContaining({ code: "native-entry", file: "GEMINI.md" }));
  });

  it("catches bootstrap alias drift, missing targets and implicit-install regression", () => {
    const files = fixture();
    files["package.json"] = files["package.json"].replace("portable-workflow.mjs guard", "missing-workflow.mjs guard");
    files["pnpm-workspace.yaml"] = "verifyDepsBeforeRun: install";
    expect(failures(files).map((failure: { code: string }) => failure.code)).toEqual(
      expect.arrayContaining(["bootstrap-alias", "implicit-install"]),
    );
  });

  it("detects loss of preview challenge ownership checks", () => {
    const files = fixture();
    files["scripts/portable-workflow.mjs"] = files["scripts/portable-workflow.mjs"].replace(
      "reply.pid !== state.pid",
      "true",
    );
    expect(failures(files)).toContainEqual(expect.objectContaining({ code: "preview-ownership" }));
  });

  it("keeps the backup historical and refuses to treat it as a runnable app", () => {
    const files = {
      "README.md":
        "Backup destination, not a runnable application or Cloud setup target. See https://github.com/BigSimmo/Ward-Flow. Historical snapshot.",
    };
    expect(failures(files, "ward-flow-backup")).toEqual([]);
    expect(failures({ ...files, "package.json": "{}" }, "ward-flow-backup")).toContainEqual(
      expect.objectContaining({ code: "backup-activation" }),
    );
  });

  it("catches legacy profile migration losing its explicit-selection guard", () => {
    const read = (file: string) => {
      try {
        return readFileSync(path.join(sourceRoot, file), "utf8");
      } catch {
        return null;
      }
    };
    expect(checkCloudContracts("PsychSift", read)).toEqual([]);
    expect(
      checkCloudContracts("PsychSift", (file: string) =>
        file === "scripts/maintain-codex-cloud.sh"
          ? read(file)?.replace('[[ "$requested_cloud_profile_set" = yes ]] ||', "true ||")
          : read(file),
      ),
    ).toContainEqual(expect.objectContaining({ code: "legacy-migration-selection" }));
  });

  it("reads immutable selected git blobs while identifying dirty working-tree evidence separately", () => {
    const { root, revision } = checkout(fixture());
    writeFileSync(path.join(root, "GEMINI.md"), "No project import");
    expect(inspectCheckout("Yarn", root, revision)).toMatchObject({
      revision,
      source: "git-blobs",
      status: "pass",
      failures: [],
    });
    expect(inspectCheckout("Yarn", root)).toMatchObject({
      revision,
      source: "working-tree",
      dirty: true,
      status: "fail",
    });
  });

  it("rejects a wrong checkout origin and a missing pinned revision", () => {
    const { root, git } = checkout(fixture());
    expect(inspectCheckout("Yarn", root, "0".repeat(40))).toMatchObject({ status: "unverified" });
    git("remote", "set-url", "origin", "https://github.com/BigSimmo/Medications.git");
    expect(inspectCheckout("Yarn", root)).toMatchObject({ status: "unverified" });
  });

  it("CLI returns exact pinned revision and nonzero for an unavailable requested repo", () => {
    const { root, revision } = checkout(fixture());
    const result = spawnSync(
      process.execPath,
      [script, "--repo", "Yarn", "--root", root, "--revision", revision, "--json"],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).results[0]).toMatchObject({ revision, status: "pass" });
    const unavailable = spawnSync(
      process.execPath,
      [script, "--repo", "Yarn", "--root", path.join(root, "absent"), "--json"],
      { encoding: "utf8" },
    );
    expect(unavailable.status).toBe(1);
    expect(JSON.parse(unavailable.stdout).results[0].status).toBe("unverified");
  });

  it("CI scopes PR checks locally and makes unauthenticated multi-repo fetch opt-in", () => {
    const workflow = readFileSync(path.join(sourceRoot, ".github/workflows/cloud-contracts.yml"), "utf8");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("--fetch-maintained");
    expect(workflow).toContain("--root .");
    expect(workflow).not.toMatch(/pull_request_target|secrets\.|npm (?:ci|install)|continue-on-error/);
    expect(workflow).toContain("scripts/check-cross-repo-cloud-contracts.mjs");
  });
});
