import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathSync } from "./retryable-fs.mjs";
import { redactSensitiveText } from "./sensitive-text.mjs";

const tokenEnvironmentKey = "CLINICAL_KB_HEAVY_LOCK_TOKEN";
const pathEnvironmentKey = "CLINICAL_KB_HEAVY_LOCK_PATH";
const coordinatorMarkerName = "coordinator.json";
const leasesDirectoryName = "leases";
const queueDirectoryName = "queue";
const gateDirectoryName = "gate.lock";
const incompleteLockGraceMs = 30_000;
const staleLockHeartbeatMs = 60_000;
const staleLockReclaimMs = 30 * 60 * 1000;
const defaultSharedWaitTimeoutMs = 30_000;
const defaultExclusiveWaitTimeoutMs = 15 * 60_000;
const sharedLeaseLimit = 2;
// Older worktrees understand exactly one owner PID. Point their compatibility
// sentinel at an OS process that stays alive for the host lifetime, while the
// real holder PID remains in holderPid and lease records. This prevents an old
// runner from deleting the coordinator if one of two shared holders crashes.
const legacySentinelProcessId = process.platform === "win32" ? 4 : 1;

function defaultWaitTimeoutFor(mode) {
  return mode === "exclusive" ? defaultExclusiveWaitTimeoutMs : defaultSharedWaitTimeoutMs;
}

function linuxProcessIsDefunct(status) {
  // A zombie group leader can still have live worker threads after pthread_exit.
  // Reclaim only a known terminal state with a positively identified sole thread.
  return /^State:[ \t]+[ZX]\b/m.test(status) && /^Threads:[ \t]+1[ \t]*$/m.test(status);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error?.code !== "EPERM") return false;
  }
  if (process.platform === "linux") {
    try {
      // kill(pid, 0) also succeeds for unreaped zombies. Require that no worker
      // threads remain before normal stale-owner pruning can reclaim the lease.
      if (linuxProcessIsDefunct(readFileSync(`/proc/${pid}/status`, "utf8"))) return false;
    } catch {
      // Unavailable procfs must not weaken the existing kill/EPERM boundary.
    }
  }
  return true;
}

function sleepSync(milliseconds) {
  if (milliseconds <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function normalizeIdentity(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function resolveRepositoryIdentity(projectRoot) {
  const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const gitCommonDirectory = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (result.status === 0 && gitCommonDirectory) return normalizeIdentity(gitCommonDirectory);

  // Docker build contexts intentionally omit .git. They cannot share worktrees
  // with the host, so a validated workspace-local identity keeps nested build
  // commands safe without weakening the common-directory coordinator.
  try {
    const manifest = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    if (manifest.name === "prompt-for-codex-medical-knowledge-base") return normalizeIdentity(projectRoot);
  } catch {
    // Preserve the explicit error below for an invalid working directory.
  }
  throw new Error("Could not resolve the shared Git directory for the Database heavyweight-run coordinator.");
}

// Keep the legacy *.lock path. Older worktrees see the coordinator's sentinel
// owner.json and safely wait instead of running beside newer shared leases.
function lockPathFor(repositoryIdentity, baseDirectory = os.tmpdir()) {
  const repositoryId = createHash("sha256").update(normalizeIdentity(repositoryIdentity)).digest("hex").slice(0, 20);
  return path.join(baseDirectory, "clinical-kb-heavy-locks", `${repositoryId}.lock`);
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readOwner(directory) {
  return readJson(path.join(directory, "owner.json"));
}

/**
 * Publish atomically: write a sibling temp file, then rename over the target.
 *
 * A plain writeFileSync is observable half-written by a concurrent reader, and
 * every reader here is concurrent by construction — the queue exists precisely
 * so separate processes can watch each other. `readJson` swallows the resulting
 * parse error and returns null, and `queueRecords` filters that out, so a torn
 * read does not surface as an error: the ticket simply *disappears* for that
 * poll, and `hasTickets` reports false while a queued exclusive waiter is
 * sitting right there. That is the priority inversion this queue exists to
 * prevent.
 *
 * `renameSync` is atomic within a filesystem, and the temp name deliberately
 * does not end in `.json` so `listJsonFiles` cannot pick it up mid-flight.
 */
function writeJson(filePath, value) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, filePath);
  } catch (error) {
    removePathSync(temporaryPath);
    throw error;
  }
}

function compatibilitySentinel(owner) {
  return {
    ...owner,
    holderPid: owner.pid,
    pid: legacySentinelProcessId,
    coordinator: true,
  };
}

function pathIsOldEnough(filePath, ageMs, now = Date.now()) {
  try {
    return now - statSync(filePath).mtimeMs >= ageMs;
  } catch {
    return false;
  }
}

function ownerDirectoryIsStale(directory) {
  const owner = readOwner(directory);
  if (!owner) return pathIsOldEnough(directory, incompleteLockGraceMs);
  if (!processIsAlive(owner.pid)) return true;
  return pathIsOldEnough(path.join(directory, "owner.json"), staleLockReclaimMs);
}

function coordinatorPaths(lockPath) {
  return {
    marker: path.join(lockPath, coordinatorMarkerName),
    leases: path.join(lockPath, leasesDirectoryName),
    queue: path.join(lockPath, queueDirectoryName),
    gate: path.join(lockPath, gateDirectoryName),
  };
}

function isCoordinator(lockPath) {
  return readJson(coordinatorPaths(lockPath).marker)?.version === 1;
}

function listDirectories(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function listJsonFiles(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function acquireGate(lockPath, processId) {
  const { gate } = coordinatorPaths(lockPath);
  const deadline = Date.now() + incompleteLockGraceMs;
  while (Date.now() <= deadline) {
    try {
      mkdirSync(gate);
      const token = randomUUID();
      writeJson(path.join(gate, "owner.json"), { pid: processId, token, startedAt: new Date().toISOString() });
      return () => {
        if (readOwner(gate)?.token === token) removePathSync(gate, { recursive: true });
      };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error?.code !== "EEXIST") throw error;
      if (ownerDirectoryIsStale(gate)) {
        removePathSync(gate, { recursive: true });
        continue;
      }
      sleepSync(25);
    }
  }
  throw new Error(`Could not enter the Database heavyweight-run coordinator at ${lockPath}.`);
}

function ensureCoordinator(lockPath, bootstrapOwner, forceLockRelease) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  for (;;) {
    try {
      mkdirSync(lockPath);
      const paths = coordinatorPaths(lockPath);
      mkdirSync(paths.leases);
      mkdirSync(paths.queue);
      writeJson(paths.marker, { version: 1, sharedLeaseLimit });
      writeJson(path.join(lockPath, "owner.json"), compatibilitySentinel(bootstrapOwner));
      return { initializing: false, legacyOwner: null };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (isCoordinator(lockPath)) return { initializing: false, legacyOwner: null };

      const legacyOwner = readOwner(lockPath);
      const stale = ownerDirectoryIsStale(lockPath);
      if (forceLockRelease || stale) {
        console.warn(
          `[AUDIT] Breaking ${stale ? "stale" : "forced"} heavyweight lock at ${lockPath} (was PID ${legacyOwner?.pid || "unknown"})`,
        );
        removePathSync(lockPath, { recursive: true });
        continue;
      }
      return { initializing: !legacyOwner, legacyOwner };
    }
  }
}

function queueRecords(lockPath) {
  return listJsonFiles(coordinatorPaths(lockPath).queue)
    .map((filePath) => ({ filePath, record: readJson(filePath) }))
    .filter((item) => item.record);
}

function leaseRecords(lockPath) {
  return listDirectories(coordinatorPaths(lockPath).leases)
    .map((directory) => ({ directory, record: readOwner(directory) }))
    .filter((item) => item.record);
}

function cleanupCoordinator(lockPath) {
  const paths = coordinatorPaths(lockPath);
  for (const directory of listDirectories(paths.leases)) {
    if (ownerDirectoryIsStale(directory)) removePathSync(directory, { recursive: true });
  }
  for (const filePath of listJsonFiles(paths.queue)) {
    const ticket = readJson(filePath);
    if (!ticket || !processIsAlive(ticket.pid)) removePathSync(filePath);
  }
}

function orderedTickets(lockPath) {
  return queueRecords(lockPath).sort((left, right) => {
    const timeOrder = String(left.record.requestedAt).localeCompare(String(right.record.requestedAt));
    return timeOrder || String(left.record.token).localeCompare(String(right.record.token));
  });
}

function updateSentinel(lockPath) {
  const candidates = [
    ...leaseRecords(lockPath).map((item) => item.record),
    ...queueRecords(lockPath).map((item) => item.record),
  ].sort((left, right) => {
    const leftTime = left.startedAt ?? left.requestedAt ?? "";
    const rightTime = right.startedAt ?? right.requestedAt ?? "";
    return String(leftTime).localeCompare(String(rightTime));
  });
  if (candidates[0]) writeJson(path.join(lockPath, "owner.json"), compatibilitySentinel(candidates[0]));
}

function canAdmit(lockPath, ticket) {
  const leases = leaseRecords(lockPath).map((item) => item.record);
  const tickets = orderedTickets(lockPath);
  const ticketIndex = tickets.findIndex((item) => item.record.token === ticket.token);
  if (ticketIndex < 0) return false;

  if (ticket.mode === "exclusive") return ticketIndex === 0 && leases.length === 0;
  if (leases.some((lease) => lease.mode === "exclusive")) return false;
  if (
    leases.some(
      (lease) => lease.mode === "shared" && normalizeIdentity(lease.worktree) === normalizeIdentity(ticket.worktree),
    )
  ) {
    return false;
  }
  if (leases.filter((lease) => lease.mode === "shared").length >= sharedLeaseLimit) return false;
  return !tickets.slice(0, ticketIndex).some((item) => item.record.mode === "exclusive");
}

function busyMessage(lockPath, requestedMode) {
  const owner = readOwner(lockPath);
  const holderPid = owner?.holderPid ?? owner?.pid ?? "unknown";
  if (requestedMode === "shared") {
    return `Database focused-test capacity is full (current owner PID ${holderPid}, worktree ${owner?.worktree ?? "unknown"}, started ${owner?.startedAt ?? owner?.requestedAt ?? "unknown"}): ${redactSensitiveText(owner?.command ?? "unknown command")}`;
  }
  return `Another Database heavyweight command is active (PID ${holderPid}, worktree ${owner?.worktree ?? "unknown"}, started ${owner?.startedAt ?? owner?.requestedAt ?? "unknown"}): ${redactSensitiveText(owner?.command ?? "unknown command")}`;
}

function cleanupTimedOutTicket(lockPath, token, processId) {
  if (!isCoordinator(lockPath)) return;
  const releaseGate = acquireGate(lockPath, processId);
  if (!releaseGate) return;
  try {
    const paths = coordinatorPaths(lockPath);
    removePathSync(path.join(paths.queue, `${token}.json`));
    cleanupCoordinator(lockPath);
    const hasLeases = leaseRecords(lockPath).length > 0;
    const hasTickets = queueRecords(lockPath).length > 0;
    if (!hasLeases && !hasTickets) {
      removePathSync(lockPath, { recursive: true });
      return;
    }
    updateSentinel(lockPath);
  } finally {
    releaseGate();
  }
}

/**
 * Acquire a repository-wide run lease.
 *
 * `exclusive` remains the default for full suites, builds, lint, coverage and
 * browser work. `shared` is reserved for fail-closed focused Vitest selection
 * and read-only typechecking, with at most two holders across all worktrees.
 *
 * @param {{
 *   projectRoot: string;
 *   command?: string;
 *   environment?: Record<string, string | undefined>;
 *   baseDirectory?: string;
 *   repositoryIdentity?: string;
 *   processId?: number;
 *   forceLockRelease?: boolean;
 *   mode?: "exclusive" | "shared";
 *   waitTimeoutMs?: number;
 * }} options
 */
export function acquireHeavyRunLock({
  projectRoot,
  command = process.argv.join(" "),
  environment = process.env,
  baseDirectory,
  repositoryIdentity = resolveRepositoryIdentity(projectRoot),
  processId = process.pid,
  forceLockRelease = false,
  mode = "exclusive",
  waitTimeoutMs,
}) {
  if (!projectRoot) throw new Error("projectRoot is required for the Database heavyweight-run coordinator.");
  if (mode !== "exclusive" && mode !== "shared") throw new Error(`Unsupported Database run lease mode: ${mode}`);
  const admissionWaitTimeoutMs = waitTimeoutMs ?? defaultWaitTimeoutFor(mode);
  if (!Number.isFinite(admissionWaitTimeoutMs) || admissionWaitTimeoutMs < 0)
    throw new Error("waitTimeoutMs must be a non-negative number.");

  const lockPath = lockPathFor(repositoryIdentity, baseDirectory);
  const inheritedToken = environment[tokenEnvironmentKey];
  const inheritedPath = environment[pathEnvironmentKey];

  if (inheritedToken || inheritedPath) {
    const expectedLeaseParent = normalizeIdentity(coordinatorPaths(lockPath).leases);
    if (!inheritedToken || !inheritedPath || normalizeIdentity(path.dirname(inheritedPath)) !== expectedLeaseParent) {
      throw new Error("The inherited Database heavyweight-run lease does not match this repository.");
    }
    const owner = readOwner(inheritedPath);
    if (owner?.token !== inheritedToken || !processIsAlive(owner.pid)) {
      throw new Error("The inherited Database heavyweight-run lease is no longer owned by a live parent process.");
    }
    return {
      path: inheritedPath,
      coordinatorPath: lockPath,
      owner,
      environment: { ...environment },
      reentrant: true,
      release() {},
    };
  }

  const token = randomUUID();
  const safeCommand = redactSensitiveText(command);
  const requestedAt = new Date().toISOString();
  const ticket = {
    pid: processId,
    token,
    mode,
    command: safeCommand,
    worktree: path.resolve(projectRoot),
    repositoryIdentity: normalizeIdentity(repositoryIdentity),
    requestedAt,
  };
  const deadline = Date.now() + admissionWaitTimeoutMs;
  let ticketCreated = false;
  let forcePending = forceLockRelease;

  for (;;) {
    const { initializing, legacyOwner } = ensureCoordinator(lockPath, ticket, forcePending);
    forcePending = false;
    if (initializing) {
      if (Date.now() >= deadline) {
        throw new Error(`A Database heavyweight coordinator is being initialized at ${lockPath}; retry shortly.`);
      }
      sleepSync(Math.min(100, Math.max(1, deadline - Date.now())));
      continue;
    }
    if (legacyOwner) {
      if (Date.now() >= deadline) throw new Error(busyMessage(lockPath, mode));
      sleepSync(Math.min(250, Math.max(1, deadline - Date.now())));
      continue;
    }

    const releaseGate = acquireGate(lockPath, processId);
    if (!releaseGate) continue;
    let admitted = false;
    let leasePath;
    try {
      cleanupCoordinator(lockPath);
      const paths = coordinatorPaths(lockPath);
      if (forceLockRelease) {
        const owners = leaseRecords(lockPath).map((item) => item.record);
        console.warn(
          `[AUDIT] Breaking forced heavyweight coordinator leases at ${lockPath} (owners ${owners.map((owner) => owner.pid).join(", ") || "unknown"})`,
        );
        for (const directory of listDirectories(paths.leases)) removePathSync(directory, { recursive: true });
        for (const filePath of listJsonFiles(paths.queue)) removePathSync(filePath);
      }
      const ticketPath = path.join(paths.queue, `${token}.json`);
      if (!ticketCreated || !existsSync(ticketPath)) {
        writeJson(ticketPath, ticket);
        ticketCreated = true;
      }
      updateSentinel(lockPath);

      if (canAdmit(lockPath, ticket)) {
        const owner = { ...ticket, startedAt: new Date().toISOString() };
        leasePath = path.join(paths.leases, `${token}.lock`);
        mkdirSync(leasePath);
        writeJson(path.join(leasePath, "owner.json"), owner);
        removePathSync(ticketPath);
        updateSentinel(lockPath);
        admitted = true;
      }
    } finally {
      releaseGate();
    }

    if (admitted) {
      const owner = readOwner(leasePath);
      let released = false;
      const leaseOwnerPath = path.join(leasePath, "owner.json");
      const heartbeatInterval = setInterval(() => {
        try {
          const now = new Date();
          utimesSync(leaseOwnerPath, now, now);
          utimesSync(path.join(lockPath, "owner.json"), now, now);
        } catch {
          // Ignore if the lease or coordinator was already released.
        }
      }, staleLockHeartbeatMs);
      heartbeatInterval.unref?.();

      return {
        path: leasePath,
        coordinatorPath: lockPath,
        owner,
        reentrant: false,
        environment: {
          ...environment,
          [tokenEnvironmentKey]: token,
          [pathEnvironmentKey]: leasePath,
        },
        release() {
          if (released) return;
          released = true;
          clearInterval(heartbeatInterval);
          if (!isCoordinator(lockPath)) return;
          const releaseCoordinatorGate = acquireGate(lockPath, processId);
          if (!releaseCoordinatorGate) return;
          try {
            if (readOwner(leasePath)?.token === token) removePathSync(leasePath, { recursive: true });
            cleanupCoordinator(lockPath);
            const hasLeases = leaseRecords(lockPath).length > 0;
            const hasTickets = queueRecords(lockPath).length > 0;
            if (!hasLeases && !hasTickets) {
              removePathSync(lockPath, { recursive: true });
              return;
            }
            updateSentinel(lockPath);
          } finally {
            releaseCoordinatorGate();
          }
        },
      };
    }

    if (Date.now() >= deadline) {
      const message = busyMessage(lockPath, mode);
      cleanupTimedOutTicket(lockPath, token, processId);
      throw new Error(message);
    }
    sleepSync(Math.min(250, Math.max(1, deadline - Date.now())));
  }
}

export const testRunLockInternals = {
  coordinatorPaths,
  defaultWaitTimeoutFor,
  isCoordinator,
  linuxProcessIsDefunct,
  lockPathFor,
  processIsAlive,
  readOwner,
  resolveRepositoryIdentity,
  sharedLeaseLimit,
  tokenEnvironmentKey,
  pathEnvironmentKey,
};
