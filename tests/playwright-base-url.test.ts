import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appName, localProjectId } from "../src/lib/local-server-utils.mjs";
import { getPlaywrightBaseUrl } from "../scripts/playwright-base-url";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(), spawnSync: vi.fn() }));

describe("explicit Playwright target approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of [
      "PLAYWRIGHT_BASE_URL",
      "ALLOW_PREVIEW_URL",
      "PLAYWRIGHT_PREVIEW_URL",
      "PREVIEW_URL",
      "VERCEL_URL",
    ]) {
      vi.stubEnv(key, "");
    }
    vi.mocked(execFileSync).mockReturnValue(
      JSON.stringify({
        appName,
        projectId: localProjectId(path.resolve(__dirname, "..")),
        localServer: { safeLocalOrigin: true },
      }),
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["", "false", "1"])("rejects HTTPS without the literal preview opt-in (%s)", (approval) => {
    vi.stubEnv("PLAYWRIGHT_BASE_URL", "https://approved-preview.invalid");
    vi.stubEnv("ALLOW_PREVIEW_URL", approval);
    expect(() => getPlaywrightBaseUrl({ allowEnsure: false })).toThrow(/ALLOW_PREVIEW_URL=true/);
    expect(execFileSync).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("accepts an explicit HTTPS preview origin only with opt-in", () => {
    vi.stubEnv("PLAYWRIGHT_BASE_URL", "https://approved-preview.invalid/");
    vi.stubEnv("ALLOW_PREVIEW_URL", "true");
    expect(getPlaywrightBaseUrl({ allowEnsure: false })).toBe("https://approved-preview.invalid");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it.each(["PLAYWRIGHT_PREVIEW_URL", "PREVIEW_URL", "VERCEL_URL"])("ignores ambient %s", (key) => {
    vi.stubEnv(key, "https://ambient-preview.invalid");
    vi.stubEnv("ALLOW_PREVIEW_URL", "true");
    expect(() => getPlaywrightBaseUrl({ allowEnsure: false })).toThrow(/runner-owned local server/);
    expect(execFileSync).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it.each([
    "http://remote.invalid:4383",
    "file:///tmp/app",
    "javascript:alert(1)",
    "ftp://remote.invalid",
    "https://user:secret@remote.invalid",
    "https://remote.invalid/path",
    "https://remote.invalid/?query=1",
    "https://remote.invalid/#fragment",
    "not a URL",
    "https://localhost:4383",
    "https://127.0.0.1:4383",
    "https://[::1]:4383",
  ])("rejects unsafe or non-origin targets even with opt-in: %s", (url) => {
    vi.stubEnv("PLAYWRIGHT_BASE_URL", url);
    vi.stubEnv("ALLOW_PREVIEW_URL", "true");
    expect(() => getPlaywrightBaseUrl({ allowEnsure: false })).toThrow();
    expect(execFileSync).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it.each(["http://localhost:4383", "http://127.0.0.1:4383"])("verifies the local identity for %s", (url) => {
    vi.stubEnv("PLAYWRIGHT_BASE_URL", url);
    expect(getPlaywrightBaseUrl({ allowEnsure: false })).toBe(url);
    expect(execFileSync).toHaveBeenCalledOnce();
    expect(vi.mocked(execFileSync).mock.calls[0][1]).toContain(url);
  });

  it("rejects another local project without bypassing its identity guard", () => {
    vi.stubEnv("PLAYWRIGHT_BASE_URL", "http://localhost:4383");
    vi.stubEnv("ALLOW_PREVIEW_URL", "true");
    vi.mocked(execFileSync).mockReturnValue(
      JSON.stringify({ appName, projectId: "another-project", localServer: { safeLocalOrigin: true } }),
    );
    expect(() => getPlaywrightBaseUrl({ allowEnsure: false })).toThrow(/local-project-id guard/);
  });
});
