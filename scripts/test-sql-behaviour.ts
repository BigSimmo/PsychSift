import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * test:sql — runs the database behaviour tests in tests/sql/*.sql.
 *
 * Replays supabase/schema.sql into a disposable, digest-pinned Supabase Postgres container (the
 * same bootstrap as `npm run drift:manifest`), then runs each SQL test in its own transaction.
 * Every test seeds synthetic rows and rolls back, so they share one replay. Requires Docker and
 * the cached image. Never touches the live project. CI runs the same files against the full
 * migration chain in the Migration replay job.
 *
 * Flags:
 *   --files <a.sql,b.sql>  run only these tests (default: every tests/sql/*.sql)
 *   --keep                 leave the container running for inspection
 *   --image <x>            override the digest-pinned Postgres image reference
 */

const IMAGE_DEFAULT =
  "supabase/postgres:17.6.1.127@sha256:be60aee15997daca475b710b734bc6bfe52cd544dcd7e9fd2ff58210b6747d83";
const OWNER_LABEL = "com.psychiatry-tools.sql-behaviour.worktree";
const repoUrl = (relative: string) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
// Same identity scheme as drift:manifest, so concurrent worktrees never touch each other's containers.
const WORKTREE_IDENTITY = createHash("sha256").update(repoUrl("").toLowerCase()).digest("hex").slice(0, 12);

// The bare image ships auth.uid() but not auth.jwt(), which the administrator functions read.
// This is the hosted platform's definition, installed only into the scratch container.
const AUTH_JWT_SHIM = `
do $$ begin
  if to_regprocedure('auth.jwt()') is null then
    create function auth.jwt() returns jsonb language sql stable as $f$
      select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                      nullif(current_setting('request.jwt.claims', true), ''))::jsonb
    $f$;
    grant execute on function auth.jwt() to anon, authenticated;
  end if;
end $$;`;

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function docker(args: string[], input?: string, environment?: Record<string, string>): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    env: environment ? { ...process.env, ...environment } : process.env,
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function removeOwnedContainer(container: string) {
  let labels: Record<string, string> | undefined;
  try {
    labels = (
      JSON.parse(docker(["container", "inspect", container])) as Array<{ Config?: { Labels?: Record<string, string> } }>
    )[0]?.Config?.Labels;
  } catch {
    return;
  }
  if (labels?.[OWNER_LABEL] !== WORKTREE_IDENTITY) {
    throw new Error(`Refusing to remove Docker container ${container}: it is not owned by this worktree.`);
  }
  docker(["rm", "-f", container]);
}

function selectedTests(): string[] {
  const requested = arg("--files");
  if (requested)
    return requested
      .split(",")
      .map((file) => file.trim())
      .filter(Boolean);
  return readdirSync(repoUrl("tests/sql"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => `tests/sql/${name}`);
}

async function main() {
  const image = arg("--image") ?? IMAGE_DEFAULT;
  if (!/@sha256:[a-f0-9]{64}$/i.test(image)) throw new Error("--image must use an immutable @sha256 digest reference");
  const keep = process.argv.includes("--keep");
  const container = `clinical-kb-sqltest-${WORKTREE_IDENTITY}-${process.pid}`;
  const tests = selectedTests();
  if (tests.length === 0) throw new Error("No SQL behaviour tests found in tests/sql.");

  try {
    docker(["info", "--format", "{{.ServerVersion}}"]);
  } catch {
    throw new Error(
      "Docker is required for test:sql (it replays schema.sql into a scratch container). Start Docker and retry.",
    );
  }
  try {
    docker(["image", "inspect", image]);
  } catch {
    throw new Error(
      `Required image is not cached: ${image}. Pull it explicitly after approving registry access, then retry.`,
    );
  }

  const query = (user: string, sql: string) =>
    docker([
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      user,
      "-d",
      "postgres",
      "-tA",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ]).trim();
  const psql = (user: string, sql: string, singleTransaction = false) =>
    docker(
      [
        "exec",
        "-i",
        container,
        "psql",
        "-X",
        "-U",
        user,
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-q",
        ...(singleTransaction ? ["-1"] : []),
        "-f",
        "-",
      ],
      sql,
    );

  const failures: string[] = [];
  try {
    console.log(`Starting scratch container ${container} (${image})…`);
    docker(
      [
        "run",
        "-d",
        "--pull=never",
        "--name",
        container,
        "--label",
        `${OWNER_LABEL}=${WORKTREE_IDENTITY}`,
        "-e",
        "POSTGRES_PASSWORD",
        image,
      ],
      undefined,
      { POSTGRES_PASSWORD: randomBytes(16).toString("hex") },
    );
    // The image restarts Postgres once during init; require sustained readiness.
    let ready = 0;
    for (let attempt = 0; attempt < 60 && ready < 5; attempt += 1) {
      try {
        docker(["exec", container, "pg_isready", "-U", "postgres", "-q"]);
        ready += 1;
      } catch {
        ready = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (ready < 5) throw new Error("scratch Postgres did not remain ready after initialization");

    psql("postgres", readFileSync(repoUrl("supabase/roles.sql"), "utf8"));
    const storageOwner = query(
      "postgres",
      "select pg_catalog.pg_get_userbyid(nspowner) from pg_catalog.pg_namespace where nspname = 'storage';",
    );
    const authOwner = query(
      "postgres",
      "select pg_catalog.pg_get_userbyid(nspowner) from pg_catalog.pg_namespace where nspname = 'auth';",
    );
    if (!storageOwner || !authOwner)
      throw new Error("bare Supabase image does not expose owners for the storage and auth schemas");
    psql(storageOwner, readFileSync(repoUrl("scripts/sql/drift-replay-scaffold.sql"), "utf8"));
    console.log("Replaying supabase/schema.sql…");
    psql("postgres", readFileSync(repoUrl("supabase/schema.sql"), "utf8"));
    psql(authOwner, AUTH_JWT_SHIM);

    for (const test of tests) {
      try {
        const output = psql("postgres", readFileSync(repoUrl(test), "utf8"), true);
        const passLine =
          output
            .split("\n")
            .map((line) => line.trim())
            // Skip psql's table furniture so the test's own result line is what gets reported.
            .filter((line) => line && !/^\(\d+ rows?\)$/.test(line) && !/^[-+]+$/.test(line))
            .at(-1) ?? "";
        console.log(`PASS ${test}  ${passLine}`);
      } catch (error) {
        const stderr = (error as { stderr?: string }).stderr ?? String(error);
        const reason = stderr.split("\n").find((line) => line.includes("ERROR")) ?? stderr.trim();
        console.error(`FAIL ${test}  ${reason}`);
        failures.push(test);
      }
    }
  } finally {
    if (keep) console.log(`Container ${container} kept running (--keep).`);
    else removeOwnedContainer(container);
  }

  if (failures.length > 0) throw new Error(`${failures.length} of ${tests.length} SQL behaviour test(s) failed.`);
  console.log(`All ${tests.length} SQL behaviour tests passed.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
