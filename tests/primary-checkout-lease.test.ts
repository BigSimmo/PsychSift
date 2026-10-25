import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquirePrimaryCheckoutLease,
  assertPrimaryWriteAllowed,
  inspectPrimaryCheckoutLease,
  primaryCheckoutLeaseInternals,
} from "../scripts/primary-checkout-lease.mjs";

const cliPath = path.join(__dirname, "..", "scripts", "primary-checkout-lease.mjs");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function git(args: string[], cwd: string) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return (result.stdout ?? "").trim();
}

function createPrimaryFixture() {
  const root = temporaryDirectory("primary-lease-");
  git(["init", "-b", "main"], root);
  git(["config", "user.email", "lease@example.test"], root);
  git(["config", "user.name", "Lease Fixture"], root);
  writeFileSync(path.join(root, "README.md"), "primary\n", "utf8");
  git(["add", "README.md"], root);
  git(["commit", "-m", "primary root"], root);
  return root;
}

describe("primary checkout write lease (#077)", () => {
  it("allows the first primary writer and refuses a second concurrent writer", () => {
    const primaryPath = createPrimaryFixture();
    const baseDirectory = temporaryDirectory("primary-lease-store-");
    const featureWorktree = temporaryDirectory("feature-worktree-");

    const first = acquirePrimaryCheckoutLease({
      primaryPath,
      baseDirectory,
      environment: {},
      ownerLabel: "task-a",
      purpose: "sync main",
    });

    expect(() =>
      acquirePrimaryCheckoutLease({
        primaryPath,
        baseDirectory,
        environment: {},
        ownerLabel: "task-b",
        purpose: "also sync",
      }),
    ).toThrow(/lease held|Primary checkout write refused/);

    expect(() =>
      assertPrimaryWriteAllowed({
        primaryPath,
        baseDirectory,
        environment: {},
      }),
    ).toThrow(/lease-held|Primary checkout write refused/);

    const readOnly = inspectPrimaryCheckoutLease({
      primaryPath,
      baseDirectory,
      environment: {},
    });
    expect(readOnly.readOnlyAllowed).toBe(true);
    expect(readOnly.featureWorktreesUnaffected).toBe(true);
    expect(readOnly.writeAllowed).toBe(false);

    // Independent feature worktrees are not gated by this cooperative lease API;
    // they simply never call it. Prove the fixture path remains usable for ordinary git.
    writeFileSync(path.join(featureWorktree, "note.txt"), "feature work\n", "utf8");
    expect(featureWorktree).not.toBe(primaryPath);

    first.release();
    const afterRelease = assertPrimaryWriteAllowed({
      primaryPath,
      baseDirectory,
      environment: {},
    });
    expect(afterRelease.writeAllowed).toBe(true);
  });

  it("permits nested same-owner writes via inherited lease tokens", () => {
    const primaryPath = createPrimaryFixture();
    const baseDirectory = temporaryDirectory("primary-lease-reentrant-");
    const first = acquirePrimaryCheckoutLease({
      primaryPath,
      baseDirectory,
      environment: {},
      purpose: "outer",
    });
    const nested = acquirePrimaryCheckoutLease({
      primaryPath,
      baseDirectory,
      environment: first.environment,
      purpose: "inner",
    });
    expect(nested.reentrant).toBe(true);
    nested.release();
    first.release();
  });

  it("fails closed when the primary checkout is dirty even without an owner", () => {
    const primaryPath = createPrimaryFixture();
    const baseDirectory = temporaryDirectory("primary-lease-dirty-");
    writeFileSync(path.join(primaryPath, "dirty.txt"), "nope\n", "utf8");

    expect(() =>
      acquirePrimaryCheckoutLease({
        primaryPath,
        baseDirectory,
        environment: {},
        purpose: "write while dirty",
      }),
    ).toThrow(/Primary checkout write refused|tracked or untracked changes/);
  });

  it("recovers a stale dead-owner lease without letting the old token release the replacement", () => {
    const primaryPath = createPrimaryFixture();
    const baseDirectory = temporaryDirectory("primary-lease-stale-");
    const stale = acquirePrimaryCheckoutLease({
      primaryPath,
      baseDirectory,
      environment: {},
      processId: 2_147_483_647,
      purpose: "dead owner",
    });
    const replacement = acquirePrimaryCheckoutLease({
      primaryPath,
      baseDirectory,
      environment: {},
      purpose: "replacement",
    });

    stale.release();
    expect(inspectPrimaryCheckoutLease({ primaryPath, baseDirectory, environment: {} }).owner?.token).toBe(
      replacement.owner.token,
    );
    replacement.release();
  });

  it("never persists credential-bearing purpose text", () => {
    const primaryPath = createPrimaryFixture();
    const baseDirectory = temporaryDirectory("primary-lease-secret-");
    const exposed = ["crsr", "example_worker_credential_123456789"].join("_");
    const lease = acquirePrimaryCheckoutLease({
      primaryPath,
      baseDirectory,
      environment: {},
      purpose: `sync --api-key ${exposed}`,
    });
    try {
      const stored = inspectPrimaryCheckoutLease({ primaryPath, baseDirectory, environment: {} });
      expect(JSON.stringify(stored)).not.toContain(exposed);
      expect(JSON.stringify(stored)).toContain("[REDACTED]");
    } finally {
      lease.release();
    }
  });

  it("never replaces a lease file another task created after the inspection", () => {
    const primaryPath = createPrimaryFixture();
    const baseDirectory = temporaryDirectory("primary-lease-race-");
    // A concurrent acquirer has created its lease file but not yet written its owner record.
    const leasePath = path.join(baseDirectory, "primary-checkout-lease.json");
    writeFileSync(leasePath, "", "utf8");

    expect(() =>
      acquirePrimaryCheckoutLease({ primaryPath, baseDirectory, environment: {}, purpose: "racing writer" }),
    ).toThrow(/created the lease .* at the same moment/);
    expect(readFileSync(leasePath, "utf8")).toBe("");
  });

  it("refuses a CLI --acquire that would record its own short-lived PID", () => {
    const primaryPath = createPrimaryFixture();
    const result = spawnSync(process.execPath, [cliPath, "--acquire", "--primary", primaryPath], {
      encoding: "utf8",
      env: { ...process.env, CLINICAL_KB_PRIMARY_LEASE_TOKEN: "", CLINICAL_KB_PRIMARY_LEASE_PATH: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--acquire needs --owner-pid");
    expect(inspectPrimaryCheckoutLease({ primaryPath, environment: {} }).owner).toBeNull();
  });

  it("records the named long-lived owner on a CLI --acquire, so the lease stays live after the CLI exits", () => {
    const primaryPath = createPrimaryFixture();
    const result = spawnSync(
      process.execPath,
      [cliPath, "--acquire", "--json", "--primary", primaryPath, "--owner-pid", String(process.pid)],
      {
        encoding: "utf8",
        env: { ...process.env, CLINICAL_KB_PRIMARY_LEASE_TOKEN: "", CLINICAL_KB_PRIMARY_LEASE_PATH: "" },
      },
    );
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    const inspection = inspectPrimaryCheckoutLease({
      primaryPath,
      environment: {
        CLINICAL_KB_PRIMARY_LEASE_TOKEN: payload.environment.CLINICAL_KB_PRIMARY_LEASE_TOKEN,
        CLINICAL_KB_PRIMARY_LEASE_PATH: payload.environment.CLINICAL_KB_PRIMARY_LEASE_PATH,
      },
    });
    expect(inspection.owner?.pid).toBe(process.pid);
    expect(inspection.owner?.alive).toBe(true);
    expect(inspection.sameOwner).toBe(true);
    rmSync(inspection.leasePath, { force: true });
  });

  it("exposes stable environment key names for nested ownership", () => {
    expect(primaryCheckoutLeaseInternals.tokenEnvironmentKey).toBe("CLINICAL_KB_PRIMARY_LEASE_TOKEN");
    expect(primaryCheckoutLeaseInternals.pathEnvironmentKey).toBe("CLINICAL_KB_PRIMARY_LEASE_PATH");
  });
});
