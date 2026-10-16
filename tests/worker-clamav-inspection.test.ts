import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentSha256 } from "../src/lib/document-ingress-safety";
import { scanClamAvBytes, type ClamAvInspectionConfiguration } from "../worker/clamav-inspection";

const boundary = vi.hoisted(() => ({ platform: "linux", exec: vi.fn() }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  platform: () => boundary.platform,
}));
vi.mock("node:child_process", () => ({ execFile: boundary.exec }));
const hash = (bytes: Uint8Array): ContentSha256 => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let root: string;
let config: ClamAvInspectionConfiguration;
let bytes: Uint8Array;
let mode: string;
let scanFile: string | undefined;
let controller: AbortController;
let filePresentAtClose: boolean;
let versions: number;
let scanStarted: (() => void) | undefined;

beforeEach(async () => {
  boundary.platform = "linux";
  boundary.exec.mockReset();
  root = await mkdtemp(path.join(tmpdir(), "psychsift-clamav-test-"));
  const scanner = path.join(root, "clamscan");
  const synthetic = Buffer.from("synthetic mocked CLI and signatures, never a real ClamAV installation");
  await writeFile(scanner, synthetic);
  const databaseDirectory = await mkdtemp(path.join(root, "signatures-"));
  const databases = [];
  for (const name of ["main.cvd", "daily.cld", "bytecode.cvd"]) {
    await writeFile(path.join(databaseDirectory, name), synthetic);
    databases.push({ name, sha256: hash(synthetic) });
  }
  config = {
    scanner: { path: scanner, sha256: hash(synthetic) },
    databaseDirectory,
    databases,
    version: "ClamAV 1.4.3/27800/Tue Oct 6 01:00:00 2026",
    signaturesUpdatedAtMs: Date.now(),
    maxSignatureAgeDays: 1,
    timeoutMs: 1000,
  };
  bytes = new Uint8Array(Buffer.from("wholly invented source bytes"));
  mode = "clean";
  scanFile = undefined;
  controller = new AbortController();
  filePresentAtClose = false;
  versions = 0;
  scanStarted = undefined;
  // Mock process controls only: these tests do not prove installed/Linux scanner detection.
  boundary.exec.mockImplementation(
    (
      file: string,
      argv: string[],
      options: {
        signal: AbortSignal;
        shell: boolean;
        maxBuffer: number;
        killSignal: string;
        env: Record<string, string>;
      },
      callback: (error: { code: number | string } | null, stdout: string, stderr: string) => void,
    ) => {
      const child = new EventEmitter();
      expect(file).toBe(config.scanner.path);
      expect(options.shell).toBe(false);
      expect(options.killSignal).toBe("SIGKILL");
      expect(options.maxBuffer).toBe(65536);
      expect(options.env.LC_ALL).toBe("C");
      const finish = (error: { code: number | string } | null, stdout = "", stderr = "") => {
        callback(error, stdout, stderr);
        // The deadline test freezes timers during real pin I/O. Its version child
        // closes immediately; the scan child still has a separately delayed close.
        if (mode === "timeout" && !scanFile) {
          queueMicrotask(() => child.emit("close", error ? 1 : 0));
          return;
        }
        setTimeout(async () => {
          if (scanFile)
            filePresentAtClose = await readFile(scanFile).then(
              () => true,
              () => false,
            );
          child.emit("close", error ? 1 : 0);
        }, 1);
      };
      queueMicrotask(async () => {
        if (argv.includes("--version")) {
          versions++;
          finish(null, mode === "version-drift" && versions === 2 ? "ClamAV 1.4.4/27800/date" : config.version);
          return;
        }
        scanFile = argv.at(-1)!;
        expect(hash(await readFile(scanFile))).toBe(hash(bytes));
        expect(argv).toContain(`--database=${config.databaseDirectory}`);
        expect(argv).toContain("--official-db-only=yes");
        expect(argv).toContain("--alert-exceeds-max=yes");
        expect(argv).toContain("--alert-encrypted=yes");
        expect(argv).toContain("--max-filesize=157286400");
        expect(argv.some((arg) => /^(--remove|--move|--copy|--log|--leave-temps)/.test(arg))).toBe(false);
        if (mode === "timeout" || mode === "cancel") {
          options.signal.addEventListener("abort", () => finish({ code: "ABORT_ERR" }), { once: true });
          if (mode === "cancel") controller.abort();
          scanStarted?.();
          return;
        }
        if (mode === "input-drift") bytes[0] ^= 1;
        if (mode === "file-drift") await writeFile(scanFile, "changed");
        if (mode === "signature-drift") await writeFile(path.join(config.databaseDirectory, "daily.cld"), "changed");
        if (mode === "executable-drift") await writeFile(config.scanner.path, "changed");
        if (mode === "extra-signature") await writeFile(path.join(config.databaseDirectory, "other.ndb"), "changed");
        if (mode === "extra-temp") await writeFile(path.join(path.dirname(scanFile), "foreign"), "retain");
        if (mode === "infected") return finish({ code: 1 }, `${scanFile}: Win.Test FOUND\n`);
        if (mode === "limits")
          return finish({ code: 1 }, `${scanFile}: Heuristics.Limits.Exceeded.MaxScanSize FOUND\n`);
        if (mode === "encrypted") return finish({ code: 1 }, `${scanFile}: Heuristics.Encrypted.PDF FOUND\n`);
        if (mode === "error") return finish({ code: 2 }, `${scanFile}: OK\n`);
        if (mode === "unavailable") return finish({ code: "ENOENT" });
        if (mode === "truncated") return finish({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }, `${scanFile}: OK\n`);
        if (mode === "ambiguous") return finish(null, "");
        if (mode === "wrong-file") return finish(null, "another: OK\n");
        if (mode === "stderr") return finish(null, `${scanFile}: OK\n`, "private diagnostic");
        finish(null, `${scanFile}: OK\n`);
      });
      return child;
    },
  );
});

afterEach(async () => {
  vi.useRealTimers();
  // Bounded named entries only; preserve production cleanup refusal behavior in tests.
  if (scanFile) {
    const directory = path.dirname(scanFile);
    for (const name of await readdir(directory).catch(() => [] as string[])) await unlink(path.join(directory, name));
    await rmdir(directory).catch(() => undefined);
  }
  for (const name of await readdir(config.databaseDirectory)) await unlink(path.join(config.databaseDirectory, name));
  await rmdir(config.databaseDirectory);
  await unlink(config.scanner.path);
  await rmdir(root);
});

const scan = () => scanClamAvBytes({ bytes, expectedSha256: hash(bytes), config, signal: controller.signal });
describe("ClamAV exact-byte adapter with mocked CLI", () => {
  it("requires exact OK output, stable pins/version and cleanup after child close", async () => {
    await expect(scan()).resolves.toEqual({
      verdict: "clean",
      scannerVersion: config.version,
      contentSha256: hash(bytes),
    });
    expect(versions).toBe(2);
    expect(filePresentAtClose).toBe(true);
    await expect(readFile(scanFile!)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([
    ["infected", "malware_detected"],
    ["error", "scan_failed"],
    ["unavailable", "scanner_unavailable"],
    ["ambiguous", "scan_ambiguous"],
    ["wrong-file", "scan_ambiguous"],
    ["stderr", "scan_ambiguous"],
    ["truncated", "scan_ambiguous"],
    ["encrypted", "scan_ambiguous"],
    ["signature-drift", "scanner_reconfigured"],
    ["version-drift", "scanner_reconfigured"],
    ["extra-signature", "scanner_reconfigured"],
    ["executable-drift", "executable_mismatch"],
    ["input-drift", "input_changed"],
    ["file-drift", "input_changed"],
    ["extra-temp", "cleanup_refused"],
    ["cancel", "scan_aborted"],
  ])("refuses %s distinctly", async (scenario, code) => {
    mode = scenario;
    await expect(scan()).rejects.toMatchObject({ code });
  });
  it("marks scan limits as incomplete inspection rather than malware", async () => {
    mode = "limits";
    await expect(scan()).rejects.toMatchObject({ code: "scan_failed", reason: "scan_limits_exceeded" });
  });
  it("bounds scan lifetime and waits for child close before deleting the payload", async () => {
    mode = "timeout";
    config = { ...config, timeoutMs: 100 };
    // Real filesystem pin work cannot consume the deadline before a child exists.
    // Advance the deadline only after the mocked scan child has its abort listener.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const started = new Promise<void>((resolve) => {
      scanStarted = resolve;
    });
    let settled = false;
    const result = scan();
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const refusal = expect(result).rejects.toMatchObject({ code: "scan_timeout" });
    await started;
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    expect(hash(await readFile(scanFile!))).toBe(hash(bytes));
    await vi.advanceTimersByTimeAsync(1);
    await refusal;
    expect(filePresentAtClose).toBe(true);
    await expect(readFile(scanFile!)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses unsupported platforms without invoking the scanner", async () => {
    boundary.platform = "win32";
    await expect(scan()).rejects.toMatchObject({ code: "unsupported_platform" });
    expect(boundary.exec).not.toHaveBeenCalled();
  });
  it("refuses stale signature observations before invocation", async () => {
    config = { ...config, signaturesUpdatedAtMs: Date.now() - 2 * 86400000 };
    await expect(scan()).rejects.toMatchObject({ code: "scanner_reconfigured" });
    expect(boundary.exec).not.toHaveBeenCalled();
  });
  it("refuses missing official database families", async () => {
    config = { ...config, databases: config.databases.slice(0, 2) };
    await expect(scan()).rejects.toMatchObject({ code: "invalid_configuration" });
  });
  it("refuses incorrect input hash and pre-cancelled requests", async () => {
    await expect(scanClamAvBytes({ bytes, expectedSha256: hash(Buffer.from("wrong")), config })).rejects.toMatchObject({
      code: "invalid_input",
    });
    controller.abort();
    await expect(scan()).rejects.toMatchObject({ code: "scan_aborted" });
    expect(boundary.exec).not.toHaveBeenCalled();
  });
  it("refuses shared input storage", async () => {
    bytes = new Uint8Array(new SharedArrayBuffer(10));
    await expect(scan()).rejects.toMatchObject({ code: "invalid_input" });
  });
});
