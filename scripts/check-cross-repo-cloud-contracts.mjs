#!/usr/bin/env node
// Static read-only contracts: never import/execute another repository's source.
import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ownRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portableAliases = {
  "check:checkout": ["scripts/portable-workflow.mjs", "identity"],
  "preview:cloud": ["scripts/portable-workflow.mjs", "run"],
  "preview:guard": ["scripts/portable-workflow.mjs", "guard"],
};

// Deliberately explicit adapters, rather than applying PsychSift's policies everywhere.
export const repositoryMatrix = Object.freeze([
  {
    name: "PsychSift",
    active: true,
    packageName: "prompt-for-codex-medical-knowledge-base",
    lock: "package-lock.json",
    sharedRules: true,
    docs: [
      "PROJECT-INSTRUCTIONS-CONTINUATION.md",
      "docs/task-receipts.md",
      "docs/agents/codex-cloud-environment.md",
      "docs/cloud/codex-cloud-legacy-bootstrap.md",
    ],
    aliases: { "cloud:setup": ["scripts/setup-codex-cloud.sh"], "cloud:maintain": ["scripts/maintain-codex-cloud.sh"] },
  },
  {
    name: "Communication",
    active: true,
    packageName: "workspace",
    lock: "pnpm-lock.yaml",
    sharedRules: true,
    docs: ["docs/task-receipts.md", "scripts/agent-rule-policy.json"],
    aliases: {
      "app:run": ["scripts/local-app.mjs", "run"],
      "app:guard": ["scripts/local-app.mjs", "guard"],
      "agent-rules:check": ["scripts/validate-agent-rules.mjs"],
    },
  },
  {
    name: "Medications",
    active: true,
    packageName: "medications",
    lock: "pnpm-lock.yaml",
    portable: true,
    docs: [
      "docs/portable-workflow.md",
      ".project-identity.json",
      "scripts/preview-route.mjs",
      "artifacts/api-server/tests/serve-drug-guide.mjs",
    ],
    aliases: {
      ...portableAliases,
      "app:run": ["scripts/preview-route.mjs", "run"],
      "app:guard": ["scripts/preview-route.mjs", "guard"],
    },
  },
  {
    name: "Ward-Flow",
    active: true,
    packageName: "ward-flow",
    lock: "package-lock.json",
    sharedRules: true,
    docs: [
      "docs/task-receipts.md",
      "docs/agents/cloud-ownership.md",
      "scripts/ward-flow/sign-out-check.mjs",
      "docs/ward-flow/DATABASE.md",
    ],
    aliases: {
      "setup:codex-worktree": ["scripts/setup-codex-worktree.mjs"],
      ensure: ["scripts/ensure-local-server.mjs"],
    },
  },
  {
    name: "Yarn",
    active: true,
    packageName: "workspace",
    lock: "pnpm-lock.yaml",
    portable: true,
    docs: ["docs/portable-workflow.md", "scripts/portable-preview.mjs"],
    aliases: portableAliases,
  },
  {
    name: "caring-contacts",
    active: true,
    packageName: "caring-contacts",
    lock: "package-lock.json",
    sharedRules: true,
    docs: ["docs/task-receipts.md"],
    aliases: { test: ["scripts/run-vitest.mjs"], "test:e2e": ["scripts/run-browser-tests.mjs"] },
  },
  { name: "ward-flow-backup", active: false, docs: ["README.md"] },
]);

function adapter(name) {
  const entry = repositoryMatrix.find((item) => item.name === name);
  if (!entry) throw new Error("Unknown repository; choose a name from --list.");
  return entry;
}

/** Known source tripwires, not a parser or proof of runtime/authorization semantics. */
export function checkCloudContracts(name, read) {
  const entry = adapter(name);
  const failures = [];
  const cache = new Map();
  const content = (file) => {
    if (!cache.has(file)) {
      let value = null;
      try {
        value = read(file);
      } catch {
        /* Missing/unreadable surfaces fail below. */
      }
      cache.set(file, typeof value === "string" ? value : null);
    }
    return cache.get(file);
  };
  const fail = (code, file, message) => failures.push({ code, file, message });
  const requireFile = (file) => {
    const value = content(file);
    if (!value?.trim()) fail("required-surface", file, "Required regular source file is missing, empty or unreadable.");
    return value ?? "";
  };
  const probe = (code, file, patterns, message) => {
    const value = content(file) ?? "";
    if (!patterns.every((pattern) => pattern.test(value))) fail(code, file, message);
  };
  for (const file of entry.docs) requireFile(file);
  if (!entry.active) {
    probe(
      "backup-boundary",
      "README.md",
      [/backup destination/i, /not a runnable application/i, /BigSimmo\/Ward-Flow/],
      "Backup must point to the maintained repository and remain explicitly non-runnable.",
    );
    for (const file of ["package.json", "AGENTS.md", "CLAUDE.md", "GEMINI.md", "scripts/setup-codex-cloud.sh"]) {
      if (content(file) !== null)
        fail(
          "backup-activation",
          file,
          "Historical backup has acquired an active application/agent surface; review its adapter explicitly.",
        );
    }
    return failures;
  }
  requireFile("AGENTS.md");
  requireFile("README.md");
  for (const file of ["CLAUDE.md", "GEMINI.md"]) {
    const value = requireFile(file);
    if (!/(?:^|\n)\s*@AGENTS\.md\s*(?:\n|$)|\]\((?:\.\/)?AGENTS\.md(?:#[\w-]+)?\)/.test(value)) {
      fail("native-entry", file, "Native adapter must import or link this checkout's root AGENTS.md.");
    }
  }
  if (entry.sharedRules) {
    probe(
      "shared-rule-boundary",
      "AGENTS.md",
      [/<!-- BEGIN:shared-cloud-working-rules -->/, /<!-- END:shared-cloud-working-rules -->/],
      "Maintained shared-rule boundaries are missing; policy prose is not compared or copied.",
    );
  }
  for (const file of entry.docs.filter(
    (file) =>
      file.startsWith("docs/") &&
      (file.includes("task-receipts") || file.includes("portable-workflow") || file.includes("cloud-ownership")),
  )) {
    if (!(content("AGENTS.md") ?? "").includes(file))
      fail("rule-link", "AGENTS.md", `Required scoped guidance is no longer linked: ${file}.`);
  }
  let pkg;
  try {
    pkg = JSON.parse(requireFile("package.json"));
  } catch {
    fail("package-json", "package.json", "Package manifest is not valid JSON.");
  }
  requireFile(entry.lock);
  if (pkg) {
    if (pkg.name !== entry.packageName || typeof pkg.engines?.node !== "string")
      fail("package-identity", "package.json", "Repository package identity or declared Node engine drifted.");
    for (const [alias, [target, command]] of Object.entries(entry.aliases)) {
      requireFile(target);
      const value = pkg.scripts?.[alias] ?? "";
      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (
        !new RegExp(`(?:^|[\\s])(?:\\./)?${escaped}(?:[\\s]|$)`).test(value) ||
        (command && !new RegExp(`\\b${command}\\b`).test(value))
      ) {
        fail(
          "bootstrap-alias",
          "package.json",
          `${alias} must retain its repository-owned ${target}${command ? ` ${command}` : ""} route.`,
        );
      }
    }
  }
  if (entry.lock === "pnpm-lock.yaml") {
    requireFile("pnpm-workspace.yaml");
    if (!/^pnpm@\d+\.\d+\.\d+$/.test(pkg?.packageManager ?? ""))
      fail("package-manager", "package.json", "pnpm repository must declare an exact packageManager version.");
    probe(
      "implicit-install",
      "pnpm-workspace.yaml",
      [/^verifyDepsBeforeRun:\s*["']?error["']?\s*$/m],
      "Script invocation must retain the fail-closed dependency policy.",
    );
  }
  if (entry.portable) {
    const file = "scripts/portable-workflow.mjs";
    probe(
      "checkout-ownership",
      file,
      [new RegExp(`BigSimmo/${name}`), /--show-toplevel/, /realpathSync/],
      "Portable bootstrap lost a checkout/origin identity tripwire.",
    );
    probe(
      "preview-ownership",
      file,
      [
        /reply\.challenge\s*!==\s*challenge/,
        /reply\.pid\s*!==\s*state\.pid/,
        /reply\.port\s*!==\s*state\.port/,
        /reply\.rootId\s*!==\s*state\.rootId/,
      ],
      "Portable preview must retain fresh challenge, PID, root and port checks.",
    );
    probe(
      "implicit-install",
      file,
      [
        /npm_config_verify_deps_before_run:\s*["']error["']/,
        /pnpm_config_verify_deps_before_run:\s*["']error["']/,
        /--config\.verify-deps-before-run=error/,
      ],
      "Verification subprocesses must pin the dependency policy through both environments and CLI.",
    );
  }
  if (name === "PsychSift") {
    probe(
      "legacy-opt-in",
      "docs/agents/codex-cloud-environment.md",
      [/explicit selection only/i, /not a default requirement/i],
      "Current host guidance must distinguish explicitly selected legacy setup.",
    );
    probe(
      "legacy-migration-selection",
      "scripts/maintain-codex-cloud.sh",
      [
        /\[\[\s*"?\$requested_cloud_profile_set"?\s*=\s*yes\s*\]\]\s*\|\|/,
        /Legacy runtime profile migration requires an explicit/,
        /PsychSift checkout:/,
      ],
      "Legacy migration must retain explicit profile selection and checkout ownership guards.",
    );
    probe(
      "migration-authority",
      "AGENTS.md",
      [/No database change without the owner's explicit permission/, /MERGING TO `main` DEPLOYS TO PRODUCTION/],
      "PsychSift's live migration authorization and merge boundary tripwires are missing.",
    );
  }
  if (name === "Ward-Flow") {
    probe(
      "cloud-ownership",
      "docs/agents/cloud-ownership.md",
      [/WARD_SIGNOUT_FILE/, /missing\/unreadable log blocks/, /repo=BigSimmo\/Ward-Flow/],
      "Cloud ownership guidance must retain scoped, readable coordination and repository claims.",
    );
    probe(
      "ownership-fail-closed",
      "scripts/ward-flow/sign-out-check.mjs",
      [/readSignOutText\(\)/, /ownership cannot be established/, /process\.exit\(1\)/],
      "Editing sign-out admission must retain its fail-closed path; stale inventory remains separately allowed.",
    );
  }
  if (name === "caring-contacts")
    probe(
      "migration-authority",
      "AGENTS.md",
      [/migrations/, /separately applicable authority/, /synthetic prototype/],
      "Caring Contacts must retain separate migration authority and synthetic prototype boundaries.",
    );
  return failures;
}

function git(root, args, extra = {}) {
  return execFileSync("git", ["--no-optional-locks", "-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
    ...extra,
  }).trim();
}

function canonicalRemote(value) {
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)(BigSimmo\/[\w.-]+?)(?:\.git)?\/?$/i
    .exec(value)?.[1]
    .toLowerCase();
}

export function inspectCheckout(name, root, revision) {
  const result = {
    repository: `BigSimmo/${name}`,
    revision: revision ?? null,
    source: revision ? "git-blobs" : "working-tree",
    dirty: null,
    status: "unverified",
    failures: [],
  };
  try {
    adapter(name);
    const physicalRoot = realpathSync(root);
    if (realpathSync(git(physicalRoot, ["rev-parse", "--show-toplevel"])) !== physicalRoot)
      throw Error("Select the exact Git checkout root.");
    const origins = git(physicalRoot, ["config", "--local", "--get-all", "remote.origin.url"]).split(/\r?\n/);
    if (!origins.length || origins.some((origin) => canonicalRemote(origin) !== `bigsimmo/${name.toLowerCase()}`))
      throw Error("Checkout origin does not match the selected repository.");
    if (revision && !/^[a-f0-9]{40}$/.test(revision))
      throw Error("Pinned revision must be a full lowercase 40-character commit SHA.");
    result.revision = git(physicalRoot, ["rev-parse", "--verify", `${revision ?? "HEAD"}^{commit}`]);
    let read;
    if (revision) {
      const entries = new Map(
        git(physicalRoot, ["ls-tree", "-r", result.revision])
          .split("\n")
          .map((line) => {
            const match = /^(100644|100755) blob [a-f0-9]+\t(.+)$/.exec(line);
            return match ? [match[2], true] : ["", false];
          }),
      );
      read = (file) => (entries.has(file) ? git(physicalRoot, ["show", `${result.revision}:${file}`]) : null);
    } else {
      result.dirty = Boolean(git(physicalRoot, ["status", "--porcelain", "--untracked-files=normal"]));
      read = (file) => {
        const target = path.join(physicalRoot, file);
        try {
          if (!lstatSync(target).isFile() || !realpathSync(target).startsWith(`${physicalRoot}${path.sep}`))
            return null;
          return readFileSync(target, "utf8");
        } catch {
          return null;
        }
      };
    }
    result.failures = checkCloudContracts(name, read);
    result.status = result.failures.length ? "fail" : "pass";
  } catch {
    // Never print Git stderr (which can contain credential-bearing remote/config details).
    result.failures.push({
      code: "source-unavailable",
      file: null,
      message: "Repository identity, root or requested revision could not be verified; no passing result is available.",
    });
  }
  return result;
}

/** @param {Record<string, string | undefined>} [source] @param {string} [platform] */
export function anonymousFetchEnvironment(source = process.env, platform = process.platform) {
  // No personal credential/helper/config inheritance. Preserve only transport/runtime configuration.
  // Windows environment names are case-insensitive; retain POSIX's existing exact spellings.
  const allowedNames = new RegExp(
    "^(?:PATH|SystemRoot|TMPDIR|TEMP|TMP|HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy|NO_PROXY|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|GIT_SSL_CAINFO|GIT_SSL_CAPATH)$",
    platform === "win32" ? "i" : "",
  );
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => allowedNames.test(key)));
  Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull });
  return env;
}

function fetchMaintained() {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "cloud-contract-audit-"));
  const results = [];
  const env = anonymousFetchEnvironment();
  try {
    for (const entry of repositoryMatrix.filter((item) => item.active && item.name !== "PsychSift")) {
      const root = path.join(temporaryRoot, entry.name);
      try {
        execFileSync("git", ["init", "--quiet", root], { env, stdio: "pipe", timeout: 10_000 });
        git(root, ["remote", "add", "origin", `https://github.com/BigSimmo/${entry.name}.git`], { env });
        git(
          root,
          [
            "-c",
            "credential.helper=",
            "-c",
            "core.askPass=",
            "fetch",
            "--no-tags",
            "--depth=1",
            "origin",
            "refs/heads/main",
          ],
          { env },
        );
        const revision = git(root, ["rev-parse", "FETCH_HEAD"], { env });
        results.push(inspectCheckout(entry.name, root, revision));
      } catch {
        results.push({
          repository: `BigSimmo/${entry.name}`,
          revision: null,
          source: "git-blobs",
          dirty: null,
          status: "unverified",
          failures: [
            {
              code: "fetch-unavailable",
              file: null,
              message:
                "Unauthenticated main fetch failed; inaccessible repositories are unverified and fail this requested audit.",
            },
          ],
        });
      }
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  return results;
}

function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (["--json", "--list", "--all", "--fetch-maintained"].includes(arg)) options[arg] = true;
    else if (
      ["--repo", "--root", "--revision", "--repos-root"].includes(arg) &&
      args[index + 1] &&
      !args[index + 1].startsWith("--")
    )
      options[arg] = args[++index];
    else
      throw Error(
        "Usage: --repo NAME --root PATH [--revision FULL_SHA] [--json]; --all --repos-root PATH; --fetch-maintained --root PATH; --list",
      );
  }
  if (options["--list"]) {
    console.log(JSON.stringify(repositoryMatrix, null, 2));
    return;
  }
  if (
    options["--all"] &&
    (!options["--repos-root"] ||
      options["--revision"] ||
      options["--repo"] ||
      options["--root"] ||
      options["--fetch-maintained"])
  )
    throw Error("--all requires --repos-root only (plus --json).");
  if (options["--fetch-maintained"] && (options["--repo"] || options["--revision"] || options["--repos-root"]))
    throw Error("--fetch-maintained accepts only --root and --json; it audits maintained main revisions anonymously.");
  if (!options["--all"] && !options["--fetch-maintained"] && options["--repos-root"])
    throw Error("--repos-root requires --all.");
  let results;
  if (options["--all"]) {
    results = repositoryMatrix.map((entry) => {
      const root = path.resolve(options["--repos-root"], entry.name);
      let revision = "unavailable";
      try {
        revision = git(root, ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"]);
      } catch {
        /* Fail closed below. */
      }
      return inspectCheckout(entry.name, root, revision);
    });
  } else {
    results = [
      inspectCheckout(
        options["--repo"] ?? "PsychSift",
        path.resolve(options["--root"] ?? ownRoot),
        options["--revision"],
      ),
    ];
    if (options["--fetch-maintained"]) results.push(...fetchMaintained());
  }
  const report = { schemaVersion: 1, evidence: "static-source-contracts", results };
  if (options["--json"]) console.log(JSON.stringify(report, null, 2));
  else {
    for (const result of results) {
      console.log(
        `${result.status.toUpperCase()} ${result.repository} revision=${result.revision ?? "unavailable"} source=${result.source}${result.dirty === null ? "" : ` dirty=${result.dirty}`}`,
      );
      for (const failure of result.failures)
        console.log(`  ${failure.code} ${failure.file ?? "source"}: ${failure.message}`);
    }
    console.log(
      `Cloud contracts: ${results.filter((result) => result.status === "pass").length}/${results.length} passed (static source only).`,
    );
  }
  if (results.some((result) => result.status !== "pass")) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
