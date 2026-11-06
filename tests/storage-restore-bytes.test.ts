import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createStorageManifest,
  runStorageRestoreCli,
  STORAGE_RESTORE_BUCKETS,
  validateStorageManifest,
  verifyStorageRestore,
} from "../scripts/verify-storage-restore.mjs";

describe("offline Storage restore byte acceptance", () => {
  let fixture: string;
  let source: string;
  let restored: string;
  const objects = [
    ["clinical-documents", "synthetic/document.pdf", "%PDF-1.4\nsynthetic fixture\n%%EOF"],
    ["clinical-images", "synthetic/image.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ["cme-private-evidence", "synthetic/evidence.txt", "wholly invented evidence"],
  ];
  beforeEach(async () => {
    fixture = await mkdtemp(path.join(tmpdir(), "psychsift-restore-bytes-"));
    source = path.join(fixture, "source");
    restored = path.join(fixture, "restored");
    for (const root of [source, restored]) {
      for (const bucket of STORAGE_RESTORE_BUCKETS) await mkdir(path.join(root, bucket), { recursive: true });
      for (const [bucket, name, content] of objects) {
        await mkdir(path.dirname(path.join(root, bucket!, name!)), { recursive: true });
        await writeFile(path.join(root, bucket!, name!), content!);
      }
    }
  });
  afterEach(async () => {
    await rm(fixture, { recursive: true, force: true });
  });

  it("reads and matches every object against source size and SHA-256", async () => {
    const manifest = await createStorageManifest(source);
    expect(manifest.objects).toHaveLength(3);
    expect(await verifyStorageRestore(restored, manifest)).toMatchObject({
      ok: true,
      expected: 3,
      verified: 3,
      failures: [],
    });
  });

  it("fails for omitted bytes even while the original inventory/metadata remains unchanged", async () => {
    const manifest = await createStorageManifest(source);
    await rm(path.join(restored, "clinical-documents", "synthetic/document.pdf"));
    const result = await verifyStorageRestore(restored, manifest);
    expect(manifest.objects).toHaveLength(3);
    expect(result).toMatchObject({ ok: false, expected: 3, verified: 2 });
    expect(result.failures).toEqual([{ object: 1, reason: "missing_or_unreadable_bytes" }]);
  });

  it("fails for same-size corrupted bytes, which row counts and sizes cannot detect", async () => {
    const manifest = await createStorageManifest(source);
    const file = path.join(restored, "cme-private-evidence", "synthetic/evidence.txt");
    const original = await readFile(file);
    original[0] = original[0]! ^ 1;
    await writeFile(file, original);
    expect(await verifyStorageRestore(restored, manifest)).toMatchObject({
      ok: false,
      verified: 2,
      failures: [{ reason: "size_or_digest_mismatch" }],
    });
  });

  it("fails for unreadable object shape and unexpected objects", async () => {
    const manifest = await createStorageManifest(source);
    const file = path.join(restored, "clinical-images", "synthetic/image.svg");
    await rm(file);
    await mkdir(file);
    await writeFile(path.join(restored, "clinical-documents", "extra.txt"), "unexpected");
    const result = await verifyStorageRestore(restored, manifest);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([{ object: 2, reason: "missing_or_unreadable_bytes" }, { reason: "unexpected_objects" }]),
    );
  });

  it("rejects symlinks without reading outside the selected root", async (context) => {
    const manifest = await createStorageManifest(source);
    const file = path.join(restored, "clinical-images", "synthetic/image.svg");
    await rm(file);
    try {
      await symlink(path.join(source, "clinical-images", "synthetic/image.svg"), file);
    } catch (error) {
      // Windows without the symlink privilege refuses creation; any other error stays visible.
      if ((error as NodeJS.ErrnoException).code === "EPERM" && process.platform === "win32") {
        context.skip();
        return;
      }
      throw error;
    }
    expect(await verifyStorageRestore(restored, manifest)).toMatchObject({ ok: false, verified: 2 });
    await expect(createStorageManifest(restored)).rejects.toThrow(/symlink/);
  });

  it("rejects traversal, duplicates, unsupported buckets and empty manifests", async () => {
    const manifest = await createStorageManifest(source);
    const object = manifest.objects[0]!;
    for (const objects of [
      [],
      [object, object],
      [{ ...object, path: "../outside" }],
      [{ ...object, bucket: "unknown" }],
    ]) {
      expect(() => validateStorageManifest({ ...manifest, objects })).toThrow();
    }
  });

  it("writes a private baseline once, verifies its exact digest, and does not overwrite it", async () => {
    const manifestPath = path.join(fixture, "source-manifest.json");
    const created = await runStorageRestoreCli(["manifest", "--root", source, "--output", manifestPath]);
    const verified = await runStorageRestoreCli(["verify", "--root", restored, "--manifest", manifestPath]);
    expect(created).toMatchObject({ ok: true, objects: 3 });
    expect(verified).toMatchObject({ ok: true, manifestSha256: created.manifestSha256 });
    await expect(runStorageRestoreCli(["manifest", "--root", restored, "--output", manifestPath])).rejects.toThrow();
    await expect(runStorageRestoreCli(["verify", "--root", restored, "--root", source])).rejects.toThrow(/repeated/);
  });

  it("digests the manifest file bytes and refuses invalid UTF-8", async () => {
    const manifestPath = path.join(fixture, "source-manifest.json");
    await runStorageRestoreCli(["manifest", "--root", source, "--output", manifestPath]);
    const bytes = await readFile(manifestPath);
    const verified = await runStorageRestoreCli(["verify", "--root", restored, "--manifest", manifestPath]);
    expect(verified.manifestSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const marker = bytes.indexOf("synthetic/document.pdf");
    const tampered = Buffer.from(bytes);
    tampered[marker] = 0xff;
    const tamperedPath = path.join(fixture, "tampered-manifest.json");
    await writeFile(tamperedPath, tampered);
    await expect(runStorageRestoreCli(["verify", "--root", restored, "--manifest", tamperedPath])).rejects.toThrow(
      /UTF-8/,
    );
  });
});
