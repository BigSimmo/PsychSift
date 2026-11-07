import { once } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: boundary.spawn,
}));
import { terminateProcessTree } from "../src/lib/extractors/document";
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it.skipIf(process.platform !== "win32")("bounds and kills the helper-owned taskkill process", async () => {
  const native = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  let killer: ChildProcess | undefined;
  let killed: Promise<unknown> | undefined;
  let closed = false;
  boundary.spawn.mockImplementation((_command: string, _args: string[], options: SpawnOptions) => {
    // A real, owned sleeper stands in for a hung taskkill executable. Node's
    // actual spawn timeout must kill it; no system taskkill is invoked.
    killer = native.spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], options);
    killed = once(killer, "close").then(() => {
      closed = true;
    });
    return killer;
  });
  try {
    const completion = terminateProcessTree({ pid: 987654, exitCode: null, kill: vi.fn() } as unknown as ChildProcess, {
      taskkillTimeoutMs: 50,
    });
    await Promise.race([completion, new Promise((resolve) => setTimeout(resolve, 300))]);
    expect(closed).toBe(true);
    expect(boundary.spawn.mock.calls[0][2]).toMatchObject({ timeout: 50, killSignal: "SIGKILL" });
  } finally {
    if (killer && !closed) killer.kill("SIGKILL");
    await killed;
  }
});
