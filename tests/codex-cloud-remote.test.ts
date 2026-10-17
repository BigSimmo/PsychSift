import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODEX_CLOUD_REPOSITORY,
  ensureOriginRemote,
  inspectOriginRemote,
  remoteRepositoryIdentity,
} from "../scripts/ensure-codex-cloud-git-remote.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("Cloud remote provider identity", () => {
  it.each([
    "BigSimmo/PsychSift",
    "/BigSimmo/PsychSift.git",
    "file:///BigSimmo/PsychSift.git",
    "https://example.com/BigSimmo/PsychSift.git",
    "https://github.com.example.com/BigSimmo/PsychSift.git",
    "https://synthetic-token@github.com/BigSimmo/PsychSift.git",
  ])("does not identify a local, foreign or credential-bearing remote as GitHub: %s", (remote) => {
    expect(remoteRepositoryIdentity(remote)).toBeNull();
  });

  it.each([
    "https://github.com/BigSimmo/PsychSift.git",
    "https://github.com/BigSimmo/PsychSift",
    "git@github.com:BigSimmo/PsychSift.git",
    "ssh://git@github.com/BigSimmo/PsychSift.git",
  ])("preserves supported credential-free GitHub transport identity: %s", (remote) => {
    expect(remoteRepositoryIdentity(remote)).toBe(CODEX_CLOUD_REPOSITORY);
  });

  it("refuses to preserve a local-path origin and leaves the configured remote unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "cloud-remote-"));
    roots.push(root);
    const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    expect(git("init", "--quiet").status).toBe(0);
    expect(git("remote", "add", "origin", "BigSimmo/PsychSift").status).toBe(0);
    expect(inspectOriginRemote(root)).toEqual({
      configured: true,
      repositoryMatch: false,
      credentialsEmbedded: false,
    });
    expect(() => ensureOriginRemote(root)).toThrow("refusing to overwrite");
    expect(git("config", "--get", "remote.origin.url").stdout.trim()).toBe("BigSimmo/PsychSift");
  });
});
