#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const isWindows = process.platform === "win32";
const [targetScript, ...forwardArgs] = process.argv.slice(2);
const offlineProviderRequested = forwardArgs.some(
  (token, index) => token === "--provider-mode" && forwardArgs[index + 1] === "offline",
);

function toDateOrDefault(rawValue) {
  if (!rawValue) return null;
  const dateValue = Date.parse(rawValue);
  if (!Number.isNaN(dateValue)) return dateValue;

  // WMI date format example: 20260701123015.000000+000
  if (rawValue.length >= 14) {
    const normalized = rawValue.slice(0, 14);
    const candidate = [
      normalized.slice(0, 4),
      normalized.slice(4, 6),
      normalized.slice(6, 8),
      normalized.slice(8, 10),
      normalized.slice(10, 12),
      normalized.slice(12, 14),
    ];
    const iso = `${candidate[0]}-${candidate[1]}-${candidate[2]}T${candidate[3]}:${candidate[4]}:${candidate[5]}Z`;
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

/** @param {string | string[]} [workspaceRoot] */
export function listRepoNodeProcesses(workspaceRoot = projectRoot) {
  if (!isWindows) return [];

  const workspaceRoots = (Array.isArray(workspaceRoot) ? workspaceRoot : [workspaceRoot]).map((root) => resolve(root));

  const command = [
    "$rootsJson = [Environment]::GetEnvironmentVariable('RUN_EVAL_GUARD_REPO_ROOTS_JSON')",
    "if (-not $rootsJson) { exit 0 }",
    "$roots = @(ConvertFrom-Json $rootsJson | ForEach-Object { [IO.Path]::GetFullPath($_).ToLowerInvariant() })",
    "$matches = Get-CimInstance Win32_Process | Where-Object {",
    "  if ($_.Name -notmatch '(?i)^(node|npm|npx|tsx|vitest|playwright|bun)(\\.exe)?$' -and $_.Name -notlike 'node*') { return $false }",
    "  if (-not $_.CommandLine) { return $false }",
    "  $commandLine = $_.CommandLine.ToLowerInvariant()",
    "  foreach ($root in $roots) { if ($commandLine.Contains($root)) { return $true } }",
    "  return $false",
    // CommandLine is used only for the in-process workspace filter. Do not
    // serialize it across the PowerShell boundary: CLI arguments can contain
    // credentials, and descendant cleanup needs only process metadata.
    "} | Select-Object ProcessId, ParentProcessId, CreationDate",
    "$matches | ConvertTo-Json -Compress",
  ];

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NoLogo", "-NonInteractive", "-Command", command.join("\n")],
    {
      encoding: "utf8",
      env: { ...process.env, RUN_EVAL_GUARD_REPO_ROOTS_JSON: JSON.stringify(workspaceRoots) },
      cwd: projectRoot,
      windowsHide: true,
    },
  );

  if (result.status !== 0) return [];

  const raw = (result.stdout || "").trim();
  if (!raw || raw === "null") return [];
  try {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((item) => ({
      pid: Number.parseInt(item?.ProcessId ?? "0", 10),
      parentPid: Number.parseInt(item?.ParentProcessId ?? "0", 10),
      createdAtMs: toDateOrDefault(item?.CreationDate ?? ""),
    }));
  } catch {
    return [];
  }
}

export function getDescendantPids(rootPid, allProcesses = listRepoNodeProcesses()) {
  const visited = new Set([rootPid]);
  const queue = [rootPid];

  while (queue.length > 0) {
    const pid = queue.shift();
    for (const process of allProcesses) {
      if (process?.parentPid === pid && !visited.has(process.pid)) {
        visited.add(process.pid);
        queue.push(process.pid);
      }
    }
  }

  return Array.from(visited);
}

export function terminateProcesses(pids, context) {
  if (!isWindows) return 0;

  const validPids = pids.filter((pid) => Number.isFinite(pid) && pid > 0);
  if (validPids.length === 0) return 0;

  let attemptCount = 0;
  for (const pid of validPids) {
    const gracefulResult = spawnSync("taskkill", ["/PID", String(pid), "/T"], {
      cwd: projectRoot,
      stdio: "ignore",
      windowsHide: true,
    });
    if (gracefulResult.status === 0) attemptCount += 1;
  }

  if (attemptCount > 0) {
    spawnSync("powershell.exe", ["-Command", "Start-Sleep -Milliseconds 1500"], { windowsHide: true });
  }

  let killed = 0;
  for (const pid of validPids) {
    const killedResult = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: projectRoot,
      stdio: "ignore",
      windowsHide: true,
    });
    if (killedResult.status === 0 || attemptCount > 0) killed += 1;
  }

  if (killed > 0) {
    const prefix = context ? `[eval] ${context}: ` : "[eval] ";
    console.log(`${prefix}terminated ${validPids.length} lingering node process(es) for this repo.`);
  }

  return validPids.length;
}

export function terminateOwnedProcessTree(pid, processSnapshot = listRepoNodeProcesses()) {
  if (!isWindows || !pid || pid <= 0) return 0;
  const descendants = getDescendantPids(pid, processSnapshot);
  return terminateProcesses(descendants, "terminateOwnedProcessTree");
}

function terminateEvalProcess(pid) {
  if (!pid || pid <= 0) return;
  terminateOwnedProcessTree(pid);
}

function runEvalScript() {
  if (!targetScript) {
    console.error("Usage: node scripts/run-eval-safe.mjs <script> [args...]");
    process.exit(1);
  }

  const targetPath = resolve(projectRoot, targetScript);
  const command = process.execPath;
  const commandArgs = [resolve(projectRoot, "scripts", "run-tsx.mjs"), targetPath, ...forwardArgs];

  const child = spawn(command, commandArgs, {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
    shell: false,
    env: offlineProviderRequested
      ? {
          ...process.env,
          RAG_PROVIDER_MODE: "offline",
          OPENAI_API_KEY: "",
          OPENAI_ORG_ID: "",
          OPENAI_PROJECT_ID: "",
        }
      : process.env,
  });

  const stopEvalProcess = () => {
    terminateEvalProcess(child.pid);
  };

  const stopEvalProcessWithTimeout = () => {
    stopEvalProcess();
    setTimeout(() => {
      terminateProcesses([child.pid], "force-stop-eval");
    }, 3000);
  };

  process.once("SIGINT", () => {
    stopEvalProcessWithTimeout();
    process.exit(130);
  });

  process.once("SIGTERM", () => {
    stopEvalProcessWithTimeout();
    process.exit(143);
  });

  child.once("close", (code, signal) => {
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    if (signal) {
      stopEvalProcess();
      process.exit(1);
    } else {
      stopEvalProcess();
      process.exit(code ?? 0);
    }
  });

  child.once("error", (error) => {
    stopEvalProcess();
    console.error(error instanceof Error ? error.message : `Failed to launch eval script: ${String(error)}`);
    process.exit(1);
  });
}

const isMain = isDirectEntrypoint(import.meta.url);
if (isMain) {
  runEvalScript();
}
