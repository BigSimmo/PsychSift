#!/usr/bin/env node
/**
 * build-forms-pdf-manifest.mjs — regenerate `data/forms-pdf-manifest.json` from the
 * committed WA Mental Health Act 2014 form PDFs in `public/forms-pdf/`.
 *
 *   node scripts/build-forms-pdf-manifest.mjs           # rewrite the manifest
 *   node scripts/build-forms-pdf-manifest.mjs --check   # gate, exit 1 on drift
 *
 * The manifest feeds `formCatalogDetails` (`src/lib/form-catalog.ts`), which puts the
 * `passwordProtected` flag on the Forms detail page as a status badge. A psychiatrist
 * reads that badge before relying on the file at the bedside for a statutory step, so
 * the flag has to be derived from the bytes rather than maintained by hand — until this
 * script existed nothing checked any of the 51 flags against the file it describes.
 *
 * WHAT `passwordProtected` MEANS
 * -----------------------------
 * It means: **opening this PDF requires a user password**. It does NOT mean "the file
 * carries an /Encrypt dictionary". Those are different facts. A PDF may be encrypted
 * with an owner password (restricting printing or editing) and an EMPTY user password;
 * it carries /Encrypt and still opens freely for any reader. Deriving the flag from the
 * presence of /Encrypt would mislabel such a file, and a clinician who finds that a
 * "password protected" form opens fine learns to disbelieve the badge on the files where
 * it is true.
 *
 * The derivation is therefore behavioural: attempt to open the document with the empty
 * user password. The flag is true only when that attempt is refused for a password
 * reason (pdf.js `PasswordException`, either NEED_PASSWORD or INCORRECT_PASSWORD).
 *
 * FAILURE DIRECTION
 * -----------------
 * `false` is an assertion that the clinician can open the file. Under-warning is the
 * unsafe direction: planning to complete a Form 10A and discovering at the bedside that
 * it will not open is a workflow failure at a time-critical statutory step. So any
 * unreadable file, malformed PDF, unparseable encryption dictionary, or unsupported
 * encryption revision yields `passwordProtected: true` AND a hard failure of this
 * script. No error path may ever produce `false`.
 *
 * PROVENANCE
 * ----------
 * Only `sha256`, `bytes`, `passwordProtected` and `editingRestricted` are derived.
 * `code`, `localPath`, `officialPdfUrl`, the entry order, and the top-level
 * `generatedAt` / `sourceRegisterUrl` are carried over verbatim from the committed
 * manifest. This script is fully offline and must never fetch anything: it cannot know a
 * form's official publisher URL, so a PDF on disk with no existing manifest entry is a
 * hard error rather than an invention. `--check` likewise fails on any disagreement
 * instead of auto-correcting — the manifest also carries the sha256 provenance record,
 * and silently rewriting it would erase the evidence that the file on disk changed.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "data", "forms-pdf-manifest.json");
const pdfDirectory = join(root, "public", "forms-pdf");
const pdfUrlPrefix = "/forms-pdf/";
const officialPdfUrlPrefix = "https://www.chiefpsychiatrist.wa.gov.au/";

/** pdf.js in Node: the legacy build runs without a DOM and without a worker thread. */
async function loadPdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/**
 * Does opening `bytes` require a user password?
 *
 * Returns `{ passwordProtected, failure }`. `failure` is non-null when the file could
 * not be classified at all — a corrupt header, a truncated body, an encryption
 * dictionary pdf.js cannot parse. In that case `passwordProtected` is still `true`: the
 * conservative answer is the one that warns, and the caller turns `failure` into a hard
 * exit so a human resolves it rather than shipping a guess.
 */
export async function derivePdfPasswordProtection(bytes, label) {
  const pdfjs = await loadPdfjs();
  // A fresh copy per call: pdf.js transfers/detaches the buffer it is handed.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    password: "",
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    await task.promise;
    return { passwordProtected: false, failure: null };
  } catch (error) {
    if (error instanceof pdfjs.PasswordException) {
      // NEED_PASSWORD (no password supplied is not enough) and INCORRECT_PASSWORD (the
      // empty string is not the user password) both mean the same thing to a clinician.
      return { passwordProtected: true, failure: null };
    }
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return {
      passwordProtected: true,
      failure: `${label} could not be opened or classified (${reason}). Recorded conservatively as password protected.`,
    };
  } finally {
    // Always tear the loading task down, including on the success path, so a failed run
    // cannot leave pdf.js work pending and hang the process.
    await task.destroy().catch(() => {});
  }
}

/**
 * Parse permissions integer from PDF bytes, looking for `/P\s+(-?\d+)` in the
 * encryption dictionary.
 *
 * Returns the parsed integer, or `null` if no `/P` entry is present (unencrypted PDF).
 */
export function parsePdfPermissions(bytes) {
  const text = Buffer.from(bytes).toString("latin1");
  const match = text.match(/\/P\s+(-?\d+)/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * Does this PDF restrict editing or modification?
 *
 * In PDF 1.7 Table 22 ("User access permissions"):
 * - Bit 4 (bitmask 1 << 3 = 8): modify contents of the document
 * - Bit 11 (bitmask 1 << 10 = 1024): assemble the document (insert/rotate/delete pages)
 *
 * In public/forms-pdf/*.pdf, 50 of 51 files carry `/P -1084` (0xFFFFFBC4) in their
 * encryption dictionary; form-12a.pdf is the only one with no `/P`.
 *
 * Permissions integer is parsed from `/P\s+(-?\d+)`. If `/P` is negative, or restricts
 * modify contents (bit 4 is 0), or assemble (bit 11 is 0), or `/P === -1084`,
 * editing is restricted (`editingRestricted: true`). For files without `/P` (like
 * form-12a.pdf), editing is permitted (`editingRestricted: false`).
 */
export function derivePdfPermissions(bytes) {
  const permissions = parsePdfPermissions(bytes);
  if (permissions === null) {
    return { editingRestricted: false, permissions: null };
  }
  const bit4 = (permissions & (1 << 3)) !== 0;
  const bit11 = (permissions & (1 << 10)) !== 0;
  const editingRestricted = permissions === -1084 || permissions < 0 || !bit4 || !bit11;
  return { editingRestricted, permissions };
}

export function derivePdfEditingRestricted(bytes) {
  return derivePdfPermissions(bytes).editingRestricted;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Committed PDF filenames, sorted so a run is deterministic across filesystems. */
export function listFormPdfFilenames() {
  return readdirSync(pdfDirectory)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .sort();
}

/**
 * Rebuild every asset entry, preserving the committed manifest's entry order and its
 * non-derived fields. Throws when the manifest and the directory disagree about which
 * forms exist — neither side may be invented from the other.
 */
export async function buildManifest(existing) {
  if (!Array.isArray(existing?.assets)) {
    throw new Error(`Malformed manifest: expected an "assets" array in ${manifestPath}.`);
  }
  const byLocalPath = new Map();
  for (const asset of existing.assets) {
    if (typeof asset?.localPath !== "string" || !asset.localPath.startsWith(pdfUrlPrefix)) {
      throw new Error(
        `Malformed manifest entry (localPath must start with "${pdfUrlPrefix}"): ${JSON.stringify(asset)}`,
      );
    }
    if (typeof asset.code !== "string" || asset.code.trim() === "") {
      throw new Error(`Malformed manifest entry (missing "code"): ${JSON.stringify(asset)}`);
    }
    // Host-pinned, not merely https. These are statutory instruments; the manifest URL is
    // the provenance record a reader follows to check the committed bytes against the
    // publisher, and any other host would send them somewhere this repo cannot vouch for.
    // `tests/forms.test.ts` pins the same host from the other direction.
    if (typeof asset.officialPdfUrl !== "string" || !asset.officialPdfUrl.startsWith(officialPdfUrlPrefix)) {
      throw new Error(
        `Malformed manifest entry ("officialPdfUrl" must start with "${officialPdfUrlPrefix}"): ${JSON.stringify(asset)}`,
      );
    }
    if (byLocalPath.has(asset.localPath)) {
      throw new Error(`Duplicate manifest entry for ${asset.localPath}.`);
    }
    byLocalPath.set(asset.localPath, asset);
  }

  const onDisk = new Set(listFormPdfFilenames().map((name) => `${pdfUrlPrefix}${name}`));
  const undocumented = [...onDisk].filter((localPath) => !byLocalPath.has(localPath));
  if (undocumented.length > 0) {
    // This script is offline by contract and cannot discover a form's publisher URL, so
    // there is no honest entry it could synthesise here.
    throw new Error(
      `Committed PDF(s) with no manifest entry: ${undocumented.join(", ")}. ` +
        "Add the entry by hand with its official chiefpsychiatrist.wa.gov.au URL, then re-run this script.",
    );
  }
  const missing = [...byLocalPath.keys()].filter((localPath) => !onDisk.has(localPath));
  if (missing.length > 0) {
    throw new Error(`Manifest entr(ies) with no committed PDF: ${missing.join(", ")}.`);
  }

  const failures = [];
  const assets = [];
  for (const asset of existing.assets) {
    const filePath = join(pdfDirectory, asset.localPath.slice(pdfUrlPrefix.length));
    let bytes;
    try {
      bytes = readFileSync(filePath);
    } catch (error) {
      // Unreadable is a hard failure, and the flag still fails closed.
      failures.push(
        `Form ${asset.code}: cannot read ${asset.localPath} (${error instanceof Error ? error.message : String(error)}).`,
      );
      assets.push({ ...asset, sha256: "", bytes: 0, passwordProtected: true, editingRestricted: true });
      continue;
    }
    const { passwordProtected, failure } = await derivePdfPasswordProtection(bytes, `Form ${asset.code}`);
    if (failure) failures.push(failure);
    const { editingRestricted } = derivePdfPermissions(bytes);
    // Spread first, then override ONLY the four derived fields. Enumerating the
    // known keys instead would silently drop any other field an asset carries, and
    // the drop would be invisible until it mattered: `--check` would report drift,
    // and the regeneration it tells the operator to run would erase the field for
    // good. The provenance fields this generator cannot compute — `officialPdfUrl`
    // above all — are exactly the ones that must survive it untouched. The
    // unreadable-file path above already spreads; these two must not disagree.
    assets.push({
      ...asset,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      passwordProtected,
      editingRestricted,
    });
  }

  return { manifest: { ...existing, assets }, failures };
}

/** Exact committed bytes: Prettier's JSON output for this file is 2-space + newline. */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function run({ checkOnly }) {
  const currentText = readFileSync(manifestPath, "utf8");
  const { manifest, failures } = await buildManifest(JSON.parse(currentText));
  if (failures.length > 0) {
    throw new Error(
      `Forms PDF manifest could not be derived from the committed bytes:\n  - ${failures.join("\n  - ")}`,
    );
  }
  const expected = serializeManifest(manifest);
  const protectedCount = manifest.assets.filter((asset) => asset.passwordProtected).length;
  const restrictedCount = manifest.assets.filter((asset) => asset.editingRestricted).length;

  if (checkOnly) {
    if (expected !== currentText) {
      throw new Error(
        `data/forms-pdf-manifest.json disagrees with the committed PDFs. ` +
          "Inspect the difference before regenerating — sha256 is a provenance record, so a changed hash means the file on disk changed. " +
          "Re-run `node scripts/build-forms-pdf-manifest.mjs` once the change is understood.",
      );
    }
    process.stdout.write(
      `Forms PDF manifest is current (${manifest.assets.length} PDFs, ${protectedCount} require a user password, ${restrictedCount} editing-restricted).\n`,
    );
    return;
  }

  writeFileSync(manifestPath, expected);
  process.stdout.write(
    `Wrote ${manifest.assets.length} entries to data/forms-pdf-manifest.json ` +
      `(${protectedCount} require a user password, ${restrictedCount} editing-restricted).\n`,
  );
}

const isEntrypoint = isDirectEntrypoint(import.meta.url);
if (isEntrypoint) {
  await run({ checkOnly: process.argv.includes("--check") });
}
