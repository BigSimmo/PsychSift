import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { appName, localProjectId, stableProjectPort } from "../src/lib/local-server-utils.mjs";

const projectRoot = path.resolve(__dirname, "..");
const ensureScript = path.join(projectRoot, "scripts", "ensure-local-server.mjs");
const localUrlPattern = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;
const identityScript = `
const http = require("node:http");
const https = require("node:https");
const rawUrl = process.argv[1] + "/api/local-project-id";
const client = rawUrl.startsWith("https:") ? https : http;
const request = client.get(rawUrl, { timeout: 15000 }, (response) => {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => { body += chunk; });
  response.on("end", () => {
    if (response.statusCode !== 200) process.exit(2);
    process.stdout.write(body);
  });
});
request.on("timeout", () => { request.destroy(); process.exit(3); });
request.on("error", () => process.exit(4));
`;

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function verifyLocalProjectIdentity(baseUrl: string) {
  let lastError: unknown = null;
  let output = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      output = execFileSync(process.execPath, ["-e", identityScript, baseUrl], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
        timeout: 20_000,
      }).trim();
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2) sleepSync(750);
    }
  }

  if (!output) {
    throw lastError instanceof Error ? lastError : new Error(`Could not verify local project identity: ${baseUrl}`);
  }

  const payload = JSON.parse(output) as {
    appName?: string;
    projectId?: string;
    localServer?: { safeLocalOrigin?: boolean };
  };

  if (
    payload.appName !== appName ||
    payload.projectId !== localProjectId(projectRoot) ||
    payload.localServer?.safeLocalOrigin !== true
  ) {
    throw new Error(`Ensured URL failed /api/local-project-id guard: ${baseUrl}`);
  }
}

function tryVerifiedLocalProjectUrl(baseUrl: string) {
  try {
    verifyLocalProjectIdentity(baseUrl);
    return baseUrl;
  } catch {
    return null;
  }
}

function findExistingLocalProjectUrl() {
  const stablePort = stableProjectPort(projectRoot);
  // Prefer localhost so dev HMR matches ensure-local-server's printed URL.
  return (
    tryVerifiedLocalProjectUrl(`http://localhost:${stablePort}`) ??
    tryVerifiedLocalProjectUrl(`http://127.0.0.1:${stablePort}`)
  );
}

export function getPlaywrightBaseUrl({ allowEnsure = true }: { allowEnsure?: boolean } = {}) {
  // Shared config never derives a target from ambient deployment variables.
  // The dedicated preview runner supplies both an explicit URL and opt-in.
  const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
  if (configuredBaseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(configuredBaseUrl);
    } catch {
      throw new Error("PLAYWRIGHT_BASE_URL must be a valid origin URL.");
    }
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("PLAYWRIGHT_BASE_URL must contain only an origin, without credentials, path, query or fragment.");
    }
    const isLocal = localUrlPattern.test(parsed.origin);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    const isPreview = process.env.ALLOW_PREVIEW_URL === "true" && parsed.protocol === "https:" && !loopback;
    if (!isLocal && !isPreview) {
      throw new Error(
        "PLAYWRIGHT_BASE_URL requires a verified localhost origin, or an HTTPS preview origin with ALLOW_PREVIEW_URL=true.",
      );
    }
    if (isLocal) {
      verifyLocalProjectIdentity(parsed.origin);
    }
    return parsed.origin;
  }

  if (!allowEnsure) {
    throw new Error(
      "Playwright requires a runner-owned local server. Use the repository npm scripts instead of invoking the Playwright CLI directly.",
    );
  }

  const existingUrl = findExistingLocalProjectUrl();
  if (existingUrl) return existingUrl;

  const result = spawnSync(process.execPath, [ensureScript, "--print-url"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = (result.stdout ?? "").trim();

  if (!localUrlPattern.test(output)) {
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const diagnostic = (result.stderr ?? "").trim();
      throw new Error(
        `ensure-local-server failed before printing a localhost URL${diagnostic ? `: ${diagnostic}` : "."}`,
      );
    }
    throw new Error(`Expected ensure-local-server to print a localhost URL, received: ${output || "<empty>"}`);
  }

  verifyLocalProjectIdentity(output);
  return output;
}
