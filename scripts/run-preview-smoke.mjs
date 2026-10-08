#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { childProcessExitCode } from "./child-process-result.mjs";

/**
 * Live Browser Testing — Preview Deploy Smoke Runner.
 *
 * Runs the focused user journeys test suite (or custom specs) against a live
 * preview deployment (Vercel, Netlify, Railway, or staging environment)
 * without spinning up or compiling a local server.
 *
 * Usage:
 *   node scripts/run-preview-smoke.mjs --url https://psych-sift-pr-123.vercel.app
 *   PREVIEW_URL=https://deploy-preview-42--psychsift.netlify.app npm run test:e2e:preview
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const playwrightBin = path.join(projectRoot, "node_modules", "playwright", "cli.js");

const rawArgs = process.argv.slice(2);
let previewUrl =
  process.env.PREVIEW_URL || process.env.PLAYWRIGHT_PREVIEW_URL || process.env.VERCEL_URL || process.env.NETLIFY_URL;
const forwardArgs = [];

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === "--url" && i + 1 < rawArgs.length) {
    previewUrl = rawArgs[i + 1];
    i++;
  } else if (arg.startsWith("--url=")) {
    previewUrl = arg.slice("--url=".length);
  } else {
    forwardArgs.push(arg);
  }
}

if (!previewUrl) {
  console.error("Usage: node scripts/run-preview-smoke.mjs --url <https://preview-url> [playwright-args...]");
  console.error("Or set PREVIEW_URL / PLAYWRIGHT_PREVIEW_URL / VERCEL_URL in your environment.");
  process.exit(1);
}

// Normalise URL to include protocol
let targetUrl = previewUrl.trim();
if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
  targetUrl = `https://${targetUrl}`;
}

try {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
} catch (error) {
  console.error(`Invalid preview URL: "${targetUrl}" (${error instanceof Error ? error.message : String(error)})`);
  process.exit(1);
}

console.log(`[preview-smoke] Targeting preview deployment: ${targetUrl}`);

// Default to user journeys spec and chromium project if none specified
const testArgs = forwardArgs.length > 0 ? forwardArgs : ["tests/ui-user-journeys.spec.ts", "--project=chromium"];

const env = {
  ...process.env,
  PLAYWRIGHT_BASE_URL: targetUrl,
  ALLOW_PREVIEW_URL: "true",
  SKIP_REMOTE_IDENTITY_CHECK: "true",
};

const result = spawnSync(process.execPath, [playwrightBin, "test", ...testArgs], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});

const exitCode = childProcessExitCode(result);
process.exit(exitCode);
