import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `.claude/hooks/session-start.sh` provisions a Node meeting the repo's
 * engine floor. It normally runs as a SessionStart hook, where Claude Code
 * supplies `CLAUDE_ENV_FILE` and `CLAUDE_PROJECT_DIR`.
 *
 * **Running it by hand is a supported path, not a curiosity.** SessionStart
 * hooks do not re-fire when a long-lived session re-bases its checkout onto a
 * newer `main`, so a session that predates this file acquires it without ever
 * executing it, stays on the container's older Node, and then fails
 * `check:runtime` — the first step of `verify:pr-local` — for every diff,
 * docs-only ones included. Running this script is the documented remedy, and
 * `checkNodeRuntime`'s failure message now names both the hook and the caller-
 * persistent export required after a manual invocation.
 *
 * It ran under `set -u` with both variables expanded unguarded, so a manual run
 * aborted with `CLAUDE_ENV_FILE: unbound variable` after the Node tarball had
 * downloaded and after PATH had changed only inside the soon-to-exit child
 * process, but before PATH persistence and before the install. These tests pin
 * that it survives both variables being absent, prints a command that activates
 * the provisioned Node in the invoking shell, and still writes the env file when
 * one is provided.
 *
 * Each test copies the hook into a temporary project, supplies stub `node` and
 * `npm` executables, and writes a matching lockfile stamp. That keeps the tests
 * hermetic: they never download, install, or touch the real checkout.
 */

const sourceHook = join(process.cwd(), ".claude/hooks/session-start.sh");
const NODE_VERSION = "24.19.0";
const scratchRoots: string[] = [];
const bashCommand =
  process.platform === "win32"
    ? ([
        "C:\\Program Files\\Git\\bin\\bash.exe",
        join(process.env.ProgramFiles || "C:\\Program Files", "Git/bin/bash.exe"),
      ].find((p) => existsSync(p)) ?? "bash")
    : "bash";

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

/**
 * A HOME containing the exact provisioned Node layout the hook looks for, and a
 * project whose dependency stamp already matches its lockfile.
 */
function stubEnvironment(): { home: string; project: string; hook: string } {
  const home = mkdtempSync(join(tmpdir(), "session-start-home-"));
  const project = mkdtempSync(join(tmpdir(), "session-start-project-"));
  scratchRoots.push(home, project);

  const hookDir = join(project, ".claude", "hooks");
  mkdirSync(hookDir, { recursive: true });
  const hook = join(hookDir, "session-start.sh");
  copyFileSync(sourceHook, hook);
  chmodSync(hook, 0o755);

  const nodeBin = join(home, ".node24", `node-v${NODE_VERSION}-linux-x64`, "bin");
  mkdirSync(nodeBin, { recursive: true });
  const nodeStub = join(nodeBin, "node");
  writeFileSync(nodeStub, `#!/bin/bash\necho "v${NODE_VERSION}"\n`);
  chmodSync(nodeStub, 0o755);
  const npmStub = join(nodeBin, "npm");
  writeFileSync(npmStub, '#!/bin/bash\nif [ "${1:-}" = "ci" ]; then exit 97; fi\necho "11.17.0"\n');
  chmodSync(npmStub, 0o755);

  const lockfile = join(project, "package-lock.json");
  const lockContents = '{"name":"stub","lockfileVersion":3}\n';
  writeFileSync(lockfile, lockContents);
  const stampDir = join(project, "node_modules", ".cache");
  mkdirSync(stampDir, { recursive: true });
  writeFileSync(
    join(stampDir, "session-start-lock-hash"),
    `${createHash("sha256").update(lockContents).digest("hex")}\n`.trimEnd() + "\n",
  );

  return { home, project, hook };
}

function runHook(hook: string, env: Record<string, string | undefined>, cwd: string) {
  const normalizedEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    normalizedEnv[key] = typeof value === "string" ? value.replace(/\\/g, "/") : value;
  }
  const base = { ...process.env, CLAUDE_CODE_REMOTE: "true", ...normalizedEnv };
  for (const [key, value] of Object.entries(normalizedEnv)) {
    if (value === undefined) delete (base as Record<string, string | undefined>)[key];
  }
  return spawnSync(bashCommand, [hook.replace(/\\/g, "/")], { cwd, env: base as NodeJS.ProcessEnv, encoding: "utf8" });
}

describe("session-start hook", () => {
  it("survives a manual run with no CLAUDE_ENV_FILE", () => {
    const { home, project, hook } = stubEnvironment();

    const result = runHook(hook, { HOME: home, CLAUDE_ENV_FILE: undefined, CLAUDE_PROJECT_DIR: project }, project);

    expect(result.stderr).not.toContain("unbound variable");
    expect(result.status, `hook exited ${result.status}: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("CLAUDE_ENV_FILE is unset");
    expect(result.stdout).toContain("export PATH=");
  });

  it("prints a PATH command that activates the provisioned Node in the invoking shell", () => {
    const { home, project, hook } = stubEnvironment();
    const result = runHook(hook, { HOME: home, CLAUDE_ENV_FILE: undefined, CLAUDE_PROJECT_DIR: project }, project);

    expect(result.status, `hook exited ${result.status}: ${result.stderr}`).toBe(0);
    const exportLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith("export PATH="));
    expect(exportLine).toBeDefined();

    const caller = spawnSync(bashCommand, ["-c", `${exportLine}; node -v`], {
      cwd: project,
      env: { ...process.env, HOME: home.replace(/\\/g, "/") },
      encoding: "utf8",
    });
    expect(caller.status, `caller exited ${caller.status}: ${caller.stderr}`).toBe(0);
    expect(caller.stdout.trim()).toBe(`v${NODE_VERSION}`);
  });

  it("falls back to its own repository when CLAUDE_PROJECT_DIR is absent", () => {
    const { home, hook } = stubEnvironment();

    // Deliberately run from a directory that is neither the repo nor the
    // temporary project: the fallback must derive from the copied hook's path.
    const elsewhere = mkdtempSync(join(tmpdir(), "session-start-elsewhere-"));
    scratchRoots.push(elsewhere);
    const result = runHook(hook, { HOME: home, CLAUDE_ENV_FILE: undefined, CLAUDE_PROJECT_DIR: undefined }, elsewhere);

    expect(result.stderr).not.toContain("unbound variable");
    expect(result.status, `hook exited ${result.status}: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("node_modules matches the lockfile, skipping install");
  });

  it("still writes the env file when Claude Code provides one", () => {
    const { home, project, hook } = stubEnvironment();
    const envFile = join(project, "claude-env");
    writeFileSync(envFile, "");

    const result = runHook(hook, { HOME: home, CLAUDE_ENV_FILE: envFile, CLAUDE_PROJECT_DIR: project }, project);

    expect(result.status, `hook exited ${result.status}: ${result.stderr}`).toBe(0);
    const written = readFileSync(envFile, "utf8");
    // Compare the path tail, not the absolute path. `home` comes from mkdtempSync(tmpdir()),
    // which on Windows is `C:\Users\…\AppData\Local\Temp\session-start-home-XXXX`, while the
    // hook runs under Git Bash and writes the POSIX view of the same directory — `/tmp/
    // session-start-home-XXXX`. Asserting the joined Windows path therefore failed on every
    // Windows run regardless of the diff under test, which made the whole file look red
    // locally and trained readers to wave it through. The unique mkdtemp basename still
    // pins this to *this* test's HOME, so the assertion loses no strength.
    const expectedTail = [basename(home), ".node24", `node-v${NODE_VERSION}-linux-x64`, "bin"].join("/");
    expect(written.replace(/\\/g, "/")).toContain(expectedTail);
    expect(written).toContain("export PATH=");
    // The manual-run advice belongs only to the manual-run branch.
    expect(result.stdout).not.toContain("CLAUDE_ENV_FILE is unset");
  });

  it("does nothing at all outside a Claude Code remote container", () => {
    const { home, project, hook } = stubEnvironment();

    const result = runHook(
      hook,
      { HOME: home, CLAUDE_CODE_REMOTE: undefined, CLAUDE_ENV_FILE: undefined, CLAUDE_PROJECT_DIR: undefined },
      project,
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("emits valid JSON on stdout matching SessionStart schema when running in hook mode", () => {
    const { home, project, hook } = stubEnvironment();
    const envFile = join(project, "claude-env");
    writeFileSync(envFile, "");

    const payload = JSON.stringify({ hook_event_name: "SessionStart" });
    const result = spawnSync(bashCommand, [hook.replace(/\\/g, "/")], {
      cwd: project,
      env: {
        ...process.env,
        HOME: home.replace(/\\/g, "/"),
        CLAUDE_CODE_REMOTE: "true",
        CLAUDE_ENV_FILE: envFile.replace(/\\/g, "/"),
        CLAUDE_PROJECT_DIR: project.replace(/\\/g, "/"),
      } as NodeJS.ProcessEnv,
      encoding: "utf8",
      input: payload,
    });

    expect(result.status, `hook exited ${result.status}: ${result.stderr}`).toBe(0);
    expect(result.stderr).toBe("");

    const jsonLine = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('{"hookSpecificOutput"'));

    expect(jsonLine, "expected hook to emit hookSpecificOutput JSON on stdout").toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: expect.stringContaining("[session-start]"),
      },
    });
  });
});

/**
 * Checked-in file mode for the hook scripts.
 *
 * `session-start.sh` shipped as `100644` while both its siblings were `100755`.
 * That is invisible on this repo's primary workstation: it is a Windows ReFS Dev
 * Drive with `core.fileMode=false`, so git ignores filesystem permission bits
 * entirely and a local `chmod +x` is a no-op that cannot fix the index. Only
 * `git update-index --chmod=+x` can, and nothing prompted anyone to run it.
 *
 * It matters because `.claude/settings.json` invokes that one hook by bare path
 * rather than through `bash`, and the script's whole body is gated on
 * `CLAUDE_CODE_REMOTE=true` — so the only environment it ever does work in is a
 * Linux web container, which is exactly where a non-executable checkout cannot
 * be run. The script provisions the Node 24 the repo's engine floor requires;
 * its own header records four PRs (#1611, #1697, #1705, #1740) blocked by
 * `npm ci` EBADENGINE before it existed.
 *
 * Two independent fixes now cover this, and this test pins the first: every hook
 * is `100755` in the index, and none may regress to `100644`. (The second is
 * that the settings.json registration invokes it via `bash`, which removes the
 * dependency on the mode altogether — belt and braces, because a future hook
 * added by an agent on this same Dev Drive will hit the identical blind spot.)
 *
 * Line endings are pinned alongside it for the same reason: `.gitattributes`
 * sets `* text=auto eol=lf`, and a CR in a shell blob fails on Linux with the
 * near-unreadable `/bin/bash^M: bad interpreter`. Measured clean at the time of
 * writing (CR=0 across all five hook blobs); this keeps it that way.
 */
describe("claude hook scripts are checked in runnable", () => {
  const listed = spawnSync("git", ["ls-files", "-s", ".claude/hooks"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  const entries = (listed.stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [meta, path] = line.split("\t");
      const [mode, object] = meta.split(/\s+/);
      return { mode, object, path };
    })
    .filter((entry) => entry.path?.endsWith(".sh"));

  it("finds all expected hook scripts including session-start.sh and issues-surface.sh", () => {
    expect(listed.status).toBe(0);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const scriptPaths = entries.map((entry) => entry.path);
    expect(scriptPaths).toContain(".claude/hooks/session-start.sh");
    expect(scriptPaths).not.toContain(".claude/hooks/precompact-issues-capture.sh");
    expect(scriptPaths).toContain(".claude/hooks/issues-surface.sh");
  });

  it.each(entries.map((entry) => [entry.path, entry.mode, entry.object]))(
    "%s is mode 100755 with LF-only line endings",
    (path, mode, object) => {
      expect(mode, `${path} must be executable in the index; fix with: git update-index --chmod=+x ${path}`).toBe(
        "100755",
      );

      const blob = spawnSync("git", ["cat-file", "blob", object as string], {
        cwd: process.cwd(),
        encoding: "buffer",
        maxBuffer: 8 * 1024 * 1024,
      });
      expect(blob.status).toBe(0);
      const carriageReturns = (blob.stdout as Buffer).filter((byte) => byte === 0x0d).length;
      expect(carriageReturns, `${path} must be stored with LF-only line endings (.gitattributes eol=lf)`).toBe(0);
    },
  );
});
