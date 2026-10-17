import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runBootstrapSmoke } from "../scripts/check-cloud-platform-smoke.mjs";
import { resolveNpmCli } from "../scripts/setup-codex-worktree.mjs";
import { getPlaywrightBaseUrl } from "../scripts/playwright-base-url";
import { localProjectRequestIdentityPayload } from "../src/lib/local-project-guard";
import { appName, localProjectId } from "../src/lib/local-server-utils.mjs";

afterEach(() => vi.unstubAllEnvs());

describe("cloud platform acceptance fixtures", () => {
  it("selects an explicitly staged real npm only for the bootstrap child", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cloud-platform-npm-"));
    try {
      const stagedHome = process.env.CLOUD_PLATFORM_NPM_HOME;
      const npmCli = stagedHome
        ? path.join(stagedHome, "npm", "node_modules", "npm", "bin", "npm-cli.js")
        : (resolveNpmCli() ??
          realpathSync(execFileSync("bash", ["-c", "command -v npm"], { encoding: "utf8" }).trim()));
      const fixtureHome = path.join(root, "npm home's space");
      const fixturePackages = path.join(fixtureHome, "npm", "node_modules");
      mkdirSync(fixturePackages, { recursive: true });
      symlinkSync(
        path.dirname(path.dirname(npmCli)),
        path.join(fixturePackages, "npm"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const callerAppData = path.join(root, "unrelated caller home");
      const rejectedBin = path.join(root, "unintended npm");
      mkdirSync(rejectedBin);
      writeFileSync(path.join(rejectedBin, "npm"), "#!/bin/sh\nexit 97\n", { mode: 0o755 });
      vi.stubEnv("APPDATA", callerAppData);
      vi.stubEnv("PATH", `${rejectedBin}${path.delimiter}${process.env.PATH}`);
      vi.stubEnv("CLOUD_PLATFORM_NPM_HOME", fixtureHome);
      expect(runBootstrapSmoke().donorCopied).toBe(true);
      expect(process.env.APPDATA).toBe(callerAppData);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 30_000);

  it("refuses an explicitly unavailable npm home instead of using ambient npm", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cloud-platform-missing-npm-"));
    try {
      vi.stubEnv("CLOUD_PLATFORM_NPM_HOME", root);
      expect(() => runBootstrapSmoke()).toThrow(/CLOUD_PLATFORM_NPM_HOME.*npm-cli/u);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("retains the exact npm runtime check for an explicit home with the wrong version", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cloud-platform-wrong-npm-"));
    try {
      const bin = path.join(root, "npm", "node_modules", "npm", "bin");
      mkdirSync(bin, { recursive: true });
      // Negative fixture only: a real matching npm supplies every successful bootstrap.
      writeFileSync(path.join(bin, "npm-cli.js"), 'process.stdout.write("0.0.0\\n");\n');
      vi.stubEnv("CLOUD_PLATFORM_NPM_HOME", root);
      expect(() => runBootstrapSmoke()).toThrow(/npm .* is required; detected 0\.0\.0/u);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("executes the bootstrap in a real shell and isolated Git worktree containing spaces and apostrophes", () => {
    const result = runBootstrapSmoke();
    expect(result).toMatchObject({
      platform: process.platform,
      missingDependencies: true,
      donorCopied: true,
      hooksInstalled: true,
      existingInstall: true,
      mismatchedDonorRejected: true,
    });
  }, 30_000);

  it.each([
    {
      name: "matching project",
      app: appName,
      project: localProjectId(path.resolve(__dirname, "..")),
      safe: true,
      accepted: true,
    },
    {
      name: "other application",
      app: "Other app",
      project: localProjectId(path.resolve(__dirname, "..")),
      safe: true,
      accepted: false,
    },
    { name: "other checkout", app: appName, project: "clinical-kb:another-checkout", safe: true, accepted: false },
    {
      name: "unsafe local origin",
      app: appName,
      project: localProjectId(path.resolve(__dirname, "..")),
      safe: false,
      accepted: false,
    },
  ])(
    "checks actual HTTP identity through a synthetic forwarding proxy: $name",
    async ({ app, project, safe, accepted }) => {
      // A separate process serves the fixture because the real URL helper uses a synchronous HTTP child.
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import http from "node:http";
      const payload = JSON.parse(process.env.SMOKE_IDENTITY);
      const backend = http.createServer((request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(request.url === "/api/local-project-id" ? payload : {}));
      });
      backend.listen(0, "127.0.0.1", () => {
        const proxy = http.createServer((request, response) => {
          const upstream = http.get({hostname:"127.0.0.1", port:backend.address().port, path:request.url}, remote => {
            response.writeHead(remote.statusCode, remote.headers); remote.pipe(response);
          });
          upstream.on("error", () => { response.writeHead(502); response.end(); });
        });
        proxy.listen(0, "127.0.0.1", () => console.log(proxy.address().port));
      });
    `,
        ],
        {
          env: {
            ...process.env,
            SMOKE_IDENTITY: JSON.stringify({
              appName: app,
              projectId: project,
              localServer: { safeLocalOrigin: safe },
            }),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      try {
        const port = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Synthetic forwarding fixture did not start")), 5_000);
          child.once("error", reject);
          child.stdout.once("data", (value: Buffer) => {
            clearTimeout(timer);
            resolve(value.toString().trim());
          });
        });
        vi.stubEnv("PLAYWRIGHT_BASE_URL", `http://127.0.0.1:${port}`);
        if (accepted) expect(getPlaywrightBaseUrl({ allowEnsure: false })).toBe(`http://127.0.0.1:${port}`);
        else expect(() => getPlaywrightBaseUrl({ allowEnsure: false })).toThrow(/local-project-id guard/);
      } finally {
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("exit", () => resolve());
          child.kill();
        });
      }
    },
  );

  it("keeps forwarded request headers separate from the identity URL and rejects an unsafe local caller", () => {
    const forwarded = { "x-forwarded-host": "preview.invalid", "x-forwarded-proto": "https" };
    const managed = localProjectRequestIdentityPayload(
      new Request("http://127.0.0.1:4383/api/local-project-id", { headers: forwarded }),
    );
    expect(managed.localServer).toMatchObject({
      currentUrl: "http://127.0.0.1:4383",
      currentPort: 4383,
      safeLocalOrigin: true,
    });
    const unsafe = localProjectRequestIdentityPayload(
      new Request("http://127.0.0.1:4383/api/local-project-id", {
        headers: { ...forwarded, origin: "http://localhost:3000" },
      }),
    );
    expect(unsafe.localServer).toMatchObject({ unsafeLocalCaller: "http://localhost:3000", safeLocalOrigin: false });
    expect(
      localProjectRequestIdentityPayload(
        new Request("http://127.0.0.1:3000/api/local-project-id", { headers: forwarded }),
      ).localServer.safeLocalOrigin,
    ).toBe(false);
  });

  it.each(["https://preview.invalid", "https://preview.invalid:8443", "https://192.0.2.1", "https://localhost."])(
    "documents HTTPS opt-in acceptance without claiming identity verification: %s",
    (url) => {
      vi.stubEnv("PLAYWRIGHT_BASE_URL", url);
      vi.stubEnv("ALLOW_PREVIEW_URL", "true");
      expect(getPlaywrightBaseUrl({ allowEnsure: false })).toBe(url);
    },
  );

  it.each([
    "https://localhost:4383",
    "https://127.0.0.1:4383",
    "https://[::1]:4383",
    "http://preview.invalid",
    "https://preview.invalid/path",
    "https://user:pass@preview.invalid",
    "https://preview.invalid/?token=1",
  ])("refuses unsupported preview origins: %s", (url) => {
    vi.stubEnv("PLAYWRIGHT_BASE_URL", url);
    vi.stubEnv("ALLOW_PREVIEW_URL", "true");
    expect(() => getPlaywrightBaseUrl({ allowEnsure: false })).toThrow();
  });
});
