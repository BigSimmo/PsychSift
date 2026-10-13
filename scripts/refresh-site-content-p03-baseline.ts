import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadDifferentialSnapshot } from "../src/lib/differential-fixtures";
import { diagnosisToRow, presentationToRow, type DifferentialRecordRow } from "../src/lib/differential-records";
import { formRecords } from "../src/lib/forms";
import { loadMedicationSnapshot } from "../src/lib/medication-snapshot";
import { recordToRow as medicationToRow, type MedicationRecordRow } from "../src/lib/medication-records";
import { recordToRow as registryToRow, type RegistryRecordRow } from "../src/lib/registry-records";
import { serviceRecords } from "../src/lib/services";
import { siteContentValueHash } from "../src/lib/site-content/site-content-manifest";
import { canonicalDynamicSiteContentProjection } from "../src/lib/site-content/site-content-publication";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

/**
 * site-content:p03 — offline helpers for the frozen P03 seed blobs.
 *
 * `supabase/migrations/20260824122000_add_site_content_release_and_outbox.sql` and
 * `supabase/schema.sql` each embed the whole site-content seed population as dollar-quoted
 * JSON: `$site_content_registry_baselines$` and `$site_content_bootstrap_records$`.
 *
 * The derivations below mirror `scripts/sync-site-content-corpus.ts` so digests and seed
 * identities can be checked offline. `tests/site-content-p03-baseline.test.ts` pins those
 * formulas; `tests/site-content-epoch-zero-freeze.test.ts` pins the frozen bytes themselves.
 *
 * WRITING IS REFUSED. Editing `20260824122000` (already applied 2026-09-11) changes only what
 * the repository claims live contains. That is the PR #2814 incident. Catalogue content reaches
 * live through the publication pipeline or a NEW forward migration — see
 * `docs/site-content-sync-runbook.md` and `npm run bootstrap:refresh`.
 *
 * Flags:
 *   --check   report how far the catalogue has moved from the freeze; never rewrite
 */

const repoUrl = (relative: string) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

const MIGRATION = "supabase/migrations/20260824122000_add_site_content_release_and_outbox.sql";
const SCHEMA = "supabase/schema.sql";
/**
 * The owner the epoch-zero seed was frozen under. It is a fixture identity, not a real
 * account, and it is load-bearing: it feeds the audit columns every projection hashes.
 */
const SEED_OWNER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SEED_AUDIT = {
  id: SEED_OWNER_ID,
  owner_id: SEED_OWNER_ID,
  created_at: "2026-08-24T00:00:00.000Z",
  updated_at: "2026-08-24T00:00:00.000Z",
  last_reviewed_at: null,
  review_due_at: null,
} as const;

/** Mirrors `deterministicUuid` in scripts/sync-site-content-corpus.ts. */
export function deterministicUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

type Projection = ReturnType<typeof canonicalDynamicSiteContentProjection>;

/** Mirrors `sourceRecord` in scripts/sync-site-content-corpus.ts, plus the seed columns. */
export function bootstrapEntry(projection: Projection) {
  const record = projection.record;
  return {
    logicalId: record.logicalId,
    logicalDocumentId: deterministicUuid(`site-content-document:${record.logicalId}`),
    logicalChunkId: deterministicUuid(`site-content-chunk:${record.logicalId}`),
    normalizedText: record.body,
    contentHash: record.contentHash,
    publicationFingerprint: record.publicationVersion,
    governanceFingerprint: siteContentValueHash({
      access: record.access,
      validationStatus: record.validationStatus,
      sourceStatus: record.sourceStatus,
    }),
    lineageFingerprint: siteContentValueHash(record.sourceLineage),
    publicMetadataFingerprint: siteContentValueHash({
      route: record.route,
      title: record.title,
      sourceRole: record.sourceRole,
    }),
    record,
    renderPayload: projection.renderPayload,
  };
}

export function registryBaselines() {
  return Object.fromEntries([
    ...serviceRecords.map((record) => [`service:${record.slug}`, record] as const),
    ...formRecords.map((record) => [`form:${record.slug}`, record] as const),
  ]);
}

export function bootstrapRecords() {
  const snapshot = loadDifferentialSnapshot();
  return [
    ...serviceRecords.map((record) =>
      canonicalDynamicSiteContentProjection("service", {
        ...registryToRow(record, SEED_OWNER_ID, "service"),
        ...SEED_AUDIT,
      } as RegistryRecordRow),
    ),
    ...formRecords.map((record) =>
      canonicalDynamicSiteContentProjection("form", {
        ...registryToRow(record, SEED_OWNER_ID, "form"),
        ...SEED_AUDIT,
      } as RegistryRecordRow),
    ),
    ...loadMedicationSnapshot().map((record) =>
      canonicalDynamicSiteContentProjection("medication", {
        ...medicationToRow(record, SEED_OWNER_ID),
        ...SEED_AUDIT,
      } as MedicationRecordRow),
    ),
    ...snapshot.diagnoses.map((record) =>
      canonicalDynamicSiteContentProjection("differential", {
        ...diagnosisToRow(record, SEED_OWNER_ID, snapshot),
        ...SEED_AUDIT,
      } as DifferentialRecordRow),
    ),
    ...snapshot.presentations.map((record) =>
      canonicalDynamicSiteContentProjection("presentation", {
        ...presentationToRow(record, SEED_OWNER_ID, snapshot),
        ...SEED_AUDIT,
      } as DifferentialRecordRow),
    ),
  ]
    .map(bootstrapEntry)
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
}

/**
 * `public.site_content_canonical_json` in JavaScript.
 *
 * The seed insert is followed by a guard that recomputes
 * `site_content_bootstrap_digest` over what actually landed in
 * `site_content_release_records` and aborts the replay on a mismatch. The digest is a
 * sha256 over this canonical rendering of `{logicalId, record, renderPayload}` for all 843
 * rows, ordered by `logical_id` under the C collation — so refreshing the blob without
 * refreshing the digest leaves a `schema.sql` that cannot be replayed at all.
 *
 * The SQL rules, mirrored exactly: null renders as `null`; an object renders its entries
 * sorted by key under C collation, which is byte order; an array keeps its order; a scalar
 * renders as jsonb's own text. `tests/site-content-p03-baseline.test.ts` pins this against
 * two digests taken from real container replays, on two different datasets, so a
 * divergence here fails offline rather than in a replay nobody runs.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      // Byte order, not locale order: `collate "C"` compares the UTF-8 encoding.
      .sort(([left], [right]) => (Buffer.from(left, "utf8") < Buffer.from(right, "utf8") ? -1 : 1));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** `public.site_content_bootstrap_digest` for a generated bootstrap population. */
export function bootstrapDigest(entries: ReturnType<typeof bootstrapRecords>) {
  const records = [...entries]
    .sort((left, right) => (Buffer.from(left.logicalId, "utf8") < Buffer.from(right.logicalId, "utf8") ? -1 : 1))
    .map((entry) => ({
      logicalId: entry.logicalId,
      record: entry.record,
      renderPayload: entry.renderPayload,
    }));
  const canonical = canonicalJson({ version: "site-content-bootstrap-public-release-v1", records });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Reports whether the seeded bootstrap release still describes the blob.
 *
 * Any change to the seeded population moves the digest, and the release's own UUID is
 * derived from it: `site_content_retained_bootstrap_valid` asserts
 * `r.id = site_content_release_id(r.release_digest, 0, 'bootstrap-v1')`. So the digest and
 * the identity always move together, across both SQL files, the drift manifest, the health
 * module, the control-plane check and the pinned tests. Rewriting only one of the two trades
 * one broken invariant for another. This is the same operation PR #2814 performed by hand when the
 * services handover moved the population from 843 records to 860 — a path this script now refuses.
 *
 * It changes a REPLAY only — a preview branch, CI's migration replay, a fresh database.
 * `20260824122000` is already applied to production, so editing it does not re-run there and
 * does not move the live active release. Publishing this content into the live canonical
 * population is a separate, deliberate operation.
 */
export function bootstrapReleaseState(sql: string, digest: string, count: number) {
  const begin = sql.indexOf("-- BEGIN GENERATED SITE CONTENT BOOTSTRAP RELEASE");
  const end = sql.indexOf("-- END GENERATED SITE CONTENT BOOTSTRAP RELEASE");
  if (begin < 0 || end < 0 || end < begin) throw new Error("Could not find the generated bootstrap-release block.");
  const block = sql.slice(begin, end);
  const pinnedDigest = block.match(
    /site_content_bootstrap_digest\('[0-9a-f-]+'\) is distinct from '([0-9a-f]{64})'/,
  )?.[1];
  const pinnedCount = block.match(/site_content_release_records where release_id = '[0-9a-f-]+'\) <> (\d+)/)?.[1];
  if (!pinnedDigest || !pinnedCount) throw new Error("Could not read the bootstrap population guard.");
  return {
    pinnedDigest,
    computedDigest: digest,
    pinnedCount: Number(pinnedCount),
    computedCount: count,
    matches: pinnedDigest === digest && Number(pinnedCount) === count,
  };
}

function blockPattern(tag: string) {
  return new RegExp(`(\\$${tag}\\$)[\\s\\S]*?(\\$${tag}\\$)`);
}

export function replaceBlock(sql: string, tag: string, body: string) {
  const pattern = blockPattern(tag);
  const matches = sql.match(new RegExp(`\\$${tag}\\$`, "g")) ?? [];
  if (matches.length !== 2) {
    throw new Error(`Expected exactly one $${tag}$ block, found ${matches.length / 2}.`);
  }
  // A blob carrying its own delimiter would terminate the quote early and turn the rest of
  // the seed into SQL. It has never happened; it must never happen silently.
  if (body.includes(`$${tag}$`)) throw new Error(`Refreshed ${tag} blob contains its own delimiter.`);
  if (/[\r\n]/.test(body)) throw new Error(`Refreshed ${tag} blob must be a single line.`);
  return sql.replace(pattern, (_match, open: string, close: string) => `${open}${body}${close}`);
}

/**
 * `--write` / bare invocation rewrites migrations the live database has already applied.
 * That is the PR #2814 defect path; refuse both spellings. See
 * `tests/site-content-epoch-zero-freeze.test.ts` and `scripts/refresh-site-content-bootstrap.ts`.
 */
const WRITE_REFUSAL = [
  "Refusing to rewrite an applied migration.",
  "",
  "supabase/migrations/20260824122000 was applied to the live database on 2026-09-11. Editing it",
  "changes only what the repository claims live contains, and check:drift goes red on the release",
  "constraints. That happened on 2026-09-16 (PR #2814) and had to be reverted.",
  "",
  "Curated catalogue content reaches live through the publication pipeline in",
  "docs/site-content-sync-runbook.md. A SQL lookup that must serve newer records is refreshed by a",
  "NEW forward migration. The freeze bytes are pinned by tests/site-content-epoch-zero-freeze.test.ts.",
  "",
  "npm run site-content:p03 -- --check still reports how far the catalogue has moved from the freeze.",
].join("\n");

function main() {
  // npm run site-content:p03 --write swallows --write into npm_config_write; both spellings refuse.
  if (!process.argv.includes("--check") || process.env.npm_config_write) {
    throw new Error(WRITE_REFUSAL);
  }

  const frozenSql = readFileSync(repoUrl(MIGRATION), "utf8");
  const frozenMatch = frozenSql.match(/\$site_content_bootstrap_records\$([\s\S]*?)\$site_content_bootstrap_records\$/);
  if (!frozenMatch) throw new Error("Could not read the frozen bootstrap records blob.");
  const frozenEntries = JSON.parse(frozenMatch[1]!) as ReturnType<typeof bootstrapRecords>;
  const frozenDigest = bootstrapDigest(frozenEntries);
  const frozenIdentity = bootstrapReleaseState(
    readFileSync(repoUrl(SCHEMA), "utf8"),
    frozenDigest,
    frozenEntries.length,
  );
  if (!frozenIdentity.matches) {
    throw new Error(
      "The seeded bootstrap release identity no longer describes the committed freeze blob. " +
        "Restore the migration; do not regenerate it from the catalogue.",
    );
  }

  const entries = bootstrapRecords();
  const digest = bootstrapDigest(entries);
  console.log(`frozen records      : ${frozenEntries.length}`);
  console.log(`catalogue records   : ${entries.length}`);
  console.log(`frozen digest       : ${frozenDigest}`);
  console.log(`catalogue digest    : ${digest}`);
  if (entries.length === frozenEntries.length && digest === frozenDigest) {
    console.log("Nothing to report: the frozen bootstrap already matches the catalogue.");
    return;
  }
  console.log("\nCheck only. The freeze above is what the live database holds and must not be");
  console.log("rewritten to match the catalogue. Publish curated content through the pipeline in");
  console.log("docs/site-content-sync-runbook.md instead.");
}

/** `public.site_content_release_id(digest, 0, 'bootstrap-v1')`, computed offline. */
export function bootstrapReleaseUuid(digest: string) {
  const hash = createHash("sha256")
    .update(
      canonicalJson({
        version: "site-content-release-instance-v1",
        releaseDigest: digest,
        targetChangeEpoch: "0",
        generationId: "bootstrap-v1",
      }),
      "utf8",
    )
    .digest("hex");
  // Pins the UUID version nibble to 5 and the RFC 4122 variant nibble to 8, exactly as the
  // SQL does. Verified against PR #2814's committed pair before this function was trusted.
  const value = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

if (isDirectEntrypoint(import.meta.url)) main();
