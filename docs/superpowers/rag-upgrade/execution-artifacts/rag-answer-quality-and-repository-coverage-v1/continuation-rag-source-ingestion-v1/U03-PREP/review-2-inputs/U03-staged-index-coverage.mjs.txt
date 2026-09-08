import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = "C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database";
const out = "C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation";
const attempt = process.argv[2];
if (!/^[1-9][0-9]*$/.test(attempt ?? "")) throw new Error("Explicit positive attempt number required.");
const resultPath = resolve(out, `U03-staged-index-coverage-result-${attempt}.json`);
if (existsSync(resultPath)) throw new Error("Preserve prior result; choose a new attempt number.");
const frozen = "fd043b262ebd9b20315c2e46bc4838265787fa80";
const checker = "scripts/check-codebase-index-coverage.mjs";
const git = args => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const approvedChecker = git(["show", `${frozen}:${checker}`]);
if (!readFileSync(resolve(root, checker)).equals(approvedChecker) || !git(["show", `:${checker}`]).equals(approvedChecker)) throw new Error("Index checker changed; review equivalence first.");
const scope = [".", ":(top,exclude)1", ":(top,exclude)1/**"];
if (git(["ls-files", "--unmerged", "-z", "--", ...scope]).length) throw new Error("Unmerged index input.");
const direct = ["docs/codebase-index.md", "supabase/schema.sql"];
if (git(["diff", "--name-only", "--", ...direct]).length) throw new Error("Unstaged index/schema overlap.");
const paths = git(["ls-files", "--cached", "-z", "--", ...scope]).toString("utf8").split("\0").filter(Boolean);
const { coverageGaps, schemaTableGaps, trackedRootDirectoryNames } = await import(pathToFileURL(resolve(root, checker)).href);
const groups = trackedRootDirectoryNames(paths).map(name => ({ kind: "root", dir: ".", name }));
for (const [kind, dir] of [["lib", "src/lib"], ["route", "src/app"], ["api", "src/app/api"]]) {
  const children = new Set(paths.filter(p => p.startsWith(dir + "/")).map(p => p.slice(dir.length + 1)).filter(p => p.includes("/")).map(p => p.split("/")[0]));
  for (const name of [...children].sort()) if (!(kind === "route" && name === "api")) groups.push({ kind, dir, name });
}
const index = git(["show", ":docs/codebase-index.md"]);
const schema = git(["show", ":supabase/schema.sql"]);
const gaps = coverageGaps(index.toString("utf8"), groups);
const tables = schemaTableGaps(index.toString("utf8"), schema.toString("utf8"));
const result = { kind: "scoped staged tracked module-index equivalent", head: git(["rev-parse", "HEAD"]).toString("utf8").trim(), checkerSha256: hash(approvedChecker), trackedPathListSha256: hash(Buffer.from(paths.join("\n") + "\n")), indexSha256: hash(index), schemaSha256: hash(schema), groups, gaps, tables, excluded: ["protected 1/", "unrelated untracked directories"] };
writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ kind: result.kind, gaps, tables }) + "\n");
process.exitCode = gaps.length || tables.missing.length || tables.stale.length ? 1 : 0;
