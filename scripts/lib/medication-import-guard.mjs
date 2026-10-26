/**
 * medication-import-guard — stops `npm run medications:import` silently undoing corrections made
 * in this repository.
 *
 * The import rewrites `data/medications-snapshot.json` wholesale from the BigSimmo/Medications
 * export. The 20 Oct 2026 clinical content audit corrected 629 medicine facts here (#3692),
 * including six urgent ones (the phenytoin albumin factor, the methadone first dose, the
 * tranylcypromine maximum and others). Until the same corrections reach the Medications repo, an
 * ordinary import would put every one of them back. `tests/medication-content-audit-corrections.test.ts`
 * catches the urgent six, but nothing caught the rest.
 *
 * So the import now compares what it would write with what is already here. New medicines are
 * fine. Any medicine that would change or disappear stops the import, names the medicines and
 * the fields, and needs an explicit `--accept-changes` naming them (or `all`) after a person has
 * checked each one.
 */

/**
 * @typedef {{ slug: string, [key: string]: unknown }} MedicationRecord
 * @typedef {{ slug: string, fields: string[] }} ChangedMedication
 */

function stable(value) {
  return JSON.stringify(value);
}

/**
 * @param {MedicationRecord[]} current  what `data/medications-snapshot.json` holds now
 * @param {MedicationRecord[]} incoming what the import would write
 * @returns {{ added: string[], removed: string[], changed: ChangedMedication[] }}
 */
export function diffMedicationSnapshots(current, incoming) {
  const before = new Map((current ?? []).map((record) => [record.slug, record]));
  const after = new Map((incoming ?? []).map((record) => [record.slug, record]));
  const added = [...after.keys()].filter((slug) => !before.has(slug)).sort();
  const removed = [...before.keys()].filter((slug) => !after.has(slug)).sort();
  const changed = [];
  for (const [slug, next] of after) {
    const prior = before.get(slug);
    if (!prior) continue;
    const keys = [...new Set([...Object.keys(prior), ...Object.keys(next)])].sort();
    const fields = keys.filter((key) => stable(prior[key]) !== stable(next[key]));
    if (fields.length > 0) changed.push({ slug, fields });
  }
  changed.sort((left, right) => left.slug.localeCompare(right.slug));
  return { added, removed, changed };
}

/**
 * Reads `--accept-changes=all` or `--accept-changes=slug-a,slug-b` from the argument list.
 *
 * @param {string[]} argv
 * @returns {{ all: boolean, slugs: Set<string> }}
 */
export function parseAcceptedChanges(argv) {
  const values = (argv ?? [])
    .filter((token) => token.startsWith("--accept-changes="))
    .flatMap((token) => token.slice("--accept-changes=".length).split(","))
    .map((slug) => slug.trim().toLowerCase())
    .filter(Boolean);
  return { all: values.includes("all"), slugs: new Set(values.filter((slug) => slug !== "all")) };
}

/**
 * Decides whether the import may write. Changed or removed medicines must each be accepted.
 *
 * @param {{ added: string[], removed: string[], changed: ChangedMedication[] }} diff
 * @param {{ all: boolean, slugs: Set<string> }} accepted
 * @returns {{ ok: boolean, unaccepted: string[], message: string }}
 */
export function judgeMedicationImport(diff, accepted) {
  const touched = [...diff.changed.map((entry) => entry.slug), ...diff.removed];
  const unaccepted = accepted.all ? [] : touched.filter((slug) => !accepted.slugs.has(slug));
  if (unaccepted.length === 0) {
    return {
      ok: true,
      unaccepted,
      message: `${diff.added.length} new, ${diff.changed.length} changed, ${diff.removed.length} removed; every change accepted.`,
    };
  }
  const lines = [
    `The import would change or remove ${unaccepted.length} medicine(s) already in PsychSift without acceptance.`,
    "Corrections made here (for example the 20 Oct 2026 content audit, #3692) would be lost.",
    "Carry them into BigSimmo/Medications first, check each medicine below, then re-run with",
    "--accept-changes=<slug,slug> or --accept-changes=all. Nothing was written.",
    "",
    ...diff.changed
      .filter((entry) => unaccepted.includes(entry.slug))
      .map((entry) => `  changed  ${entry.slug}: ${entry.fields.join(", ")}`),
    ...diff.removed.filter((slug) => unaccepted.includes(slug)).map((slug) => `  removed  ${slug}`),
  ];
  return { ok: false, unaccepted, message: lines.join("\n") };
}

/**
 * True when a git remote URL names the BigSimmo/Medications repository. An export saved inside some
 * other checkout (this repository included) must not have that checkout's HEAD recorded as the
 * Medications commit, so the import only reads HEAD after this check passes.
 *
 * @param {string | null | undefined} remoteUrl
 */
export function isMedicationsRemote(remoteUrl) {
  return typeof remoteUrl === "string" && /[/:]bigsimmo\/medications(?:\.git)?\/?$/i.test(remoteUrl.trim());
}

/**
 * The record written beside `data/medications-snapshot.json` (audit 2026-10-24 E2E-09).
 *
 * The snapshot is a bare array, so nothing said which Medications version or export it came
 * from. The import now writes this sidecar: where the records came from, the upstream commit
 * when the Medications checkout can report one, when that source was exported or last changed,
 * when it was imported, how many medicines, and a hash of the exact file written, so a later
 * reader can tell whether the snapshot was edited by hand since.
 *
 * @param {{ sourceKind: "canonical-snapshot" | "export-zip", sourceName: string, upstreamCommit: string | null,
 *   sourceModifiedAt: string | null, importedAt: string, recordCount: number, snapshotSha256: string }} input
 */
export function buildMedicationSnapshotProvenance(input) {
  const commit = typeof input.upstreamCommit === "string" ? input.upstreamCommit.trim().toLowerCase() : "";
  return {
    schemaVersion: 1,
    upstreamRepository: "BigSimmo/Medications",
    sourceKind: input.sourceKind,
    sourceName: input.sourceName,
    // Only a full or short hex commit is recorded; anything else is "not known", never a guess.
    upstreamCommit: /^[0-9a-f]{7,40}$/.test(commit) ? commit : null,
    sourceModifiedAt: input.sourceModifiedAt,
    importedAt: input.importedAt,
    recordCount: input.recordCount,
    snapshotSha256: input.snapshotSha256,
  };
}
