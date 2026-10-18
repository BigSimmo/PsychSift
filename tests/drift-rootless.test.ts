import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { manifestText, parseSnapshot, replaySchema, writeManifestAtomically } from "../scripts/generate-drift-manifest";
import { diffManifests, IGNORED_MANIFEST_KEYS } from "../scripts/check-drift-manifest-freshness";
import {
  controlPath,
  imageEnvironment,
  removeOwnedRootlessRun,
  rootlessOptions,
  ROOTLESS_SUPERVISOR,
  verifyOfflineImage,
} from "../scripts/lib/drift-rootless";

const directories: string[] = [];
async function temporary() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "drift-rootless-test-"));
  directories.push(directory);
  return realpath(directory);
}
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function imageFixture(
  options: { corruptLayer?: boolean; wrongDiffId?: boolean; architecture?: string; duplicatePlatform?: boolean } = {},
) {
  const directory = await temporary();
  await mkdir(path.join(directory, "blobs/sha256"), { recursive: true });
  const add = async (bytes: Buffer, mediaType: string) => {
    const descriptor = { digest: digest(bytes), size: bytes.length, mediaType };
    await writeFile(path.join(directory, "blobs/sha256", descriptor.digest.slice(7)), bytes);
    return descriptor;
  };
  const raw = Buffer.from("synthetic local layer bytes; no executable image is supplied");
  const layer = await add(gzipSync(raw), "application/vnd.oci.image.layer.v1.tar+gzip");
  const config = {
    os: "linux",
    architecture: options.architecture ?? "amd64",
    rootfs: { diff_ids: [options.wrongDiffId ? `sha256:${"0".repeat(64)}` : digest(raw)] },
    config: {
      Env: [
        "PATH=/bin",
        "PGDATA=/var/lib/postgresql/data",
        "POSTGRES_HOST=/var/run/postgresql",
        "POSTGRES_DB=postgres",
      ],
      Entrypoint: ["docker-entrypoint.sh"],
      Cmd: ["postgres", "-D", "/etc/postgresql"],
      WorkingDir: "/",
    },
  };
  const configDescriptor = await add(Buffer.from(JSON.stringify(config)), "application/vnd.oci.image.config.v1+json");
  const manifest = await add(
    Buffer.from(
      JSON.stringify({
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        config: configDescriptor,
        layers: [layer],
      }),
    ),
    "application/vnd.oci.image.manifest.v1+json",
  );
  const child = { ...manifest, platform: { os: "linux", architecture: "amd64" } };
  const index = await add(
    Buffer.from(
      JSON.stringify({
        mediaType: "application/vnd.oci.image.index.v1+json",
        manifests: options.duplicatePlatform ? [child, child] : [child],
      }),
    ),
    "application/vnd.oci.image.index.v1+json",
  );
  await writeFile(path.join(directory, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }));
  await writeFile(
    path.join(directory, "index.json"),
    JSON.stringify({ manifests: [{ ...manifest, annotations: { "org.opencontainers.image.ref.name": "verified" } }] }),
  );
  if (options.corruptLayer)
    await writeFile(path.join(directory, "blobs/sha256", layer.digest.slice(7)), "corrupt bytes");
  return {
    directory,
    image: `supabase/postgres:test@${index.digest}`,
    config,
    index,
    manifest,
    layer,
    configDescriptor,
  };
}

const inputs = {
  rolesSql: "-- exact role bootstrap",
  scaffoldSql: "-- exact storage scaffold",
  schemaSql: "-- complete schema\nselect 'do not truncate';",
};
function completeSnapshot() {
  return {
    snapshot_version: 2,
    captured_at: "volatile",
    migration_history_probe: "no_history_table",
    migration_history: [],
    extensions: [{}],
    tables: Array.from({ length: 31 }, (_, id) => ({ name: `t${id}` })),
    views: [{}],
    functions: Array.from({ length: 41 }, (_, id) => ({ signature: `f${id}()` })),
    indexes: Array.from({ length: 101 }, (_, id) => ({ name: `i${id}` })),
    policies: [{}],
    constraints: [{}],
    triggers: [{}],
    storage_buckets: [{}],
  };
}

describe("explicit offline rootless inputs", () => {
  const args = [
    "--oci-layout",
    "/private/image",
    "--scratch-root",
    "/private/scratch",
    "--umoci",
    "/private/umoci",
    "--umoci-sha256",
    "a".repeat(64),
    "--evidence",
    "/private/evidence.json",
  ];
  it.each(["--keep", "--port", "--container"])(
    "rejects unsupported Docker option %s before inspecting inputs",
    (flag) => {
      expect(() => rootlessOptions([...args, flag, "5432"], "image", "/repo")).toThrow("not supported");
    },
  );
  it("requires every offline path and an exact executable hash", () => {
    expect(() => rootlessOptions([], "image", "/repo")).toThrow("--oci-layout");
    expect(() =>
      rootlessOptions(
        args.map((arg) => (arg === "a".repeat(64) ? "bad" : arg)),
        "image",
        "/repo",
      ),
    ).toThrow("SHA-256");
    expect(rootlessOptions(args, "image", "/repo").umociSha256).toBe("a".repeat(64));
  });
  it("verifies actual index, child/config, compressed bytes and ordered uncompressed diff IDs", async () => {
    const fixture = await imageFixture();
    const verified = await verifyOfflineImage(fixture.directory, fixture.image);
    expect(verified.manifest_digest).toBe(fixture.manifest.digest);
    expect(verified.config_digest).toBe(fixture.configDescriptor.digest);
    expect(verified.layers[0].digest).toBe(fixture.layer.digest);
    expect(verified.layers[0].diff_id).toBe(fixture.config.rootfs.diff_ids[0]);
    expect(verified.tag).toBe("verified");
  });
  it.each([{ corruptLayer: true }, { wrongDiffId: true }, { architecture: "arm64" }, { duplicatePlatform: true }])(
    "refuses invalid local provenance %j",
    async (options) => {
      const fixture = await imageFixture(options);
      await expect(verifyOfflineImage(fixture.directory, fixture.image)).rejects.toThrow();
    },
  );
  it("rejects the verified tag when another local descriptor uses it for different image bytes", async () => {
    const fixture = await imageFixture();
    const annotations = { "org.opencontainers.image.ref.name": "verified" };
    await writeFile(
      path.join(fixture.directory, "index.json"),
      JSON.stringify({
        manifests: [
          { ...fixture.manifest, annotations },
          { digest: `sha256:${"0".repeat(64)}`, size: 1, mediaType: fixture.manifest.mediaType, annotations },
        ],
      }),
    );
    await expect(verifyOfflineImage(fixture.directory, fixture.image)).rejects.toThrow("unambiguous tag");
  });

  it("does not trust the pinned filename when its index bytes were changed", async () => {
    const fixture = await imageFixture();
    await writeFile(path.join(fixture.directory, "blobs/sha256", fixture.index.digest.slice(7)), "{}");
    await expect(verifyOfflineImage(fixture.directory, fixture.image)).rejects.toThrow("index digest mismatch");
  });
  it("refuses a missing blob without attempting acquisition", async () => {
    const fixture = await imageFixture();
    await rm(path.join(fixture.directory, "blobs/sha256", fixture.configDescriptor.digest.slice(7)));
    await expect(verifyOfflineImage(fixture.directory, fixture.image)).rejects.toThrow();
  });
  it.skipIf(process.platform === "win32")(
    "refuses symlink control paths without rejecting ordinary image content",
    async () => {
      const fixture = await imageFixture();
      const alias = path.join(await temporary(), "alias");
      await symlink(fixture.directory, alias);
      await expect(controlPath(alias, true)).rejects.toThrow("symlinks");
      await expect(controlPath(fixture.directory, true)).resolves.toBe(fixture.directory);
    },
  );
  it("uses verified image settings and rejects changed startup or socket contracts", async () => {
    const fixture = await imageFixture();
    expect(imageEnvironment(fixture.config).POSTGRES_HOST).toBe("/var/run/postgresql");
    const changed = structuredClone(fixture.config);
    changed.config.Env = changed.config.Env.map((entry) =>
      entry.startsWith("POSTGRES_HOST=") ? "POSTGRES_HOST=live.example" : entry,
    );
    expect(() => imageEnvironment(changed)).toThrow("bootstrap differs");
    changed.config.Env = [...fixture.config.config.Env, "LD_PRELOAD=/host/injected.so"];
    expect(() => imageEnvironment(changed)).toThrow("environment");
  });
});

describe("shared actual schema replay contract", () => {
  it("applies exact inputs in order, dynamically selects Storage owner, and captures only after full replay", async () => {
    const calls: Array<{ role: string; sql: string; tuples: boolean }> = [];
    const snapshot = await replaySchema(async (role, sql, tuples = false) => {
      calls.push({ role, sql, tuples });
      if (calls.length === 2) return "  synthetic_storage_owner\n";
      if (calls.length === 5) return JSON.stringify(completeSnapshot());
      return "";
    }, inputs);
    expect(calls.map(({ role }) => role)).toEqual([
      "postgres",
      "postgres",
      "synthetic_storage_owner",
      "postgres",
      "postgres",
    ]);
    expect(calls[0].sql).toBe(inputs.rolesSql);
    expect(calls[2].sql).toBe(inputs.scaffoldSql);
    expect(calls[3].sql).toBe(inputs.schemaSql);
    expect(calls[4]).toEqual({ role: "postgres", sql: "select public.schema_drift_snapshot()::text;", tuples: true });
    expect(snapshot).not.toHaveProperty("captured_at");
    expect(snapshot.functions).toHaveLength(41);
  });
  it("refuses an unavailable storage owner before scaffold or schema writes", async () => {
    const sql = vi.fn().mockResolvedValue("");
    await expect(replaySchema(sql, inputs)).rejects.toThrow("owner");
    expect(sql).toHaveBeenCalledTimes(2);
  });
  it.each([1, 3, 4, 5])("aborts on SQL stage %i without overwriting the previous manifest", async (failedStage) => {
    const output = path.join(await temporary(), "manifest.json");
    await writeFile(output, "previous manifest bytes");
    let stage = 0;
    await expect(
      (async () => {
        const snapshot = await replaySchema(async () => {
          stage += 1;
          if (stage === failedStage) throw new Error("synthetic SQL failure");
          return stage === 2 ? "synthetic_storage_owner" : "";
        }, inputs);
        writeManifestAtomically(output, manifestText("image", "hash", 1, snapshot));
      })(),
    ).rejects.toThrow("synthetic SQL failure");
    expect(stage).toBe(failedStage);
    expect(await readFile(output, "utf8")).toBe("previous manifest bytes");
  });
  it("rejects tiny, malformed and fabricated successful-history snapshots", () => {
    expect(() => parseSnapshot("{}")).toThrow("inventory");
    expect(() => parseSnapshot("not JSON")).toThrow();
    expect(() => parseSnapshot(JSON.stringify({ ...completeSnapshot(), migration_history_probe: "ok" }))).toThrow(
      "contract",
    );
  });
  it("keeps one manifest format across backends and does not hide new provenance keys from CI", async () => {
    const snapshot = completeSnapshot();
    const docker = JSON.parse(manifestText("original@index", "schema", 1, snapshot));
    const rootless = JSON.parse(manifestText("original@index", "schema", 100, snapshot));
    expect(diffManifests(docker, rootless)).toEqual([]);
    expect(rootless.generator).toBe("scripts/generate-drift-manifest.ts");
    expect(Object.keys(rootless).sort()).toEqual([
      "generated_at",
      "generator",
      "postgres_image",
      "replay_seconds",
      "schema_sha256",
      "snapshot",
    ]);
    expect([...IGNORED_MANIFEST_KEYS].sort()).toEqual(["generated_at", "replay_seconds"]);
    expect(diffManifests(docker, { ...rootless, backend: "rootless" })).toHaveLength(1);
    const output = path.join(await temporary(), "manifest.json");
    writeManifestAtomically(output, JSON.stringify(rootless));
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(rootless);
    expect(await readdir(path.dirname(output))).toEqual(["manifest.json"]);
  });
});

describe("single-namespace guest supervisor", () => {
  it.skipIf(process.platform !== "linux").each([false, true])(
    "records actual shutdown outcome (pg_ctl fails: %s)",
    async (failedCleanup) => {
      const directory = await temporary();
      const bin = path.join(directory, "bin");
      const output = path.join(directory, "output");
      await mkdir(bin);
      await mkdir(output);
      const executable = (name: string, body: string) =>
        writeFile(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o700 });
      await executable(
        "docker-entrypoint.sh",
        `trap 'exit 0' TERM
echo $$ > "$PGDATA/server.pid"
echo 'PostgreSQL init process complete; ready for start up.'
while true; do /bin/sleep 0.01; done`,
      );
      await executable(
        "pg_isready",
        `count=0
if [ -f "$PGDATA/checks" ]; then count=$(cat "$PGDATA/checks"); fi
count=$((count+1))
printf '%s' "$count" > "$PGDATA/checks"
[ "$count" -ne 2 ]`,
      );
      await executable("sleep", "exec /bin/sleep 0.001");
      await executable("psql", 'cat > "$PGDATA/received.sql"; printf "actual fixture response\\n"');
      await executable("pg_ctl", failedCleanup ? "exit 7" : 'kill -TERM "$(cat "$PGDATA/server.pid")"; exit 0');
      // Substitute only the guest mount location; run the maintained shell itself
      // against harmless executable fixtures, with no bwrap or database started.
      const supervisor = ROOTLESS_SUPERVISOR.replaceAll("/tmp/drift-output", output);
      const sql = "select 'fixture';";
      const result = spawnSync("/bin/bash", ["-c", supervisor], {
        env: { PATH: `${bin}:/usr/bin:/bin`, NODE_ENV: "test", PGDATA: directory, POSTGRES_HOST: directory },
        input: `synthetic-password\n1 tuples ${Buffer.from("postgres").toString("base64")} ${Buffer.from(sql).toString("base64")}\n`,
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(failedCleanup ? 1 : 0);
      expect(Number(await readFile(path.join(directory, "checks"), "utf8"))).toBeGreaterThanOrEqual(7);
      expect(await readFile(path.join(directory, "received.sql"), "utf8")).toBe(sql);
      expect((await readFile(path.join(output, "1.status"), "utf8")).trim()).toBe("0");
      expect((await readFile(path.join(output, "cleanup-status"), "utf8")).trim().split(" ")[0]).toBe(
        failedCleanup ? "7" : "0",
      );
    },
  );
});

describe("owned immutable rootfs directory cleanup", () => {
  it.skipIf(process.platform !== "linux")(
    "removes 0555 owned directories without chmodding or following an outside symlink",
    async () => {
      const parent = await temporary();
      const run = await mkdtemp(path.join(parent, "drift-rootless-"));
      const readonly = path.join(run, "bundle/rootfs/nix/store/immutable/bin");
      await mkdir(readonly, { recursive: true });
      await writeFile(path.join(readonly, "tool"), "owned disposable bytes", { mode: 0o444 });
      const outside = path.join(await temporary(), "outside");
      await mkdir(outside);
      const outsideFile = path.join(outside, "retained");
      await writeFile(outsideFile, "must remain untouched", { mode: 0o444 });
      // The native test runner uses a restrictive umask; establish exact fixture modes.
      await chmod(outsideFile, 0o444);
      await chmod(outside, 0o555);
      await symlink(outside, path.join(readonly, "outside-link"));
      await chmod(readonly, 0o555);
      await chmod(path.dirname(readonly), 0o555);
      const marker = JSON.stringify({ run, nonce: "synthetic-owned-run" });
      await writeFile(path.join(run, "owner.json"), marker);
      const identity = await lstat(run);
      try {
        await removeOwnedRootlessRun(run, { ino: identity.ino, dev: identity.dev, uid: identity.uid, marker });
        await expect(lstat(run)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readFile(outsideFile, "utf8")).toBe("must remain untouched");
        expect((await lstat(outside)).mode & 0o777).toBe(0o555);
        expect((await lstat(outsideFile)).mode & 0o777).toBe(0o444);
      } finally {
        await chmod(outside, 0o700);
        // Let fixture disposal work even when the implementation under test fails.
        await chmod(path.dirname(readonly), 0o700).catch(() => undefined);
        await chmod(readonly, 0o700).catch(() => undefined);
      }
    },
  );

  it.skipIf(process.platform !== "linux")(
    "refuses a mismatched marker before changing any directory modes",
    async () => {
      const run = await mkdtemp(path.join(await temporary(), "drift-rootless-"));
      const readonly = path.join(run, "untouched");
      await mkdir(readonly, { mode: 0o555 });
      await chmod(readonly, 0o555);
      await writeFile(path.join(run, "owner.json"), "actual-marker");
      const identity = await lstat(run);
      await expect(
        removeOwnedRootlessRun(run, {
          ino: identity.ino,
          dev: identity.dev,
          uid: identity.uid,
          marker: "wrong-marker",
        }),
      ).rejects.toThrow("marker changed");
      expect((await lstat(readonly)).mode & 0o777).toBe(0o555);
      expect(await readFile(path.join(run, "owner.json"), "utf8")).toBe("actual-marker");
    },
  );
});
