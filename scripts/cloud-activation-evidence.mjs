#!/usr/bin/env node
// Offline evidence only: never source installed files or inspect environment/config values.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const options = {};
const allowed = new Set(["--expected-revision", "--installed-home", "--codex-home", "--claude-config-dir"]);
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  if (!allowed.has(name) || !process.argv[i + 1] || options[name] !== undefined) {
    console.error(
      "Usage: node scripts/cloud-activation-evidence.mjs [--expected-revision FULL_SHA] [--installed-home DIR] [--codex-home DIR] [--claude-config-dir DIR]",
    );
    process.exit(2);
  }
  options[name] = process.argv[i + 1];
}
if (options["--expected-revision"] && !/^[a-f0-9]{40}$/.test(options["--expected-revision"])) {
  console.error("Expected revision must be a full lowercase Git SHA.");
  process.exit(2);
}
const checkout = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const issues = [];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) =>
  execFileSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", checkout, ...args], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

// Inspect every component before reading, including ancestors of selected external homes.
function inspect(path) {
  for (let part = resolve(path); ; part = dirname(part)) {
    const info = lstatSync(part, { throwIfNoEntry: false });
    if (info?.isSymbolicLink()) return { state: "symlink" };
    if (part !== resolve(path) && info && !info.isDirectory()) return { state: "non-directory-parent" };
    if (part === dirname(part)) break;
  }
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return { state: "missing" };
  if (!info.isFile()) return { state: "non-file" };
  if (info.size > 2 * 1024 * 1024) return { state: "oversize" };
  const bytes = readFileSync(path);
  return { state: "regular", sha256: digest(bytes), bytes };
}
function fileEvidence(path, label) {
  const { state, sha256 } = inspect(path);
  return sha256 ? { path: label, state, sha256 } : { path: label, state };
}
function claudeEvidence(directory) {
  const manifest = inspect(join(directory, ".cloud-profile-install.json"));
  if (manifest.state !== "regular") {
    if (manifest.state !== "missing") issues.push("Claude ownership manifest is unsafe or unreadable");
    return { status: "unverified", manifestState: manifest.state, files: [] };
  }
  let value;
  try {
    value = JSON.parse(manifest.bytes.toString("utf8"));
  } catch {
    /* report without content */
  }
  const plain = (item) => item !== null && typeof item === "object" && !Array.isArray(item);
  const validPath = (path) =>
    path === "CLAUDE.md" ||
    (/^skills\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(path) &&
      !path.split("/").some((part) => part === "." || part === ".."));
  if (
    !plain(value) ||
    value.version !== 1 ||
    typeof value.source !== "string" ||
    !plain(value.files) ||
    !Array.isArray(value.settings) ||
    Object.keys(value.files).length > 2000 ||
    Object.entries(value.files).some(([path, hash]) => !validPath(path) || !/^[a-f0-9]{64}$/.test(hash))
  ) {
    issues.push("Claude ownership manifest has an unsupported structure");
    return { status: "unverified", manifestState: "invalid", files: [] };
  }
  const ownerMatches = value.source === checkout;
  if (!ownerMatches) {
    issues.push("Claude installation belongs to a different source checkout");
    return { status: "inspected", manifestSha256: manifest.sha256, ownerMatches, files: [] };
  }
  const files = Object.entries(value.files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, expected]) => {
      const source = inspect(join(checkout, ".claude", "cloud-profile", path));
      // Retired/unrecognized manifest entries are recorded without opening host files.
      if (source.state !== "regular") {
        issues.push("Claude manifest contains an entry absent from current regular source");
        return { path, state: "source-unavailable", sourceMatches: false };
      }
      const actual = fileEvidence(join(directory, path), path);
      const manifestMatches = actual.sha256 === expected;
      const sourceMatches = actual.sha256 === source.sha256;
      if (!manifestMatches || !sourceMatches) issues.push("Claude artifact differs from manifest or current source");
      return { ...actual, manifestMatches, sourceMatches, sourceSha256: source.sha256 };
    });
  return {
    status: "inspected",
    manifestSha256: manifest.sha256,
    ownerMatches,
    files,
    settings: "unverified; config values are not inspected",
    provenance: "local manifest and byte comparison; not runtime loading proof",
  };
}
function codexEvidence(home, configHome) {
  const names = [
    ["runtime-profile", join(home, ".clinical-kb-codex-cloud.sh"), "# Generated by scripts/setup-codex-cloud.sh."],
    ...["node", "npm", "npx"].map((name) => [
      `shim-${name}`,
      join(home, ".local", "bin", name),
      "# Generated by scripts/install-codex-cloud-command-shims.sh.",
    ]),
  ];
  const files = names.map(([path, destination, marker]) => {
    const { bytes, ...actual } = inspect(destination);
    let owner = "unknown";
    let generatedMarker = false;
    if (bytes) {
      const lines = bytes.toString("utf8").split("\n");
      generatedMarker = lines.includes(marker);
      const owners = lines.filter((line) => line.startsWith("# PsychSift checkout: "));
      if (owners.length)
        owner =
          owners.length === 1 && owners[0] === `# PsychSift checkout: ${checkout}`
            ? "selected-checkout"
            : "other-or-ambiguous";
      if (owner === "other-or-ambiguous")
        issues.push("Codex legacy artifact belongs to a different or ambiguous checkout");
    }
    if (!["missing", "regular"].includes(actual.state)) issues.push("Codex legacy artifact is unsafe or unreadable");
    return { path, ...actual, generatedMarker, owner, contentVerification: "unverified" };
  });
  // Do not read config.toml: even a hash of the whole config would inspect unrelated credentials.
  return {
    status: "inspected",
    home: resolve(home),
    configHome: resolve(configHome),
    files,
    shellPolicy: "unverified; config values are not inspected",
    provenance: "markers are ownership clues only; legacy artifacts have no trusted content manifest",
  };
}
try {
  if (realpathSync(git("rev-parse", "--show-toplevel")) !== checkout) throw new Error("checkout identity");
  const revision = git("rev-parse", "HEAD");
  const revisionMatches = options["--expected-revision"] ? revision === options["--expected-revision"] : null;
  if (revisionMatches === false) issues.push("Source revision does not match the expected revision");
  const sourcePaths = [
    "AGENTS.md",
    "PROJECT-INSTRUCTIONS-CONTINUATION.md",
    "CLAUDE.md",
    "GEMINI.md",
    "docs/agents/codex-cloud-environment.md",
    "docs/agents/cloud-instruction-activation.md",
    "scripts/setup-codex-cloud.sh",
    "scripts/install-codex-cloud-command-shims.sh",
    "scripts/apply-claude-cloud-profile.mjs",
    ".claude/cloud-profile/CLAUDE.md",
  ];
  // Include the source guidance tree, excluding settings and memory seeds.
  function guidancePaths(directory, relative, depth = 0) {
    if (depth > 12 || sourcePaths.length > 2000) throw new Error("source guidance exceeds bounds");
    if (inspect(directory).state === "symlink") {
      sourcePaths.push(relative);
      return;
    }
    const info = lstatSync(directory, { throwIfNoEntry: false });
    if (!info?.isDirectory()) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (sourcePaths.length >= 2000) throw new Error("source guidance exceeds bounds");
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) guidancePaths(join(directory, entry.name), next, depth + 1);
      else sourcePaths.push(next);
    }
  }
  guidancePaths(join(checkout, ".claude/cloud-profile/skills"), ".claude/cloud-profile/skills");
  const source = {
    checkout,
    revision,
    branch: git("branch", "--show-current"),
    dirty: git("status", "--porcelain", "--untracked-files=normal") !== "",
    revisionMatches,
    files: sourcePaths.map((path) => fileEvidence(join(checkout, path), path)),
  };
  if (source.files.some((file) => !["regular", "missing"].includes(file.state)))
    issues.push("Source guidance contains an unsafe artifact");
  const installed = { status: "unverified" };
  if (options["--installed-home"]) {
    installed.status = "inspected";
    installed.codex = codexEvidence(
      resolve(options["--installed-home"]),
      resolve(options["--codex-home"] || join(options["--installed-home"], ".codex")),
    );
  } else if (options["--codex-home"]) throw new Error("--codex-home requires --installed-home");
  if (options["--claude-config-dir"]) {
    installed.status = "inspected";
    installed.claude = claudeEvidence(resolve(options["--claude-config-dir"]));
  }
  console.log(
    JSON.stringify(
      {
        version: 1,
        source,
        installed,
        activeSession: {
          status: "unverified",
          reason:
            "Requires supported native context inspection; source files, manifests, environment variables and this report do not prove loaded instructions",
        },
        issues: [...new Set(issues)],
      },
      null,
      2,
    ),
  );
  process.exitCode = issues.length ? 1 : 0;
} catch {
  console.error(
    "Cloud activation evidence could not be collected safely; verify checkout, arguments and readable regular artifacts. No files changed.",
  );
  process.exitCode = 2;
}
