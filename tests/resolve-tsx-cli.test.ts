import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveTsxCli } from "../scripts/resolve-tsx-cli.mjs";

const created: string[] = [];
afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("resolveTsxCli", () => {
  it("falls back from a secondary worktree to the main checkout node_modules", () => {
    const root = mkdtempSync(join(tmpdir(), "tsx-worktree-"));
    created.push(root);
    const main = join(root, "repo");
    const secondary = join(root, "secondary");
    const gitDir = join(main, ".git");
    const secondaryGitDir = join(gitDir, "worktrees", "secondary");
    const cli = join(main, "node_modules", "tsx", "dist", "cli.mjs");
    mkdirSync(secondaryGitDir, { recursive: true });
    mkdirSync(secondary, { recursive: true });
    mkdirSync(join(main, "node_modules", "tsx", "dist"), { recursive: true });
    // An ancestor install must not shadow the dependency belonging to the Git checkout.
    mkdirSync(join(root, "node_modules", "tsx", "dist"), { recursive: true });
    writeFileSync(join(root, "node_modules", "tsx", "dist", "cli.mjs"), "");
    writeFileSync(cli, "");
    writeFileSync(join(secondary, ".git"), `gitdir: ${secondaryGitDir}`);
    writeFileSync(join(secondaryGitDir, "gitdir"), join(secondary, ".git"));

    expect(
      resolveTsxCli(secondary, () => {
        throw new Error("local resolution unavailable");
      }),
    ).toBe(cli);
  });
});
