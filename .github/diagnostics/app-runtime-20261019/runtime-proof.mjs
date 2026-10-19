import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
assert.equal(process.version, "v24.22.0");
assert.equal(process.arch, "x64");
assert.equal(process.getuid(), 1000);
assert.equal(process.getgid(), 1000);
assert.deepEqual(process.getgroups(), [1000]);
assert.equal(process.env.HOME, "/home/node");
fs.accessSync(process.env.HOME, fs.constants.W_OK);
assert.equal(
  createHash("sha256").update(fs.readFileSync("/usr/local/bin/node")).digest("hex"),
  "67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c",
);
const absent = [
  "/usr/bin/apt",
  "/usr/bin/dpkg",
  "/usr/bin/perl",
  "/usr/bin/mount",
  "/usr/bin/umount",
  "/usr/bin/nsenter",
  "/usr/lib/systemd/systemd-homed",
  "/usr/local/lib/node_modules/npm",
  "/usr/lib/x86_64-linux-gnu/libacl.so.1",
  "/usr/lib/x86_64-linux-gnu/libmount.so.1",
  "/usr/lib/x86_64-linux-gnu/libblkid.so.1",
  "/usr/lib/x86_64-linux-gnu/libuuid.so.1",
  "/usr/lib/x86_64-linux-gnu/libsystemd.so.0",
  "/usr/lib/x86_64-linux-gnu/libudev.so.1",
  "/usr/lib/x86_64-linux-gnu/libtinfo.so.6",
  "/usr/lib/x86_64-linux-gnu/libncursesw.so.6",
  "/usr/share/perl",
];
for (const path of absent) {
  assert.throws(() => fs.lstatSync(path), { code: "ENOENT" }, path);
}
const retainedLibraries = fs
  .readdirSync("/usr/lib", { recursive: true })
  .filter((name) =>
    /^lib(?:acl|blkid|fdisk|lastlog|mount|smartcols|uuid|systemd|udev|perl|tinfo|ncurses).*\.so(?:\.|$)/.test(
      name.split("/").at(-1),
    ),
  );
assert.deepEqual(retainedLibraries, [], "held component versioned libraries remain");
const donor = JSON.parse(fs.readFileSync("/donor-inventory.json", "utf8"));
for (const [path, key] of [
  ["/bin/sh", "dash"],
  ["/var/lib/dpkg/status.d/dash", "status"],
  ["/usr/share/doc/dash/copyright", "copyright"],
])
  assert.equal(createHash("sha256").update(fs.readFileSync(path)).digest("hex"), donor[key], path);
assert.match(fs.readFileSync("/var/lib/dpkg/status.d/dash", "utf8"), /^Package: dash$/m);
fs.accessSync("/usr/share/doc/dash/copyright");
console.log(
  JSON.stringify({
    runtime: "passed",
    node: process.version,
    glibc: process.report.getReport().header.glibcVersionRuntime,
    uid: process.getuid(),
    gid: process.getgid(),
    groups: process.getgroups(),
    home: process.env.HOME,
    absent,
  }),
);
