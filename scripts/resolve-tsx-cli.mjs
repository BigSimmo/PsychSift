import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function addAncestors(candidates, start) {
  let current = resolve(start);
  while (true) {
    candidates.add(current);
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function worktreeRoots(projectRoot) {
  const roots = new Set();
  const dotGit = join(projectRoot, ".git");
  if (!existsSync(dotGit)) return roots;
  try {
    const pointer = readFileSync(dotGit, "utf8")
      .trim()
      .replace(/^gitdir:\s*/i, "");
    const gitDir = isAbsolute(pointer) ? pointer : resolve(projectRoot, pointer);
    const commonGitDir = resolve(gitDir, "..", "..");
    roots.add(dirname(commonGitDir));
    const worktreesDir = join(commonGitDir, "worktrees");
    if (existsSync(worktreesDir)) {
      for (const name of readdirSync(worktreesDir)) {
        const gitdirFile = join(worktreesDir, name, "gitdir");
        if (!existsSync(gitdirFile)) continue;
        const worktreeGitFile = readFileSync(gitdirFile, "utf8").trim();
        roots.add(dirname(worktreeGitFile));
      }
    }
  } catch {
    // A normal checkout has a .git directory, not a pointer file. Ancestor
    // lookup below already covers its local node_modules.
  }
  return roots;
}

export function resolveTsxCli(projectRoot, moduleResolve = (specifier) => import.meta.resolve(specifier)) {
  try {
    return fileURLToPath(moduleResolve("tsx/cli"));
  } catch {
    // Prefer this checkout and its Git worktrees before unrelated ancestor installs.
    const roots = new Set([resolve(projectRoot), ...worktreeRoots(projectRoot)]);
    for (const root of [...roots]) addAncestors(roots, root);
    for (const root of roots) {
      const candidate = join(root, "node_modules", "tsx", "dist", "cli.mjs");
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`Unable to resolve tsx/cli from ${projectRoot} or its Git worktrees.`);
  }
}
