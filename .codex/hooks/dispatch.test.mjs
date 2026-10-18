import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { findRoot, normalize, plan, run, registration } from "./dispatch.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "psychsift-hook-adapter-"));
const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = process.env.PROJECT_HOOK_SOURCE_ROOT ?? path.resolve(directory, "../..");
// Tests replay only synthetic fixtures. Trap network APIs and external provider CLIs;
// never invoke native lifecycle events or the checkout's real push guard.
const networkCalls = [];
const originals = [];
for (const [object, key] of [
  [net, "connect"],
  [net, "createConnection"],
  [net.Socket.prototype, "connect"],
  [http, "request"],
  [http, "get"],
  [https, "request"],
  [https, "get"],
  [dns, "lookup"],
  [dns, "resolve"],
  [globalThis, "fetch"],
]) {
  originals.push([object, key, object[key]]);
  object[key] = () => {
    networkCalls.push(key);
    throw Error(`Network forbidden in hook fixture: ${key}`);
  };
}
syncBuiltinESMExports();
const originalPath = process.env.PATH;
const trapDirectory = path.join(root, "offline-bin");
fs.mkdirSync(trapDirectory);
const providerMarker = path.join(root, "provider-attempt");
for (const name of ["gh", "curl", "wget", "npm", "npx", "supabase", "railway"]) {
  fs.writeFileSync(
    path.join(trapDirectory, name),
    `#!/bin/sh\necho attempted > '${providerMarker.replaceAll("\\", "/")}'\nexit 97\n`,
    { mode: 0o755 },
  );
}
process.env.PATH = trapDirectory + path.delimiter + originalPath;
after(() => {
  for (const [object, key, value] of originals) object[key] = value;
  syncBuiltinESMExports();
  process.env.PATH = originalPath;
  assert.deepEqual(networkCalls, []);
  assert.equal(fs.existsSync(providerMarker), false);
  fs.rmSync(root, { recursive: true, force: true });
});
fs.mkdirSync(path.join(root, ".git"));
fs.mkdirSync(path.join(root, "nested/deep"), { recursive: true });
const payload = (tool_name, tool_input = {}) => ({
  tool_name,
  tool_input,
  cwd: path.join(root, "nested/deep"),
  session_id: "synthetic",
});
test("nested checkout and linked-worktree markers resolve without primary path", () => {
  assert.equal(findRoot(path.join(root, "nested/deep")), root);
  const wt = path.join(root, "linked");
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, ".git"), "gitdir: ../dummy");
  assert.equal(findRoot(wt), wt);
});
test("Git discovery controls are delegated to Git rather than walked past", () => {
  assert.equal(
    findRoot(path.join(root, "nested/deep"), { ...process.env, GIT_CEILING_DIRECTORIES: path.join(root, "nested") }),
    null,
  );
});
test("direct Codex shells normalize command and actual workdir", () => {
  for (const tool of ["exec_command", "functions.exec_command"]) {
    const p = normalize(payload(tool, { cmd: "git push", workdir: root, shell: "pwsh.exe" }));
    assert.equal(p.tool_name, "PowerShell");
    assert.equal(p.tool_input.command, "git push");
    assert.equal(p.cwd, root);
  }
  assert.equal(normalize(payload("exec_command", { cmd: "git push", shell: "/bin/bash" })).tool_name, "Bash");
});
test("only relevant canonical actions are planned", () => {
  assert.deepEqual(plan("PreToolUse", payload("Bash", { command: "git status" })), []);
  assert.equal(
    plan("PreToolUse", payload("functions.exec_command", { cmd: "git push" }))[0].file,
    ".claude/hooks/push-format-guard.sh",
  );
  assert.equal(plan("PreToolUse", payload("CronCreate"))[0].file, ".claude/hooks/pr-handoff-stop.sh");
  assert.equal(plan("PostToolUse", payload("exec_command", { cmd: "gh pr create" }))[0].args[0], "post");
  assert.deepEqual(plan("PostToolUse", payload("mcp__github__create_pull_request_review")), []);
  assert.equal(plan("PreCompact", {})[0].file, ".claude/hooks/precompact-issues-capture.sh");
});
test("malformed and unsupported wrappers make no advisory decision", async () => {
  let called = 0;
  const execute = () => {
    called++;
    throw Error("unexpected");
  };
  for (const p of [
    null,
    [],
    { tool_name: "functions.exec", tool_input: { code: "git push" } },
    payload("exec_command", { cmd: ["git", "push"] }),
  ]) {
    assert.deepEqual(await run("PreToolUse", p, root, { execute }), { stdout: "", stderr: "", code: 0 });
  }
  assert.equal(called, 0);
});
test("canonical deny is preserved and empty output is not a fabricated pass", async () => {
  const deny =
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "synthetic refusal",
      },
    }) + "\n";
  const seen = [];
  let result = await run("PreToolUse", payload("functions.exec_command", { cmd: "git push", workdir: root }), root, {
    execute: async (a, p, r) => {
      seen.push([a, p, r]);
      return { stdout: deny, stderr: "", code: 0 };
    },
  });
  assert.equal(result.stdout, deny);
  assert.equal(seen[0][1].tool_input.command, "git push");
  assert.equal(seen[0][2], root);
  result = await run("PreToolUse", payload("Bash", { command: "git push" }), root, {
    execute: async () => ({ stdout: "", stderr: "", code: 0 }),
  });
  assert.equal(result.stdout, "");
});
test("canonical exit 2 and wrong-event filtering preserve the transport contract", async () => {
  const denial =
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } }) + "\n";
  const result = await run("PreToolUse", payload("Bash", { command: "git push" }), root, {
    execute: async () => ({
      stdout:
        denial +
        "not JSON\n" +
        JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "wrong event" } }),
      stderr: "synthetic reason",
      code: 2,
    }),
  });
  assert.equal(result.code, 2);
  assert.equal(result.stdout, denial);
  assert.equal(result.stderr, "synthetic reason");
});
test("unavailable canonical hooks report no advisory decision rather than a pass", async () => {
  for (const result of [
    { stdout: "", stderr: "", code: 1 },
    { stdout: "", stderr: "", code: 1, error: Error("synthetic spawn failure") },
  ]) {
    const output = await run("PreToolUse", payload("Bash", { command: "git push" }), root, {
      execute: async () => result,
    });
    assert.equal(output.code, 0);
    assert.equal(output.stdout, "");
    assert.match(output.stderr, /unavailable.*no advisory decision/s);
  }
});
test("startup plans only issue context and cached freshness, without provisioning", async () => {
  const actions = plan("SessionStart", {});
  assert.deepEqual(
    actions.map((a) => a.file),
    [".claude/hooks/issues-surface.sh", "scripts/check-base-freshness.mjs"],
  );
  assert.equal(actions[1].env.BASE_FRESHNESS_NO_FETCH, "1");
  const result = await run("SessionStart", {}, root, {
    execute: async (a) => ({ stdout: a.kind === "context" ? "Synthetic issues" : "", stderr: "", code: 0 }),
  });
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, "Synthetic issues");
});
test("registration is portable, pins Windows Node, and resolves current payload root", () => {
  const h = registration();
  for (const groups of Object.values(h.hooks))
    for (const g of groups)
      for (const entry of g.hooks) {
        assert.ok(entry.command.startsWith("node -e "));
        assert.ok(entry.commandWindows.includes('C:/Program Files/nodejs/node.exe'));
        assert.ok(entry.commandWindows.includes('else { "node" }'));
        assert.ok(!/CLAUDE_PROJECT_DIR|D:[/\\]|setup-claude-cloud/.test(entry.command));
      }
  const matcher = new RegExp(h.hooks.PreToolUse[0].matcher);
  assert.ok(matcher.test("functions.exec_command"));
  assert.ok(!matcher.test("functions.exec"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sourceRoot, ".codex/hooks.json"), "utf8")), h);
});
test("registration launch handles a real nested synthetic checkout and malformed input", () => {
  fs.mkdirSync(path.join(root, ".codex/hooks"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".codex/hooks/dispatch.mjs"),
    'export async function run(e,p,r){return {stdout:JSON.stringify({e,r,cwd:p.cwd}),stderr:"",code:0}}',
  );
  const entry = registration().hooks.PreToolUse[0].hooks[0];
  const command = process.platform === "win32" ? entry.commandWindows : entry.command;
  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/bash";
  const args = process.platform === "win32" ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-c", command];
  const good = spawnSync(shell, args, {
    input: JSON.stringify(payload("exec_command", { cmd: "git push" })),
    encoding: "utf8",
    cwd: root,
    windowsHide: true,
  });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).r, root);
  const bad = spawnSync(shell, args, { input: "{broken", encoding: "utf8", cwd: root, windowsHide: true });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, "");
});
test("pre-push fails closed when Node cannot be found", () => {
  const source = fs.existsSync(path.join(directory, "pre-push"))
    ? path.join(directory, "pre-push")
    : path.join(sourceRoot, ".githooks/pre-push");
  const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  const result = spawnSync(shell, [source], {
    encoding: "utf8",
    env: { ...process.env, PATH: root },
    windowsHide: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /node.*not found/i);
});
test("pre-push preserves guard arguments and nonzero refusal using only synthetic executables", () => {
  const fixture = path.join(root, "push-fixture");
  fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, "git"), `#!/bin/sh\nprintf '%s\\n' '${fixture.replaceAll("\\", "/")}'\n`, {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(fixture, "node"), '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 7\n', { mode: 0o755 });
  const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  // Git Bash prepends its own runtime tools during Windows startup; set PATH after
  // startup so these explicit fixture executables own both command resolutions.
  const result = spawnSync(
    shell,
    [
      "-c",
      'export PATH="$1"; shift; exec /bin/sh "$@"',
      "synthetic",
      fixture,
      path.join(sourceRoot, ".githooks/pre-push"),
      "synthetic-remote",
      "synthetic-url",
    ],
    { encoding: "utf8", cwd: fixture, windowsHide: true, timeout: 5000 },
  );
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [
    `${fixture.replaceAll("\\", "/")}/scripts/guard-push.mjs`,
    "synthetic-remote",
    "synthetic-url",
  ]);
});
test("canonical PR handoff runs only against synthetic marker state", async () => {
  fs.mkdirSync(path.join(root, ".claude/hooks"), { recursive: true });
  fs.copyFileSync(
    path.join(sourceRoot, ".claude/hooks/pr-handoff-stop.sh"),
    path.join(root, ".claude/hooks/pr-handoff-stop.sh"),
  );
  let p = {
    ...payload("functions.exec_command", { cmd: "gh pr create", workdir: root }),
    tool_response: { output: "https://github.com/synthetic/project/pull/123", exit_code: 0 },
  };
  const created = await run("PostToolUse", p, root);
  assert.equal(created.code, 0);
  assert.match(created.stdout, /PostToolUse/);
  assert.ok(fs.existsSync(path.join(root, ".git/claude-pr-handoff-synthetic")));
  const blocked = await run("PreToolUse", payload("CronCreate"), root);
  assert.equal(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision, "deny");
  const unrelated = await run("PreToolUse", { ...payload("CronCreate"), session_id: "other" }, root);
  assert.equal(unrelated.stdout, "");
});
