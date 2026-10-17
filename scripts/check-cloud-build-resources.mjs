#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const GiB = 1024 ** 3;
const recommendedHeapBytes = 8 * GiB;
const reserveBytes = 4 * GiB;

function readOptional(readFile, file) {
  try {
    return readFile(file).trim();
  } catch {
    return null;
  }
}

function nonnegativeBytes(text) {
  if (!/^\d+$/.test(text ?? "")) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function unescapeMount(text) {
  return text.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

/** Read-only Linux cgroup v1/v2 discovery; injected readers keep tests off the real host. */
export function discoverBuildMemory({
  readFile = (file) => readFileSync(file, "utf8"),
  totalMemoryBytes = os.totalmem(),
  freeMemoryBytes = os.freemem(),
  platform = process.platform,
} = {}) {
  const issues = [];
  const bounds = [];
  const meminfo = platform === "linux" ? readOptional(readFile, "/proc/meminfo") : null;
  const availableKiB = meminfo?.match(/^MemAvailable:\s+(\d+)\s+kB$/m)?.[1];
  const hostAvailable = availableKiB ? Number(availableKiB) * 1024 : freeMemoryBytes;
  if (!(
    Number.isFinite(totalMemoryBytes) &&
    totalMemoryBytes > 0 &&
    Number.isFinite(hostAvailable) &&
    hostAvailable >= 0
  )) {
    issues.push("Host memory capacity or availability could not be determined.");
  } else {
    bounds.push({
      source: "host",
      limitBytes: totalMemoryBytes,
      availableBytes: Math.min(totalMemoryBytes, hostAvailable),
    });
  }

  const membership = platform === "linux" ? readOptional(readFile, "/proc/self/cgroup") : null;
  const mounts = platform === "linux" ? readOptional(readFile, "/proc/self/mountinfo") : null;
  if (membership && !mounts) issues.push("Cgroup membership exists but its memory mount could not be inspected.");
  for (const line of mounts?.split("\n") ?? []) {
    const [left, right] = line.split(" - ");
    if (!right) continue;
    const [type, , options] = right.split(" ");
    const v2 = type === "cgroup2";
    if (!v2 && !(type === "cgroup" && options?.split(",").includes("memory"))) continue;
    const entry = membership?.split("\n").find((item) => {
      const record = item.match(/^(\d+):([^:]*):(\/.*)$/);
      if (!record) return false;
      return v2 ? record[1] === "0" && record[2] === "" : record[2].split(",").includes("memory");
    });
    if (!entry) {
      issues.push("Visible cgroup memory mount has unreadable or unresolved process membership.");
      continue;
    }
    const groupPath = entry.slice(entry.indexOf(":", entry.indexOf(":") + 1) + 1);
    const mountFields = left.split(" ");
    const mountRoot = unescapeMount(mountFields[3]);
    const mountPoint = unescapeMount(mountFields[4]);
    // A cgroup namespace may expose / even when mountinfo's root is outside it.
    const relative = groupPath === "/" ? "" : path.posix.relative(mountRoot, groupPath);
    if (relative === ".." || relative.startsWith("../")) {
      issues.push("Cgroup memory path cannot be resolved inside its visible mount.");
      continue;
    }
    let directory = path.posix.join(mountPoint, relative);
    for (;;) {
      const limitFile = path.posix.join(directory, v2 ? "memory.max" : "memory.limit_in_bytes");
      const limitText = readOptional(readFile, limitFile);
      if (limitText === null) {
        issues.push(`Cgroup memory limit could not be read at ${limitFile}.`);
      }
      if (limitText !== null) {
        // v1 unlimited uses a page-aligned LONG_MAX sentinel; compare as BigInt.
        const unlimited =
          limitText === "max" || (/^\d+$/.test(limitText) && BigInt(limitText) >= BigInt(Number.MAX_SAFE_INTEGER));
        const limit = unlimited ? null : nonnegativeBytes(limitText);
        if (!unlimited && (limit === null || limit === 0)) issues.push(`Unreadable memory limit at ${limitFile}.`);
        if (limit !== null && limit > 0) {
          const usage = nonnegativeBytes(
            readOptional(readFile, path.posix.join(directory, v2 ? "memory.current" : "memory.usage_in_bytes")),
          );
          if (usage === null) {
            issues.push(`Memory usage unavailable for finite limit at ${limitFile}.`);
          } else {
            const stat = readOptional(readFile, path.posix.join(directory, "memory.stat"));
            const cacheText = stat?.match(v2 ? /^inactive_file (\d+)$/m : /^total_inactive_file (\d+)$/m)?.[1];
            const reclaimable = Math.min(usage, nonnegativeBytes(cacheText) ?? 0);
            bounds.push({
              source: limitFile,
              limitBytes: limit,
              availableBytes: Math.max(0, limit - usage + reclaimable),
            });
          }
        }
      }
      if (directory === mountPoint) break;
      directory = path.posix.dirname(directory);
    }
  }
  return {
    limitBytes: bounds.length ? Math.min(...bounds.map((bound) => bound.limitBytes)) : null,
    availableBytes: bounds.length ? Math.min(...bounds.map((bound) => bound.availableBytes)) : null,
    bounds,
    issues,
  };
}

function gib(bytes) {
  return `${Number((bytes / GiB).toFixed(2))} GiB`;
}

/** A planning envelope, not a guarantee that arbitrary builds fit this allocation. */
export function assessCloudBuildResources({ memory, inheritedHeapBytes }) {
  const issues = [...memory.issues];
  const validHeap = Number.isFinite(inheritedHeapBytes) && inheritedHeapBytes > 0;
  if (!validHeap) {
    issues.push("Inherited worker heap could not be measured; inspect NODE_OPTIONS and rerun.");
  } else if (inheritedHeapBytes < recommendedHeapBytes) {
    issues.push(
      `Inherited worker heap is ${gib(inheritedHeapBytes)}; recommended at least 8 GiB via command-scoped NODE_OPTIONS=--max-old-space-size=8192. Preserve other options and review any explicit heap setting before changing it.`,
    );
  }
  // V8's reported limit includes overhead beyond old-space. Retain that actual
  // value rather than rounding down an explicit larger allocation.
  const heapBudget = validHeap ? Math.max(recommendedHeapBytes, inheritedHeapBytes) : recommendedHeapBytes;
  const requiredMemoryBytes = heapBudget + reserveBytes;
  if (memory.limitBytes !== null && memory.limitBytes < requiredMemoryBytes) {
    issues.push(
      `Effective memory limit is ${gib(memory.limitBytes)}; recommended envelope is ${gib(requiredMemoryBytes)} (${gib(heapBudget)} heap plus 4 GiB for native allocations, other workers and the OS). Choose a larger runner; an 8 GiB heap does not fit an 8 GiB runner.`,
    );
  }
  if (memory.availableBytes !== null && memory.availableBytes < requiredMemoryBytes) {
    issues.push(
      `Currently available memory is ${gib(memory.availableBytes)}, below the ${gib(requiredMemoryBytes)} planning envelope. Wait for other work or select a larger runner, then rerun this preflight.`,
    );
  }
  return { ok: issues.length === 0, inheritedHeapBytes, requiredMemoryBytes, ...memory, issues };
}

function inheritedHeap() {
  // Deliberately omit parent execArgv: a flag applied only to this script proves
  // nothing about the environment inherited by Next.js subprocesses.
  const result = spawnSync(
    process.execPath,
    ["-e", 'process.stdout.write(String(require("node:v8").getHeapStatistics().heap_size_limit))'],
    {
      env: process.env,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    },
  );
  return result.status === 0 ? nonnegativeBytes(result.stdout.trim()) : null;
}

if (isDirectEntrypoint(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
    console.error("Usage: node scripts/check-cloud-build-resources.mjs [--json]");
    process.exitCode = 2;
  } else {
    const report = assessCloudBuildResources({ memory: discoverBuildMemory(), inheritedHeapBytes: inheritedHeap() });
    if (args[0] === "--json") console.log(JSON.stringify(report, null, 2));
    else {
      console.log(
        `[cloud-build-resources] ${report.ok ? "PASS" : "NOT READY"}: inherited heap ${report.inheritedHeapBytes === null ? "unknown" : gib(report.inheritedHeapBytes)}; limit ${report.limitBytes === null ? "unknown" : gib(report.limitBytes)}; available ${report.availableBytes === null ? "unknown" : gib(report.availableBytes)}.`,
      );
      for (const issue of report.issues) console.log(`- ${issue}`);
      console.log(
        "Read-only planning preflight; rerun immediately before the existing build/browser command. See docs/agents/cloud-build-resources.md.",
      );
    }
    process.exitCode = report.ok ? 0 : 1;
  }
}
