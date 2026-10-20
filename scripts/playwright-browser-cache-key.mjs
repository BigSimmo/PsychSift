import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const engineBrowsers = {
  chromium: ["chromium", "chromium-headless-shell", "ffmpeg"],
  firefox: ["firefox", "ffmpeg"],
  webkit: ["webkit", "ffmpeg"],
};

/** Browser archives are independent of npm's other dependencies and Playwright's JS version. */
export function browserCacheKey(metadata, { engine, runnerOS, architecture, platform }) {
  if (!Object.hasOwn(engineBrowsers, engine)) throw new Error(`Unsupported Playwright engine: ${engine}`);
  const names = engineBrowsers[engine];
  for (const [label, value] of Object.entries({ runnerOS, architecture, platform })) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9._-]+$/.test(value)) {
      throw new Error(`Invalid browser cache ${label}`);
    }
  }
  if (!Array.isArray(metadata?.browsers)) throw new Error("Playwright browsers.json has no browser inventory");
  const required = runnerOS === "Windows" ? [...names, "winldd"] : names;
  const revisions = required.map((name) => {
    const entries = metadata.browsers.filter((entry) => entry.name === name);
    if (entries.length !== 1 || !/^\d+$/.test(String(entries[0].revision ?? ""))) {
      throw new Error(`Playwright browsers.json must contain one valid ${name} revision`);
    }
    const entry = entries[0];
    const overrides = entry.revisionOverrides ?? {};
    if (typeof overrides !== "object" || Array.isArray(overrides)) {
      throw new Error(`Invalid ${name} revision overrides`);
    }
    const revisionOverrides = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right));
    if (revisionOverrides.some(([key, value]) => !/^[a-zA-Z0-9._-]+$/.test(key) || !/^\d+$/.test(String(value)))) {
      throw new Error(`Invalid ${name} revision overrides`);
    }
    return { name, revision: String(entry.revision), revisionOverrides };
  });
  // Distribution identity matters for WebKit's platform-specific Linux archives;
  // overrides also participate so a platform-specific revision can never reuse stale bytes.
  const digest = createHash("sha256").update(JSON.stringify({ platform, revisions })).digest("hex");
  return `playwright-v1-${runnerOS}-${architecture}-${engine}-${digest}`;
}

export function browserCachePlatform() {
  const override = process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE;
  if (override) return override;
  if (process.platform === "linux") {
    const release = readFileSync("/etc/os-release", "utf8");
    const field = (name) => new RegExp(`^${name}=["']?([a-zA-Z0-9._-]+)["']?$`, "m").exec(release)?.[1];
    const distribution = field("ID");
    const version = field("VERSION_ID");
    if (!distribution || !version) throw new Error("Cannot identify the Linux browser archive platform");
    return `${distribution}-${version}`;
  }
  return `${process.platform}-${os.release()}`;
}

if (isDirectEntrypoint(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { engine: { type: "string" }, os: { type: "string" }, arch: { type: "string" } },
      allowPositionals: false,
    });
    const metadata = JSON.parse(
      readFileSync(path.join(process.cwd(), "node_modules/playwright-core/browsers.json"), "utf8"),
    );
    const key = browserCacheKey(metadata, {
      engine: values.engine,
      runnerOS: values.os,
      architecture: values.arch,
      platform: browserCachePlatform(),
    });
    console.log(`key=${key}`);
  } catch (error) {
    console.error(`Cannot resolve Playwright browser cache key: ${error.message}`);
    process.exitCode = 1;
  }
}
