#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const IMAGE = "supabase/postgres:17.6.1.127@sha256:be60aee15997daca475b710b734bc6bfe52cd544dcd7e9fd2ff58210b6747d83";
const OWNER_LABEL = "com.psychiatry-tools.site-content-control-plane.worktree";
const LOCAL_AUTH_JWT_SCAFFOLD = `
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
grant execute on function auth.jwt() to authenticated;
`;
const repoPath = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const WORKTREE_ID = createHash("sha256").update(repoPath("").toLowerCase()).digest("hex").slice(0, 12);
const CONTAINER = `clinical-kb-site-control-${WORKTREE_ID}-${process.pid}`;
const AUTHORITY_MIGRATION = repoPath("supabase/migrations/20260830120000_harden_site_content_initial_adoption.sql");
const TRANSITION_MIGRATION = repoPath("supabase/migrations/20260830121000_bind_site_content_release_transitions.sql");
let databaseCloneRole;

export function assertCorrectionMigrationsPresent() {
  for (const migration of [AUTHORITY_MIGRATION, TRANSITION_MIGRATION]) {
    if (!existsSync(migration)) throw new Error(`Missing correction migration: ${migration}`);
  }
}

function docker(args, input) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      input,
      maxBuffer: 96 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const command = ["docker", ...args].join(" ");
    const stdout = String(error?.stdout ?? "").trim();
    const stderr = String(error?.stderr ?? "").trim();
    throw new Error([`Command failed: ${command}`, stderr, stdout, error?.message].filter(Boolean).join("\n"), {
      cause: error,
    });
  }
}

export function assertOwnedContainer(container = CONTAINER) {
  let inspected;
  try {
    inspected = JSON.parse(docker(["container", "inspect", container]));
  } catch {
    return false;
  }
  const owner = inspected[0]?.Config?.Labels?.[OWNER_LABEL];
  if (owner !== WORKTREE_ID) {
    throw new Error(`Refusing to remove unowned container ${container}.`);
  }
  return true;
}

function removeOwnedContainer() {
  if (assertOwnedContainer()) docker(["rm", "-f", CONTAINER]);
}

function psql(database, sql, { expectFailure, user = "postgres" } = {}) {
  const args = ["exec", "-i", CONTAINER, "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"];
  try {
    const output = docker(args, sql);
    if (expectFailure) throw new Error(`Expected ${expectFailure}, but SQL succeeded.`);
    return output;
  } catch (error) {
    if (!expectFailure) throw error;
    const detail = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`;
    if (!detail.includes(expectFailure)) {
      throw new Error(`SQL failed without expected marker ${expectFailure}: ${detail}`);
    }
    return detail;
  }
}

function dockerAsync(args, input) {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(input);
  return {
    child,
    result: new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        const result = { code, stdout, stderr };
        if (code === 0) resolve(result);
        else reject(Object.assign(new Error(stderr || stdout || `docker exited ${code}`), result));
      });
    }),
  };
}

function psqlAsync(database, sql, applicationName, user = "postgres") {
  return dockerAsync(
    ["exec", "-i", CONTAINER, "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
    `set application_name = '${applicationName}';\n${sql}`,
  );
}

function scalar(database, sql) {
  return docker(["exec", CONTAINER, "psql", "-U", "postgres", "-d", database, "-tAq", "-c", sql]).trim();
}

async function waitForSql(database, sql, expected = "1") {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (scalar(database, sql) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for SQL condition in ${database}: ${sql}`);
}

function terminateApplication(database, applicationName) {
  psql(
    database,
    `select pg_catalog.pg_terminate_backend(pid)
     from pg_catalog.pg_stat_activity
     where application_name = '${applicationName}' and pid <> pg_catalog.pg_backend_pid();`,
  );
}

async function expectAsyncFailure(task, marker) {
  try {
    await task.result;
  } catch (error) {
    const detail = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`;
    if (detail.includes(marker)) return detail;
    throw new Error(`Async SQL failed without expected marker ${marker}: ${detail}`);
  }
  throw new Error(`Expected async SQL failure containing ${marker}, but it succeeded.`);
}

async function runLegacyTransitionRace(database, mode, transition) {
  const prefix = `site-content-${mode}-race`;
  const blockerApp = `${prefix}-blocker`;
  const migrationApp = `${prefix}-migration`;
  const legacyApp = `${prefix}-legacy`;
  const blocker = psqlAsync(
    database,
    "begin; lock table public.site_content_sync_state in access share mode; select pg_catalog.pg_sleep(60); commit;",
    blockerApp,
  );
  void blocker.result.catch(() => {});
  await waitForSql(
    database,
    `select count(*) from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a on a.pid=l.pid
     where a.application_name='${blockerApp}' and l.relation='public.site_content_sync_state'::regclass
       and l.mode='AccessShareLock' and l.granted;`,
  );
  const migration = psqlAsync(database, transition, migrationApp);
  void migration.result.catch(() => {});
  await waitForSql(
    database,
    `select count(*) from pg_catalog.pg_locks advisory
     join pg_catalog.pg_stat_activity a on a.pid=advisory.pid
     where a.application_name='${migrationApp}' and advisory.locktype='advisory' and advisory.granted
       and exists (select 1 from pg_catalog.pg_locks relation_lock
         where relation_lock.pid=a.pid and relation_lock.relation='public.site_content_sync_state'::regclass
           and relation_lock.mode='AccessExclusiveLock' and not relation_lock.granted);`,
  );
  const invocation =
    mode === "activation"
      ? `do $$ declare r public.site_content_releases%rowtype; p public.site_content_releases%rowtype;
           f jsonb; receipt jsonb; begin
           select * into strict r from public.site_content_releases where id='84000000-0000-5000-8000-000000000200';
           select * into strict p from public.site_content_releases where id='84000000-0000-5000-8000-000000000100';
           f:=jsonb_build_object('version','activation-receipt-v1','promotionId','site-release:legacy-race-r2',
             'projectRef','legacy-transition-race','operation','site_release','recoveryReadinessDigest',repeat('6',64),
             'activatedAt',to_char(pg_catalog.statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'resource',jsonb_build_object('kind','site_release',
             'siteReleaseId',r.id::text,'siteReleaseDigest',r.release_digest,'previousSiteReleaseId',p.id::text,
             'previousSiteReleaseDigest',p.release_digest));
           receipt:=f||jsonb_build_object('receiptId','sha256:'||encode(extensions.digest(convert_to(
             'activation-receipt-identity-v1'||E'\\n'||public.site_content_canonical_json(f),'UTF8'),'sha256'),'hex'));
           perform public.activate_site_content_release(r.id,r.release_digest,2,repeat('6',64),receipt);
         end $$;`
      : `do $$ declare a public.site_content_release_receipts%rowtype; t public.site_content_releases%rowtype;
           f jsonb; receipt jsonb; begin
           select * into strict a from public.site_content_release_receipts
             where release_id='84000000-0000-5000-8000-000000000200' and receipt_kind='activation';
           select * into strict t from public.site_content_releases where id='84000000-0000-5000-8000-000000000100';
           f:=jsonb_build_object('version','rollback-receipt-v1','activationReceiptId',a.receipt_id,
             'promotionId',a.receipt->>'promotionId','projectRef',a.receipt->>'projectRef','operation','site_release',
             'rolledBackAt',to_char(pg_catalog.statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'method','retained_previous','requiresReconstruction',false,
             'outcome','succeeded','target',jsonb_build_object('kind','site_release','siteReleaseId',t.id::text,
             'siteReleaseDigest',t.release_digest));
           receipt:=f||jsonb_build_object('receiptId','sha256:'||encode(extensions.digest(convert_to(
             'rollback-receipt-identity-v1'||E'\\n'||public.site_content_canonical_json(f),'UTF8'),'sha256'),'hex'));
           perform public.rollback_site_content_release('84000000-0000-5000-8000-000000000200',t.id,repeat('7',64),receipt);
         end $$;`;
  const legacy = psqlAsync(database, invocation, legacyApp);
  void legacy.result.catch(() => {});
  await waitForSql(
    database,
    `select count(*) from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a on a.pid=l.pid
     where a.application_name='${legacyApp}' and not l.granted;`,
  );
  terminateApplication(database, blockerApp);
  await expectAsyncFailure(blocker, "terminating connection");
  await migration.result;
  await expectAsyncFailure(legacy, "site_content_transition_pointer_update_required");
  psql(
    database,
    mode === "activation"
      ? `do $$ begin
          if not exists (select 1 from public.site_content_releases where id='84000000-0000-5000-8000-000000000100' and state='active')
            or not exists (select 1 from public.site_content_releases where id='84000000-0000-5000-8000-000000000200' and state='candidate')
            or exists (select 1 from public.site_content_release_receipts where release_id='84000000-0000-5000-8000-000000000200')
          then raise exception 'legacy_activation_race_mutated_state'; end if;
        end $$;`
      : `do $$ begin
          if not exists (select 1 from public.site_content_releases where id='84000000-0000-5000-8000-000000000100' and state='superseded')
            or not exists (select 1 from public.site_content_releases where id='84000000-0000-5000-8000-000000000200' and state='active')
            or exists (select 1 from public.site_content_release_receipts where receipt_kind='rollback')
          then raise exception 'legacy_rollback_race_mutated_state'; end if;
        end $$;`,
  );
}

async function runLegacyReconciliationRace(database, authority) {
  const gateLock = 93206991;
  const gateApp = "site-content-recorder-race-gate";
  const migrationApp = "site-content-recorder-race-migration";
  const legacyApp = "site-content-recorder-race-legacy";
  const gate = psqlAsync(
    database,
    `select pg_catalog.pg_advisory_lock(${gateLock}); select pg_catalog.pg_sleep(60);`,
    gateApp,
  );
  void gate.result.catch(() => {});
  await waitForSql(
    database,
    `select count(*) from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a on a.pid=l.pid
     where a.application_name='${gateApp}' and l.locktype='advisory' and l.granted;`,
  );
  const pausedAuthority = authority.replace(
    "lock table public.site_content_reconciliation_plans in access exclusive mode;",
    `lock table public.site_content_reconciliation_plans in access exclusive mode;
     select pg_catalog.pg_advisory_xact_lock(${gateLock});`,
  );
  const migration = psqlAsync(database, pausedAuthority, migrationApp);
  void migration.result.catch(() => {});
  await waitForSql(
    database,
    `select count(*) from pg_catalog.pg_locks table_lock
     join pg_catalog.pg_stat_activity a on a.pid=table_lock.pid
     where a.application_name='${migrationApp}'
       and table_lock.relation='public.site_content_reconciliation_plans'::regclass
       and table_lock.mode='AccessExclusiveLock' and table_lock.granted
       and exists (select 1 from pg_catalog.pg_locks advisory
         where advisory.pid=a.pid and advisory.locktype='advisory' and not advisory.granted);`,
  );
  const legacy = psqlAsync(
    database,
    `select public.record_site_content_reconciliation_plan(
       (select plan from public.site_content_legacy_race_plan),
       '85000000-0000-4000-8000-000000000001'::uuid);`,
    legacyApp,
  );
  void legacy.result.catch(() => {});
  await waitForSql(
    database,
    `select count(*) from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a on a.pid=l.pid
     where a.application_name='${legacyApp}'
       and l.relation='public.site_content_reconciliation_plans'::regclass
       and l.mode='RowExclusiveLock' and not l.granted;`,
  );
  terminateApplication(database, gateApp);
  await expectAsyncFailure(gate, "terminating connection");
  await migration.result;
  await expectAsyncFailure(legacy, "administrator_authorized_at");
  psql(
    database,
    `do $$ begin
      if exists (select 1 from public.site_content_reconciliation_plans)
        or to_regprocedure('public.record_site_content_reconciliation_plan(jsonb,uuid)') is not null
        or to_regprocedure('public.record_site_content_reconciliation_plan(jsonb)') is null
      then raise exception 'legacy_recorder_race_mutated_or_weakened_authority'; end if;
    end $$;`,
  );
}

function cloneDatabase(source, name) {
  psql(
    "template1",
    `alter database ${source} with allow_connections false;
     select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity
       where datname = '${source}' and pid <> pg_catalog.pg_backend_pid();
     create database ${name} template ${source};
     alter database ${name} owner to postgres;
     alter database ${source} with allow_connections true;`,
    { user: databaseCloneRole },
  );
}

function discoverDatabaseCloneRole() {
  const role = docker([
    "exec",
    CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-tAq",
    "-c",
    "select rolname from pg_catalog.pg_roles where rolsuper and rolcanlogin order by rolname limit 1;",
  ]).trim();
  if (!role) throw new Error("Scratch Postgres does not expose a local database-clone role.");
  return role;
}

function storageSchemaOwner(database) {
  return docker([
    "exec",
    CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    database,
    "-tAq",
    "-c",
    "select pg_catalog.pg_get_userbyid(nspowner) from pg_catalog.pg_namespace where nspname = 'storage';",
  ]).trim();
}

async function waitUntilReady() {
  let consecutive = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker(["exec", CONTAINER, "pg_isready", "-U", "postgres", "-q"]);
      consecutive += 1;
      if (consecutive >= 5) return;
    } catch {
      consecutive = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Scratch Postgres did not remain ready after initialization.");
}

export async function main() {
  assertCorrectionMigrationsPresent();
  try {
    docker(["info", "--format", "{{.ServerVersion}}"]);
  } catch {
    throw new Error("Docker is required for check:site-content-control-plane; start Docker and retry.");
  }
  try {
    docker(["image", "inspect", IMAGE]);
  } catch {
    throw new Error(`Required cached image is unavailable: ${IMAGE}. This command never pulls images.`);
  }

  const schema = readFileSync(repoPath("supabase/schema.sql"), "utf8");
  const authority = readFileSync(AUTHORITY_MIGRATION, "utf8");
  const transition = readFileSync(TRANSITION_MIGRATION, "utf8");
  const roles = readFileSync(repoPath("supabase/roles.sql"), "utf8");
  const scaffold = readFileSync(repoPath("scripts/sql/drift-replay-scaffold.sql"), "utf8");
  const invariantFixture = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-control-plane-correction.sql"),
    "utf8",
  );
  const invocationFixture = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-invocation-state-machine.sql"),
    "utf8",
  );
  const authorityFixture = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-reconciliation-authority.sql"),
    "utf8",
  );
  const transitionBackfillSeed = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-transition-backfill-seed.sql"),
    "utf8",
  );
  const transitionBackfillAssert = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-transition-backfill-assert.sql"),
    "utf8",
  );
  const initialAdoptionSeed = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-initial-adoption-seed.sql"),
    "utf8",
  );
  const activateCurrentHead = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-activate-current-head.sql"),
    "utf8",
  );
  const publishNextEpoch = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-publish-next-epoch.sql"),
    "utf8",
  );
  const rollbackCurrentRelease = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-rollback-current-release.sql"),
    "utf8",
  );
  const transitionFailClosed = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-transition-fail-closed.sql"),
    "utf8",
  );
  const legacyTransitionRaceSeed = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-legacy-transition-race-seed.sql"),
    "utf8",
  );
  const legacyReconciliationRaceSeed = readFileSync(
    repoPath("tests/fixtures/site-content/site-content-legacy-reconciliation-race-seed.sql"),
    "utf8",
  );
  const password = randomBytes(16).toString("hex");
  const authorityMarker = "-- Forward-only authority and bounded-claim correction for the site-content control plane.";
  const authorityOffset = schema.indexOf(authorityMarker);
  if (authorityOffset < 0) throw new Error("Canonical schema is missing the site-content correction suffix.");
  const task4Schema = schema.slice(0, authorityOffset);

  removeOwnedContainer();
  try {
    docker([
      "run",
      "-d",
      "--pull=never",
      "--name",
      CONTAINER,
      "--label",
      `${OWNER_LABEL}=${WORKTREE_ID}`,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      IMAGE,
    ]);
    await waitUntilReady();
    databaseCloneRole = discoverDatabaseCloneRole();
    psql("postgres", roles);
    cloneDatabase("postgres", "site_content_platform_base");
    cloneDatabase("site_content_platform_base", "site_content_task4_base");
    psql("site_content_task4_base", scaffold, {
      user: storageSchemaOwner("site_content_task4_base"),
    });
    psql("site_content_task4_base", LOCAL_AUTH_JWT_SCAFFOLD, { user: databaseCloneRole });
    psql("site_content_task4_base", task4Schema);

    cloneDatabase("site_content_task4_base", "site_content_legacy_evidence");
    psql(
      "site_content_legacy_evidence",
      `insert into public.site_content_reconciliation_plans(
        plan_digest,version,trusted_snapshot_digest,trusted_snapshots,dispositions,
        expected_record_count,expected_group_count,batch_size,batch_count,counts,reviewed_by)
       values (repeat('a',64),'site-content-reconciliation-plan-v1',repeat('b',64),'[]'::jsonb,'[]'::jsonb,
        1,1,1,1,'{}'::jsonb,'11111111-1111-4111-8111-111111111111'::uuid);`,
    );
    psql("site_content_legacy_evidence", authority, {
      expectFailure: "site_content_phase_correction_requires_empty_reconciliation_plans",
    });

    cloneDatabase("site_content_task4_base", "site_content_legacy_reconciliation_race");
    psql("site_content_legacy_reconciliation_race", legacyReconciliationRaceSeed);
    await runLegacyReconciliationRace("site_content_legacy_reconciliation_race", authority);

    cloneDatabase("site_content_task4_base", "site_content_authority_evidence");
    psql("site_content_authority_evidence", authority);
    psql(
      "site_content_authority_evidence",
      authorityFixture.replaceAll("__DATABASE__", "site_content_authority_evidence"),
    );
    psql("site_content_authority_evidence", "select pg_catalog.pg_sleep(3.25);");

    cloneDatabase("site_content_authority_evidence", "site_content_initial_seed");
    psql("site_content_initial_seed", initialAdoptionSeed);
    psql(
      "site_content_initial_seed",
      `do $$ begin
        if not exists (select 1 from public.site_content_sync_state
          where not initialized and change_epoch = 2 and served_change_epoch = 0)
        then raise exception 'initial_adoption_multi_state_invalid'; end if;
        if exists (select 1 from public.site_content_release_receipts)
          or not exists (
            select 1 from public.site_content_sync_state s
            join public.site_content_releases r on r.id = s.active_release_id
            where r.id = 'e4a1dd29-14f6-556c-8fb7-f4f947d8b846'::uuid
              and r.state = 'active' and r.release_digest = s.active_release_digest
              and r.release_digest = public.site_content_bootstrap_digest(r.id))
        then raise exception 'initial_adoption_multi_bootstrap_invalid'; end if;
        if (select count(*) from public.site_content_publications) <> 2
          or (select count(*) from public.site_content_public_records) <> 2
          or (select count(*) from public.site_content_sync_events) <> 2
          or (select count(distinct target_change_epoch) from public.site_content_sync_events) <> 2
          or (select min(target_change_epoch) from public.site_content_sync_events) <> 1
          or (select max(target_change_epoch) from public.site_content_sync_events) <> 2
        then raise exception 'initial_adoption_multi_cardinality_invalid'; end if;
        if exists (
          select 1 from public.site_content_public_records h
          left join public.site_content_publications p
            on p.id = h.current_publication_id and p.logical_id = h.logical_id
          left join public.site_content_sync_events e on e.event_sequence = h.pending_event_sequence
          where p.id is null or e.event_sequence is null
            or e.logical_id is distinct from h.logical_id
            or e.target_publication_id is distinct from h.current_publication_id
            or e.target_change_epoch is distinct from h.head_change_epoch
            or (e.target_change_epoch = 2 and (
              e.state not in ('pending','retry_pending','processing','ready')
              or e.superseded_by_event_sequence is not null))
            or (e.target_change_epoch < 2 and (
              e.state <> 'superseded'
              or e.superseded_by_event_sequence is null
              or not exists (
                select 1 from public.site_content_sync_events successor
                where successor.event_sequence = e.superseded_by_event_sequence
                  and successor.target_change_epoch > e.target_change_epoch
                  and successor.target_change_epoch <= 2))))
        then raise exception 'initial_adoption_multi_forward_link_invalid'; end if;
        if exists (
          select 1 from public.site_content_sync_events e
          left join public.site_content_public_records h on h.pending_event_sequence = e.event_sequence
          left join public.site_content_publications p
            on p.id = e.target_publication_id and p.logical_id = e.logical_id
          where h.logical_id is null or p.id is null
            or h.logical_id is distinct from e.logical_id
            or h.current_publication_id is distinct from e.target_publication_id
            or h.head_change_epoch is distinct from e.target_change_epoch)
        then raise exception 'initial_adoption_multi_reverse_link_invalid'; end if;
        if exists (
          select 1 from public.site_content_publications p
          left join public.site_content_public_records h
            on h.current_publication_id = p.id and h.logical_id = p.logical_id
          where h.logical_id is null)
        then raise exception 'initial_adoption_multi_publication_link_invalid'; end if;
        if exists (
          select 1 from public.site_content_publications p
          left join public.site_content_reconciliation_plans rp
            on rp.plan_digest = p.reconciliation_plan_digest
          where rp.plan_digest is null or rp.reviewed_by is null
            or rp.reviewed_at <> rp.administrator_authorized_at
            or rp.administrator_authorization_version <> 'site-content-admin-authorization-v1'
            or not exists (select 1 from auth.users u where u.id = rp.reviewed_by))
        then raise exception 'initial_adoption_multi_authority_invalid'; end if;
      end $$;`,
    );
    cloneDatabase("site_content_initial_seed", "site_content_initial_adoption");
    cloneDatabase("site_content_initial_seed", "site_content_initial_shifted_epoch");
    cloneDatabase("site_content_initial_seed", "site_content_unique_activation_seed");
    psql("site_content_initial_adoption", transition);
    cloneDatabase("site_content_initial_adoption", "site_content_null_activation_receipt");
    psql(
      "site_content_null_activation_receipt",
      activateCurrentHead
        .replaceAll("__RELEASE_ID__", "83000000-0000-5000-8000-000000000050")
        .replaceAll("__GENERATION__", "null-activation-receipt")
        .replaceAll("__RECONCILIATION_DIGEST__", "recorded")
        .replaceAll("__RECOVERY_HEX__", "a")
        .replaceAll(
          "__RECEIPT_MUTATION__",
          `v_receipt := jsonb_set(v_receipt, '{activatedAt}', 'null'::jsonb);
           v_receipt := (v_receipt - 'receiptId') || jsonb_build_object(
             'receiptId','sha256:' || encode(extensions.digest(convert_to(
               'activation-receipt-identity-v1' || E'\\n' ||
               public.site_content_canonical_json(v_receipt - 'receiptId'),
               'UTF8'),'sha256'),'hex'));`,
        )
        .replaceAll("__EXPECT_RESULT__", "false"),
    );
    psql(
      "site_content_initial_adoption",
      `do $$ begin
        if not public.site_content_initial_adoption_closure_valid(2)
          or exists (select 1 from public.site_content_sync_state
            where active_transition_receipt_id is not null or initialized)
        then raise exception 'initial_adoption_backfill_invalid'; end if;
      end $$;`,
    );
    psql(
      "site_content_initial_shifted_epoch",
      `update public.site_content_sync_events set target_change_epoch = 2;
       update public.site_content_public_records set head_change_epoch = 2;
       update public.site_content_sync_state set change_epoch = 2;`,
    );
    psql("site_content_initial_shifted_epoch", transition, {
      expectFailure: "site_content_transition_backfill_unprovable",
    });
    psql(
      "site_content_unique_activation_seed",
      activateCurrentHead
        .replaceAll("__RELEASE_ID__", "83000000-0000-5000-8000-000000000100")
        .replaceAll("__GENERATION__", "initial-r1")
        .replaceAll("__RECONCILIATION_DIGEST__", "recorded")
        .replaceAll("__RECOVERY_HEX__", "b")
        .replaceAll("__RECEIPT_MUTATION__", "")
        .replaceAll("__EXPECT_RESULT__", "true"),
    );
    cloneDatabase("site_content_unique_activation_seed", "site_content_unique_activation");
    cloneDatabase("site_content_unique_activation_seed", "site_content_corrupt_active_digest");
    cloneDatabase("site_content_unique_activation_seed", "site_content_null_receipt_digest");
    cloneDatabase("site_content_unique_activation_seed", "site_content_orphan_rollback");
    cloneDatabase("site_content_unique_activation_seed", "site_content_extra_active_release");
    psql("site_content_unique_activation", transition);
    psql(
      "site_content_unique_activation",
      `do $$ declare s public.site_content_sync_state%rowtype; begin
        select * into strict s from public.site_content_sync_state where singleton;
        if public.site_content_current_transition_kind(
          s.active_transition_receipt_id,s.active_release_id,s.active_release_digest,
          s.initialized,s.served_change_epoch) <> 'activation'
        then raise exception 'unique_activation_backfill_invalid'; end if;
      end $$;`,
    );
    psql(
      "site_content_extra_active_release",
      `update public.site_content_releases
       set state = 'active'
       where id = 'e4a1dd29-14f6-556c-8fb7-f4f947d8b846'::uuid;`,
    );
    psql("site_content_extra_active_release", transition, {
      expectFailure: "site_content_transition_backfill_unprovable",
    });
    cloneDatabase("site_content_unique_activation", "site_content_nonzero_rollback_seed");
    psql("site_content_nonzero_rollback_seed", publishNextEpoch.replaceAll("__TITLE_SUFFIX__", "epoch-two"));
    psql(
      "site_content_nonzero_rollback_seed",
      activateCurrentHead
        .replaceAll("__RELEASE_ID__", "83000000-0000-5000-8000-000000000200")
        .replaceAll("__GENERATION__", "current-r2")
        .replaceAll("__RECONCILIATION_DIGEST__", "")
        .replaceAll("__RECOVERY_HEX__", "c")
        .replaceAll("__RECEIPT_MUTATION__", "")
        .replaceAll("__EXPECT_RESULT__", "true"),
    );
    cloneDatabase("site_content_nonzero_rollback_seed", "site_content_nonzero_rollback");
    cloneDatabase("site_content_nonzero_rollback_seed", "site_content_rollback_candidate_reject");
    cloneDatabase("site_content_nonzero_rollback_seed", "site_content_rollback_live_reject");
    cloneDatabase("site_content_nonzero_rollback_seed", "site_content_rollback_head_reject");
    cloneDatabase("site_content_nonzero_rollback_seed", "site_content_null_rollback_receipt");
    psql(
      "site_content_null_rollback_receipt",
      rollbackCurrentRelease
        .replaceAll("__ACTIVE_RELEASE_ID__", "83000000-0000-5000-8000-000000000200")
        .replaceAll("__TARGET_RELEASE_ID__", "83000000-0000-5000-8000-000000000100")
        .replaceAll(
          "__RECEIPT_MUTATION__",
          `v_receipt := jsonb_set(v_receipt, '{rolledBackAt}', 'null'::jsonb);
           v_receipt := (v_receipt - 'receiptId') || jsonb_build_object(
             'receiptId','sha256:' || encode(extensions.digest(convert_to(
               'rollback-receipt-identity-v1' || E'\\n' ||
               public.site_content_canonical_json(v_receipt - 'receiptId'),
               'UTF8'),'sha256'),'hex'));`,
        )
        .replaceAll("__EXPECT_RESULT__", "false"),
    );
    psql(
      "site_content_rollback_candidate_reject",
      `insert into public.site_content_releases(
        id,state,target_change_epoch,previous_release_id,registry_version,static_manifest_digest,
        dynamic_state_digest,release_digest,generation_id,plan_digest,reconciliation_plan_digest,
        expected_added_count,expected_changed_count,expected_unchanged_count,expected_record_count,
        expected_tombstone_count,must_pass_checks)
       values ('83000000-0000-5000-8000-000000000299','candidate',3,
        '83000000-0000-5000-8000-000000000200','candidate-blocker',repeat('1',64),
        repeat('2',64),repeat('3',64),'candidate-blocker',repeat('4',64),null,0,0,0,0,0,false);`,
    );
    psql(
      "site_content_rollback_candidate_reject",
      rollbackCurrentRelease
        .replaceAll("__ACTIVE_RELEASE_ID__", "83000000-0000-5000-8000-000000000200")
        .replaceAll("__TARGET_RELEASE_ID__", "83000000-0000-5000-8000-000000000100")
        .replaceAll("__RECEIPT_MUTATION__", "")
        .replaceAll("__EXPECT_RESULT__", "false"),
    );
    psql(
      "site_content_rollback_live_reject",
      `insert into public.site_content_sync_events(logical_id,target_publication_id,target_change_epoch,state)
       select h.logical_id,h.current_publication_id,3,'pending'
       from public.site_content_public_records h limit 1;`,
    );
    psql(
      "site_content_rollback_live_reject",
      rollbackCurrentRelease
        .replaceAll("__ACTIVE_RELEASE_ID__", "83000000-0000-5000-8000-000000000200")
        .replaceAll("__TARGET_RELEASE_ID__", "83000000-0000-5000-8000-000000000100")
        .replaceAll("__RECEIPT_MUTATION__", "")
        .replaceAll("__EXPECT_RESULT__", "false"),
    );
    psql(
      "site_content_rollback_head_reject",
      `update public.site_content_public_records
       set head_change_epoch = (
         select served_change_epoch + 1 from public.site_content_sync_state where singleton
       ), pending_event_sequence = null
       where logical_id = (
         select logical_id from public.site_content_public_records order by logical_id limit 1
       );`,
    );
    psql(
      "site_content_rollback_head_reject",
      rollbackCurrentRelease
        .replaceAll("__ACTIVE_RELEASE_ID__", "83000000-0000-5000-8000-000000000200")
        .replaceAll("__TARGET_RELEASE_ID__", "83000000-0000-5000-8000-000000000100")
        .replaceAll("__RECEIPT_MUTATION__", "")
        .replaceAll("__EXPECT_RESULT__", "false"),
    );
    psql(
      "site_content_nonzero_rollback",
      rollbackCurrentRelease
        .replaceAll("__ACTIVE_RELEASE_ID__", "83000000-0000-5000-8000-000000000200")
        .replaceAll("__TARGET_RELEASE_ID__", "83000000-0000-5000-8000-000000000100")
        .replaceAll("__RECEIPT_MUTATION__", "")
        .replaceAll("__EXPECT_RESULT__", "true"),
    );
    psql(
      "site_content_nonzero_rollback",
      rollbackCurrentRelease
        .replaceAll("__ACTIVE_RELEASE_ID__", "83000000-0000-5000-8000-000000000200")
        .replaceAll("__TARGET_RELEASE_ID__", "83000000-0000-5000-8000-000000000100")
        .replaceAll("__RECEIPT_MUTATION__", "")
        .replaceAll("__EXPECT_RESULT__", "false"),
    );
    psql("site_content_nonzero_rollback", publishNextEpoch.replaceAll("__TITLE_SUFFIX__", "epoch-three"));
    cloneDatabase("site_content_nonzero_rollback", "site_content_r3_valid");
    cloneDatabase("site_content_nonzero_rollback", "site_content_r3_corrupt_predecessor");
    psql(
      "site_content_r3_corrupt_predecessor",
      `update public.site_content_sync_state
       set active_transition_receipt_id = (
         select receipt_id from public.site_content_release_receipts
         where release_id = '83000000-0000-5000-8000-000000000100' and receipt_kind = 'activation'
         order by created_at limit 1)
       where singleton;`,
    );
    psql(
      "site_content_r3_corrupt_predecessor",
      activateCurrentHead
        .replaceAll("__RELEASE_ID__", "83000000-0000-5000-8000-000000000300")
        .replaceAll("__GENERATION__", "current-r3-corrupt")
        .replaceAll("__RECONCILIATION_DIGEST__", "")
        .replaceAll("__RECOVERY_HEX__", "e")
        .replaceAll("__RECEIPT_MUTATION__", "")
        .replaceAll("__EXPECT_RESULT__", "false"),
    );
    psql(
      "site_content_r3_valid",
      activateCurrentHead
        .replaceAll("__RELEASE_ID__", "83000000-0000-5000-8000-000000000300")
        .replaceAll("__GENERATION__", "current-r3")
        .replaceAll("__RECONCILIATION_DIGEST__", "")
        .replaceAll("__RECOVERY_HEX__", "e")
        .replaceAll("__RECEIPT_MUTATION__", "")
        .replaceAll("__EXPECT_RESULT__", "true"),
    );
    psql(
      "site_content_r3_valid",
      `do $$ declare s public.site_content_sync_state%rowtype; begin
        select * into strict s from public.site_content_sync_state where singleton;
        if s.active_release_id <> '83000000-0000-5000-8000-000000000300'
          or s.change_epoch <> s.served_change_epoch
          or s.change_epoch is distinct from (
            select target_change_epoch from public.site_content_releases
            where id = '83000000-0000-5000-8000-000000000300')
          or public.site_content_current_transition_kind(
            s.active_transition_receipt_id,s.active_release_id,s.active_release_digest,
            s.initialized,s.served_change_epoch) <> 'activation'
        then raise exception 'r3_activation_after_rollback_invalid'; end if;
      end $$;`,
    );
    cloneDatabase("site_content_r3_valid", "site_content_pointer_corrupt");
    cloneDatabase("site_content_r3_valid", "site_content_pointer_epoch_mismatch");
    cloneDatabase("site_content_r3_valid", "site_content_pointer_missing");
    psql(
      "site_content_pointer_corrupt",
      `update public.site_content_sync_state
       set active_transition_receipt_id = (
         select receipt_id from public.site_content_release_receipts
         where release_id = '83000000-0000-5000-8000-000000000100' and receipt_kind = 'activation'
         order by created_at limit 1)
       where singleton;`,
    );
    psql("site_content_pointer_corrupt", transitionFailClosed);
    psql(
      "site_content_pointer_epoch_mismatch",
      `update public.site_content_sync_state
       set served_change_epoch = (
           select target_change_epoch from public.site_content_releases
           where id = '83000000-0000-5000-8000-000000000200'
         ),
         active_transition_receipt_id = (
           select receipt_id from public.site_content_release_receipts
           where release_id = '83000000-0000-5000-8000-000000000200' and receipt_kind = 'activation'
           order by created_at limit 1)
       where singleton;`,
    );
    psql("site_content_pointer_epoch_mismatch", transitionFailClosed);
    psql(
      "site_content_pointer_missing",
      `alter table public.site_content_sync_state
         drop constraint site_content_sync_state_transition_pointer_check;
       update public.site_content_sync_state set active_transition_receipt_id = null where singleton;`,
    );
    psql("site_content_pointer_missing", transitionFailClosed);
    psql(
      "site_content_corrupt_active_digest",
      `update public.site_content_sync_state set active_release_digest = repeat('f',64) where singleton;`,
    );
    psql("site_content_corrupt_active_digest", transition, {
      expectFailure: "site_content_transition_backfill_unprovable",
    });
    psql(
      "site_content_null_receipt_digest",
      `do $$ declare f jsonb; r jsonb; rid text; active_id uuid; begin
        select active_release_id into strict active_id from public.site_content_sync_state where singleton;
        f := jsonb_build_object(
          'version','activation-receipt-v1','promotionId','site-release:null-digest',
          'projectRef','control-plane-corruption','operation','site_release',
          'recoveryReadinessDigest',repeat('c',64),
          'activatedAt','2026-08-30T00:00:00.000Z',
          'resource',jsonb_build_object(
            'kind','site_release','siteReleaseId',active_id::text,'siteReleaseDigest',null,
            'previousSiteReleaseId','e4a1dd29-14f6-556c-8fb7-f4f947d8b846',
            'previousSiteReleaseDigest',repeat('0',64)));
        rid := 'sha256:' || encode(extensions.digest(convert_to(
          'activation-receipt-identity-v1' || E'\\n' || public.site_content_canonical_json(f),
          'UTF8'),'sha256'),'hex');
        r := f || jsonb_build_object('receiptId',rid);
        insert into public.site_content_release_receipts values(rid,active_id,'activation',repeat('c',64),r,clock_timestamp());
      end $$;`,
    );
    psql("site_content_null_receipt_digest", transition, {
      expectFailure: "site_content_transition_backfill_unprovable",
    });
    psql(
      "site_content_orphan_rollback",
      `do $$ declare f jsonb; r jsonb; rid text; active_id uuid; active_digest text; begin
        select active_release_id,active_release_digest into strict active_id,active_digest
        from public.site_content_sync_state where singleton;
        f := jsonb_build_object(
          'version','rollback-receipt-v1','activationReceiptId','sha256:' || repeat('d',64),
          'promotionId','site-release:orphan','projectRef','control-plane-corruption',
          'operation','site_release','rolledBackAt','2026-08-30T00:00:00.000Z',
          'method','retained_previous','requiresReconstruction',false,'outcome','succeeded',
          'target',jsonb_build_object('kind','site_release','siteReleaseId',active_id::text,
            'siteReleaseDigest',active_digest));
        rid := 'sha256:' || encode(extensions.digest(convert_to(
          'rollback-receipt-identity-v1' || E'\\n' || public.site_content_canonical_json(f),
          'UTF8'),'sha256'),'hex');
        r := f || jsonb_build_object('receiptId',rid);
        insert into public.site_content_release_receipts values(rid,active_id,'rollback',repeat('e',64),r,clock_timestamp());
      end $$;`,
    );
    psql("site_content_orphan_rollback", transition, {
      expectFailure: "site_content_transition_backfill_unprovable",
    });

    cloneDatabase("site_content_task4_base", "site_content_legacy_activation_race");
    cloneDatabase("site_content_task4_base", "site_content_legacy_rollback_race");
    psql("site_content_legacy_activation_race", authority);
    psql("site_content_legacy_rollback_race", authority);
    psql("site_content_legacy_activation_race", legacyTransitionRaceSeed.replaceAll("__RACE_MODE__", "activation"));
    psql("site_content_legacy_rollback_race", legacyTransitionRaceSeed.replaceAll("__RACE_MODE__", "rollback"));
    await runLegacyTransitionRace("site_content_legacy_activation_race", "activation", transition);
    await runLegacyTransitionRace("site_content_legacy_rollback_race", "rollback", transition);

    cloneDatabase("site_content_task4_base", "site_content_transition_seed");
    psql("site_content_transition_seed", authority);
    psql("site_content_transition_seed", transitionBackfillSeed);
    cloneDatabase("site_content_transition_seed", "site_content_transition_backfill");
    cloneDatabase("site_content_transition_seed", "site_content_transition_ambiguous");
    cloneDatabase("site_content_transition_seed", "site_content_transition_guard_invalid");
    cloneDatabase("site_content_transition_seed", "site_content_transition_source_state_invalid");
    psql("site_content_transition_backfill", transition);
    psql("site_content_transition_backfill", transitionBackfillAssert);
    psql(
      "site_content_transition_ambiguous",
      `update public.site_content_releases set target_change_epoch = 2
       where id = '82000000-0000-5000-8000-000000000001'::uuid;`,
    );
    psql("site_content_transition_ambiguous", transition, {
      expectFailure: "site_content_transition_backfill_unprovable",
    });
    psql(
      "site_content_transition_guard_invalid",
      `set session_replication_role = replica;
       update public.site_content_release_receipts
       set recovery_readiness_digest = repeat('f',64)
       where release_id = '82000000-0000-5000-8000-000000000002'::uuid
         and receipt_kind = 'activation';
       set session_replication_role = origin;`,
    );
    psql("site_content_transition_guard_invalid", transition, {
      expectFailure: "site_content_transition_backfill_unprovable",
    });
    psql(
      "site_content_transition_source_state_invalid",
      `update public.site_content_releases set state = 'superseded'
       where id = '82000000-0000-5000-8000-000000000002'::uuid;`,
    );
    psql("site_content_transition_source_state_invalid", transition, {
      expectFailure: "site_content_transition_backfill_unprovable",
    });
    cloneDatabase("site_content_transition_seed", "site_content_transition_watermark_corrupt");
    psql(
      "site_content_transition_watermark_corrupt",
      `update public.site_content_sync_state set served_change_epoch = 1 where singleton;`,
    );
    psql("site_content_transition_watermark_corrupt", transition, {
      expectFailure: "site_content_transition_backfill_unprovable",
    });

    cloneDatabase("site_content_task4_base", "site_content_upgrade_clean");
    psql("site_content_upgrade_clean", authority);
    psql("site_content_upgrade_clean", transition);
    psql("site_content_upgrade_clean", invariantFixture);

    cloneDatabase("site_content_platform_base", "site_content_final_schema");
    psql("site_content_final_schema", scaffold, {
      user: storageSchemaOwner("site_content_final_schema"),
    });
    psql("site_content_final_schema", LOCAL_AUTH_JWT_SCAFFOLD, { user: databaseCloneRole });
    psql("site_content_final_schema", schema);
    psql("site_content_final_schema", invocationFixture.replaceAll("-d postgres", "-d site_content_final_schema"));
    psql("site_content_final_schema", invariantFixture);
    console.log("PASS site-content control-plane PostgreSQL matrix");
  } finally {
    removeOwnedContainer();
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
