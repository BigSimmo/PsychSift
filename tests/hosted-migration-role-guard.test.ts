import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IMMUTABLE_HISTORICAL_MIGRATION,
  RESERVED_HOSTED_ROLE,
  discoverRepositoryEntries,
  formatRepositoryDiagnostics,
  inspectMigrationRoleRepository,
  isGuardedMigrationRolePath,
  runMigrationRoleGuard,
  validateMigrationRoleEntries,
} from "../scripts/check-hosted-migration-role.mjs";

const HEAD_SHA = "1".repeat(40);
const BASE_SHA = "2".repeat(40);
const MERGE_BASE_SHA = "3".repeat(40);

function nulList(paths: string[]) {
  return paths.length > 0 ? `${paths.join("\0")}\0` : "";
}

function syntheticRepository({
  tracked = [IMMUTABLE_HISTORICAL_MIGRATION],
  untracked = [],
  entries = {},
  diagnosticFailure,
  gitOverrides = {},
}: {
  tracked?: string[];
  untracked?: string[];
  entries?: Record<string, Buffer | string | { kind: string; content?: Buffer | string } | Error>;
  diagnosticFailure?: Error;
  gitOverrides?: Record<string, string | Error>;
} = {}) {
  const historicalContent = readFileSync(IMMUTABLE_HISTORICAL_MIGRATION);
  const contentByPath = new Map<string, Buffer | string | { kind: string; content?: Buffer | string } | Error>([
    [IMMUTABLE_HISTORICAL_MIGRATION, historicalContent],
    ...Object.entries(entries),
  ]);

  return {
    runGit(args: string[]) {
      const command = args.join(" ");
      if (Object.hasOwn(gitOverrides, command)) {
        const override = gitOverrides[command];
        if (override instanceof Error) throw override;
        return override;
      }
      if (command === "ls-files --cached -z") return nulList(tracked);
      if (command === "ls-files --others --exclude-standard -z") return nulList(untracked);
      if (diagnosticFailure) throw diagnosticFailure;
      if (command === "rev-parse --verify HEAD") return `${HEAD_SHA}\n`;
      if (command === "rev-parse --verify --quiet origin/main^{commit}") return `${BASE_SHA}\n`;
      if (command === "merge-base HEAD origin/main") return `${MERGE_BASE_SHA}\n`;
      if (command === "rev-list --left-right --count origin/main...HEAD") return "2\t5\n";
      if (command === "rev-parse --is-shallow-repository") return "false\n";
      throw new Error(`Unexpected synthetic Git operation: ${command}`);
    },
    inspectPath(_absolutePath: string, repositoryPath: string) {
      const entry = contentByPath.get(repositoryPath);
      if (entry instanceof Error) throw entry;
      if (entry && typeof entry === "object" && !Buffer.isBuffer(entry) && "kind" in entry) return entry;
      if (entry === undefined) {
        const error = new Error("synthetic missing path") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return { kind: "file", content: entry };
    },
    runtime: { platform: "win32", architecture: "x64", nodeVersion: "24.19.0" },
  };
}

describe("hosted migration-role guard", { timeout: 60_000 }, () => {
  it("accepts the current repository state", () => {
    const result = inspectMigrationRoleRepository();

    expect(result.failures, result.diagnostics ? formatRepositoryDiagnostics(result.diagnostics) : undefined).toEqual(
      [],
    );
  });

  it("keeps tracked and untracked provenance on discovered guarded entries", () => {
    const trackedPath = "scripts/tracked-role-check.mjs";
    const untrackedPath = "scripts/untracked-role-check.mjs";
    const discovery = discoverRepositoryEntries("C:\\Users\\secret-owner\\Database", {
      ...syntheticRepository({
        tracked: [IMMUTABLE_HISTORICAL_MIGRATION, trackedPath],
        untracked: [untrackedPath],
        entries: { [trackedPath]: "select 1;", [untrackedPath]: "select 1;" },
      }),
    });

    expect(discovery.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: trackedPath, provenance: "tracked" }),
        expect.objectContaining({ path: untrackedPath, provenance: "untracked" }),
      ]),
    );
    expect(discovery.counts).toMatchObject({ tracked: 2, untracked: 1, guarded: 3, readErrors: 0 });
  });

  it("attributes an untracked guarded role reference without printing its content", () => {
    const untrackedPath = "scripts/temporary-hosted-role-check.mjs";
    const secretContent = `do not print this token; role=${RESERVED_HOSTED_ROLE}`;
    const result = inspectMigrationRoleRepository("C:\\Users\\secret-owner\\Database", {
      ...syntheticRepository({ untracked: [untrackedPath], entries: { [untrackedPath]: secretContent } }),
    });

    expect(result.failures).toEqual([
      expect.stringContaining(`${untrackedPath} [untracked]: active content references the reserved hosted role`),
    ]);
    expect(JSON.stringify(result)).not.toContain("do not print this token");
    expect(formatRepositoryDiagnostics(result.diagnostics!)).not.toContain("secret-owner");
  });

  it("fails closed with structured provenance for guarded directories and read errors", () => {
    const directoryPath = "scripts/nested-worktree";
    const unreadablePath = "supabase/migrations/20990101000000_unreadable.sql";
    const readError = new Error("C:\\Users\\secret-owner\\Database\\private-token") as NodeJS.ErrnoException;
    readError.code = "EACCES";
    const result = inspectMigrationRoleRepository("C:\\Users\\secret-owner\\Database", {
      ...syntheticRepository({
        untracked: [directoryPath, unreadablePath],
        entries: { [directoryPath]: { kind: "directory" }, [unreadablePath]: readError },
      }),
    });

    expect(result.failures).toEqual(
      expect.arrayContaining([
        `${directoryPath} [untracked]: guarded entry could not be inspected (category=directory, code=EISDIR)`,
        `${unreadablePath} [untracked]: guarded entry could not be inspected (category=read-error, code=EACCES)`,
      ]),
    );
    expect(result.diagnostics?.counts.readErrors).toBe(2);
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(JSON.stringify(result)).not.toContain("secret-owner");
  });

  it("prints deterministic safe repository diagnostics on a simulated failure", () => {
    const migration = "supabase/migrations/20990101000000_bad.sql";
    const standardOutput: string[] = [];
    const standardError: string[] = [];
    const exitCode = runMigrationRoleGuard({
      repoRoot: "C:\\Users\\secret-owner\\Database",
      dependencies: syntheticRepository({
        tracked: [IMMUTABLE_HISTORICAL_MIGRATION],
        untracked: [migration],
        entries: { [migration]: `grant ${RESERVED_HOSTED_ROLE} to postgres;` },
      }),
      writeOutput: (line) => standardOutput.push(line),
      writeError: (line) => standardError.push(line),
    });

    expect(exitCode).toBe(1);
    expect(standardOutput).toEqual([]);
    expect(standardError.join("\n")).toContain(
      [
        "Hosted migration-role diagnostics:",
        `- HEAD: ${HEAD_SHA}`,
        `- base: ref=origin/main commit=${BASE_SHA} merge-base=${MERGE_BASE_SHA} ahead=5 behind=2`,
        "- shallow: false",
        "- runtime: platform=win32 architecture=x64 node=24.19.0",
        "- entries: tracked=1 untracked=1 guarded=2 read-errors=0",
        `- migrations: count=2 first=${IMMUTABLE_HISTORICAL_MIGRATION.split("/").at(-1)} last=${migration.split("/").at(-1)}`,
      ].join("\n"),
    );
    expect(standardError.join("\n")).not.toContain("secret-owner");
  });

  it("renders unavailable diagnostics without leaking collection errors or raw Git commands", () => {
    const migration = "supabase/migrations/20990101000000_bad.sql";
    const collectionError = new Error(
      "git rev-parse --verify HEAD failed at C:\\Users\\secret-owner with token=raw-secret",
    );
    const result = inspectMigrationRoleRepository("C:\\Users\\secret-owner\\Database", {
      ...syntheticRepository({
        untracked: [migration],
        entries: { [migration]: `grant ${RESERVED_HOSTED_ROLE} to postgres;` },
        diagnosticFailure: collectionError,
      }),
    });
    const output = formatRepositoryDiagnostics(result.diagnostics!);

    expect(result.failures).toHaveLength(1);
    expect(output).toContain("- HEAD: unavailable");
    expect(output).toContain(
      "- base: ref=unavailable commit=unavailable merge-base=unavailable ahead=unavailable behind=unavailable",
    );
    expect(output).toContain("- shallow: unavailable");
    expect(output).not.toMatch(/raw-secret|secret-owner|rev-parse|--verify/);
  });

  it("retains independent diagnostics when one runtime field coercion throws", () => {
    const migration = "supabase/migrations/20990101000000_bad.sql";
    const standardError: string[] = [];
    const dependencies = syntheticRepository({
      untracked: [migration],
      entries: { [migration]: `grant ${RESERVED_HOSTED_ROLE} to postgres;` },
    });
    dependencies.runtime.platform = {
      toString() {
        throw new Error("SENSITIVE-DIAGNOSTIC C:\\Users\\secret-owner");
      },
    } as unknown as string;

    let exitCode: number | undefined;
    expect(() => {
      exitCode = runMigrationRoleGuard({
        repoRoot: "C:\\Users\\secret-owner\\Database",
        dependencies,
        writeOutput: () => undefined,
        writeError: (line) => standardError.push(line),
      });
    }).not.toThrow();

    const output = standardError.join("\n");
    expect(exitCode).toBe(1);
    expect(output).toContain(`- HEAD: ${HEAD_SHA}`);
    expect(output).toContain(
      `- base: ref=origin/main commit=${BASE_SHA} merge-base=${MERGE_BASE_SHA} ahead=5 behind=2`,
    );
    expect(output).toContain("- shallow: false");
    expect(output).toContain("- runtime: platform=unavailable architecture=x64 node=24.19.0");
    expect(output).toContain("- entries: tracked=1 untracked=1 guarded=2 read-errors=0");
    expect(output).toContain(
      "- migrations: count=2 first=20260713102000_revoke_supabase_admin_default_privileges.sql last=20990101000000_bad.sql",
    );
    expect(output).not.toMatch(/SENSITIVE-DIAGNOSTIC|secret-owner/);
  });

  it("retains safe repository evidence when the runtime dependency getter throws", () => {
    const migration = "supabase/migrations/20990101000000_bad.sql";
    const standardError: string[] = [];
    const dependencies = syntheticRepository({
      untracked: [migration],
      entries: { [migration]: `grant ${RESERVED_HOSTED_ROLE} to postgres;` },
    });
    Object.defineProperty(dependencies, "runtime", {
      configurable: true,
      get() {
        throw new Error("SENSITIVE-RUNTIME-GETTER C:\\Users\\secret-owner");
      },
    });

    let exitCode: number | undefined;
    expect(() => {
      exitCode = runMigrationRoleGuard({
        repoRoot: "C:\\Users\\secret-owner\\Database",
        dependencies,
        writeOutput: () => undefined,
        writeError: (line) => standardError.push(line),
      });
    }).not.toThrow();

    const output = standardError.join("\n");
    expect(exitCode).toBe(1);
    expect(output).toContain(`- HEAD: ${HEAD_SHA}`);
    expect(output).toContain(
      `- base: ref=origin/main commit=${BASE_SHA} merge-base=${MERGE_BASE_SHA} ahead=5 behind=2`,
    );
    expect(output).toContain("- shallow: false");
    expect(output).toContain("- runtime: platform=unavailable architecture=unavailable node=unavailable");
    expect(output).toContain("- entries: tracked=1 untracked=1 guarded=2 read-errors=0");
    expect(output).toContain(
      "- migrations: count=2 first=20260713102000_revoke_supabase_admin_default_privileges.sql last=20990101000000_bad.sql",
    );
    expect(output).not.toMatch(/SENSITIVE-RUNTIME-GETTER|secret-owner/);
  });

  it("fails closed without leaking a throwing runGit dependency getter", () => {
    const standardError: string[] = [];
    const dependencies = syntheticRepository();
    Object.defineProperty(dependencies, "runGit", {
      configurable: true,
      get() {
        throw new Error("SENSITIVE-RUNGIT-GETTER C:\\Users\\secret-owner");
      },
    });

    let exitCode: number | undefined;
    expect(() => {
      exitCode = runMigrationRoleGuard({
        repoRoot: "C:\\Users\\secret-owner\\Database",
        dependencies,
        writeOutput: () => undefined,
        writeError: (line) => standardError.push(line),
      });
    }).not.toThrow();

    const output = standardError.join("\n");
    expect(exitCode).toBe(1);
    expect(output).toContain("repository tracked discovery could not be completed (code=DEPENDENCY_ACCESS)");
    expect(output).toContain("repository untracked discovery could not be completed (code=DEPENDENCY_ACCESS)");
    expect(output).toContain("- HEAD: unavailable");
    expect(output).toContain("- runtime: platform=win32 architecture=x64 node=24.19.0");
    expect(output).toContain(
      "- entries: tracked=unavailable untracked=unavailable guarded=unavailable read-errors=unavailable",
    );
    expect(output).not.toMatch(/SENSITIVE-RUNGIT-GETTER|secret-owner/);
  });

  it("fails closed without leaking a throwing inspectPath dependency getter", () => {
    const standardError: string[] = [];
    const dependencies = syntheticRepository();
    Object.defineProperty(dependencies, "inspectPath", {
      configurable: true,
      get() {
        throw new Error("SENSITIVE-INSPECT-GETTER C:\\Users\\secret-owner");
      },
    });

    let exitCode: number | undefined;
    expect(() => {
      exitCode = runMigrationRoleGuard({
        repoRoot: "C:\\Users\\secret-owner\\Database",
        dependencies,
        writeOutput: () => undefined,
        writeError: (line) => standardError.push(line),
      });
    }).not.toThrow();

    const output = standardError.join("\n");
    expect(exitCode).toBe(1);
    expect(output).toContain(
      `${IMMUTABLE_HISTORICAL_MIGRATION} [tracked]: guarded entry could not be inspected ` +
        "(category=read-error, code=DEPENDENCY_ACCESS)",
    );
    expect(output).toContain(`- HEAD: ${HEAD_SHA}`);
    expect(output).toContain("- runtime: platform=win32 architecture=x64 node=24.19.0");
    expect(output).toContain("- entries: tracked=1 untracked=0 guarded=1 read-errors=1");
    expect(output).toContain(
      `- migrations: count=1 first=${IMMUTABLE_HISTORICAL_MIGRATION.split("/").at(-1)} ` +
        `last=${IMMUTABLE_HISTORICAL_MIGRATION.split("/").at(-1)}`,
    );
    expect(output).not.toMatch(/SENSITIVE-INSPECT-GETTER|secret-owner/);
  });

  it("uses constant unavailable diagnostics after an unexpected inspection failure", () => {
    const standardError: string[] = [];
    const dependencies = syntheticRepository();
    const stableRunGit = dependencies.runGit;
    let runGitGetterReads = 0;
    Object.defineProperty(dependencies, "runGit", {
      configurable: true,
      get() {
        runGitGetterReads += 1;
        if (runGitGetterReads > 1) throw new Error("SENSITIVE-RETRIED-GETTER C:\\Users\\secret-owner");
        return stableRunGit;
      },
    });

    let exitCode: number | undefined;
    expect(() => {
      exitCode = runMigrationRoleGuard({
        repoRoot: {} as unknown as string,
        dependencies,
        writeOutput: () => undefined,
        writeError: (line) => standardError.push(line),
      });
    }).not.toThrow();

    const output = standardError.join("\n");
    expect(exitCode).toBe(1);
    expect(runGitGetterReads).toBe(1);
    expect(output).toContain("repository inspection could not be completed (code=UNEXPECTED)");
    expect(output).toContain("- HEAD: unavailable");
    expect(output).toContain(
      "- entries: tracked=unavailable untracked=unavailable guarded=unavailable read-errors=unavailable",
    );
    expect(output).not.toMatch(/SENSITIVE-RETRIED-GETTER|secret-owner/);
  });

  it("formats hostile diagnostic objects as a fixed unavailable block", () => {
    const hostileDiagnostics = {
      get base() {
        throw new Error("SENSITIVE-FORMATTER C:\\Users\\secret-owner");
      },
    };

    let output = "";
    expect(() => {
      output = formatRepositoryDiagnostics(hostileDiagnostics);
    }).not.toThrow();
    expect(output).toContain("- HEAD: unavailable");
    expect(output).toContain(
      "- base: ref=unavailable commit=unavailable merge-base=unavailable ahead=unavailable behind=unavailable",
    );
    expect(output).toContain(
      "- entries: tracked=unavailable untracked=unavailable guarded=unavailable read-errors=unavailable",
    );
    expect(output).not.toMatch(/SENSITIVE-FORMATTER|secret-owner/);
  });

  it("preserves a valid merge-base when ahead and behind collection fails", () => {
    const migration = "supabase/migrations/20990101000000_bad.sql";
    const result = inspectMigrationRoleRepository("C:\\Users\\secret-owner\\Database", {
      ...syntheticRepository({
        untracked: [migration],
        entries: { [migration]: `grant ${RESERVED_HOSTED_ROLE} to postgres;` },
        gitOverrides: {
          "rev-list --left-right --count origin/main...HEAD": new Error("relationship unavailable"),
        },
      }),
    });

    expect(result.diagnostics?.base).toMatchObject({
      mergeBase: MERGE_BASE_SHA,
      ahead: "unavailable",
      behind: "unavailable",
    });
  });

  it("preserves valid ahead and behind counts when merge-base collection fails", () => {
    const migration = "supabase/migrations/20990101000000_bad.sql";
    const result = inspectMigrationRoleRepository("C:\\Users\\secret-owner\\Database", {
      ...syntheticRepository({
        untracked: [migration],
        entries: { [migration]: `grant ${RESERVED_HOSTED_ROLE} to postgres;` },
        gitOverrides: {
          "merge-base HEAD origin/main": new Error("merge-base unavailable"),
        },
      }),
    });

    expect(result.diagnostics?.base).toMatchObject({
      mergeBase: "unavailable",
      ahead: 5,
      behind: 2,
    });
  });

  it("marks read-error counts unavailable when repository discovery is incomplete", () => {
    const migration = "supabase/migrations/20990101000000_bad.sql";
    const result = inspectMigrationRoleRepository("C:\\Users\\secret-owner\\Database", {
      ...syntheticRepository({
        untracked: [migration],
        entries: { [migration]: "select 1;" },
        gitOverrides: {
          "ls-files --cached -z": Object.assign(new Error("SENSITIVE-DISCOVERY"), { code: "EIO" }),
        },
      }),
    });

    expect(result.diagnostics?.counts).toEqual({
      tracked: "unavailable",
      untracked: 1,
      guarded: "unavailable",
      readErrors: "unavailable",
    });
    expect(formatRepositoryDiagnostics(result.diagnostics!)).not.toContain("SENSITIVE-DISCOVERY");
  });

  it("accepts the pinned immutable migration and rejects modifications or removal", () => {
    const historicalContent = readFileSync(IMMUTABLE_HISTORICAL_MIGRATION);

    expect(
      validateMigrationRoleEntries([{ path: IMMUTABLE_HISTORICAL_MIGRATION, content: historicalContent }]),
    ).toEqual([]);
    expect(
      validateMigrationRoleEntries([
        { path: IMMUTABLE_HISTORICAL_MIGRATION, content: Buffer.concat([historicalContent, Buffer.from("\n")]) },
      ]),
    ).toEqual([expect.stringContaining("immutable applied migration changed")]);
    expect(validateMigrationRoleEntries([])).toEqual([
      expect.stringContaining("immutable applied migration is missing"),
    ]);
  });

  it("rejects the reserved role token in active hosted content and file names", () => {
    const contentFailures = validateMigrationRoleEntries(
      [
        {
          path: "supabase/migrations/20990101000000_bad_default_privileges.sql",
          content: `alter default privileges for role ${RESERVED_HOSTED_ROLE.toUpperCase()} revoke all on tables from public;`,
        },
      ],
      { requireHistorical: false },
    );
    const pathFailures = validateMigrationRoleEntries(
      [
        {
          path: `supabase/migrations/20990101000000_${RESERVED_HOSTED_ROLE}_repair.sql`,
          content: "select 1;",
        },
      ],
      { requireHistorical: false },
    );

    expect(contentFailures).toEqual([expect.stringContaining("active content references")]);
    expect(pathFailures).toEqual([expect.stringContaining("active file name references")]);
  });

  it("limits enforcement to hosted SQL/tooling and does not confuse environment-variable names with SQL roles", () => {
    expect(isGuardedMigrationRolePath("scripts/generate-drift-manifest.ts")).toBe(true);
    expect(isGuardedMigrationRolePath("docs/disaster-recovery-runbook.md")).toBe(true);
    expect(isGuardedMigrationRolePath("docs/branch-review-ledger.md")).toBe(false);

    expect(
      validateMigrationRoleEntries(
        [
          {
            path: "scripts/set-site-administrator.ts",
            content: `process.env.ALLOW_${RESERVED_HOSTED_ROLE.toUpperCase()}_MUTATION`,
          },
          { path: "docs/branch-review-ledger.md", content: `Historical reference: ${RESERVED_HOSTED_ROLE}` },
        ],
        { requireHistorical: false },
      ),
    ).toEqual([]);
  });

  it("discovers the bare-image storage owner instead of hard-coding a hosted role", () => {
    const generator = readFileSync("scripts/generate-drift-manifest.ts", "utf8");
    const runbook = readFileSync("docs/disaster-recovery-runbook.md", "utf8");

    expect(generator).toContain("pg_catalog.pg_get_userbyid(nspowner)");
    expect(generator).toContain("await sql(storageSchemaOwner, inputs.scaffoldSql)");
    expect(runbook).toContain("storage_owner=");
    expect(runbook).toContain('psql -U "${storage_owner}"');
    expect(generator).not.toContain(RESERVED_HOSTED_ROLE);
    expect(runbook).not.toContain(RESERVED_HOSTED_ROLE);
  });
});
