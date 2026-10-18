import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { createGunzip } from "node:zlib";

export type ReplaySql = (role: string, sql: string, tuples?: boolean) => Promise<string>;
type Descriptor = {
  digest: string;
  size: number;
  mediaType?: string;
  platform?: { os?: string; architecture?: string };
  annotations?: Record<string, string>;
};
type ImageConfig = {
  architecture: string;
  os: string;
  rootfs: { diff_ids: string[] };
  config: { Env: string[]; Entrypoint: string[]; Cmd: string[]; WorkingDir?: string };
};
export type RootlessOptions = {
  image: string;
  layout: string;
  scratchRoot: string;
  umoci: string;
  umociSha256: string;
  evidence: string;
  worktree: string;
};
const MAX_BYTES = 8 * 1024 ** 3;
const MAX_OUTPUT = 64 * 1024 ** 2;
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const containsControl = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export function rootlessOptions(argv: string[], image: string, worktree: string): RootlessOptions {
  for (const flag of ["--keep", "--port", "--container"]) {
    if (argv.includes(flag)) throw new Error(`${flag} is not supported by the rootless backend`);
  }
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    const result = index < 0 ? undefined : argv[index + 1];
    if (!result || result.startsWith("--")) throw new Error(`${flag} is required for the rootless backend`);
    return result;
  };
  const options = {
    image,
    worktree,
    layout: value("--oci-layout"),
    scratchRoot: value("--scratch-root"),
    umoci: value("--umoci"),
    umociSha256: value("--umoci-sha256"),
    evidence: value("--evidence"),
  };
  if (!/^[a-f0-9]{64}$/.test(options.umociSha256)) throw new Error("--umoci-sha256 must be an exact SHA-256");
  return options;
}

/** Validate control paths, not legitimate symlinks within the unpacked image. */
export async function controlPath(input: string, directory: boolean): Promise<string> {
  if (!path.isAbsolute(input) || containsControl(input))
    throw new Error("Rootless paths must be absolute control paths");
  const resolved = path.resolve(input);
  let current = path.parse(resolved).root;
  for (const component of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Rootless control paths must not contain symlinks");
  }
  const info = await stat(resolved);
  if (directory ? !info.isDirectory() : !info.isFile()) throw new Error("Unexpected rootless control path type");
  return realpath(resolved);
}

async function hashStream(file: string, decompress = false): Promise<{ digest: string; bytes: number }> {
  const source = createReadStream(file);
  const stream = decompress ? source.pipe(createGunzip()) : source;
  if (decompress) source.on("error", (error) => stream.destroy(error));
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) {
      stream.destroy();
      source.destroy();
      throw new Error("Rootless image stream exceeds the 8 GiB bound");
    }
    hash.update(chunk);
  }
  return { digest: `sha256:${hash.digest("hex")}`, bytes };
}

function digestHex(digest: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Unsupported OCI digest");
  return digest.slice(7);
}

/** Reverify local bytes; a prior acquisition receipt alone cannot authenticate a rootfs. */
export async function verifyOfflineImage(layout: string, image: string) {
  const expected = image.match(/@sha256:([a-f0-9]{64})$/)?.[1];
  if (!expected) throw new Error("Rootless image requires an immutable SHA-256 reference");
  if (JSON.parse(await readFile(path.join(layout, "oci-layout"), "utf8")).imageLayoutVersion !== "1.0.0") {
    throw new Error("Unsupported OCI layout version");
  }
  const blob = async (descriptor: Descriptor) => {
    const file = await controlPath(path.join(layout, "blobs", "sha256", digestHex(descriptor.digest)), false);
    const actual = await hashStream(file);
    if (actual.digest !== descriptor.digest || actual.bytes !== descriptor.size)
      throw new Error("OCI blob digest/size mismatch");
    return file;
  };
  const indexFile = await controlPath(path.join(layout, "blobs", "sha256", expected), false);
  const topBytes = await readFile(indexFile);
  if (sha256(topBytes) !== expected) throw new Error("Pinned OCI index digest mismatch");
  const index = JSON.parse(topBytes.toString()) as { mediaType: string; manifests: Descriptor[] };
  if (index.mediaType !== "application/vnd.oci.image.index.v1+json")
    throw new Error("Rootless replay requires the pinned OCI index");
  const candidates = index.manifests.filter(
    (item) => item.platform?.os === "linux" && item.platform.architecture === "amd64",
  );
  if (candidates.length !== 1) throw new Error("OCI index must identify exactly one linux/amd64 image");
  const selected = candidates[0];
  const manifest = JSON.parse(await readFile(await blob(selected), "utf8")) as {
    mediaType: string;
    config: Descriptor;
    layers: Descriptor[];
  };
  if (
    manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json" ||
    manifest.config.mediaType !== "application/vnd.oci.image.config.v1+json"
  ) {
    throw new Error("Unsupported OCI manifest/config media type");
  }
  const config = JSON.parse(await readFile(await blob(manifest.config), "utf8")) as ImageConfig;
  if (
    config.os !== "linux" ||
    config.architecture !== "amd64" ||
    config.rootfs.diff_ids.length !== manifest.layers.length ||
    !manifest.layers.length
  ) {
    throw new Error("OCI platform or ordered rootfs descriptors are inconsistent");
  }
  const layers = [];
  let expandedBytes = 0;
  for (const [number, descriptor] of manifest.layers.entries()) {
    if (descriptor.mediaType !== "application/vnd.oci.image.layer.v1.tar+gzip")
      throw new Error("Unsupported OCI layer media type");
    const file = await blob(descriptor);
    const unpacked = await hashStream(file, true);
    expandedBytes += unpacked.bytes;
    if (unpacked.digest !== config.rootfs.diff_ids[number] || expandedBytes > MAX_BYTES)
      throw new Error("OCI rootfs diff ID or expansion bound mismatch");
    layers.push({ digest: descriptor.digest, bytes: descriptor.size, diff_id: unpacked.digest });
  }
  const localIndex = JSON.parse(await readFile(path.join(layout, "index.json"), "utf8")) as { manifests: Descriptor[] };
  const references = localIndex.manifests.filter(
    (item) => item.digest === selected.digest && item.size === selected.size && item.mediaType === selected.mediaType,
  );
  const tag = references.length === 1 ? references[0].annotations?.["org.opencontainers.image.ref.name"] : undefined;
  if (
    !tag ||
    !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(tag) ||
    localIndex.manifests.filter((item) => item.annotations?.["org.opencontainers.image.ref.name"] === tag).length !== 1
  )
    throw new Error("Local OCI layout must have one unambiguous tag for the verified child");
  return {
    config,
    tag,
    index_digest: `sha256:${expected}`,
    manifest_digest: selected.digest,
    config_digest: manifest.config.digest,
    layers,
    expanded_bytes: expandedBytes,
  };
}

export function imageEnvironment(config: ImageConfig): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const entry of config.config.Env) {
    const separator = entry.indexOf("=");
    const key = entry.slice(0, separator);
    if (separator < 1 || !/^[A-Z_][A-Z0-9_]*$/.test(key) || Object.hasOwn(environment, key) || key === "LD_PRELOAD")
      throw new Error("Unsupported image environment");
    environment[key] = entry.slice(separator + 1);
  }
  if (
    environment.PGDATA !== "/var/lib/postgresql/data" ||
    environment.POSTGRES_HOST !== "/var/run/postgresql" ||
    environment.POSTGRES_DB !== "postgres" ||
    JSON.stringify(config.config.Entrypoint) !== '["docker-entrypoint.sh"]' ||
    JSON.stringify(config.config.Cmd) !== '["postgres","-D","/etc/postgresql"]' ||
    (config.config.WorkingDir && config.config.WorkingDir !== "/")
  )
    throw new Error("Image bootstrap differs from the supported rootless contract");
  return environment;
}

/** One shell owns bootstrap, all psql calls and shutdown in the SAME PID namespace. */
export const ROOTLESS_SUPERVISOR = String.raw`
set -Eeuo pipefail
IFS= read -r POSTGRES_PASSWORD
export POSTGRES_PASSWORD PGPASSWORD="$POSTGRES_PASSWORD"
server_pid=""
cleanup() {
  original_status=$?
  trap - EXIT INT TERM HUP
  pg_status=0
  server_status=0
  if [ -n "$server_pid" ]; then
    pg_ctl -D "$PGDATA" -m fast -w -t 20 stop > /tmp/drift-output/cleanup.log 2>&1 || pg_status=$?
    if kill -0 "$server_pid" 2>/dev/null; then kill -TERM "$server_pid" 2>/dev/null || true; fi
    wait "$server_pid" 2>/dev/null || server_status=$?
  fi
  printf '%s %s\n' "$pg_status" "$server_status" > /tmp/drift-output/cleanup-status
  if [ "$pg_status" -ne 0 ] || [ "$server_status" -ne 0 ]; then exit 1; fi
  exit "$original_status"
}
trap cleanup EXIT
trap 'exit 143' TERM HUP
trap 'exit 130' INT
docker-entrypoint.sh postgres -D /etc/postgresql -c listen_addresses= > /tmp/drift-output/server.log 2>&1 &
server_pid=$!
ready=0
for ((attempt=0; attempt<60; attempt++)); do
  kill -0 "$server_pid" 2>/dev/null || exit 1
  if grep -Fq 'PostgreSQL init process complete; ready for start up.' /tmp/drift-output/server.log && pg_isready -h "$POSTGRES_HOST" -U postgres -q; then
    ready=$((ready+1))
  else
    ready=0
  fi
  if [ "$ready" -ge 5 ]; then break; fi
  sleep 2
done
[ "$ready" -ge 5 ] || exit 1
printf 'ready\n' > /tmp/drift-output/ready
while read -r sequence mode encoded_role encoded_sql; do
  [[ "$sequence" =~ ^[0-9]+$ ]] || exit 1
  [[ "$mode" == script || "$mode" == tuples ]] || exit 1
  role=$(printf '%s' "$encoded_role" | base64 -d)
  psql_command() {
    if [ "$mode" == tuples ]; then
      psql -X -h "$POSTGRES_HOST" -U "$role" -d postgres -v ON_ERROR_STOP=1 -tA -f -
    else
      psql -X -h "$POSTGRES_HOST" -U "$role" -d postgres -v ON_ERROR_STOP=1 -q -f -
    fi
  }
  status=0
  printf '%s' "$encoded_sql" | base64 -d | psql_command > "/tmp/drift-output/$sequence.out" 2> "/tmp/drift-output/$sequence.err" || status=$?
  printf '%s\n' "$status" > "/tmp/drift-output/$sequence.status.tmp"
  mv "/tmp/drift-output/$sequence.status.tmp" "/tmp/drift-output/$sequence.status"
done
`;

async function command(executable: string, args: string[], timeout: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" },
      stdio: "ignore",
      timeout,
      killSignal: "SIGKILL",
    });
    child.once("error", () => reject(new Error("Rootless tool could not start")));
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("Rootless tool failed or timed out"))));
  });
}

export type OwnedRunIdentity = { ino: number; dev: number; uid: number; marker: string };

/** Only the stopped, identity-checked disposable run may have its directory modes changed. */
export async function removeOwnedRootlessRun(run: string, expected: OwnedRunIdentity): Promise<void> {
  const canonical = await controlPath(run, true);
  if (canonical !== run || !/^drift-rootless-[A-Za-z0-9]+$/.test(path.basename(run))) {
    throw new Error("Refusing cleanup outside a canonical rootless run");
  }
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  const parent = await open(path.dirname(run), flags);
  try {
    const pinnedRun = `/proc/self/fd/${parent.fd}/${path.basename(run)}`;
    const root = await open(pinnedRun, flags);
    try {
      const info = await root.stat();
      if (
        info.ino !== expected.ino ||
        info.dev !== expected.dev ||
        info.uid !== expected.uid ||
        info.uid !== process.getuid?.()
      ) {
        throw new Error("Refusing cleanup: run identity or ownership changed");
      }
      const markerPath = `/proc/self/fd/${root.fd}/owner.json`;
      const markerInfo = await lstat(markerPath);
      if (
        !markerInfo.isFile() ||
        markerInfo.isSymbolicLink() ||
        (await readFile(markerPath, "utf8")) !== expected.marker
      ) {
        throw new Error("Refusing cleanup: run ownership marker changed");
      }
      const makeDirectoriesRemovable = async (directory: Awaited<ReturnType<typeof open>>): Promise<void> => {
        const current = await directory.stat();
        if (current.dev !== expected.dev || current.uid !== expected.uid)
          throw new Error("Refusing cleanup across foreign directory ownership or filesystem");
        // chmod the pinned directory FD, never a path that could resolve through a symlink.
        await directory.chmod((current.mode & 0o7777) | 0o700);
        const pinned = `/proc/self/fd/${directory.fd}`;
        for (const name of await readdir(pinned)) {
          const childPath = `${pinned}/${name}`;
          const childInfo = await lstat(childPath);
          if (!childInfo.isDirectory() || childInfo.isSymbolicLink()) continue;
          const child = await open(childPath, flags);
          try {
            const opened = await child.stat();
            if (opened.ino !== childInfo.ino || opened.dev !== childInfo.dev)
              throw new Error("Refusing cleanup: directory changed during inspection");
            await makeDirectoriesRemovable(child);
          } finally {
            await child.close();
          }
        }
      };
      await makeDirectoriesRemovable(root);
      const final = await lstat(pinnedRun);
      if (
        final.isSymbolicLink() ||
        final.ino !== expected.ino ||
        final.dev !== expected.dev ||
        (await readFile(markerPath, "utf8")) !== expected.marker
      ) {
        throw new Error("Refusing removal: run identity changed");
      }
      // fs.rm unlinks symlink entries; only owned directory FDs were chmodded above.
      await rm(pinnedRun, { recursive: true });
    } finally {
      await root.close();
    }
  } finally {
    await parent.close();
  }
}

export async function withRootlessReplay<T>(
  options: RootlessOptions,
  replay: (sql: ReplaySql) => Promise<T>,
): Promise<T> {
  if (process.platform !== "linux" || process.arch !== "x64" || process.getuid?.() === 0)
    throw new Error("Rootless replay supports a non-root Linux amd64 host only");
  const layout = await controlPath(options.layout, true);
  const scratch = await controlPath(options.scratchRoot, true);
  const tool = await controlPath(options.umoci, false);
  const evidenceParent = await controlPath(path.dirname(options.evidence), true);
  if (!path.isAbsolute(options.evidence) || containsControl(options.evidence))
    throw new Error("Evidence requires an absolute private output path");
  const evidenceFile = path.join(evidenceParent, path.basename(options.evidence));
  try {
    await lstat(evidenceFile);
    throw new Error("Evidence output already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const ownership = await stat(scratch);
  const evidenceOwnership = await stat(evidenceParent);
  if (
    ownership.uid !== process.getuid?.() ||
    ownership.mode & 0o077 ||
    evidenceOwnership.uid !== process.getuid?.() ||
    evidenceOwnership.mode & 0o077
  )
    throw new Error("Scratch and evidence parents must be private and owned by this user");
  if (
    layout === scratch ||
    layout.startsWith(`${scratch}${path.sep}`) ||
    scratch.startsWith(`${layout}${path.sep}`) ||
    evidenceFile.startsWith(`${layout}${path.sep}`)
  )
    throw new Error("OCI inputs and scratch parent must not overlap");
  await access(tool, constants.X_OK);
  if ((await hashStream(tool)).digest !== `sha256:${options.umociSha256}`)
    throw new Error("Trusted umoci binary hash mismatch");
  const verified = await verifyOfflineImage(layout, options.image);
  const environment = imageEnvironment(verified.config);
  const capacity = await statfs(scratch);
  if (capacity.bavail * capacity.bsize < verified.expanded_bytes + 4 * 1024 ** 3)
    throw new Error("Insufficient scratch capacity for verified rootless image and 4 GiB reserve");
  const run = await mkdtemp(path.join(scratch, "drift-rootless-"));
  const outputRoot = path.join(run, "tmp", "drift-output");
  const nonce = randomBytes(16).toString("hex");
  const marker = JSON.stringify({ worktree: await realpath(options.worktree), uid: process.getuid?.(), nonce, run });
  await writeFile(path.join(run, "owner.json"), marker, { mode: 0o600, flag: "wx" });
  const originalRun = await stat(run);
  const evidence: Record<string, unknown> = {
    backend: "rootless",
    image: options.image,
    index_digest: verified.index_digest,
    manifest_digest: verified.manifest_digest,
    config_digest: verified.config_digest,
    layers: verified.layers,
    umoci_sha256: options.umociSha256,
    worktree: options.worktree,
    run,
    status: "Running",
    environment_keys: Object.keys(environment),
    environment_values_logged: false,
    uid: 100,
    gid: 101,
    readonly_rootfs: true,
    external_network: false,
    host_tcp_port: null,
    commands: [],
    cleanup: "pending",
  };
  let child: ReturnType<typeof spawn> | undefined;
  let closed = false;
  let exit: Promise<void> | undefined;
  let childExit: { code: number | null; signal: NodeJS.Signals | null; spawn_error?: boolean } | undefined;
  const waitFor = async (file: string, timeout: number) => {
    const started = Date.now();
    while (true) {
      try {
        return await readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (closed) throw new Error("Rootless supervisor exited before completing replay");
      if (Date.now() - started > timeout) throw new Error("Rootless replay phase timed out");
      await pause(50);
    }
  };
  let password = "";
  let replayFailed = false;
  try {
    await command(
      tool,
      ["unpack", "--rootless", "--image", `${layout}:${verified.tag}`, path.join(run, "bundle")],
      300_000,
    );
    const rootfs = path.join(run, "bundle", "rootfs");
    const passwd = await readFile(await controlPath(path.join(rootfs, "etc/passwd"), false), "utf8");
    await controlPath(path.join(rootfs, "etc/postgresql"), true);
    await controlPath(path.join(rootfs, "etc/postgresql-custom"), true);
    if (!/^postgres:[^:]*:100:101:/m.test(passwd))
      throw new Error("Extracted image postgres UID/GID does not match the proven rootless mapping");
    for (const directory of ["data", "socket", "tmp"]) await mkdir(path.join(run, directory), { mode: 0o700 });
    await mkdir(outputRoot, { mode: 0o700 });
    await cp(path.join(rootfs, "etc/postgresql"), path.join(run, "config"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    await cp(path.join(rootfs, "etc/postgresql-custom"), path.join(run, "custom-config"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    const args = [
      "--unshare-user",
      "--uid",
      "100",
      "--gid",
      "101",
      "--unshare-pid",
      "--unshare-ipc",
      "--unshare-uts",
      "--unshare-net",
      "--ro-bind",
      rootfs,
      "/",
    ];
    for (const [local, guest] of [
      ["data", "/var/lib/postgresql/data"],
      ["socket", "/run/postgresql"],
      ["tmp", "/tmp"],
      ["config", "/etc/postgresql"],
      ["custom-config", "/etc/postgresql-custom"],
    ])
      args.push("--bind", path.join(run, local), guest);
    args.push("--proc", "/proc", "--dev", "/dev", "--clearenv", "--chdir", "/", "--die-with-parent", "--new-session");
    for (const [key, value] of Object.entries(environment)) args.push("--setenv", key, value);
    args.push("--", "/bin/bash", "-c", ROOTLESS_SUPERVISOR);
    const active = spawn("/usr/bin/bwrap", args, {
      env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" },
      stdio: ["pipe", "ignore", "ignore"],
    });
    child = active;
    exit = new Promise<void>((resolve) => {
      active.once("error", () => {
        childExit = { code: null, signal: null, spawn_error: true };
        closed = true;
        resolve();
      });
      active.once("exit", (code, signal) => {
        childExit = { code, signal };
        closed = true;
        resolve();
      });
    });
    password = randomBytes(16).toString("hex");
    active.stdin?.on("error", () => {
      /* The phase waiter reports process closure. */
    });
    active.stdin?.write(`${password}\n`);
    await waitFor(path.join(outputRoot, "ready"), 135_000);
    evidence.final_initialization_marker_and_five_readiness_checks = true;
    let sequence = 0;
    const result = await replay(async (role, sql, tuples = false) => {
      if (closed) throw new Error("Rootless database is not running");
      const number = ++sequence;
      active.stdin?.write(
        `${number} ${tuples ? "tuples" : "script"} ${Buffer.from(role).toString("base64")} ${Buffer.from(sql).toString("base64")}\n`,
      );
      const status = await waitFor(path.join(outputRoot, `${number}.status`), 600_000);
      (evidence.commands as unknown[]).push({ number, role, sql_sha256: sha256(sql), exit_status: Number(status) });
      if (status.trim() !== "0") throw new Error(`Rootless psql step ${number} failed (raw output is not exported)`);
      const output = path.join(outputRoot, `${number}.out`);
      if ((await stat(output)).size > MAX_OUTPUT)
        throw new Error("Rootless psql output exceeds the bounded capture limit");
      return readFile(output, "utf8");
    });
    evidence.status = "Passed";
    return result;
  } catch (error) {
    replayFailed = true;
    evidence.status = "Failed";
    evidence.reason =
      error instanceof Error ? error.message.replaceAll(password || "\0", "[redacted]") : "Rootless replay failed";
    throw error;
  } finally {
    let cleanupFailed = false;
    if (child && exit) {
      child.stdin?.end();
      const boundedExit = async (milliseconds: number) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            exit,
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, milliseconds);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      await boundedExit(30_000);
      if (!closed) {
        evidence.forced_stop = "SIGTERM";
        child.kill("SIGTERM");
        await boundedExit(5_000);
      }
      if (!closed) {
        evidence.forced_stop = "SIGKILL";
        child.kill("SIGKILL");
        await exit;
      }
      evidence.owned_supervisor_stopped = closed;
      evidence.supervisor_exit = childExit;
      let cleanupStatus = "unavailable";
      try {
        cleanupStatus = (await readFile(path.join(outputRoot, "cleanup-status"), "utf8")).trim();
      } catch {
        /* Startup/forced-stop can prevent the trap. */
      }
      evidence.guest_cleanup_status = cleanupStatus;
      cleanupFailed = Boolean(evidence.forced_stop) || childExit?.code !== 0 || cleanupStatus !== "0 0";
      if (cleanupFailed) evidence.status = "Failed";
    }
    const output = outputRoot;
    const logs: Record<string, unknown> = {};
    for (const name of ["server.log", "cleanup.log"]) {
      try {
        const bytes = await readFile(path.join(output, name));
        // Native init can create private encryption material. Never export log text.
        logs[name] = { bytes: bytes.length, sha256: sha256(bytes), text_exported: false };
      } catch {
        /* Failure can precede guest startup. */
      }
    }
    evidence.logs = logs;
    try {
      await removeOwnedRootlessRun(run, { ino: originalRun.ino, dev: originalRun.dev, uid: originalRun.uid, marker });
      evidence.cleanup = "owned run removed";
    } catch (error) {
      cleanupFailed = true;
      evidence.status = "Failed";
      evidence.cleanup = "owned run removal failed or refused";
      evidence.cleanup_error = {
        code: (error as NodeJS.ErrnoException).code ?? "OWNERSHIP_OR_CLEANUP",
        message: error instanceof Error ? error.message.replaceAll(password || "\0", "[redacted]") : "Cleanup failed",
      };
    }
    try {
      await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    } catch (error) {
      // A sidecar write failure cannot replace the original SQL/replay exception.
      if (!replayFailed) throw error;
      console.warn("Could not persist rootless failure evidence; the original replay error is preserved.");
    }
    if (cleanupFailed && !replayFailed)
      throw new Error(
        "Rootless cleanup did not confirm graceful shutdown and owned run removal; inspect private evidence",
      );
  }
}
