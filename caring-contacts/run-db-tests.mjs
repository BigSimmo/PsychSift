#!/usr/bin/env node
// caring-contacts/run-db-tests.mjs
//
// Runs the caring-contact database suites -- the migration/row-level-security proofs and the
// shared repository contract driven against the Postgres store -- against a real Postgres named
// by CARING_CONTACTS_DATABASE_URL.
//
// It never skips. A missing variable is a hard failure naming the variable, because a suite that
// quietly passes when the database is absent is a check that cannot fail: the row-level security
// this schema exists to prove would then be unproven and reported green.
//
// The database is a local, disposable container. It is NOT the repository's live Supabase
// project, and nothing here touches a hosted service.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VARIABLE = "CARING_CONTACTS_DATABASE_URL";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const url = process.env[VARIABLE];
if (typeof url !== "string" || url.trim() === "") {
  const lines = [
    `${VARIABLE} is not set, so the caring-contact database suites cannot run.`,
    "They are never skipped: row-level security is the control that stops one hospital team",
    "seeing another team's patients, and it is only proven against a real database.",
    "",
    "Start a disposable local Postgres and point the variable at it, for example:",
    "  docker run --rm -d --name caring-contacts-pg -e POSTGRES_PASSWORD=caring-contacts-local -p 54329:5432 postgres:17",
    `  export ${VARIABLE}=postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres`,
    "",
  ];
  process.stderr.write(lines.join("\n"));
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [
    path.join(projectRoot, "scripts", "run-vitest.mjs"),
    "run",
    "--project=caring-contacts-db",
    ...process.argv.slice(2),
  ],
  { cwd: projectRoot, env: process.env, stdio: "inherit" },
);
child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
child.on("close", (status, signal) => process.exit(status === null ? (signal ? 1 : 0) : status));
