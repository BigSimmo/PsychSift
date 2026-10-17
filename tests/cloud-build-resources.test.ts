import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { assessCloudBuildResources, discoverBuildMemory } from "../scripts/check-cloud-build-resources.mjs";

const GiB = 1024 ** 3;
function memory(files: Record<string, string>, total = 64 * GiB, free = 60 * GiB) {
  return discoverBuildMemory({
    readFile: (file: string) => {
      if (!(file in files)) throw new Error("ENOENT");
      return files[file];
    },
    totalMemoryBytes: total,
    freeMemoryBytes: free,
    platform: "linux",
  });
}

function v2(limit: string, current = String(GiB), extra: Record<string, string> = {}) {
  return {
    "/proc/self/cgroup": "0::/job",
    "/proc/self/mountinfo": "1 0 0:1 / /sys/fs/cgroup rw - cgroup2 cgroup rw",
    "/sys/fs/cgroup/cgroup.controllers": "memory pids",
    "/sys/fs/cgroup/job/memory.max": limit,
    "/sys/fs/cgroup/job/memory.current": current,
    "/sys/fs/cgroup/memory.max": "max",
    ...extra,
  };
}

describe("cloud build resource preflight", () => {
  it("uses cgroup v2 instead of the larger host and retains finite headroom", () => {
    const discovered = memory(v2(String(8 * GiB)));
    expect(discovered.limitBytes).toBe(8 * GiB);
    const report = assessCloudBuildResources({ memory: discovered, inheritedHeapBytes: 8 * GiB });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toContain("12 GiB");
  });

  it("accepts the recommended envelope when a 16 GiB cgroup has enough room", () => {
    const report = assessCloudBuildResources({
      memory: memory(v2(String(16 * GiB))),
      inheritedHeapBytes: 8 * GiB,
    });
    expect(report.ok).toBe(true);
    expect(report.requiredMemoryBytes).toBe(12 * GiB);
  });

  it("checks ancestor v2 limits and their usage independently", () => {
    const discovered = memory(
      v2("max", String(GiB), {
        "/sys/fs/cgroup/memory.max": String(16 * GiB),
        "/sys/fs/cgroup/memory.current": String(8 * GiB),
      }),
    );
    expect(discovered.limitBytes).toBe(16 * GiB);
    expect(discovered.availableBytes).toBe(8 * GiB);
    expect(assessCloudBuildResources({ memory: discovered, inheritedHeapBytes: 8 * GiB }).ok).toBe(false);
  });

  it("fails closed when a visible memory mount has unreadable process membership", () => {
    const files: Record<string, string> = v2("max");
    delete files["/proc/self/cgroup"];
    const report = assessCloudBuildResources({ memory: memory(files), inheritedHeapBytes: 8 * GiB });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toContain("membership");
  });

  it("fails closed when visible memory mount membership is malformed", () => {
    const report = assessCloudBuildResources({
      memory: memory(v2("max", String(GiB), { "/proc/self/cgroup": "not-a-membership-record" })),
      inheritedHeapBytes: 8 * GiB,
    });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toContain("membership");
  });

  it("fails closed when cgroup discovery is unavailable despite sufficient host memory", () => {
    const report = assessCloudBuildResources({
      memory: memory({ "/proc/meminfo": `MemAvailable: ${60 * 1024 ** 2} kB\n` }),
      inheritedHeapBytes: 8 * GiB,
    });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toContain("could not be determined");
  });

  it("skips a controller-less cgroup v2 mount on a hybrid host", () => {
    const discovered = memory({
      "/proc/self/cgroup": "5:memory:/job\n0::/",
      "/proc/self/mountinfo":
        "1 0 0:1 / /sys/fs/cgroup/memory rw - cgroup cgroup rw,memory\n2 0 0:2 / /sys/fs/cgroup/unified rw - cgroup2 cgroup rw",
      "/sys/fs/cgroup/unified/cgroup.controllers": "pids",
      "/sys/fs/cgroup/memory/job/memory.limit_in_bytes": String(16 * GiB),
      "/sys/fs/cgroup/memory/job/memory.usage_in_bytes": String(2 * GiB),
      "/sys/fs/cgroup/memory/memory.limit_in_bytes": "max",
    });
    expect(assessCloudBuildResources({ memory: discovered, inheritedHeapBytes: 8 * GiB }).ok).toBe(true);
  });

  it("fails closed when an unlimited leaf has an unreadable visible ancestor limit", () => {
    const files: Record<string, string> = v2("max");
    delete files["/sys/fs/cgroup/memory.max"];
    const report = assessCloudBuildResources({ memory: memory(files), inheritedHeapBytes: 8 * GiB });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toContain("/sys/fs/cgroup/memory.max");
  });

  it("rejects a missing leaf limit even when the visible parent is readable", () => {
    const files = v2(String(16 * GiB), String(GiB), {
      "/sys/fs/cgroup/memory.max": "max",
    });
    delete (files as Record<string, string>)["/sys/fs/cgroup/job/memory.max"];
    expect(assessCloudBuildResources({ memory: memory(files), inheritedHeapBytes: 8 * GiB }).ok).toBe(false);
  });

  it("uses inactive file cache as reclaimable cgroup memory, bounded by its current usage", () => {
    const discovered = memory(
      v2(String(16 * GiB), String(8 * GiB), {
        "/sys/fs/cgroup/job/memory.stat": `inactive_file ${5 * GiB}\n`,
      }),
    );
    expect(discovered.availableBytes).toBe(13 * GiB);
  });

  it("handles cgroup v1 memory controllers at a non-root mount", () => {
    const discovered = memory({
      "/proc/self/cgroup": "4:cpu,cpuacct:/other\n5:memory:/tenant/job",
      "/proc/self/mountinfo": "1 0 0:1 /tenant /sys/fs/cgroup/memory rw - cgroup cgroup rw,memory",
      "/sys/fs/cgroup/memory/job/memory.limit_in_bytes": String(16 * GiB),
      "/sys/fs/cgroup/memory/job/memory.usage_in_bytes": String(2 * GiB),
      "/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712",
    });
    expect(discovered.limitBytes).toBe(16 * GiB);
    expect(discovered.availableBytes).toBe(14 * GiB);
  });

  it.each(["max", "9223372036854771712"])("falls back to finite host memory for unlimited cgroups (%s)", (limit) => {
    const discovered = memory(v2(limit), 16 * GiB, 13 * GiB);
    expect(discovered.limitBytes).toBe(16 * GiB);
    expect(discovered.availableBytes).toBe(13 * GiB);
    expect(assessCloudBuildResources({ memory: discovered, inheritedHeapBytes: 8 * GiB }).ok).toBe(true);
  });

  it("uses host MemAvailable when available and caps it at physical memory", () => {
    expect(memory({ "/proc/meminfo": `MemAvailable: ${14 * 1024 ** 2} kB\n` }, 16 * GiB, GiB).availableBytes).toBe(
      14 * GiB,
    );
  });

  it("fails closed when a finite cgroup limit has missing usage", () => {
    const files = v2(String(16 * GiB));
    delete (files as Record<string, string>)["/sys/fs/cgroup/job/memory.current"];
    const report = assessCloudBuildResources({ memory: memory(files), inheritedHeapBytes: 8 * GiB });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toContain("usage");
  });

  it("fails closed on malformed cgroup limits rather than trusting host capacity", () => {
    const report = assessCloudBuildResources({ memory: memory(v2("broken")), inheritedHeapBytes: 8 * GiB });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toContain("limit");
  });

  it("reports low inherited heap without overwriting an explicit user setting", () => {
    const report = assessCloudBuildResources({ memory: memory(v2(String(16 * GiB))), inheritedHeapBytes: 4 * GiB });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toContain("NODE_OPTIONS");
  });

  it("reserves more room when an explicit inherited heap is larger than the recommendation", () => {
    const report = assessCloudBuildResources({ memory: memory(v2(String(16 * GiB))), inheritedHeapBytes: 14 * GiB });
    expect(report.ok).toBe(false);
    expect(report.requiredMemoryBytes).toBe(18 * GiB);
  });

  it("retains fractional heap sizes when calculating headroom", () => {
    const report = assessCloudBuildResources({ memory: memory(v2(String(16 * GiB))), inheritedHeapBytes: 12.5 * GiB });
    expect(report.ok).toBe(false);
    expect(report.requiredMemoryBytes).toBe(16.5 * GiB);
  });

  it("probes inherited NODE_OPTIONS instead of assuming parent-only flags reach workers", () => {
    const options = "--stack-trace-limit=77 --max_old_space_size=4096";
    const originalOptions = process.env.NODE_OPTIONS;
    const result = spawnSync(
      process.execPath,
      ["--max-old-space-size=8192", "scripts/check-cloud-build-resources.mjs", "--json"],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_OPTIONS: options },
        encoding: "utf8",
      },
    );
    const report = JSON.parse(result.stdout);
    expect(result.status).toBe(1);
    expect(report.inheritedHeapBytes).toBeGreaterThanOrEqual(4 * GiB);
    expect(report.inheritedHeapBytes).toBeLessThan(5 * GiB);
    expect(report.issues.join(" ")).toContain("NODE_OPTIONS");
    expect(process.env.NODE_OPTIONS).toBe(originalOptions);
  });

  it("rejects unknown flags without starting a build", () => {
    const result = spawnSync(process.execPath, ["scripts/check-cloud-build-resources.mjs", "--skip-checks"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });
});
