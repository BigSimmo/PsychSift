#!/usr/bin/env node
/**
 * Install/reconcile a checkout-owned Claude profile. Uninstall removes only unchanged owned files
 * and settings. Memory seeds are always copy-if-absent and never enter the ownership manifest.
 * --adopt claims byte-identical unmanaged files/settings; it never overwrites differing host data.
 * A configuration home belongs to one source checkout. Use a separate CLAUDE_CONFIG_DIR for another
 * checkout, or uninstall from the original source before deliberately adopting matching leftovers.
 */
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = join(repoRoot, ".claude", "cloud-profile");
const args = process.argv.slice(2);
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const quiet = args.includes("--quiet");
const uninstall = args.includes("--uninstall");
const adopt = args.includes("--adopt");
const checkOwner = args.includes("--check-owner");
const KNOWN_PARTS = new Set(["settings", "claude-md", "skills", "memory"]);
const skipped = new Set(
  args
    .filter((arg) => arg.startsWith("--skip="))
    .flatMap((arg) => arg.slice(7).split(","))
    .filter(Boolean),
);
for (const arg of args) {
  if (
    !["--force", "--dry-run", "--quiet", "--uninstall", "--adopt", "--check-owner"].includes(arg) &&
    !arg.startsWith("--skip=")
  ) {
    console.error(
      "[cloud-profile] ERROR: unknown argument; use --force, --dry-run, --quiet, --adopt, --uninstall, --check-owner or --skip=<parts>",
    );
    process.exit(2);
  }
}
for (const part of skipped) {
  if (!KNOWN_PARTS.has(part)) {
    console.error(`[cloud-profile] ERROR: unknown --skip part '${part}'`);
    process.exit(2);
  }
}
function note(message) {
  if (!quiet) console.log(`[cloud-profile] ${message}`);
}
function fail(message) {
  throw new Error(message);
}
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function entry(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}
function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function sha256(path) {
  return hashBytes(readFileSync(path));
}
function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
const claudeHome = process.env.CLAUDE_CONFIG_DIR ? resolve(process.env.CLAUDE_CONFIG_DIR) : join(homedir(), ".claude");
const manifestPath = join(claudeHome, ".cloud-profile-install.json");
const lockPath = join(claudeHome, ".cloud-profile-install.lock");
const source = realpathSync(repoRoot);
let locked = false;

function safeParent(path) {
  for (let parent = dirname(path); ; parent = dirname(parent)) {
    const info = entry(parent);
    if (info && (!info.isDirectory() || info.isSymbolicLink()))
      fail("a managed destination parent is not a real directory; use an isolated CLAUDE_CONFIG_DIR");
    if (parent === claudeHome) return;
    if (parent === dirname(parent)) fail("managed destination escaped the configuration home");
  }
}
function atomicWrite(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.cloud-profile-${process.pid}.tmp`;
  let created = false;
  try {
    writeFileSync(temporary, content, { flag: "wx", mode });
    created = true;
    renameSync(temporary, path);
  } finally {
    if (created && entry(temporary)) unlinkSync(temporary);
  }
}
function readObject(path, label) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${label} is not valid JSON; preserved unchanged for manual repair`);
  }
  if (!isPlainObject(value)) fail(`${label} must be an object; preserved unchanged for manual repair`);
  return value;
}
function safeKeys(keys) {
  return (
    Array.isArray(keys) &&
    keys.length > 0 &&
    keys.every((key) => typeof key === "string" && !["__proto__", "prototype", "constructor"].includes(key))
  );
}
function settingLeaves(value, keys = [], result = []) {
  for (const [key, child] of Object.entries(value)) {
    const path = [...keys, key];
    if (!safeKeys(path)) fail("profile settings contain an unsafe key");
    if (isPlainObject(child) && Object.keys(child).length) settingLeaves(child, path, result);
    else result.push({ path, value: child });
  }
  return result;
}
function getSetting(root, keys) {
  let current = root;
  for (const key of keys) {
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) return { present: false };
    current = current[key];
  }
  return { present: true, value: current };
}
function setSetting(root, keys, value) {
  let current = root;
  for (const key of keys.slice(0, -1)) {
    if (Object.hasOwn(current, key) && !isPlainObject(current[key]))
      fail("a host setting conflicts with the profile; preserve it and use an isolated CLAUDE_CONFIG_DIR");
    current = current[key] ??= {};
  }
  current[keys.at(-1)] = value;
}
function deleteSetting(root, keys) {
  let current = root;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(current[key])) return;
    current = current[key];
  }
  delete current[keys.at(-1)];
}
function filePart(path) {
  return path === "CLAUDE.md" ? "claude-md" : "skills";
}
function validFile(path) {
  return (
    path === "CLAUDE.md" ||
    (/^skills\/[A-Za-z0-9._-]+\/(?!.*(?:^|\/)\.\.?\/)[^\\]+$/.test(path) &&
      !path.split("/").some((part) => [".", "..", ""].includes(part)))
  );
}
function collectFiles(directory, prefix, out) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${item.name}`;
    const path = join(directory, item.name);
    if (item.isDirectory()) collectFiles(path, relative, out);
    else if (item.isFile() && validFile(relative)) out[relative] = { hash: sha256(path), source: path };
    else fail("profile skills must contain regular files and directories only");
  }
}

function memorySeedNames(directory) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(directory, "seed-manifest.json"), "utf8"));
  } catch {
    fail("memory seed manifest is missing or invalid JSON");
  }
  if (
    !isPlainObject(manifest) ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    Object.keys(manifest).some((key) => !["version", "files"].includes(key))
  ) {
    fail("memory seed manifest must declare version 1 and a files array");
  }
  const names = new Set();
  for (const name of manifest.files) {
    if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name)) {
      fail("memory seed manifest entries must be plain Markdown filenames");
    }
    const key = name.toLowerCase();
    if (names.has(key)) fail("memory seed manifest contains duplicate filenames");
    names.add(key);
    const source = join(directory, name);
    if (!existsSync(source) || !lstatSync(source).isFile()) {
      fail("memory seed manifest entry is missing or is not a regular file");
    }
  }
  if (!manifest.files.includes("MEMORY.md")) fail("memory seed manifest must include MEMORY.md");
  const index = readFileSync(join(directory, "MEMORY.md"), "utf8");
  const targets = [
    ...Array.from(index.matchAll(/\[[^\]]*\]\(([^)]+)\)/g), (match) => match[1]),
    ...Array.from(index.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g), (match) => `${match[1]}.md`),
  ];
  if (targets.some((target) => !manifest.files.includes(target))) {
    fail("memory seed index refers to an unlisted seed");
  }
  return manifest.files;
}

// Read-only admission for every tier that changes the selected Claude config home.
function readOwnership() {
  if (entry(claudeHome) && (!entry(claudeHome).isDirectory() || entry(claudeHome).isSymbolicLink()))
    fail("configuration home must be a real directory");
  if (entry(manifestPath) && !entry(manifestPath).isFile()) fail("installation manifest must be a regular file");
  const previous = existsSync(manifestPath)
    ? readObject(manifestPath, "installation manifest")
    : { version: 1, source, files: {}, settings: [] };
  if (
    previous.version !== 1 ||
    typeof previous.source !== "string" ||
    !isPlainObject(previous.files) ||
    !Array.isArray(previous.settings) ||
    Object.entries(previous.files).some(([path, hash]) => !validFile(path) || !/^[a-f0-9]{64}$/.test(hash)) ||
    previous.settings.some((item) => !isPlainObject(item) || !safeKeys(item.path) || !Object.hasOwn(item, "value"))
  )
    fail("installation manifest has an unsupported structure; preserved unchanged");
  if (previous.source !== source)
    fail(
      "configuration home is owned by another source checkout; use a separate CLAUDE_CONFIG_DIR, or run --uninstall from the original checkout, then --adopt here for identical leftovers; ownership is never migrated automatically",
    );
  return previous;
}

function run() {
  if (process.env.CLAUDE_CODE_REMOTE !== "true" && !force) {
    note("not a remote container (CLAUDE_CODE_REMOTE is not true); nothing to do");
    return;
  }
  if (checkOwner) {
    readOwnership();
    note("configuration ownership check passed; nothing was written");
    return;
  }
  if (!uninstall && !existsSync(profileDir)) fail("profile directory is missing");
  const profileMemory = join(profileDir, "memory");
  // Validate all selected source inputs before acquiring ownership or changing any host file.
  const memoryFiles =
    !uninstall && existsSync(profileMemory) && !skipped.has("memory") ? memorySeedNames(profileMemory) : [];
  const desiredFiles = {};
  const profileClaudeMd = join(profileDir, "CLAUDE.md");
  if (!uninstall && existsSync(profileClaudeMd) && !skipped.has("claude-md")) {
    if (!entry(profileClaudeMd).isFile()) fail("profile CLAUDE.md must be a regular file");
    desiredFiles["CLAUDE.md"] = { hash: sha256(profileClaudeMd), source: profileClaudeMd };
  }
  const profileSkills = join(profileDir, "skills");
  if (existsSync(profileSkills) && !uninstall && !skipped.has("skills"))
    collectFiles(profileSkills, "skills", desiredFiles);
  const profileSettingsPath = join(profileDir, "settings.json");
  const desiredSettings =
    !uninstall && !skipped.has("settings") && existsSync(profileSettingsPath)
      ? settingLeaves(readObject(profileSettingsPath, "profile settings"))
      : [];
  if (entry(claudeHome) && (!entry(claudeHome).isDirectory() || entry(claudeHome).isSymbolicLink()))
    fail("configuration home must be a real directory");
  if (!dryRun) {
    mkdirSync(claudeHome, { recursive: true });
    try {
      mkdirSync(lockPath);
      locked = true;
    } catch {
      fail(
        "another profile operation owns the configuration lock; retry after it finishes (remove a stale .cloud-profile-install.lock manually)",
      );
    }
  }
  const previous = readOwnership();
  if (
    !uninstall &&
    !skipped.has("skills") &&
    !existsSync(profileSkills) &&
    Object.keys(previous.files).some((path) => path.startsWith("skills/"))
  ) {
    fail(
      "owned skills exist but the source skills directory is missing; restore the complete checkout or use --skip=skills; use --uninstall for deliberate removal",
    );
  }
  const next = structuredClone(previous);
  const operations = [];
  let kept = 0;
  for (const relative of new Set([...Object.keys(previous.files), ...Object.keys(desiredFiles)])) {
    if (skipped.has(filePart(relative))) continue;
    const path = join(claudeHome, relative);
    safeParent(path);
    const info = entry(path);
    const actual = info?.isFile() ? sha256(path) : null;
    const owned = Object.hasOwn(previous.files, relative);
    const desired = desiredFiles[relative];
    if (owned && info && actual !== previous.files[relative]) {
      kept += 1;
      note(`preserved host modification: ${relative}`);
      continue;
    }
    if (!desired) {
      if (owned && info) operations.push({ kind: "remove", path, relative });
      delete next.files[relative];
    } else if (info && !owned) {
      if (!adopt || actual !== desired.hash)
        fail(
          `unmanaged file collision at ${relative}; preserve it and use a separate CLAUDE_CONFIG_DIR, or review matching content and rerun with --adopt (identical files only)`,
        );
      next.files[relative] = desired.hash;
      note(`adopted identical file: ${relative}`);
    } else {
      next.files[relative] = desired.hash;
      if (actual !== desired.hash)
        operations.push({
          kind: "write",
          path,
          relative,
          content: readFileSync(desired.source),
          mode: entry(desired.source).mode & 0o777,
        });
      else note(`${relative} already matches the profile`);
    }
  }
  if (!skipped.has("settings")) {
    const settingsPath = join(claudeHome, "settings.json");
    safeParent(settingsPath);
    if (entry(settingsPath) && !entry(settingsPath).isFile())
      fail("host settings must be a regular file; preserved unchanged");
    const existing = existsSync(settingsPath) ? readObject(settingsPath, "host settings") : {};
    const settings = structuredClone(existing);
    const desiredByKey = new Map(desiredSettings.map((item) => [JSON.stringify(item.path), item]));
    const previousByKey = new Map(previous.settings.map((item) => [JSON.stringify(item.path), item]));
    const nextByKey = new Map(previousByKey);
    for (const [key, item] of previousByKey) {
      const current = getSetting(settings, item.path);
      if (current.present && !equal(current.value, item.value)) {
        note(`preserved host setting modification: ${item.path.join(".")}`);
        kept += 1;
        continue;
      }
      const desired = desiredByKey.get(key);
      if (!desired) {
        deleteSetting(settings, item.path);
        nextByKey.delete(key);
      } else {
        setSetting(settings, item.path, desired.value);
        nextByKey.set(key, desired);
      }
      desiredByKey.delete(key);
    }
    for (const [key, item] of desiredByKey) {
      // A modified owned setting remains host-owned in practice; never reclaim it on an update.
      if (previousByKey.has(key)) continue;
      const current = getSetting(settings, item.path);
      if (current.present && !equal(current.value, item.value))
        fail(
          `host setting collision at ${item.path.join(".")}; preserve it and use an isolated CLAUDE_CONFIG_DIR; --adopt accepts identical content only`,
        );
      if (!current.present || adopt) {
        setSetting(settings, item.path, item.value);
        nextByKey.set(key, item);
      }
    }
    next.settings = [...nextByKey.values()];
    if (!equal(settings, existing))
      operations.push({
        kind: "write",
        path: settingsPath,
        relative: "settings.json",
        content: `${JSON.stringify(settings, null, 2)}\n`,
      });
    else note("settings.json already matches the profile or preserved host values");
  }
  // Preflight memory parents too; host memory entries themselves, including symlinks, always win.
  const projectDir = process.env.CLAUDE_PROJECT_DIR ? resolve(process.env.CLAUDE_PROJECT_DIR) : repoRoot;
  const memoryTarget = join(claudeHome, "projects", projectDir.replace(/[/\\:]/g, "-"), "memory");
  for (const file of memoryFiles) safeParent(join(memoryTarget, file));
  for (const op of operations) {
    note(`${dryRun ? "would " : ""}${op.kind}: ${op.relative}`);
    if (dryRun) continue;
    if (op.kind === "write") atomicWrite(op.path, op.content, op.mode);
    else {
      unlinkSync(op.path);
      // Remove empty skill directories only; extra host files make rmdir fail harmlessly.
      for (
        let parent = dirname(op.path);
        parent !== claudeHome && parent !== join(claudeHome, "skills");
        parent = dirname(parent)
      ) {
        try {
          rmdirSync(parent);
        } catch {
          break;
        }
      }
    }
  }
  let copied = 0;
  for (const file of memoryFiles) {
    const destination = join(memoryTarget, file);
    if (entry(destination)) continue;
    if (!dryRun) {
      mkdirSync(memoryTarget, { recursive: true });
      try {
        copyFileSync(join(profileMemory, file), destination, constants.COPYFILE_EXCL);
      } catch (error) {
        if (error.code === "EEXIST") continue;
        throw error;
      }
    }
    copied += 1;
  }
  if (memoryFiles.length) note(`memories: ${copied} installed; existing host records kept`);
  if (!dryRun) {
    if (uninstall && Object.keys(next.files).length === 0 && next.settings.length === 0) {
      if (entry(manifestPath)) unlinkSync(manifestPath);
    } else atomicWrite(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  if (kept) note(`${kept} modified owned entries retained; ownership stays recorded for review`);
  if (dryRun) note("dry run — nothing was written");
}
try {
  run();
} catch (error) {
  console.error(`[cloud-profile] ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (locked) rmdirSync(lockPath);
}
