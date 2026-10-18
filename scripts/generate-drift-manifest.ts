import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { rootlessOptions, withRootlessReplay, type ReplaySql } from "./lib/drift-rootless";

/**
 * drift:manifest — regenerates supabase/drift-manifest.json.
 *
 * Replays supabase/schema.sql from scratch into a disposable Supabase Postgres
 * Docker container (the same image family the hosted platform runs), then
 * captures public.schema_drift_snapshot() from that pristine database. The
 * result is the expected-state side of `npm run check:drift`.
 *
 * Defaults to Docker; an explicit offline rootless backend is available on Linux amd64.
 * Never touches the live project. Run this whenever
 * supabase/schema.sql changes — the manifest embeds schema.sql's sha256 and
 * both check:drift and tests/drift-detection.test.ts fail while it is stale.
 * The replay has no supabase_migrations schema, so the manifest's
 * migration_history is always empty with probe 'no_history_table' — that
 * category is compared live-vs-allowlist, never against this manifest.
 *
 * Flags:
 *   --keep        leave the container running (for inspection / DR rehearsal)
 *   --port <n>    host port for the scratch Postgres (default: ephemeral loopback port)
 *   --container <name>  override the scratch container name for concurrent worktrees
 *   --image <x>   override the digest-pinned Postgres image reference
 *   --backend rootless --oci-layout <absolute> --scratch-root <private absolute>
 *     --umoci <trusted absolute executable> --umoci-sha256 <approved binary hash>
 *     --evidence <new private absolute JSON>  explicit offline rootless replay
 * Rootless rejects --keep, --port and --container. Tool/image acquisition is separate.
 */

const IMAGE_DEFAULT =
  "supabase/postgres:17.6.1.127@sha256:be60aee15997daca475b710b734bc6bfe52cd544dcd7e9fd2ff58210b6747d83";
const DRIFT_OWNER_LABEL = "com.psychiatry-tools.drift-manifest.worktree";

const repoUrl = (relative: string) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

export function worktreeIdentity(root = repoUrl("")): string {
  return createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 12);
}

const WORKTREE_IDENTITY = worktreeIdentity();
const CONTAINER_DEFAULT = `clinical-kb-drift-${WORKTREE_IDENTITY}-${process.pid}`;

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function docker(args: string[], input?: string, environment?: Record<string, string | undefined>): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    env: environment ? { ...process.env, ...environment } : process.env,
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function assertOwnedContainer(container: string): boolean {
  let inspection: Array<{ Config?: { Labels?: Record<string, string> } }>;
  try {
    inspection = JSON.parse(docker(["container", "inspect", container])) as typeof inspection;
  } catch {
    return false;
  }

  const owner = inspection[0]?.Config?.Labels?.[DRIFT_OWNER_LABEL];
  if (owner !== WORKTREE_IDENTITY) {
    throw new Error(
      `Refusing to remove Docker container ${container}: expected ownership label ${DRIFT_OWNER_LABEL}=${WORKTREE_IDENTITY}, found ${owner ?? "none"}.`,
    );
  }
  return true;
}

function removeOwnedContainer(container: string): void {
  if (assertOwnedContainer(container)) docker(["rm", "-f", container]);
}

export function parseSnapshot(raw: string): Record<string, unknown> {
  const snapshot = JSON.parse(raw) as Record<string, unknown>;
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object")
    throw new Error("Replay snapshot must be an object");
  for (const category of [
    "extensions",
    "tables",
    "views",
    "functions",
    "indexes",
    "policies",
    "constraints",
    "triggers",
    "storage_buckets",
  ]) {
    if (!Array.isArray(snapshot[category]) || !snapshot[category].length)
      throw new Error(`Replay snapshot inventory ${category} is missing or empty`);
  }
  if (
    (snapshot.functions as unknown[]).length <= 40 ||
    (snapshot.indexes as unknown[]).length <= 100 ||
    (snapshot.tables as unknown[]).length <= 30 ||
    snapshot.snapshot_version !== 2 ||
    snapshot.migration_history_probe !== "no_history_table" ||
    !Array.isArray(snapshot.migration_history) ||
    snapshot.migration_history.length
  ) {
    throw new Error("Replay snapshot does not satisfy the complete fresh-schema inventory contract");
  }
  delete snapshot.captured_at;
  return snapshot;
}

export async function replaySchema(
  sql: ReplaySql,
  inputs: { rolesSql: string; scaffoldSql: string; schemaSql: string },
): Promise<Record<string, unknown>> {
  console.log("Applying role bootstrap (postgres)…");
  await sql("postgres", inputs.rolesSql);
  const storageSchemaOwner = (
    await sql(
      "postgres",
      "select pg_catalog.pg_get_userbyid(nspowner) from pg_catalog.pg_namespace where nspname = 'storage';",
      true,
    )
  ).trim();
  if (!storageSchemaOwner) throw new Error("bare Supabase image does not expose an owner for the storage schema");
  console.log("Applying storage scaffold as the discovered bare-image storage owner…");
  await sql(storageSchemaOwner, inputs.scaffoldSql);
  console.log("Replaying supabase/schema.sql from scratch (postgres)…");
  await sql("postgres", inputs.schemaSql);
  return parseSnapshot((await sql("postgres", "select public.schema_drift_snapshot()::text;", true)).trim());
}

export function manifestText(
  image: string,
  schemaSha256: string,
  replaySeconds: number,
  snapshot: Record<string, unknown>,
): string {
  return `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      generator: "scripts/generate-drift-manifest.ts",
      postgres_image: image,
      schema_sha256: schemaSha256,
      replay_seconds: replaySeconds,
      snapshot,
    },
    null,
    2,
  )}\n`;
}

export function writeManifestAtomically(output: string, text: string): void {
  const temporary = `${output}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, text, { flag: "wx", mode: 0o644 });
    renameSync(temporary, output);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function main() {
  const image = arg("--image") ?? IMAGE_DEFAULT;
  if (!/@sha256:[a-f0-9]{64}$/i.test(image)) {
    throw new Error("--image must use an immutable @sha256 digest reference");
  }
  const backend = arg("--backend") ?? "docker";
  if (backend !== "docker" && backend !== "rootless") throw new Error("--backend must be docker or rootless");
  if (backend === "rootless") {
    const options = rootlessOptions(process.argv, image, repoUrl(""));
    const inputs = {
      schemaSql: readFileSync(repoUrl("supabase/schema.sql"), "utf8"),
      rolesSql: readFileSync(repoUrl("supabase/roles.sql"), "utf8"),
      scaffoldSql: readFileSync(repoUrl("scripts/sql/drift-replay-scaffold.sql"), "utf8"),
    };
    const { normalizedSchemaSha256 } = await import("./check-drift");
    const startedAt = Date.now();
    console.log(`Starting explicit offline rootless replay (${image})…`);
    const snapshot = await withRootlessReplay(options, (sql) => replaySchema(sql, inputs));
    const text = manifestText(
      image,
      normalizedSchemaSha256(inputs.schemaSql),
      Math.round((Date.now() - startedAt) / 1000),
      snapshot,
    );
    writeManifestAtomically(repoUrl("supabase/drift-manifest.json"), text);
    const evidence = JSON.parse(readFileSync(options.evidence, "utf8"));
    evidence.manifest_sha256 = createHash("sha256").update(text).digest("hex");
    evidence.schema_sha256 = normalizedSchemaSha256(inputs.schemaSql);
    writeFileSync(options.evidence, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    console.log("Wrote supabase/drift-manifest.json from actual rootless replay; private provenance is in --evidence.");
    return;
  }
  const requestedPort = arg("--port");
  if (requestedPort && (!/^\d+$/.test(requestedPort) || Number(requestedPort) < 1 || Number(requestedPort) > 65535)) {
    throw new Error("--port must be an integer from 1 to 65535");
  }
  const container = arg("--container") ?? CONTAINER_DEFAULT;
  const keep = process.argv.includes("--keep");

  try {
    docker(["info", "--format", "{{.ServerVersion}}"]);
  } catch {
    throw new Error(
      "Docker is required for drift:manifest (it replays schema.sql into a scratch container). Start Docker and retry.",
    );
  }

  try {
    docker(["image", "inspect", image]);
  } catch {
    throw new Error(
      `Required drift image is not cached: ${image}. Pull it explicitly after approving registry access, then retry.`,
    );
  }

  const schemaSql = readFileSync(repoUrl("supabase/schema.sql"), "utf8");
  const rolesSql = readFileSync(repoUrl("supabase/roles.sql"), "utf8");
  const scaffoldSql = readFileSync(repoUrl("scripts/sql/drift-replay-scaffold.sql"), "utf8");
  const { normalizedSchemaSha256 } = await import("./check-drift");

  const publishedPort = requestedPort ? `127.0.0.1:${requestedPort}:5432` : "127.0.0.1::5432";
  console.log(`Starting worktree-owned scratch container ${container} (${image})…`);
  removeOwnedContainer(container);
  const startedAt = Date.now();
  const scratchPassword = randomBytes(16).toString("hex");
  let hostEndpoint = "an unavailable host port";
  try {
    docker(
      [
        "run",
        "-d",
        "--pull=never",
        "--name",
        container,
        "--label",
        `${DRIFT_OWNER_LABEL}=${WORKTREE_IDENTITY}`,
        "-e",
        "POSTGRES_PASSWORD",
        "-p",
        publishedPort,
        image,
      ],
      undefined,
      { POSTGRES_PASSWORD: scratchPassword },
    );
    hostEndpoint = docker(["port", container, "5432/tcp"]).trim();
    console.log(`Scratch Postgres published at ${hostEndpoint}.`);

    // The Supabase image briefly accepts connections before its init migrations
    // deliberately restart Postgres. Require sustained readiness so replay does
    // not race that shutdown window.
    let consecutiveReadyChecks = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        docker(["exec", container, "pg_isready", "-U", "postgres", "-q"]);
        consecutiveReadyChecks += 1;
        if (consecutiveReadyChecks >= 5) break;
      } catch {
        consecutiveReadyChecks = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (consecutiveReadyChecks < 5) {
      throw new Error("scratch Postgres did not remain ready after initialization");
    }

    const snapshot = await replaySchema(
      async (user, sql, tuples = false) =>
        docker(
          [
            "exec",
            "-i",
            container,
            "psql",
            "-U",
            user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            ...(tuples ? ["-tA"] : ["-q"]),
            "-f",
            "-",
          ],
          sql,
        ),
      { rolesSql, scaffoldSql, schemaSql },
    );
    const replaySeconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`Replay complete in ${replaySeconds}s (container start included).`);
    writeManifestAtomically(
      repoUrl("supabase/drift-manifest.json"),
      manifestText(image, normalizedSchemaSha256(schemaSql), replaySeconds, snapshot),
    );
    console.log("Wrote supabase/drift-manifest.json");
    console.log("Next: run `npm run check:drift` against live (needs service-role env).");
  } finally {
    if (keep) {
      console.log(`Container ${container} kept running at ${hostEndpoint} (--keep).`);
    } else {
      try {
        removeOwnedContainer(container);
      } catch (error) {
        console.warn(
          `Could not safely remove container ${container}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
