// Codex transport adapter for the maintained Claude project hooks. It does not execute
// tool commands, provision a cloud environment, or interpret outer functions.exec code.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function findRoot(cwd, env = process.env) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return null;
  if (
    ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_CEILING_DIRECTORIES", "GIT_DISCOVERY_ACROSS_FILESYSTEM"].some(
      (k) => env[k],
    )
  ) {
    const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    return result.status === 0 ? path.resolve(result.stdout.trim()) : null;
  }
  let current = path.resolve(cwd);
  if (
    fs.existsSync(path.join(current, "HEAD")) &&
    fs.existsSync(path.join(current, "objects")) &&
    fs.existsSync(path.join(current, "refs"))
  )
    return null;
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function normalize(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = { ...payload };
  const input = p.tool_input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    p.cwd = input.workdir ?? input.cwd ?? p.cwd;
    if (["exec_command", "functions.exec_command"].includes(p.tool_name)) {
      if (typeof (input.cmd ?? input.command) !== "string") return null;
      p.tool_name =
        /powershell|pwsh/i.test(input.shell ?? "") || (!input.shell && process.platform === "win32")
          ? "PowerShell"
          : "Bash";
      p.tool_input = { ...input, command: input.cmd ?? input.command };
    }
  } else if (["Bash", "PowerShell", "exec_command", "functions.exec_command"].includes(p.tool_name)) return null;
  p.session_id ??= p.thread_id;
  return p;
}

const GIT_PUSH = /git(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--?[\w-]+(?:=\S*)?))*\s+push(?:\s|$)/;
// PATH `bash` on Windows is usually the WSL launcher (System32), which cannot see this checkout's
// Windows paths; prefer the pinned Git for Windows bash and use PATH only when it is absent.
const GIT_BASH = "C:/Program Files/Git/bin/bash.exe";

export function plan(event, payload) {
  const p = normalize(payload);
  if (!p) return [];
  const shell = ["Bash", "PowerShell"].includes(p.tool_name);
  const command = shell ? (p.tool_input.command ?? p.tool_input.script ?? p.tool_input.code) : "";
  if (shell && typeof command !== "string") return [];
  if (event === "PreToolUse") {
    if (
      [
        "Edit",
        "Write",
        "MultiEdit",
        "NotebookEdit",
        "edit_file",
        "write_file",
        "functions.edit_file",
        "functions.write_file",
      ].includes(p.tool_name)
    )
      return [{ file: ".claude/hooks/organisation-edit-warning.sh", args: [] }];
    if (p.tool_name === "CronCreate") return [{ file: ".claude/hooks/pr-handoff-stop.sh", args: ["pre"] }];
    // Mirrors push-format-guard.sh: git, any global options (`-C <dir>`, `-c k=v`, `--git-dir=…`), then push.
    if (shell && GIT_PUSH.test(command)) return [{ file: ".claude/hooks/push-format-guard.sh", args: [] }];
  }
  if (
    event === "PostToolUse" &&
    ((shell && /gh\s+pr\s+create/.test(command)) || /create_?pull_?request$/i.test(p.tool_name ?? ""))
  )
    return [{ file: ".claude/hooks/pr-handoff-stop.sh", args: ["post"] }];
  if (event === "PreCompact") return [{ file: ".claude/hooks/precompact-issues-capture.sh", args: [] }];
  if (event === "SessionStart")
    return [
      { file: ".claude/hooks/issues-surface.sh", args: [], kind: "context" },
      { file: "scripts/check-base-freshness.mjs", args: ["--hook"], env: { BASE_FRESHNESS_NO_FETCH: "1" } },
    ];
  return [];
}

function execute(action, payload, root) {
  const script = path.join(root, action.file);
  const binary = action.file.endsWith(".mjs")
    ? process.execPath
    : process.platform === "win32"
      ? fs.existsSync(GIT_BASH)
        ? GIT_BASH
        : "bash"
      : "/bin/bash";
  const result = spawnSync(binary, [script, ...action.args], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: root,
    windowsHide: true,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...action.env },
    timeout: action.file.includes("push-format") ? 170_000 : 20_000,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? 1, error: result.error };
}

export async function run(event, payload, root, { execute: runner = execute } = {}) {
  const p = normalize(payload);
  let stdout = "",
    stderr = "",
    code = 0;
  for (const action of plan(event, p)) {
    const result = await runner(action, p, root);
    if (result.error || (result.code !== 0 && result.code !== 2)) {
      stderr += `Codex project hook unavailable: ${action.file}; no advisory decision was produced.\n`;
      continue;
    }
    stderr += result.stderr ?? "";
    if (action.kind === "context" && result.stdout.trim()) {
      stdout +=
        JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: result.stdout.trim() } }) +
        "\n";
    } else {
      for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.hookSpecificOutput?.hookEventName === event) stdout += line + "\n";
        } catch {
          /* advisory non-JSON output is not a pass */
        }
      }
    }
    if (result.code === 2) code = 2;
  }
  return { stdout, stderr, code };
}

// One Node bootstrap per event locates the session checkout without shell expansion or a
// second Git/Node resolver. The extra Node freshness check runs only at SessionStart.
// Use only double quotes inside this string: it is enclosed in single quotes by both shells.
export function registration() {
  const bootstrap =
    '(async()=>{const f=require("node:fs"),p=require("node:path"),u=require("node:url");let s="";for await(const b of process.stdin){s+=b;if(s.length>1048576)return;}let v;try{v=JSON.parse(s)}catch{return}if(!v||typeof v!=="object"||Array.isArray(v))return;let d=v.tool_input?.workdir??v.tool_input?.cwd??v.cwd??process.cwd();if(typeof d!=="string"||!p.isAbsolute(d))return;d=p.resolve(d);let t=p.resolve(process.cwd());while(!f.existsSync(p.join(t,".git"))){let q=p.dirname(t);if(q===t)return;t=q;}if(["GIT_DIR","GIT_COMMON_DIR","GIT_WORK_TREE","GIT_CEILING_DIRECTORIES","GIT_DISCOVERY_ACROSS_FILESYSTEM"].some(k=>process.env[k])){const g=require("node:child_process").spawnSync("git",["-C",d,"rev-parse","--show-toplevel"],{encoding:"utf8",windowsHide:true,timeout:5000});if(g.status!==0)return;d=p.resolve(g.stdout.trim())}else{if(f.existsSync(p.join(d,"HEAD"))&&f.existsSync(p.join(d,"objects"))&&f.existsSync(p.join(d,"refs")))return;while(!f.existsSync(p.join(d,".git"))){const q=p.dirname(d);if(q===d)return;d=q;}}if(d!==t)return;const a=p.join(d,".codex/hooks/dispatch.mjs");if(!f.existsSync(a))return;const m=await import(u.pathToFileURL(a).href),r=await m.run(process.argv[1],v,d);process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.code;})().catch(()=>{process.stderr.write("Codex project hook adapter unavailable; no advisory decision was produced.\\n")})';
  // Windows PowerShell 5 strips embedded double quotes during native argument passing.
  // This bootstrap contains no dollar/backtick characters: switch JS literals to single
  // quotes inside PowerShell's double-quoted argument, preserving the actual Node source.
  const windowsBootstrap = bootstrap.replaceAll('"', "'");
  const hook = (event) => ({
    type: "command",
    command: `node -e '${bootstrap}' ${event}`,
    commandWindows: `& $(if (Test-Path "C:/Program Files/nodejs/node.exe") { "C:/Program Files/nodejs/node.exe" } else { "node" }) -e "${windowsBootstrap}" ${event}`,
    timeout: event === "PreToolUse" ? 180 : 45,
  });
  const shells =
    "Bash|PowerShell|exec_command|functions\\.exec_command|Edit|Write|MultiEdit|NotebookEdit|edit_file|write_file|functions\\.edit_file|functions\\.write_file";
  return {
    hooks: {
      PreToolUse: [{ matcher: `^(?:${shells}|CronCreate)$`, hooks: [hook("PreToolUse")] }],
      PostToolUse: [{ matcher: `^(?:${shells}|.*[Cc]reate_?[Pp]ull_?[Rr]equest)$`, hooks: [hook("PostToolUse")] }],
      PreCompact: [{ hooks: [hook("PreCompact")] }],
      SessionStart: [{ hooks: [hook("SessionStart")] }],
    },
  };
}
