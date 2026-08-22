#!/usr/bin/env node
// scripts/rebuild-caring-contacts-sdd-workspace.mjs
//
// Rebuilds the superpowers subagent-driven-development workspace for the Caring Contacts Phase 2A
// plan from the TRACKED records, so the workspace is disposable rather than precious.
//
// Why this exists. The workspace lives at `.superpowers/sdd/<plan>/`, which carries its own
// `.gitignore` containing `*` -- everything in it is invisible to git. On 2026-08-21 the worktree
// holding it was deleted by another process on the workstation and the entire workspace was lost,
// including the session ledger, which existed nowhere else in that form. Only the tracked copies
// under `docs/caring-contacts/` survived.
//
// The lesson was not "back the workspace up". It was that the workspace must never be a SOURCE.
// So this script regenerates it from tracked files, and every generated file says so in its own
// header. If the workspace is destroyed again, run this and lose nothing.
//
//   node scripts/rebuild-caring-contacts-sdd-workspace.mjs
//   node scripts/rebuild-caring-contacts-sdd-workspace.mjs --check   (verify, write nothing)
//
// `--check` exits non-zero if the workspace is missing or stale, so the rebuild can be proven
// rather than assumed.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = "2026-08-19-caring-contact-phase-2a-foundations";
const workspace = path.join(projectRoot, ".superpowers", "sdd", PLAN);
const archive = path.join(projectRoot, "docs", "caring-contacts", "phase-2a-sdd-archive");
const ledger = path.join(projectRoot, "docs", "caring-contacts", "phase-2a-build-record.md");
const checkOnly = process.argv.includes("--check");

const GENERATED = (source) =>
  [
    "<!--",
    "  GENERATED MIRROR -- DO NOT EDIT, AND DO NOT TREAT AS A SOURCE.",
    "",
    `  Regenerated from ${source} by`,
    "  scripts/rebuild-caring-contacts-sdd-workspace.mjs. This directory is git-ignored scratch and",
    "  has already been destroyed once, on 2026-08-21, taking an unbacked session ledger with it.",
    "  Edit the tracked file above; then re-run the script.",
    "-->",
    "",
  ].join("\n");

function sourceFiles() {
  if (!existsSync(archive)) throw new Error(`Tracked archive is missing: ${archive}`);
  // The stale frozen ledger snapshot is deliberately NOT mirrored: it is a trap, not a source.
  return readdirSync(archive).filter((name) => name.endsWith(".md") && name !== "00-live-ledger-verbatim.md");
}

function expectedContents() {
  const files = new Map();
  for (const name of sourceFiles()) {
    files.set(
      name,
      GENERATED(`docs/caring-contacts/phase-2a-sdd-archive/${name}`) + readFileSync(path.join(archive, name), "utf8"),
    );
  }
  files.set(
    "progress.md",
    GENERATED("docs/caring-contacts/phase-2a-build-record.md") +
      [
        "# SDD ledger — MIRROR of the tracked build record",
        "",
        "**Append new rulings, findings and resume points to the tracked file, never to this one.**",
        "Two ledgers drifting apart is the failure a data loss already removed here; this copy exists",
        "only so the workspace is complete if the tracked repository is unavailable.",
        "",
        "---",
        "",
        readFileSync(ledger, "utf8"),
      ].join("\n"),
  );
  return files;
}

const expected = expectedContents();

if (checkOnly) {
  const problems = [];
  for (const [name, content] of expected) {
    const target = path.join(workspace, name);
    if (!existsSync(target)) problems.push(`missing: ${name}`);
    else if (readFileSync(target, "utf8") !== content) problems.push(`stale: ${name}`);
  }
  if (problems.length > 0) {
    process.stderr.write(
      `The Caring Contacts SDD workspace is out of date (${problems.length}):\n  ${problems.slice(0, 10).join("\n  ")}\n` +
        `Run: node scripts/rebuild-caring-contacts-sdd-workspace.mjs\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`SDD workspace is current: ${expected.size} files mirrored from tracked records.\n`);
  process.exit(0);
}

// Rebuild from scratch so a stale file from an earlier plan revision cannot survive.
if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });
mkdirSync(path.join(projectRoot, ".superpowers"), { recursive: true });
writeFileSync(path.join(projectRoot, ".superpowers", ".gitignore"), "*\n");
for (const [name, content] of expected) writeFileSync(path.join(workspace, name), content);
process.stdout.write(
  `Rebuilt ${workspace}\n  ${expected.size} files mirrored from tracked records (ledger + ${expected.size - 1} briefs/reports).\n`,
);
