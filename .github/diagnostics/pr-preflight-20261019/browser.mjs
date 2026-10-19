import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const root = process.cwd();
const { offlineTestEnvironment } = await import(pathToFileURL(`${root}/scripts/test-environment.mjs`));
const { appName, localProjectId } = await import(pathToFileURL(`${root}/src/lib/local-server-utils.mjs`));
const env = offlineTestEnvironment(process.env, {
  PLAYWRIGHT_TRACE: "off",
  PLAYWRIGHT_OFFLINE_MODE: "true",
  DEV_SERVER_IDLE_MINUTES: "1",
});
// The normal ensure server is detached. Track only newly created process groups owned by this checkout.
function ownedDevGroups() {
  const groups = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const args = readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0");
      if (!args.includes("scripts/dev-free-port.mjs") || realpathSync(`/proc/${name}/cwd`) !== root) continue;
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const pgrp = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
      if (pgrp === Number(name)) groups.push(Number(name));
    } catch {}
  }
  return groups;
}
const before = new Set(ownedDevGroups());
assert.equal(before.size, 0, "fresh diagnostic runner must have no existing checkout dev server");
let url;
try {
  const ensure = spawnSync("npm", ["run", "ensure", "--", "--print-url"], {
    encoding: "utf8",
    env,
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  process.stdout.write(ensure.stdout ?? "");
  process.stderr.write(ensure.stderr ?? "");
  assert.equal(ensure.status, 0, "normal npm run ensure must pass");
  url = ensure.stdout.match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+/g)?.at(-1);
  assert.ok(url, "ensure must print its actual project URL");
  const identity = await fetch(`${url}/api/local-project-id`, { signal: AbortSignal.timeout(5000) }).then((r) =>
    r.json(),
  );
  assert.equal(identity.appName, appName);
  assert.equal(identity.projectId, localProjectId(root));
  assert.equal(identity.localServer?.safeLocalOrigin, true);
  writeFileSync("/tmp/psychsift-pr-proof/browser-ensure.json", JSON.stringify({ url, identity }, null, 2));
} finally {
  // Release the verified task-owned dev server before the isolated production build consumes RAM.
  for (const pid of ownedDevGroups())
    if (!before.has(pid)) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
    }
}
for (let i = 0; ownedDevGroups().length && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(ownedDevGroups().length, 0, "owned ensure server must stop before the production browser build");
const specs = ["tests/ui-formulation.spec.ts", "tests/ui-phone-scroll-assessments.spec.ts", "tests/ui-smoke.spec.ts"];
const args = ["scripts/run-playwright.mjs", ...specs, "--project=chromium", "--retries=0", "--workers=1"];
console.log("FOCUSED_BROWSER_COMMAND", JSON.stringify([process.execPath, ...args]));
const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
process.exit(result.status ?? 1);
