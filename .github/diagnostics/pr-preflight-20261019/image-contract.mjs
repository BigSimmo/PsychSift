import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { isExpectedAppCommand, imagePathAbsenceProbe, imageListingProbe, imagePrivilegeBitsProbe } = await import(
  pathToFileURL(`${process.cwd()}/scripts/check-image-content-contract.mjs`)
);
const [kind, image] = process.argv.slice(2);
assert.ok(["app", "worker"].includes(kind));
const run = (args) => execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 });
const info = JSON.parse(run(["inspect", image]))[0];
writeFileSync("/tmp/psychsift-pr-proof/image-inspect.json", JSON.stringify(info, null, 2));
assert.equal(info.Config.User, "node");
assert.equal(info.Config.StopSignal, "SIGTERM");
assert.equal(info.Config.Labels["org.opencontainers.image.source"], "https://github.com/BigSimmo/PsychSift");
assert.ok(info.Config.Healthcheck?.Test?.length);
if (kind === "app") assert.ok(isExpectedAppCommand(info.Config.Cmd));
else assert.deepEqual(info.Config.Cmd, ["node", "dist/worker/index.mjs"]);
const probe = (code) =>
  run([
    "run",
    "--rm",
    "--network=none",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--entrypoint",
    "node",
    image,
    "-e",
    code,
  ]);
probe(
  "const a=require('node:assert/strict');a.equal(process.getuid(),1000);a.equal(process.getgid(),1000);a.ok(process.getgroups().every(g=>g===1000));",
);
for (const path of [
  "/app/.env",
  "/app/.env.example",
  "/app/.env.local",
  "/app/tests",
  "/usr/local/lib/node_modules/npm",
])
  probe(imagePathAbsenceProbe(path));
assert.equal(probe(imageListingProbe("/app", "\\.pem$")).trim(), "");
if (kind === "app") {
  for (const path of [
    "/usr/bin/apt",
    "/usr/bin/dpkg",
    "/usr/bin/perl",
    "/usr/bin/mount",
    "/usr/bin/umount",
    "/usr/bin/nsenter",
    "/usr/lib/systemd/systemd-homed",
  ])
    probe(imagePathAbsenceProbe(path));
} else {
  for (const path of ["/usr/bin/mount", "/usr/bin/umount"]) probe(imagePrivilegeBitsProbe(path));
  for (const path of ["/usr/local/bin/npm", "/usr/local/bin/npx", "/usr/local/bin/yarn", "/usr/local/bin/yarnpkg"])
    probe(imagePathAbsenceProbe(path));
  assert.equal(probe(imageListingProbe("/app/worker/python", "^test_.*\\.py$")).trim(), "");
  assert.equal(probe(imageListingProbe("/opt", "^yarn-")).trim(), "");
}
console.log(`${kind} assembled-image content contract passed`);
