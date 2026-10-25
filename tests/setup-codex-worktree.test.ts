import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeInstalledTreeStamp } from "../scripts/check-installed-lock-parity.mjs";

import {
  copyDependencies,
  findDependencyDonor,
  installationIsComplete,
  installedMetadataMatches,
  lockDigest,
  nodeVersionSatisfiesRange,
  parseWorktreeList,
  resolveNpmCli,
} from "../scripts/setup-codex-worktree.mjs";

const temporaryRoots: string[] = [];

function fixture(version = "1.0.0", complete = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-worktree-setup-"));
  temporaryRoots.push(root);
  const packages = {
    "": { name: "fixture" },
    "node_modules/next": { version },
    "node_modules/react": { version: "19.2.8" },
  };
  writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  if (complete) {
    mkdirSync(path.join(root, "node_modules", "next"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", "react"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", "next", "package.json"), JSON.stringify({ version }));
    writeFileSync(path.join(root, "node_modules", "react", "package.json"), JSON.stringify({ version: "19.2.8" }));
    writeFileSync(
      path.join(root, "node_modules", ".package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/next": { version },
          "node_modules/react": { version: "19.2.8" },
        },
      }),
    );
    writeInstalledTreeStamp(root);
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("Codex Desktop worktree setup", () => {
  it("enforces the complete declared Node range before dependency handling", () => {
    const range = ">=24.15.0 <25";

    expect(nodeVersionSatisfiesRange("24.13.0", range)).toBe(false);
    expect(nodeVersionSatisfiesRange("24.14.9", range)).toBe(false);
    expect(nodeVersionSatisfiesRange("24.15.0", range)).toBe(true);
    expect(nodeVersionSatisfiesRange("24.19.0", range)).toBe(true);
    expect(nodeVersionSatisfiesRange("25.0.0", range)).toBe(false);
    expect(nodeVersionSatisfiesRange("not-a-version", range)).toBe(false);
  });

  it("parses worktree paths without treating metadata as paths", () => {
    expect(parseWorktreeList("worktree C:/repo/main\nHEAD abc\n\nworktree C:/repo/feature\ndetached\n")).toEqual([
      path.resolve("C:/repo/main"),
      path.resolve("C:/repo/feature"),
    ]);
  });

  it("requires installed metadata and critical packages", () => {
    const incomplete = fixture("16.2.12");
    const complete = fixture("16.2.12", true);
    mkdirSync(path.join(incomplete, "node_modules"), { recursive: true });
    writeFileSync(
      path.join(incomplete, "node_modules", ".package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/next": { version: "16.2.12" } } }),
    );
    expect(installedMetadataMatches(incomplete)).toBe(false);
    expect(installationIsComplete(incomplete)).toBe(false);
    expect(installedMetadataMatches(complete)).toBe(true);
    expect(installationIsComplete(complete, ["next"])).toBe(true);
  });

  it("uses only a complete donor with a byte-identical lockfile", () => {
    const current = fixture("16.2.12");
    const wrongLock = fixture("16.2.11", true);
    const exactLock = fixture("16.2.12", true);

    expect(lockDigest(wrongLock)).not.toBe(lockDigest(current));
    expect(lockDigest(exactLock)).toBe(lockDigest(current));
    expect(findDependencyDonor([wrongLock, exactLock], current, ["next"])).toBe(exactLock);
  });

  it.skipIf(process.platform === "win32")("keeps copied node_modules links relative to the new worktree", () => {
    const donor = fixture("1.0.0", true);
    const target = fixture();
    mkdirSync(path.join(donor, "node_modules", "next", "dist", "bin"), { recursive: true });
    writeFileSync(path.join(donor, "node_modules", "next", "dist", "bin", "next"), "#!/usr/bin/env node\n");
    mkdirSync(path.join(donor, "node_modules", ".bin"), { recursive: true });
    symlinkSync("../next/dist/bin/next", path.join(donor, "node_modules", ".bin", "next"));

    copyDependencies(donor, target);

    expect(readlinkSync(path.join(target, "node_modules", ".bin", "next"))).toBe("../next/dist/bin/next");
  });

  it("resolves npm's JavaScript entrypoint without executing a Windows command shim", () => {
    const resolved = resolveNpmCli();
    expect(resolved === null || /npm-cli\.js$/u.test(resolved)).toBe(true);
  });

  it("registers the worktree setup script under its documented npm command", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["setup:codex-worktree"]).toBe("node scripts/setup-codex-worktree.mjs");
  });
});
