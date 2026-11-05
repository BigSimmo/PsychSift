#!/usr/bin/env node
// Offline byte acceptance for an explicitly selected, privately held Storage download.
// This tool never contacts Storage, loads environment files, or restores anything.
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const STORAGE_RESTORE_BUCKETS = ["clinical-documents", "clinical-images", "cme-private-evidence"];
const MAX_OBJECTS = 100_000;
const MAX_OBJECT_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;

function validObjectPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/[\\\x00-\x1f\x7f]/.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

export function validateStorageManifest(manifest) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.algorithm !== "sha256" ||
    !Array.isArray(manifest.objects) ||
    manifest.objects.length === 0 ||
    manifest.objects.length > MAX_OBJECTS
  ) {
    throw new Error("Invalid or empty Storage byte manifest");
  }
  const seen = new Set();
  for (const [index, object] of manifest.objects.entries()) {
    if (
      !STORAGE_RESTORE_BUCKETS.includes(object?.bucket) ||
      !validObjectPath(object.path) ||
      !Number.isSafeInteger(object.size) ||
      object.size < 0 ||
      object.size > MAX_OBJECT_BYTES ||
      typeof object.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(object.sha256)
    ) {
      throw new Error(`Invalid Storage byte manifest object ${index + 1}`);
    }
    const key = `${object.bucket}/${object.path}`;
    if (seen.has(key)) throw new Error(`Duplicate Storage byte manifest object ${index + 1}`);
    seen.add(key);
  }
  return manifest;
}

async function selectedRoot(root) {
  const canonical = await realpath(path.resolve(root));
  if (!(await stat(canonical)).isDirectory()) throw new Error("Storage root must be a directory");
  return canonical;
}

async function inventory(root) {
  const entries = [];
  const top = await readdir(root, { withFileTypes: true });
  if (
    top.length !== STORAGE_RESTORE_BUCKETS.length ||
    top.some((entry) => !STORAGE_RESTORE_BUCKETS.includes(entry.name) || !entry.isDirectory())
  ) {
    throw new Error("Storage root must contain exactly the three supported bucket directories");
  }
  async function visit(bucket, prefix = "") {
    for (const entry of await readdir(path.join(root, bucket, prefix), { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!validObjectPath(name)) throw new Error("Unsupported Storage object path");
      if (entry.isDirectory()) await visit(bucket, name);
      else if (entry.isFile()) {
        entries.push({ bucket, path: name });
        if (entries.length > MAX_OBJECTS) throw new Error("Storage object inventory exceeds safety bound");
      } else throw new Error("Storage object inventory contains a symlink or nonregular file");
    }
  }
  for (const bucket of STORAGE_RESTORE_BUCKETS) await visit(bucket);
  return entries.sort((a, b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`));
}

async function objectBytes(root, object) {
  // Reject symlinks in every component, including bucket directories. The final open also
  // refuses a symlink swap. The caller owns this isolated fixture/download root.
  let full = root;
  for (const component of [object.bucket, ...object.path.split("/")]) {
    full = path.join(full, component);
    if ((await lstat(full)).isSymbolicLink()) throw new Error("symlink");
  }
  if (!(await lstat(full)).isFile()) throw new Error("nonregular");
  const file = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_OBJECT_BYTES) throw new Error("nonregular_or_oversize");
    const hash = createHash("sha256");
    let size = 0;
    for await (const bytes of file.createReadStream({ autoClose: false })) {
      size += bytes.length;
      if (size > MAX_OBJECT_BYTES) throw new Error("oversize");
      hash.update(bytes);
    }
    if (size !== info.size) throw new Error("changed_during_read");
    return { size, sha256: hash.digest("hex") };
  } finally {
    await file.close();
  }
}

export async function createStorageManifest(root) {
  const canonical = await selectedRoot(root);
  const objects = [];
  for (const object of await inventory(canonical))
    objects.push({ ...object, ...(await objectBytes(canonical, object)) });
  return validateStorageManifest({ schemaVersion: 1, algorithm: "sha256", objects });
}

export async function verifyStorageRestore(root, manifest) {
  validateStorageManifest(manifest);
  const canonical = await selectedRoot(root);
  const failures = [];
  let verified = 0;
  let bytes = 0;
  for (const [index, object] of manifest.objects.entries()) {
    try {
      const actual = await objectBytes(canonical, object);
      if (actual.size !== object.size || actual.sha256 !== object.sha256) {
        failures.push({ object: index + 1, reason: "size_or_digest_mismatch" });
      } else {
        verified += 1;
        bytes += actual.size;
      }
    } catch {
      // Do not print confidential object paths or native filesystem error text.
      failures.push({ object: index + 1, reason: "missing_or_unreadable_bytes" });
    }
  }
  try {
    const expected = new Set(manifest.objects.map((object) => `${object.bucket}/${object.path}`));
    const actual = await inventory(canonical);
    if (actual.some((object) => !expected.has(`${object.bucket}/${object.path}`))) {
      failures.push({ reason: "unexpected_objects" });
    }
  } catch {
    failures.push({ reason: "invalid_bucket_inventory" });
  }
  return { ok: failures.length === 0, expected: manifest.objects.length, verified, bytes, failures };
}

export async function runStorageRestoreCli(args) {
  const [mode, ...flags] = args;
  const options = {};
  if (!["manifest", "verify"].includes(mode) || flags.length !== 4)
    throw new Error(
      "Usage: manifest --root <download> --output <private-manifest> OR verify --root <download> --manifest <private-manifest>",
    );
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index];
    if (
      !["--root", mode === "manifest" ? "--output" : "--manifest"].includes(flag) ||
      options[flag] ||
      !flags[index + 1]
    )
      throw new Error("Invalid or repeated Storage verifier option");
    options[flag] = flags[index + 1];
  }
  if (!options["--root"]) throw new Error("Explicit Storage root is required");
  if (mode === "manifest") {
    const manifest = await createStorageManifest(options["--root"]);
    const encoded = `${JSON.stringify(manifest, null, 2)}\n`;
    if (Buffer.byteLength(encoded) > MAX_MANIFEST_BYTES) throw new Error("Storage manifest exceeds safety bound");
    // Refuse to overwrite a known-good baseline with restored or partial bytes.
    await writeFile(options["--output"], encoded, { flag: "wx", mode: 0o600 });
    return {
      ok: true,
      objects: manifest.objects.length,
      manifestSha256: createHash("sha256").update(encoded).digest("hex"),
    };
  }
  if ((await stat(options["--manifest"])).size > MAX_MANIFEST_BYTES)
    throw new Error("Storage manifest exceeds safety bound");
  const encoded = await readFile(options["--manifest"], "utf8");
  return {
    ...(await verifyStorageRestore(options["--root"], JSON.parse(encoded))),
    manifestSha256: createHash("sha256").update(encoded).digest("hex"),
  };
}

if (isDirectEntrypoint(import.meta.url)) {
  runStorageRestoreCli(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch(() => {
      console.error(
        "Storage byte acceptance failed: invalid input or unreadable bytes; keep private paths out of shared logs.",
      );
      process.exitCode = 1;
    });
}
