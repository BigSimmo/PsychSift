import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, open, readFile, readdir, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import path from "node:path";
import { types } from "node:util";
import type { ContentSha256 } from "../src/lib/document-ingress-safety";
import { MalwareInspectionRefusal } from "./malware-inspection";

/** Server-owned pins. Provision signatures separately; this adapter never updates/downloads them. */
export type ClamAvInspectionConfiguration = Readonly<{
  scanner: Readonly<{ path: string; sha256: ContentSha256 }>;
  databaseDirectory: string;
  databases: readonly Readonly<{ name: string; sha256: ContentSha256 }>[];
  /** Exact clamscan --database=... --version line, including daily database version/date. */
  version: string;
  signaturesUpdatedAtMs: number;
  maxSignatureAgeDays: number;
  timeoutMs: number;
}>;

/** A scan limit is incomplete inspection, not a claim that malware was found. */
export class ClamAvScanLimitRefusal extends MalwareInspectionRefusal {
  readonly reason = "scan_limits_exceeded";
  constructor() {
    super("scan_failed");
  }
}

/** Safe control diagnostics only; never include scanner output, bytes or source names. */
export class ClamAvCleanupRefusal extends MalwareInspectionRefusal {
  constructor(
    readonly diagnostics: Readonly<{
      originalScanCode: MalwareInspectionRefusal["code"] | null;
      deadlineAborted: boolean;
      stage: "directory_identity" | "file_identity" | "unlink_file" | "remove_empty_directory";
      systemCode: string | null;
      directoryName: string;
      fileName: "payload.bin";
      directoryIdentityMatched: boolean;
      fileIdentityMatched: boolean;
      remainingEntryCount: number | null;
      remainingEntryNames: readonly string[] | null;
    }>,
  ) {
    super("cleanup_refused");
  }
}

const MAX_BYTES = 157286400;
const HASH = /^sha256:[a-f0-9]{64}$/;
const digest = (bytes: Uint8Array): ContentSha256 => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const prototype = Object.getPrototypeOf(Uint8Array.prototype);
const bufferGetter = Object.getOwnPropertyDescriptor(prototype, "buffer")!.get!;
const offsetGetter = Object.getOwnPropertyDescriptor(prototype, "byteOffset")!.get!;
const lengthGetter = Object.getOwnPropertyDescriptor(prototype, "byteLength")!.get!;

function snapshot(bytes: Uint8Array): Uint8Array {
  if (types.isProxy(bytes) || !types.isUint8Array(bytes)) throw new MalwareInspectionRefusal("invalid_input");
  const buffer = Reflect.apply(bufferGetter, bytes, []) as ArrayBuffer;
  const offset = Reflect.apply(offsetGetter, bytes, []) as number;
  const length = Reflect.apply(lengthGetter, bytes, []) as number;
  if (types.isSharedArrayBuffer(buffer) || length < 1 || length > MAX_BYTES)
    throw new MalwareInspectionRefusal("invalid_input");
  return new Uint8Array(new Uint8Array(buffer, offset, length));
}

/** Wait for direct-child close even after timeout/cancellation, before cleanup. No shell/daemon. */
function execute(file: string, argv: string[], signal: AbortSignal) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    let closed = false;
    let completed = false;
    let result: { exitCode: number; stdout: string; stderr: string } | undefined;
    let failure: MalwareInspectionRefusal | undefined;
    const finish = () => {
      if (!closed || !completed) return;
      if (failure || !result) reject(failure ?? new MalwareInspectionRefusal("scanner_unavailable"));
      else resolve(result);
    };
    const child = execFile(
      file,
      argv,
      {
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        maxBuffer: 65536,
        signal,
        killSignal: "SIGKILL",
        // Stable output language; no inherited loader overrides or scanner environment settings.
        env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", NODE_ENV: "production" },
      },
      (error, stdout, stderr) => {
        completed = true;
        if (error && typeof error.code !== "number")
          failure = new MalwareInspectionRefusal(
            error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "scan_ambiguous" : "scanner_unavailable",
          );
        else result = { exitCode: error ? Number(error.code) : 0, stdout, stderr };
        finish();
      },
    );
    child.once("close", () => {
      closed = true;
      finish();
    });
  });
}

/** Hash with bounded memory and reject replacement/size drift across the open file handle. */
async function pinnedFile(file: string, expected: ContentSha256, maximum: number, check: () => void) {
  check();
  const stat = await lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size < 1 ||
    stat.size > maximum ||
    path.resolve(await realpath(file)) !== path.resolve(file)
  )
    throw new Error("pin");
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat();
    if (opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error("pin");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let total = 0;
    for (;;) {
      check();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maximum) throw new Error("pin");
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    const named = await lstat(file);
    if (
      total !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      named.ino !== stat.ino ||
      named.dev !== stat.dev ||
      `sha256:${hash.digest("hex")}` !== expected
    )
      throw new Error("pin");
  } finally {
    await handle.close();
  }
  return `${stat.dev}/${stat.ino}/${stat.size}/${stat.mtimeMs}/${stat.ctimeMs}`;
}

/** Local Linux clamscan only. Caller must isolate execution/network and provide immutable server-owned pins. */
export async function scanClamAvBytes(args: {
  bytes: Uint8Array;
  expectedSha256: ContentSha256;
  config: ClamAvInspectionConfiguration;
  signal?: AbortSignal;
}): Promise<Readonly<{ verdict: "clean"; scannerVersion: string; contentSha256: ContentSha256 }>> {
  if (platform() !== "linux") throw new MalwareInspectionRefusal("unsupported_platform");
  const config = Object.freeze({
    ...args.config,
    scanner: Object.freeze({ ...args.config.scanner }),
    databases: Object.freeze(args.config.databases.map((database) => Object.freeze({ ...database }))),
  });
  const expected = args.expectedSha256;
  if (
    !HASH.test(expected) ||
    !HASH.test(config.scanner.sha256) ||
    !path.isAbsolute(config.scanner.path) ||
    path.basename(config.scanner.path) !== "clamscan" ||
    !path.isAbsolute(config.databaseDirectory) ||
    config.databases.length !== 3 ||
    config.databases
      .map((entry) => entry.name.replace(/\.(cvd|cld)$/, ""))
      .sort()
      .join() !== "bytecode,daily,main" ||
    config.databases.some(
      (entry) => !/^(main|daily|bytecode)\.(cvd|cld)$/.test(entry.name) || !HASH.test(entry.sha256),
    ) ||
    !/^ClamAV \d+\.\d+\.\d+(?:[^/\r\n]*)\/\d+\/[^\r\n]+$/.test(config.version) ||
    config.version.length > 200 ||
    !Number.isSafeInteger(config.signaturesUpdatedAtMs) ||
    config.signaturesUpdatedAtMs <= 0 ||
    !Number.isInteger(config.maxSignatureAgeDays) ||
    config.maxSignatureAgeDays < 1 ||
    config.maxSignatureAgeDays > 7 ||
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 100 ||
    config.timeoutMs > 120000
  )
    throw new MalwareInspectionRefusal("invalid_configuration");
  const copied = snapshot(args.bytes);
  if (digest(copied) !== expected) throw new MalwareInspectionRefusal("invalid_input");
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), config.timeoutMs);
  const signal = args.signal ? AbortSignal.any([args.signal, deadline.signal]) : deadline.signal;
  const checkInterrupt = () => {
    if (args.signal?.aborted) throw new MalwareInspectionRefusal("scan_aborted");
    if (deadline.signal.aborted) throw new MalwareInspectionRefusal("scan_timeout");
    const age = Date.now() - config.signaturesUpdatedAtMs;
    if (age < 0 || age > config.maxSignatureAgeDays * 86400000)
      throw new MalwareInspectionRefusal("scanner_reconfigured");
  };
  const check = () => {
    checkInterrupt();
    if (digest(snapshot(args.bytes)) !== expected) throw new MalwareInspectionRefusal("input_changed");
  };
  const pins = async () => {
    let scanner: string;
    try {
      scanner = await pinnedFile(config.scanner.path, config.scanner.sha256, 67108864, checkInterrupt);
    } catch (error) {
      if (error instanceof MalwareInspectionRefusal) throw error;
      throw new MalwareInspectionRefusal("executable_mismatch");
    }
    try {
      const dir = await lstat(config.databaseDirectory);
      if (
        !dir.isDirectory() ||
        dir.isSymbolicLink() ||
        path.resolve(await realpath(config.databaseDirectory)) !== path.resolve(config.databaseDirectory) ||
        (await readdir(config.databaseDirectory)).sort().join() !==
          config.databases
            .map((entry) => entry.name)
            .sort()
            .join()
      )
        throw new Error("pin");
      const identities = [];
      for (const entry of config.databases)
        identities.push(
          await pinnedFile(path.join(config.databaseDirectory, entry.name), entry.sha256, 536870912, checkInterrupt),
        );
      check();
      return `${scanner};${dir.dev}/${dir.ino};${identities.join(";")}`;
    } catch (error) {
      if (error instanceof MalwareInspectionRefusal) throw error;
      throw new MalwareInspectionRefusal("scanner_reconfigured");
    }
  };
  const version = async () => {
    const result = await execute(config.scanner.path, [`--database=${config.databaseDirectory}`, "--version"], signal);
    if (result.exitCode !== 0 || result.stderr.trim()) throw new MalwareInspectionRefusal("scanner_unavailable");
    if (result.stdout.trim() !== config.version) throw new MalwareInspectionRefusal("scanner_reconfigured");
  };
  let directory: string | undefined;
  let file: string | undefined;
  let directoryStat: Awaited<ReturnType<typeof lstat>> | undefined;
  let fileStat: Awaited<ReturnType<typeof lstat>> | undefined;
  let originalScanCode: MalwareInspectionRefusal["code"] | null = null;
  const verify = async () => {
    check();
    const dir = await lstat(directory!);
    const stat = await lstat(file!);
    if (
      !dir.isDirectory() ||
      dir.isSymbolicLink() ||
      dir.dev !== directoryStat!.dev ||
      dir.ino !== directoryStat!.ino ||
      path.resolve(await realpath(directory!)) !== path.resolve(directory!) ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.dev !== fileStat!.dev ||
      stat.ino !== fileStat!.ino ||
      stat.nlink !== 1 ||
      stat.size !== copied.length ||
      digest(await readFile(file!)) !== expected
    )
      throw new MalwareInspectionRefusal("input_changed");
  };
  try {
    check();
    const before = await pins();
    await version();
    directory = await mkdtemp(path.join(tmpdir(), "psychsift-clamav-"));
    directoryStat = await lstat(directory);
    file = path.join(directory, "payload.bin");
    await writeFile(file, copied, { flag: "wx", mode: 0o600 });
    fileStat = await lstat(file);
    await verify();
    const result = await execute(
      config.scanner.path,
      [
        `--database=${config.databaseDirectory}`,
        "--official-db-only=yes",
        "--bytecode-unsigned=no",
        `--fail-if-cvd-older-than=${config.maxSignatureAgeDays}`,
        "--no-summary",
        "--stdout",
        "--scan-archive=yes",
        "--alert-encrypted=yes",
        "--alert-exceeds-max=yes",
        "--disable-cache",
        `--max-filesize=${MAX_BYTES}`,
        "--max-scansize=314572800",
        "--max-files=10000",
        "--max-recursion=32",
        "--bytecode-timeout=1000",
        "--max-scantime=60000",
        "--follow-file-symlinks=0",
        "--follow-dir-symlinks=0",
        `--tempdir=${directory}`,
        "--",
        file,
      ],
      signal,
    );
    check();
    await verify();
    if ((await pins()) !== before) throw new MalwareInspectionRefusal("scanner_reconfigured");
    await version();
    check();
    if (result.exitCode === 2) throw new MalwareInspectionRefusal("scan_failed");
    const output = result.stdout.trim();
    if (result.stderr.trim()) throw new MalwareInspectionRefusal("scan_ambiguous");
    if (
      result.exitCode === 1 &&
      output.startsWith(`${file}: `) &&
      /^.+ FOUND$/.test(output.slice(file.length + 2)) &&
      !output.includes("\n")
    ) {
      if (output.includes("Heuristics.Limits.Exceeded")) throw new ClamAvScanLimitRefusal();
      if (output.includes("Heuristics.Encrypted.")) throw new MalwareInspectionRefusal("scan_ambiguous");
      throw new MalwareInspectionRefusal("malware_detected");
    }
    if (result.exitCode !== 0 || output !== `${file}: OK`) throw new MalwareInspectionRefusal("scan_ambiguous");
    return Object.freeze({ verdict: "clean", scannerVersion: config.version, contentSha256: expected });
  } catch (error) {
    let failure =
      error instanceof MalwareInspectionRefusal ? error : new MalwareInspectionRefusal("scanner_unavailable");
    try {
      check();
    } catch (changed) {
      if (changed instanceof MalwareInspectionRefusal) failure = changed;
    }
    originalScanCode = failure.code;
    throw failure;
  } finally {
    clearTimeout(timer);
    // Remove only our named file and empty directory; preserve unexpected scanner/concurrent files.
    if (directory && directoryStat) {
      const cleanupDirectory = directory;
      let stage: ClamAvCleanupRefusal["diagnostics"]["stage"] = "directory_identity";
      let directoryIdentityMatched = false;
      let fileIdentityMatched = false;
      try {
        const dir = await lstat(directory);
        if (
          !dir.isDirectory() ||
          dir.isSymbolicLink() ||
          dir.dev !== directoryStat.dev ||
          dir.ino !== directoryStat.ino ||
          path.resolve(await realpath(directory)) !== path.resolve(directory)
        )
          throw new Error("cleanup");
        directoryIdentityMatched = true;
        if (file && fileStat) {
          stage = "file_identity";
          const stat = await lstat(file);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            stat.dev !== fileStat.dev ||
            stat.ino !== fileStat.ino
          )
            throw new Error("cleanup");
          fileIdentityMatched = true;
          stage = "unlink_file";
          await unlink(file);
        }
        stage = "remove_empty_directory";
        await rmdir(directory);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        // Inspect only the still-owned directory and record a count, never foreign names/content.
        let remainingEntryCount: number | null = null;
        let remainingEntryNames: readonly string[] | null = null;
        if (directoryIdentityMatched) {
          const current = await lstat(directory).catch(() => undefined);
          if (
            current?.isDirectory() &&
            !current.isSymbolicLink() &&
            current.dev === directoryStat.dev &&
            current.ino === directoryStat.ino &&
            (await realpath(directory).then(
              (resolved) => path.resolve(resolved) === path.resolve(cleanupDirectory),
              () => false,
            ))
          )
            await readdir(directory).then(
              (entries) => {
                remainingEntryCount = entries.length;
                // Only known task/ClamAV-generated names; arbitrary foreign/source names stay redacted.
                remainingEntryNames = Object.freeze(
                  entries
                    .sort()
                    .slice(0, 32)
                    .map((name) =>
                      name === "payload.bin" || /^clamav-[a-zA-Z0-9_-]{1,100}(?:\.tmp)?$/.test(name)
                        ? name
                        : "<redacted-name>",
                    ),
                );
              },
              () => undefined,
            );
        }
        throw new ClamAvCleanupRefusal(
          Object.freeze({
            originalScanCode,
            deadlineAborted: deadline.signal.aborted,
            stage,
            systemCode: typeof code === "string" && /^[A-Z0-9_]{1,60}$/.test(code) ? code : null,
            directoryName: path.basename(directory),
            fileName: "payload.bin",
            directoryIdentityMatched,
            fileIdentityMatched,
            remainingEntryCount,
            remainingEntryNames,
          }),
        );
      }
    }
  }
}
