import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = "C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database";
const out = "C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation";
const attempt = process.argv[2];
if (!/^[1-9][0-9]*$/.test(attempt ?? "")) throw new Error("Explicit positive attempt number required.");
const resultPath = resolve(out, `U03-staged-migration-role-result-${attempt}.json`);
if (existsSync(resultPath)) throw new Error("Preserve prior result; choose a new attempt number.");
const frozen = "fd043b262ebd9b20315c2e46bc4838265787fa80";
const checker = "scripts/check-hosted-migration-role.mjs";
const git = args => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const approvedChecker = git(["show", `${frozen}:${checker}`]);
if (!readFileSync(resolve(root, checker)).equals(approvedChecker) || !git(["show", `:${checker}`]).equals(approvedChecker)) {
  throw new Error("Working/indexed validator differs from reviewed source.");
}
const { isGuardedMigrationRolePath, validateMigrationRoleEntries, IMMUTABLE_HISTORICAL_MIGRATION } = await import(pathToFileURL(resolve(root, checker)).href);
const guardedRoots = ["AGENTS.md", "package.json", "supabase/schema.sql", "supabase/roles.sql", "docs/disaster-recovery-runbook.md", ".github/actions/", ".github/workflows/", "scripts/", "supabase/migrations/"];
if (git(["diff", "--name-only", "--", ...guardedRoots]).length) throw new Error("Unstaged guarded overlap; freeze the candidate before validation.");
if (git(["ls-files", "--unmerged", "-z", "--", ...guardedRoots]).length) throw new Error("Unmerged guarded input.");
const paths = [...new Set(git(["ls-files", "--cached", "-z", "--", ...guardedRoots]).toString("utf8").split("\0").filter(Boolean))].filter(isGuardedMigrationRolePath).sort();
for (const required of [IMMUTABLE_HISTORICAL_MIGRATION, "supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql"]) {
  if (!paths.includes(required)) throw new Error(`Required staged input absent: ${required}`);
}
const entries = paths.map(path => ({ path, content: git(["show", `:${path}`]) }));
const failures = validateMigrationRoleEntries(entries, { requireHistorical: true });
const result = { kind: "scoped staged migration-role equivalent", head: git(["rev-parse", "HEAD"]).toString("utf8").trim(), checkerSha256: hash(approvedChecker), inputs: entries.map(({ path, content }) => ({ path, sha256: hash(content) })), failures };
writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const failure of failures) process.stderr.write(failure + "\n");
process.stdout.write(`Scoped staged migration-role: ${failures.length ? "FAIL" : "PASS"}; ${entries.length} guarded inputs; immutable history included.\n`);
process.exitCode = failures.length ? 1 : 0;
