#!/usr/bin/env node

import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  CODEX_CLOUD_REPOSITORY,
  hasSafeGitHubCredentialHelper,
  inspectOriginRemote,
} from "./ensure-codex-cloud-git-remote.mjs";
import { redactSensitiveText } from "./sensitive-text.mjs";
import { providerEnvironmentKeys } from "./test-environment.mjs";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const expectedCloudCliVersions = Object.freeze({
  codex: "0.147.0",
});

export const expectedHostedWorkspaceClass = "personal-pro";

export const expectedMcpConfiguration = Object.freeze({
  // Canonical form matches `.mcp.json` (no trailing slash).
  railwayUrl: "https://mcp.railway.com",
  supabaseUrl: "https://mcp.supabase.com/mcp",
  supabaseProjectRef: "sjrfecxgysukkwxsowpy",
  supabaseFeatures: Object.freeze(["development", "docs"]),
});

/** Project `.codex/config.toml` registrations — disabled by default, secret-free URLs only. */
export const expectedCodexProjectMcpServers = Object.freeze({
  figma_cloud: Object.freeze({
    url: "https://mcp.figma.com/mcp",
    approvalMode: "writes",
  }),
  railway: Object.freeze({
    url: expectedMcpConfiguration.railwayUrl,
    approvalMode: "writes",
  }),
  sentry_cloud: Object.freeze({
    url: "https://mcp.sentry.dev/mcp",
    approvalMode: "writes",
  }),
  supabase_cloud: Object.freeze({
    // URL validated with the same project/read-only/feature rules as `.mcp.json`.
    kind: "supabase",
    approvalMode: "prompt",
  }),
});

const allowedCodexProjectMcpKeys = Object.freeze(["default_tools_approval_mode", "enabled", "url"]);

const forbiddenCodexProjectMcpKeys = Object.freeze([
  "bearer_token_env_var",
  "command",
  "env",
  "env_http_headers",
  "env_vars",
  "headers",
  "http_headers",
]);

function parseTomlScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (isQuotedTomlScalar(trimmed)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isQuotedTomlScalar(value) {
  const quote = value[0];
  return (quote === '"' || quote === "'") && value.endsWith(quote);
}

function parseCodexMcpTableHeader(line, state) {
  const nested = line.match(/^\[mcp_servers\.([A-Za-z0-9_-]+)\./);
  if (nested) {
    state.current = nested[1];
    state.servers[state.current] ??= {};
    state.nestedServers.add(state.current);
    return true;
  }
  const table = line.match(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]$/);
  if (table) {
    state.current = table[1];
    state.servers[state.current] ??= {};
    return true;
  }
  if (!line.startsWith("[")) return false;
  state.current = null;
  return true;
}

function parseCodexMcpSetting(line, state) {
  if (!state.current) {
    const dotted = line.match(/^mcp_servers\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (dotted) {
      state.servers[dotted[1]] ??= {};
      state.servers[dotted[1]][dotted[2]] = parseTomlScalar(dotted[3]);
    }
    return;
  }
  const keyValue = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
  if (!keyValue) {
    state.unparsedServers.add(state.current);
    return;
  }
  state.servers[state.current][keyValue[1]] = parseTomlScalar(keyValue[2]);
}

/**
 * Parse `[mcp_servers.name]` tables from a Codex project config.toml.
 * Supports only the scalar keys this gate governs.
 * @param {string} text
 * @returns {{ servers: Record<string, Record<string, unknown>>, nestedServers: Set<string>, unparsedServers: Set<string> }}
 */
export function parseCodexProjectMcpServers(text) {
  /** @type {Record<string, Record<string, unknown>>} */
  const servers = {};
  const nestedServers = new Set();
  const unparsedServers = new Set();
  const state = { servers, nestedServers, unparsedServers, current: null };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (parseCodexMcpTableHeader(line, state)) continue;
    parseCodexMcpSetting(line, state);
  }
  return { servers, nestedServers, unparsedServers };
}

function validateSupabaseMcpUrl(urlString, label, errors) {
  try {
    const url = new URL(urlString);
    if (`${url.origin}${url.pathname}` !== expectedMcpConfiguration.supabaseUrl) {
      errors.push(`${label} must use the official hosted endpoint.`);
    }
    if (url.searchParams.get("project_ref") !== expectedMcpConfiguration.supabaseProjectRef) {
      errors.push(`${label} must be scoped to the expected project.`);
    }
    if (url.searchParams.get("read_only") !== "true") {
      errors.push(`${label} must keep the production project read-only.`);
    }
    const queryNames = [...url.searchParams.keys()].sort();
    if (JSON.stringify(queryNames) !== JSON.stringify(["features", "project_ref", "read_only"])) {
      errors.push(`${label} must not include additional query parameters.`);
    }
    const features = (url.searchParams.get("features") ?? "").split(",").filter(Boolean).sort();
    if (JSON.stringify(features) !== JSON.stringify(expectedMcpConfiguration.supabaseFeatures)) {
      errors.push(`${label} must expose only the approved read-only feature groups.`);
    }
  } catch {
    errors.push(`${label} URL must be valid.`);
  }
}

function validateProjectModelDefaults(text, errors) {
  const rootConfiguration = text.split(/^\s*\[/m, 1)[0];
  if (
    /^\s*(?:(?:model|model_reasoning_effort)|(["'])(?:model|model_reasoning_effort)\1)\s*=/m.test(rootConfiguration)
  ) {
    errors.push(
      ".codex/config.toml must not set repository-wide model or model_reasoning_effort; leave them to the task or desktop picker.",
    );
  }
}

function validateProjectMcpServerNames(servers, expectedNames, errors) {
  const actualNames = Object.keys(servers).sort();
  if (JSON.stringify(actualNames) === JSON.stringify(expectedNames)) return;
  const unexpectedNames = actualNames.filter((name) => !expectedNames.includes(name));
  const missingNames = expectedNames.filter((name) => !actualNames.includes(name));
  const details = [
    unexpectedNames.length ? `unexpected: ${unexpectedNames.join(", ")}` : null,
    missingNames.length ? `missing: ${missingNames.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  errors.push(
    `.codex/config.toml must register exactly these MCP servers: ${expectedNames.join(", ")}.${details ? ` ${details}.` : ""} Use the canonical railway template name; stale railway_cloud registrations are host-local OAuth apps and must not be reintroduced here.`,
  );
}

function validateProjectMcpServer(name, server, nestedServers, unparsedServers, errors) {
  if (!server) return;
  const label = `.codex/config.toml ${name}`;
  const expected = expectedCodexProjectMcpServers[name];
  if (server.enabled !== false) {
    errors.push(
      `${label} must set enabled = false (opt in via $CODEX_HOME/config.toml or a never-committed local edit; do not commit enabled = true).`,
    );
  }
  if (server.default_tools_approval_mode !== expected.approvalMode) {
    const reason =
      expected.approvalMode === "writes"
        ? "write-capable tools require explicit approval"
        : "the production server is constrained read-only";
    errors.push(`${label} must set default_tools_approval_mode = "${expected.approvalMode}" because ${reason}.`);
  }
  for (const key of Object.keys(server)) {
    const rootKey = key.split(".")[0];
    if (forbiddenCodexProjectMcpKeys.includes(rootKey)) {
      errors.push(`${label} must not embed ${rootKey}; keep OAuth credentials in the host store.`);
    } else if (!allowedCodexProjectMcpKeys.includes(key)) {
      errors.push(`${label} must be URL-only; unsupported key ${key}.`);
    }
  }
  if (nestedServers.has(name)) {
    errors.push(`${label} must not declare nested tool override tables in the shared project config.`);
  }
  if (unparsedServers.has(name)) errors.push(`${label} contains unsupported or unparsed entries.`);
  if (typeof server.url !== "string" || !server.url) {
    errors.push(`${label} must declare a secret-free url.`);
    return;
  }
  if (expected.kind === "supabase") validateSupabaseMcpUrl(server.url, label, errors);
  else if (server.url !== expected.url) errors.push(`${label} must use the pinned endpoint ${expected.url}.`);
}

/**
 * Project `.codex/config.toml` must register the approved Desktop/CLI MCP surface
 * as disabled URL-only templates. Hosted tools require separately installed apps.
 * @param {string} text
 * @returns {string[]}
 */
export function validateCodexProjectMcpConfiguration(text) {
  const errors = [];
  validateProjectModelDefaults(text, errors);
  const { servers, nestedServers, unparsedServers } = parseCodexProjectMcpServers(text);
  const expectedNames = Object.keys(expectedCodexProjectMcpServers).sort();
  validateProjectMcpServerNames(servers, expectedNames, errors);
  for (const name of expectedNames) {
    validateProjectMcpServer(name, servers[name], nestedServers, unparsedServers, errors);
  }
  return errors;
}

/** Known hosted connector names that may appear in a fresh-task inventory. */
export const knownHostedAppInventoryNames = Object.freeze([
  "github",
  "railway",
  "supabase",
  "figma",
  "sentry",
  "slack",
  "linear",
  "figma_cloud",
  "sentry_cloud",
  "supabase_cloud",
]);

/** Host-local names that must be removed before a connected task is trusted. */
export const staleHostedAppInventoryNames = Object.freeze(["railway_cloud"]);

/**
 * Read an explicit, non-secret hosted app inventory supplied by a fresh task.
 * The repository cannot discover this inventory itself.
 * @param {string[]} args
 * @returns {string[] | null}
 */
export function parseHostedAppInventoryArgument(args) {
  const prefix = "--hosted-app-inventory=";
  const argument = args.find((value) => value.startsWith(prefix));
  if (!argument) return null;
  return argument
    .slice(prefix.length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Reject malformed or ambiguous attempts to supply hosted inventory evidence.
 * @param {string[]} args
 * @returns {string[]}
 */
export function validateHostedAppInventoryArguments(args) {
  const exactPrefix = "--hosted-app-inventory=";
  const exactArguments = args.filter((value) => value.startsWith(exactPrefix));
  const supportedArguments = new Set(["--environment", "--runtime"]);
  const unsupportedArguments = args.filter((value) => !supportedArguments.has(value) && !value.startsWith(exactPrefix));
  const errors = [];
  if (unsupportedArguments.length > 0) {
    errors.push(
      "Unsupported Cloud-check argument; hosted app inventory must use exactly --hosted-app-inventory=<comma-separated-apps>.",
    );
  }
  if (exactArguments.length > 1) {
    errors.push("Hosted app inventory may be supplied only once.");
  }
  return errors;
}

/**
 * Format hosted-app inventory for sanitized capability output.
 * Never echo arbitrary operator-supplied strings — only allowlisted presence flags.
 * @param {string[] | null} appNames
 * @returns {string}
 */
export function hostedAppInventoryCapabilityLine(appNames) {
  if (appNames === null) return "hosted_app.inventory=external-unverified-until-fresh-task";
  const normalizedNames = appNames.map((name) => name.toLowerCase());
  const set = new Set(normalizedNames);
  const unknownCount = normalizedNames.filter(
    (name) => !knownHostedAppInventoryNames.includes(name) && !staleHostedAppInventoryNames.includes(name),
  ).length;
  const parts = [
    `count=${appNames.length}`,
    ...knownHostedAppInventoryNames.map((name) => `${name}=${set.has(name)}`),
    ...staleHostedAppInventoryNames.map((name) => `stale_${name}=${set.has(name)}`),
    `unknown=${unknownCount}`,
  ];
  return `hosted_app.inventory=provided ${parts.join(" ")}`;
}

/**
 * Validate only host-reported app names. This does not turn repository config
 * into hosted-tool proof or attempt to inspect OAuth state.
 * @param {string[] | null} appNames
 * @returns {string[]}
 */
export function validateHostedAppInventory(appNames) {
  if (appNames === null) return [];
  const errors = [];
  if (appNames.length === 0) {
    errors.push("Hosted app inventory was supplied but contained no app names.");
    return errors;
  }
  const normalizedNames = appNames.map((name) => name.toLowerCase());
  const invalidNames = normalizedNames.filter((name) => !/^[A-Za-z0-9_.-]+$/.test(name));
  if (invalidNames.length > 0) {
    errors.push("Hosted app inventory names may contain only letters, numbers, dot, underscore, and hyphen.");
  }
  const credentialShapedNames = appNames.filter((name) => redactSensitiveText(name) !== name || name.length > 128);
  if (credentialShapedNames.length > 0) {
    errors.push(
      "Hosted app inventory appears to contain a credential; supply connector names only, never tokens or secrets.",
    );
  }
  const unrecognizedNames = normalizedNames.filter(
    (name) =>
      /^[A-Za-z0-9_.-]+$/.test(name) &&
      !knownHostedAppInventoryNames.includes(name) &&
      !staleHostedAppInventoryNames.includes(name),
  );
  if (unrecognizedNames.length > 0) {
    errors.push(
      "Hosted app inventory contains unrecognized connector identifiers; update the checker allowlist before accepting them as evidence.",
    );
  }
  if (normalizedNames.some((name) => staleHostedAppInventoryNames.includes(name))) {
    errors.push(
      "Hosted app inventory contains stale railway_cloud; remove or reconnect that host-local app, then start a fresh task and supply the new inventory.",
    );
  }
  return errors;
}

export const providerCredentialVariables = Object.freeze([
  ...providerEnvironmentKeys,
  "RAILWAY_API_TOKEN",
  "RAILWAY_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "CODEX_CLOUD_GITHUB_PAT",
  "GITLAB_TOKEN",
  "GLAB_TOKEN",
  "CODEX_TRIGGER_TOKEN",
  "HEALTH_DEEP_PROBE_SECRET",
  "INDEXING_V3_AGENT_SECRET",
  "CROSS_TENANT_SERVICE_ROLE_KEY",
  "FIGMA_CLIENT_ID",
  "FIGMA_CLIENT_SECRET",
  "FIGMA_ACCESS_TOKEN",
  "FIGMA_PERSONAL_ACCESS_TOKEN",
  "FIGMA_TOKEN",
  "FIGMA_NPM_TOKEN",
]);

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function requireMatch(errors, value, pattern, message) {
  if (!pattern.test(value)) errors.push(message);
}

function exactVersionPattern(version) {
  return new RegExp(`\\b${version.replaceAll(".", "\\.")}\\b`);
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function obsoleteNpmProxyVariables(env = process.env) {
  return ["npm_config_http_proxy", "npm_config_https_proxy", "npm_config_proxy"].filter(
    (name) => Object.hasOwn(env, name) && Boolean(env[name]),
  );
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function configuredProviderCredentialNames(env = process.env) {
  return providerCredentialVariables.filter((name) => Object.hasOwn(env, name) && Boolean(env[name]));
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env] */
export function validateCodexCloudEnvironment(env = process.env) {
  const errors = [];
  if (env.CODEX_CLOUD !== "1") errors.push("CODEX_CLOUD must be 1 in the Cloud agent shell.");

  const accessProfile = env.CODEX_CLOUD_ACCESS_PROFILE ?? "offline";
  if (!["offline", "connected"].includes(accessProfile)) {
    errors.push("CODEX_CLOUD_ACCESS_PROFILE must be offline or connected.");
    return errors;
  }

  const configured = configuredProviderCredentialNames(env);
  if (configured.length > 0) {
    errors.push(
      `${accessProfile === "offline" ? "Offline" : "Connected"} mode exposes provider environment variables: ${configured.join(", ")}.`,
    );
  }

  if (accessProfile === "offline") {
    for (const [name, expected] of Object.entries({
      RAG_PROVIDER_MODE: "offline",
      NEXT_PUBLIC_DEMO_MODE: "true",
      PLAYWRIGHT_OFFLINE_MODE: "true",
    })) {
      if (env[name] !== expected) errors.push(`${name} must be ${expected} in offline mode.`);
    }
    return errors;
  }

  for (const [name, allowed] of Object.entries({
    RAG_PROVIDER_MODE: ["offline"],
    NEXT_PUBLIC_DEMO_MODE: ["true", "false"],
    PLAYWRIGHT_OFFLINE_MODE: ["true", "false"],
  })) {
    if (!allowed.includes(env[name])) errors.push(`${name} must be an approved value in connected mode.`);
  }
  return errors;
}

export function parseMcpServerMetadata(text) {
  const parsed = JSON.parse(text);
  const servers = parsed?.mcpServers;
  if (!servers || Array.isArray(servers) || typeof servers !== "object") {
    throw new Error(".mcp.json must contain an mcpServers object.");
  }
  return Object.entries(servers).map(([name, server]) => mcpServerMetadata(name, server));
}

function mcpServerMetadata(name, server) {
  let endpoint = "none";
  let queryNames = [];
  if (typeof server?.url === "string") {
    const url = new URL(server.url);
    endpoint = `${url.origin}${url.pathname}`;
    queryNames = [...url.searchParams.keys()].sort();
  }
  let type = "invalid";
  if (typeof server?.type === "string") type = server.type;
  else if (typeof server?.command === "string") type = "stdio";
  const validEnvironment = server?.env && !Array.isArray(server.env) && typeof server.env === "object";
  return {
    name,
    type,
    command: typeof server?.command === "string" ? server.command : "none",
    endpoint,
    queryNames,
    environmentNames: validEnvironment ? Object.keys(server.env).sort() : [],
  };
}

function parseMcpConfiguration(text) {
  try {
    return { parsed: JSON.parse(text), error: null };
  } catch (error) {
    return {
      parsed: null,
      error: `.mcp.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validateMcpServerInventory(servers, errors) {
  const serverNames = Object.keys(servers).sort();
  if (JSON.stringify(serverNames) !== JSON.stringify(["railway", "supabase"])) {
    errors.push("Desktop/CLI .mcp.json must contain only Railway and Supabase.");
  }
  for (const name of ["railway", "supabase"]) {
    if (servers[name]?.env !== undefined || servers[name]?.headers !== undefined) {
      errors.push(`${name} MCP must use OAuth without embedded environment variables or headers.`);
    }
  }
}

function validateRailwayMcpServer(railway, errors) {
  if (railway?.type !== "http" || railway?.url !== expectedMcpConfiguration.railwayUrl.replace(/\/$/, "")) {
    errors.push("Railway MCP must use Railway's official remote OAuth endpoint.");
  }
}

function validateSupabaseMcpServer(supabase, errors) {
  if (supabase?.type !== "http" || typeof supabase?.url !== "string") {
    errors.push("Supabase MCP must use the hosted HTTP endpoint.");
    return;
  }
  validateSupabaseMcpUrl(supabase.url, "Supabase MCP", errors);
}

export function validateMcpConfiguration(text) {
  const errors = [];
  const { parsed, error } = parseMcpConfiguration(text);
  if (error) return [error];
  const servers = parsed?.mcpServers;
  if (!servers || Array.isArray(servers) || typeof servers !== "object") {
    return [".mcp.json must contain an mcpServers object."];
  }
  validateMcpServerInventory(servers, errors);
  validateRailwayMcpServer(servers.railway, errors);
  validateSupabaseMcpServer(servers.supabase, errors);
  return errors;
}

function approvedModeValue(value, allowed) {
  return allowed.includes(value) ? value : "invalid";
}

export function codexCloudValidationScope({ runtime = false, environment = false, browserInstallSkipped = false }) {
  if (runtime && browserInstallSkipped) {
    return "static, environment, and source-only runtime (browser validation skipped)";
  }
  if (runtime) return "static, environment, and runtime";
  if (environment) return "static and environment";
  return "static";
}

function commandAvailable(command) {
  return spawnSync(command, ["--version"], { encoding: "utf8", shell: false }).status === 0;
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env] */
export function sanitizedCloudCapabilityLines(env = process.env, options = {}) {
  const origin = options.origin ?? inspectOriginRemote(repoRoot);
  const codexCliAvailable = options.codexCliAvailable ?? commandAvailable("codex");
  const safeGitHelper = options.safeGitHelper ?? hasSafeGitHubCredentialHelper(repoRoot);
  const mcpServers = options.mcpServers ?? parseMcpServerMetadata(read(".mcp.json"));
  const checkout = options.checkout ?? gitCheckoutFreshness(repoRoot, env);
  const lines = [
    `hosted_workspace.class_documented=${expectedHostedWorkspaceClass}`,
    `CODEX_CLOUD=${approvedModeValue(env.CODEX_CLOUD, ["1"])}`,
    `CODEX_CLOUD_ACCESS_PROFILE=${approvedModeValue(env.CODEX_CLOUD_ACCESS_PROFILE ?? "offline", ["offline", "connected"])}`,
    `RAG_PROVIDER_MODE=${approvedModeValue(env.RAG_PROVIDER_MODE, ["offline"])}`,
    `NEXT_PUBLIC_DEMO_MODE=${approvedModeValue(env.NEXT_PUBLIC_DEMO_MODE, ["true", "false"])}`,
    `PLAYWRIGHT_OFFLINE_MODE=${approvedModeValue(env.PLAYWRIGHT_OFFLINE_MODE, ["true", "false"])}`,
  ];
  for (const name of providerCredentialVariables) lines.push(`${name}.present=${Boolean(env[name])}`);
  lines.push(hostedAppInventoryCapabilityLine(options.hostedAppInventory ?? null));
  lines.push("provider_route.github=codex-native-connector");
  lines.push("provider_route.railway=chatgpt-official-app");
  lines.push("provider_route.supabase=chatgpt-project-scoped-read-only-app");
  lines.push(`codex.cli_available=${codexCliAvailable}`);
  lines.push(pythonWorkerVersionLine(env.CODEX_CLOUD_OCR_PYTHON));
  lines.push(`git.origin_configured=${origin.configured}`);
  lines.push(`git.origin_repository_match=${origin.repositoryMatch}`);
  lines.push(`git.origin_credential_embedded=${origin.credentialsEmbedded}`);
  lines.push(`git.github_cli_helper_configured=${safeGitHelper}`);
  lines.push(`git.head=${checkout.head}`);
  lines.push(`git.local_main=${checkout.localMain}`);
  lines.push(`git.origin_main=${checkout.originMain}`);
  lines.push(`git.expected_base=${checkout.expectedBase}`);
  lines.push(`git.expected_base_ancestor=${checkout.expectedBaseAncestor}`);
  lines.push(`git.checkout_freshness=${checkout.freshness}`);
  for (const server of mcpServers) {
    lines.push(
      `desktop_cli_mcp.template=${server.name} type=${server.type} command=${server.command} endpoint=${server.endpoint} query_names=${server.queryNames.join(",") || "none"} environment_names=${server.environmentNames.join(",") || "none"}`,
    );
  }
  return lines;
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env] */
export function localGitBaseline(root = process.cwd(), env = process.env) {
  for (const ref of ["refs/remotes/origin/main", "refs/heads/main"]) {
    const result = spawnSync("git", ["show-ref", "--verify", "--quiet", ref], {
      cwd: root,
      stdio: "ignore",
    });
    if (result.status === 0) return ref;
  }
  if (env.CODEX_CLOUD === "1") {
    const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], {
      cwd: root,
      stdio: "ignore",
    });
    if (result.status === 0) return "HEAD";
  }
  return null;
}

function fullGitRevision(root, ref) {
  const result = spawnSync("git", ["rev-parse", "--verify", ref], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  return result.status === 0 ? String(result.stdout ?? "").trim() : "unavailable";
}

function normalizedExpectedBase(root, value) {
  if (!value) return "unset";
  const candidate = String(value);
  if (!/^[0-9a-f]{40}$/i.test(candidate)) return "invalid";
  const revision = fullGitRevision(root, `${candidate}^{commit}`);
  return /^[0-9a-f]{40}$/i.test(revision) ? revision.toLowerCase() : "invalid";
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env] */
export function gitCheckoutFreshness(root = process.cwd(), env = process.env) {
  const head = fullGitRevision(root, "HEAD");
  const localMain = fullGitRevision(root, "refs/heads/main");
  const originMain = fullGitRevision(root, "refs/remotes/origin/main");
  const expectedBase = normalizedExpectedBase(root, env.CODEX_CLOUD_EXPECTED_BASE_SHA);
  let expectedBaseAncestor = "unverified";
  if (expectedBase !== "unset" && expectedBase !== "invalid" && head !== "unavailable") {
    const result = spawnSync("git", ["merge-base", "--is-ancestor", expectedBase, "HEAD"], {
      cwd: root,
      stdio: "ignore",
      shell: false,
    });
    expectedBaseAncestor = result.status === 0 ? "true" : "false";
  }
  const taskOnly = localMain === "unavailable" && originMain === "unavailable";
  const freshness =
    expectedBaseAncestor === "true"
      ? "verified"
      : expectedBaseAncestor === "false"
        ? "invalid"
        : taskOnly
          ? "unverified"
          : "branch-reference-available";
  return { head, localMain, originMain, expectedBase, expectedBaseAncestor, freshness };
}

export function executableFile(filePath) {
  try {
    return statSync(filePath).isFile() && (accessSync(filePath, constants.X_OK), true);
  } catch {
    return false;
  }
}

export async function playwrightBrowserErrors(browserTypes, timeout = 15_000) {
  const errors = [];
  for (const [name, browserType] of Object.entries(browserTypes)) {
    if (!executableFile(browserType.executablePath())) {
      errors.push(`${name} browser executable is unavailable.`);
      continue;
    }
    let browser;
    try {
      browser = await browserType.launch({ headless: true, timeout });
    } catch (error) {
      errors.push(`${name} browser launch failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await browser?.close();
    }
  }
  return errors;
}

export const pythonWorkerImports = ["fitz", "PIL", "pytesseract", "medspacy"];

/**
 * @param {string} pythonCommand
 * @param {(
 *   command: string,
 *   args: string[],
 *   options?: { encoding?: BufferEncoding; shell?: boolean },
 * ) => { status: number | null }} [run]
 * @returns {string | null}
 */
export function pythonWorkerImportError(pythonCommand, run = spawnSync) {
  if (!pythonCommand || !executableFile(pythonCommand)) {
    return "The configured Codex Cloud OCR Python executable is unavailable.";
  }
  const result = run(pythonCommand, ["-c", `import ${pythonWorkerImports.join(", ")}`], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status === 0) return null;
  return `Python worker imports failed: ${pythonWorkerImports.join(", ")}.`;
}

export function pythonWorkerDependencyErrors(pythonCommand, run = spawnSync) {
  if (!pythonCommand || !executableFile(pythonCommand)) {
    return ["The configured Codex Cloud OCR Python executable is unavailable."];
  }
  const errors = [];
  const pipCheck = run(pythonCommand, ["-m", "pip", "check"], {
    encoding: "utf8",
    shell: false,
  });
  if (pipCheck.status !== 0) errors.push("Python worker dependency conflicts were reported by pip check.");

  const requirements = readFileSync(path.join(repoRoot, "worker/python/requirements-cloud.txt"));
  const expectedHash = createHash("sha256").update(requirements).digest("hex");
  const markerPath = path.resolve(path.dirname(pythonCommand), "..", ".requirements-cloud.sha256");
  let installedHash = "";
  try {
    installedHash = readFileSync(markerPath, "utf8").trim();
  } catch {
    errors.push("Python worker requirements fingerprint is missing; rerun Cloud setup.");
  }
  if (installedHash && installedHash !== expectedHash) {
    errors.push("Python worker requirements fingerprint is stale; rerun Cloud setup.");
  }

  const versions = run(
    pythonCommand,
    [
      "-c",
      "from importlib.metadata import version; print('medspacy=%s spacy=%s' % (version('medspacy'), version('spacy')))",
    ],
    { encoding: "utf8", shell: false },
  );
  if (versions.status !== 0) errors.push("Python worker medspacy/spacy version reporting failed.");
  return errors;
}

export function pythonWorkerVersionLine(pythonCommand, run = spawnSync) {
  if (!pythonCommand || !executableFile(pythonCommand)) return "python.worker_versions=unavailable";
  const result = run(
    pythonCommand,
    [
      "-c",
      "from importlib.metadata import version; print('medspacy=%s spacy=%s' % (version('medspacy'), version('spacy')))",
    ],
    { encoding: "utf8", shell: false },
  );
  return result.status === 0
    ? `python.worker_versions=${String(result.stdout ?? "")
        .trim()
        .replaceAll(/\s+/g, ",")}`
    : "python.worker_versions=unavailable";
}

function cloudSetupLogicalLines(setupText) {
  const setup = setupText.replace(/\\\r?\n[\t ]*/gu, " ");
  return setup
    .split(/\r?\n/gu)
    .map((line, index) => ({ text: line.trim(), index }))
    .filter(({ text }) => text && !text.startsWith("#"));
}

function cloudProjectInstallCommands(logicalLines) {
  const installCommands = logicalLines.filter(({ text }) => /\bnpm\s+(?:ci|install|i)(?:\s|$)/u.test(text));
  return installCommands.filter(({ text }) => {
    const tokens = text.split(/\s+/u);
    return !tokens.includes("--global") && !tokens.includes("-g");
  });
}

function validateCloudInstallPlacement(logicalLines, command, errors) {
  const nodeDependenciesStart = logicalLines.findIndex(({ text }) => text === 'setup_step="node-dependencies"');
  const nextStep = logicalLines.findIndex(
    ({ text }, index) => index > nodeDependenciesStart && /^setup_step=/u.test(text),
  );
  const commandPosition = logicalLines.indexOf(command);
  if (
    nodeDependenciesStart === -1 ||
    commandPosition <= nodeDependenciesStart ||
    (nextStep !== -1 && commandPosition >= nextStep)
  ) {
    errors.push('Cloud project dependency install must run inside the "node-dependencies" setup step.');
  }
}

function validateCloudInstallCommand(command, errors) {
  if (/[;&|`$()]/u.test(command.text)) {
    errors.push("Cloud project dependency install must be a direct, unchained command without expansion.");
    return;
  }
  const tokens = command.text.split(/\s+/u);
  const expectedFlags = ["--include=dev", "--prefer-offline", "--no-audit", "--no-fund"];
  const actualFlags = tokens.slice(2);
  const commandIsNpmCi = tokens[0] === "npm" && tokens[1] === "ci";
  const flagsMatch =
    actualFlags.length === expectedFlags.length &&
    expectedFlags.every((flag) => actualFlags.includes(flag)) &&
    new Set(actualFlags).size === expectedFlags.length;
  if (!commandIsNpmCi || !flagsMatch) {
    errors.push(
      `Cloud project dependency install must be npm ci with exactly these flags: ${expectedFlags.join(" ")}.`,
    );
  }
}

export function validateCloudNpmInstallContract(setupText) {
  const errors = [];
  const logicalLines = cloudSetupLogicalLines(setupText);
  const projectInstallCommands = cloudProjectInstallCommands(logicalLines);
  if (projectInstallCommands.length !== 1) {
    errors.push(
      `Cloud setup must contain exactly one project dependency install; found ${projectInstallCommands.length}.`,
    );
    return errors;
  }
  const command = projectInstallCommands[0];
  validateCloudInstallPlacement(logicalLines, command, errors);
  validateCloudInstallCommand(command, errors);
  return errors;
}

function readCodexCloudSetupSources() {
  return {
    packageJson: JSON.parse(read("package.json")),
    nodeVersion: read(".node-version").trim(),
    nvmVersion: read(".nvmrc").trim(),
    setup: read("scripts/setup-codex-cloud.sh"),
    pythonSelector: read("scripts/select-codex-cloud-python.sh"),
    maintenance: read("scripts/maintain-codex-cloud.sh"),
    commandShims: read("scripts/install-codex-cloud-command-shims.sh"),
    checkoutBaseRefresh: read("scripts/refresh-codex-cloud-base.sh"),
    rawEnvironmentProbe: read("scripts/check-codex-cloud-raw-env.sh"),
    githubShellAccess: read("scripts/check-github-shell-access.mjs"),
    patDelete: read("scripts/delete-codex-cloud-branch-with-pat.sh"),
    guide: read("docs/codex-cloud.md"),
    agents: read("AGENTS.md"),
    modularCloudAgents: read("docs/agents/codex-cloud-environment.md"),
    envExample: read(".env.example"),
    gitignore: read(".gitignore"),
    mcp: read(".mcp.json"),
    codexProjectConfig: read(".codex/config.toml"),
  };
}

function validateCloudToolchainContract(sources, errors) {
  const { packageJson, nodeVersion, nvmVersion, gitignore } = sources;
  // engines.node declares a minor-level floor rather than a bare major because
  // dev dependencies carry a floor that a "24.x" range cannot express.
  const engineRange = String(packageJson.engines?.node ?? "");
  const engineFloor = engineRange.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  const engineCeiling = engineRange.match(/<\s*(\d+)/);
  if (!engineFloor || !engineCeiling) {
    errors.push(
      `package.json engines.node must declare a floor and an exclusive major ceiling, e.g. ">=${nodeVersion}.15.0 <${Number(nodeVersion) + 1}". Found "${engineRange}".`,
    );
  } else if (engineFloor[1] !== nodeVersion || Number(engineCeiling[1]) !== Number(nodeVersion) + 1) {
    errors.push(`package.json engines.node major must match .node-version (${nodeVersion}).`);
  }
  if (packageJson.engines?.npm !== "11.x") errors.push("package.json must require npm 11.x.");
  if (!String(packageJson.packageManager ?? "").startsWith("npm@11.")) {
    errors.push("package.json packageManager must pin npm 11.x.");
  }
  if (nvmVersion !== nodeVersion) errors.push(".nvmrc and .node-version must match.");
  requireMatch(errors, gitignore, /^\/error\.log$/m, "Codex Cloud diagnostic error.log must stay ignored.");
}

export function cloudSetupContainsMcpRegistration(setup) {
  let quote = null;
  let ansiQuoted = false;
  let escaped = false;
  let wordStart = true;
  let uncommented = "";
  const substitutions = [];
  for (let index = 0; index < setup.length; index += 1) {
    const character = setup[index];
    if (escaped) {
      uncommented += character;
      escaped = false;
      continue;
    }
    if (quote !== "'" && character === "$" && ["(", "{"].includes(setup[index + 1])) {
      const opening = setup[++index];
      substitutions.push({ quote, closing: opening === "(" ? ")" : "}", depth: 1 });
      quote = null;
      ansiQuoted = false;
      uncommented += `$${opening}`;
      wordStart = true;
      continue;
    }
    if (quote !== "'" && character === "`") {
      const active = substitutions.at(-1);
      if (!quote && active?.closing === "`") {
        quote = substitutions.pop().quote;
        wordStart = false;
      } else {
        substitutions.push({ quote, closing: "`", depth: 1 });
        quote = null;
        wordStart = true;
      }
      ansiQuoted = false;
      uncommented += character;
      continue;
    }
    if (quote) {
      uncommented += character;
      if (character === quote) {
        quote = null;
        ansiQuoted = false;
      } else if (character === "\\" && (quote === '"' || ansiQuoted)) escaped = true;
      continue;
    }
    const active = substitutions.at(-1);
    if (active && active.closing !== "`") {
      if (character === active.closing) {
        active.depth -= 1;
        if (active.depth === 0) quote = substitutions.pop().quote;
        uncommented += character;
        wordStart = false;
        continue;
      }
      if (character === (active.closing === ")" ? "(" : "{")) active.depth += 1;
    }
    if (character === "#" && wordStart && active?.closing !== "}") {
      while (index < setup.length && setup[index] !== "\n") index += 1;
      uncommented += "\n";
      wordStart = true;
      continue;
    }
    uncommented += character;
    if (character === "'" || character === '"') {
      quote = character;
      ansiQuoted = character === "'" && setup[index - 1] === "$";
    } else if (character === "\\") escaped = true;
    wordStart = /[\s;|&()]/.test(character);
  }
  return /\bmcp_servers\b/.test(uncommented);
}

function validateCloudSetupLifecycleContract(sources, errors) {
  const { setup, pythonSelector, maintenance } = sources;
  for (const [pattern, message] of [
    [/expected_node_range=/, "Cloud setup must read the complete Node engine range."],
    [/node_version_supported/, "Cloud setup must validate the complete Node engine range."],
    [
      /node_version_supported "\$actual_node_version" \|\| fail/,
      "Cloud setup must fail closed if provisioning does not satisfy the Node engine range.",
    ],
    [/deno@2/, "Cloud setup must install Deno 2.x."],
    [/worker\/python\/requirements-cloud\.txt/, "Cloud setup must install the Python 3.12 Cloud worker lock."],
    [/select-codex-cloud-python\.sh/, "Cloud setup must load the version-aware Python selector."],
    [/select_codex_cloud_python/, "Cloud setup must resolve the required Python version explicitly."],
    [/CODEX_CLOUD_OCR_PYTHON/, "Cloud setup must expose the Python worker environment."],
    [/playwright install --with-deps chromium firefox webkit/, "Cloud setup must install every browser."],
    [/CODEX_CLOUD_ACCESS_PROFILE/, "Cloud setup must support explicit access profiles."],
    [/RAG_PROVIDER_MODE=offline/, "Cloud setup must default RAG to offline mode."],
    [/unset OPENAI_API_KEY/, "Cloud setup must remove raw provider variables from the agent shell."],
    [/\.bash_profile/, "Cloud setup must cover Bash login-profile precedence."],
    [/@openai\/codex/, "Cloud setup must install the Codex CLI."],
    [/ensure-codex-cloud-git-remote\.mjs/, "Cloud setup must restore a safe origin remote."],
    [/refresh-codex-cloud-base\.sh/, "Cloud setup must refresh and pin the task checkout base."],
    [/check:codex-cloud -- --runtime/, "Cloud setup must run runtime acceptance."],
    [
      /BEGIN clinical-kb-codex-cloud shell policy/,
      "Cloud setup must write the Codex shell policy inside a managed marker block.",
    ],
    [
      /Unmanaged \[shell_environment_policy\] table found/,
      "Cloud setup must reject unmanaged shell_environment_policy tables before rewriting config.toml.",
    ],
    [/Incomplete managed shell policy block/, "Cloud setup must reject incomplete managed shell policy marker blocks."],
    [
      /export RAG_PROVIDER_MODE="\$\{rag_provider_mode\}"/,
      "Cloud setup must pin the connected-mode retrieval value at setup time.",
    ],
    [/inherit = "all"/, "Cloud setup must configure Codex shell_environment_policy inheritance."],
    [/CODEX_CLOUD_SETUP_STOP_AFTER_POLICY/, "Cloud setup must expose a policy-only stop for behavior-level tests."],
  ]) {
    requireMatch(errors, setup, pattern, message);
  }
  errors.push(...validateCloudNpmInstallContract(setup));
  requireMatch(
    errors,
    pythonSelector,
    /local candidates=\("python\$\{expected_version\}" python3 python\)/,
    "Cloud Python selection must prefer the exact versioned interpreter before generic aliases.",
  );
  requireMatch(
    errors,
    pythonSelector,
    /actual_version=.*sys\.version_info\.major.*sys\.version_info\.minor/,
    "Cloud Python selection must verify each interpreter's major and minor version.",
  );
  if (!setup.includes(`codex_cli_version="${expectedCloudCliVersions.codex}"`)) {
    errors.push("Cloud setup Codex CLI version must match the checked runtime contract.");
  }
  for (const name of providerCredentialVariables) {
    if (!setup.includes(name)) errors.push(`Cloud setup must handle provider environment variable ${name}.`);
  }
  if (cloudSetupContainsMcpRegistration(setup)) {
    errors.push("Cloud setup must not generate MCP registrations; hosted apps are external to the repository.");
  }
  if (setup.includes("@railway/cli") || setup.includes('setup_step="railway-cli"')) {
    errors.push("Cloud setup must not install or invoke Railway CLI; hosted access comes from the authenticated app.");
  }
  if (/gh auth login|configure-codex-cloud-github-shell\.sh/.test(`${setup}\n${maintenance}`)) {
    errors.push(
      "Cloud lifecycle scripts must not persist setup-only GitHub credentials for the agent phase; use the native connector.",
    );
  }
}

function validateGithubShellAccessContract(githubShellAccess, errors) {
  for (const [pattern, message] of [
    [/expectedIdentity = "BigSimmo"/, "GitHub shell acceptance must pin the intended identity."],
    [/repository = "BigSimmo\/PsychSift"/, "GitHub shell acceptance must pin the intended repository."],
    [
      /requiredScopes = new Set\(\["repo", "workflow", "read:org", "gist"\]\)/,
      "GitHub shell acceptance must require the complete gh login and Actions scope set.",
    ],
    [/addPullRequestReviewThreadReply/, "GitHub shell acceptance must verify review-thread reply availability."],
    [/resolveReviewThread/, "GitHub shell acceptance must verify review-thread resolution availability."],
    [
      /"core\.hooksPath=\/dev\/null", "push", "--dry-run"/,
      "GitHub shell acceptance must isolate its non-mutating push from real-push hooks.",
    ],
    [/GH_DRY_RUN_REF_MUTATED/, "GitHub shell acceptance must verify that its dry-run probe ref stays absent."],
    [/GH_ACTIONS_RERUN_UNAVAILABLE/, "GitHub shell acceptance must verify the failed-job rerun command surface."],
    [/GH_ACTIONS_LOG_ACCESS_MISSING/, "GitHub shell acceptance must verify bounded Actions log access."],
    [/GH_ACTIONS_LOG_SAMPLE_MISSING/, "GitHub shell acceptance must reject skipped-job log samples."],
    [/GH_REVIEW_THREAD_READ_MISSING/, "GitHub shell acceptance must verify repository review-thread reads."],
    [
      /GH_REVIEW_THREAD_RESOLVE_PERMISSION_MISSING/,
      "GitHub shell acceptance must verify resolution permission on sampled unresolved threads.",
    ],
    [/GH_PR_SAMPLE_MISSING/, "GitHub shell acceptance must fail closed without a readable PR sample."],
    [/providerProbeTimeoutMilliseconds/, "GitHub shell acceptance must bound every provider subprocess."],
    [/runWithTransientRetry/, "GitHub shell acceptance must retry bounded transient provider failures."],
  ]) {
    requireMatch(errors, githubShellAccess, pattern, message);
  }
  for (const forbidden of ["CODEX_CLOUD_GITHUB_PAT", "gh auth token", "--force", "--force-with-lease"]) {
    if (githubShellAccess.includes(forbidden)) {
      errors.push(`GitHub shell acceptance must not read credentials or permit history rewriting (${forbidden}).`);
    }
  }
}

function validateProviderScrubAndInventory(sources, errors) {
  const { setup, envExample } = sources;
  const providerScrubIndex = setup.indexOf("unset OPENAI_API_KEY");
  const accessProfileBranchIndex = setup.indexOf('if [ "\\$CODEX_CLOUD_ACCESS_PROFILE" = "connected" ]');
  if (providerScrubIndex < 0 || accessProfileBranchIndex < 0 || providerScrubIndex > accessProfileBranchIndex) {
    errors.push("Cloud setup must scrub provider environment variables before selecting an access profile.");
  }
  const credentialLikeExampleNames = [
    ...envExample.matchAll(/^([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|DB_URL))=/gm),
  ].map(([, name]) => name);
  for (const name of credentialLikeExampleNames) {
    if (!providerCredentialVariables.includes(name)) {
      errors.push(`Cloud credential inventory must include .env.example variable ${name}.`);
    }
  }
}

function validateMaintenanceAndCommandShims(sources, errors) {
  const { maintenance, commandShims } = sources;
  for (const [pattern, message] of [
    [/exec bash scripts\/setup-codex-cloud\.sh/, "Maintenance must repair the full toolchain."],
    [/ensure-codex-cloud-git-remote\.mjs/, "Maintenance must preserve the safe origin remote."],
    [/refresh-codex-cloud-base\.sh/, "Maintenance must refresh and pin the task checkout base."],
  ]) {
    requireMatch(errors, maintenance, pattern, message);
  }
  for (const [pattern, message] of [
    [/nvm version/, "Cloud command shims must resolve the selected Node version without following their own wrappers."],
    [/clean_path=.*\.local.*bin/, "Cloud command shims must remove their directory before running child npm scripts."],
    [/mkdir -p "\$HOME\/\.local\/bin"/, "Cloud command shims must create their destination directory."],
    [/\.clinical-kb-codex-cloud\.sh/, "Cloud command shims must load the generated profile."],
  ]) {
    requireMatch(errors, commandShims, pattern, message);
  }
  if (!commandShims.includes('exec "$node_bin/$command_name" "\\$@"')) {
    errors.push("Cloud command shims must execute absolute Node commands.");
  }
}

function validateCheckoutAndRawEnvironmentContracts(sources, errors) {
  const { checkoutBaseRefresh, patDelete, rawEnvironmentProbe } = sources;
  requireMatch(
    errors,
    checkoutBaseRefresh,
    /git merge-base HEAD refs\/remotes\/origin\/main/,
    "Checkout-base refresh must pin the merge base shared by the task and origin/main.",
  );
  requireMatch(
    errors,
    checkoutBaseRefresh,
    /cloud-expected-base-sha/,
    "Checkout-base refresh must persist the verified base outside the repository.",
  );
  requireMatch(
    errors,
    patDelete,
    /CODEX_CLOUD.*use native Push/,
    "PAT deletion helper must reject the Codex Cloud agent phase and direct operators to native publication.",
  );
  requireMatch(errors, rawEnvironmentProbe, /never values/, "Raw Cloud environment probe must report names only.");
  requireMatch(
    errors,
    rawEnvironmentProbe,
    /known_launcher_defect_variables=\(OPENAI_BASE_URL\)/,
    "Raw Cloud environment probe must name-scope the OPENAI_BASE_URL launcher-defect allowance.",
  );
  requireMatch(
    errors,
    rawEnvironmentProbe,
    /FAIL-KNOWN: inherited documented launcher defect names/,
    "Raw Cloud environment probe must emit FAIL-KNOWN for the documented launcher defect.",
  );
  requireMatch(
    errors,
    rawEnvironmentProbe,
    /CONTINUE-RESTRICTED: OPENAI_BASE_URL can redirect OpenAI-bound traffic/,
    "Raw Cloud environment probe must warn that OPENAI_BASE_URL can redirect provider traffic.",
  );
  requireMatch(
    errors,
    rawEnvironmentProbe,
    /STOP: unexpected credential-bearing names require a fresh task/,
    "Raw Cloud environment probe must hard-stop on unexpected provider names.",
  );
  for (const name of providerCredentialVariables) {
    if (!rawEnvironmentProbe.includes(name)) {
      errors.push(`Raw Cloud environment probe must cover provider environment variable ${name}.`);
    }
  }
  for (const [pattern, message] of [
    [/\[\[ "\$branch" != -\* \]\]/, "PAT deletion helper must reject option-like branch names."],
    [/git check-ref-format --branch/, "PAT deletion helper must validate branch names."],
    [/git remote get-url --push --all origin/, "PAT deletion helper must validate effective push URLs."],
    [/GIT_ASKPASS/, "PAT deletion helper must use a temporary askpass program."],
    [/core\.hooksPath=\/dev\/null/, "PAT deletion helper must disable Git hooks before the token-bearing push."],
    [/https:\/\/github\.com\/BigSimmo\/PsychSift\.git/, "PAT deletion helper must require the credential-free origin."],
  ]) {
    requireMatch(errors, patDelete, pattern, message);
  }
}

function validateGuideAndMcpContracts(sources, errors) {
  const { guide, mcp, codexProjectConfig } = sources;
  for (const [pattern, message] of [
    [/bash scripts\/setup-codex-cloud\.sh/, "The guide must provide the setup command."],
    [/install-codex-cloud-command-shims\.sh/, "The guide must document the command-shim workaround."],
    [/CODEX_CLOUD_ACCESS_PROFILE=connected/, "The guide must document connected access."],
    [/CODEX_CLOUD_GITHUB_PAT/, "The guide must document the narrowly scoped PAT exception."],
    [/GitHub connector/, "The guide must document GitHub connector access."],
    [/Personal Pro/, "The guide must identify the active Personal Pro workspace."],
    [/split control plane/, "The guide must document the Personal Pro provider workaround."],
  ]) {
    requireMatch(errors, guide, pattern, message);
  }
  try {
    parseMcpServerMetadata(mcp);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  errors.push(...validateMcpConfiguration(mcp));
  errors.push(...validateCodexProjectMcpConfiguration(codexProjectConfig));
}

function validateForbiddenCloudBootstrapUsage(sources, errors) {
  const { setup, maintenance } = sources;
  for (const command of [
    "check:supabase-project",
    "test:live",
    "eval:rag",
    "eval:quality",
    "eval:retrieval",
    "verify:release",
  ]) {
    if (setup.includes(command) || maintenance.includes(command)) {
      errors.push(`Cloud bootstrap scripts must not invoke provider-capable command ${command}.`);
    }
  }
  for (const pattern of [
    /sjrfecxgysukkwxsowpy/i,
    /5deaad0b-675a-4c13-978e-5ca2b5b877f9/i,
    /sk-[A-Za-z0-9_-]{12,}/,
    /sb_secret_[A-Za-z0-9_-]{8,}/,
  ]) {
    if (pattern.test(setup) || pattern.test(maintenance)) {
      errors.push(`Cloud bootstrap scripts contain a live provider identifier matching ${pattern}.`);
    }
  }
}

function validateCloudAgentHeadings(sources, errors) {
  const cloudHeadingCount = (sources.modularCloudAgents.match(/^## Codex Cloud environment$/gm) ?? []).length;
  if (cloudHeadingCount !== 1) {
    errors.push(
      `docs/agents/codex-cloud-environment.md must contain exactly one Codex Cloud environment section; found ${cloudHeadingCount}.`,
    );
  }
  const rootHeadingCount = (sources.agents.match(/^## Codex Cloud environment$/gm) ?? []).length;
  if (rootHeadingCount !== 1) {
    errors.push(
      `AGENTS.md must contain exactly one Codex Cloud environment pointer section; found ${rootHeadingCount}.`,
    );
  }
}

export function validateCodexCloudSetup() {
  const errors = [];
  const sources = readCodexCloudSetupSources();
  validateCloudToolchainContract(sources, errors);

  validateCloudSetupLifecycleContract(sources, errors);
  validateGithubShellAccessContract(sources.githubShellAccess, errors);
  validateProviderScrubAndInventory(sources, errors);
  validateMaintenanceAndCommandShims(sources, errors);
  validateCheckoutAndRawEnvironmentContracts(sources, errors);
  validateGuideAndMcpContracts(sources, errors);

  validateForbiddenCloudBootstrapUsage(sources, errors);
  validateCloudAgentHeadings(sources, errors);
  return errors;
}

function commandVersion(command, args, expectedPattern) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status !== 0 || !expectedPattern.test(output)) {
    return `${command} ${args.join(" ")} failed its runtime check.`;
  }
  return null;
}

function repositoryCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status === 0) return null;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split(/\r?\n/).at(-1);
  return `${command} ${args.join(" ")} failed: ${output || `exit ${result.status}`}`;
}

function appendRuntimeCommandErrors(errors) {
  for (const error of [
    commandVersion("deno", ["--version"], /^deno 2\./m),
    commandVersion("tesseract", ["--version"], /^tesseract \d+\./m),
    commandVersion("codex", ["--version"], exactVersionPattern(expectedCloudCliVersions.codex)),
  ]) {
    if (error) errors.push(error);
  }
}

function appendPythonWorkerErrors(env, errors) {
  const pythonError = pythonWorkerImportError(env.CODEX_CLOUD_OCR_PYTHON);
  if (pythonError) errors.push(pythonError);
  else errors.push(...pythonWorkerDependencyErrors(env.CODEX_CLOUD_OCR_PYTHON));
}

function appendRepositoryRuntimeErrors(errors) {
  for (const error of [
    repositoryCommand(process.execPath, ["scripts/run-tsx.mjs", "scripts/check-runtime.ts"]),
    repositoryCommand(process.execPath, ["scripts/check-installed-lock-parity.mjs"]),
  ]) {
    if (error) errors.push(error);
  }
}

async function appendBrowserRuntimeErrors(env, errors) {
  if (env.CODEX_CLOUD_SKIP_BROWSER_INSTALL === "1") return;
  try {
    const { chromium, firefox, webkit } = await import("playwright");
    errors.push(...(await playwrightBrowserErrors({ chromium, firefox, webkit })));
  } catch (error) {
    errors.push(`Playwright browser validation failed: ${error.message}`);
  }
}

function appendCheckoutRuntimeErrors(env, errors) {
  const obsoleteProxyNames = obsoleteNpmProxyVariables(env);
  if (obsoleteProxyNames.length > 0) {
    errors.push(`Obsolete npm proxy variable names are set: ${obsoleteProxyNames.join(", ")}.`);
  }
  const baseline = localGitBaseline(repoRoot, env);
  const checkout = gitCheckoutFreshness(repoRoot, env);
  if (!baseline) {
    errors.push("Neither local main, origin/main, nor a Cloud task HEAD is available.");
  } else if (baseline === "HEAD" && checkout.freshness === "unverified" && env.CODEX_CLOUD_PROVISIONING !== "1") {
    errors.push(
      "Checkout freshness is unverified: set CODEX_CLOUD_EXPECTED_BASE_SHA to the intended merge/base commit.",
    );
  }
  if (checkout.expectedBaseAncestor === "false") {
    errors.push("CODEX_CLOUD_EXPECTED_BASE_SHA is not an ancestor of the current HEAD.");
  }
}

function appendOriginRuntimeErrors(errors) {
  const origin = inspectOriginRemote(repoRoot);
  if (!origin.configured) errors.push("origin is unavailable in the Cloud checkout.");
  else if (origin.credentialsEmbedded) errors.push("origin contains embedded credentials.");
  else if (!origin.repositoryMatch) errors.push(`origin must identify ${CODEX_CLOUD_REPOSITORY}.`);
}

export async function validateCodexCloudRuntime(env = process.env) {
  const errors = validateCodexCloudEnvironment(env);

  // Hosted Railway access is the OAuth ChatGPT/Codex app, not CLI token auth.
  // Do not reintroduce `railway --version` or RAILWAY_API_TOKEN-vs-RAILWAY_TOKEN
  // substitution checks here unless a future workflow restores CLI token auth.
  appendRuntimeCommandErrors(errors);
  appendPythonWorkerErrors(env, errors);
  appendRepositoryRuntimeErrors(errors);
  await appendBrowserRuntimeErrors(env, errors);
  appendCheckoutRuntimeErrors(env, errors);
  appendOriginRuntimeErrors(errors);
  return errors;
}

if (isDirectEntrypoint(import.meta.url)) {
  const errors = validateCodexCloudSetup();
  const commandArguments = process.argv.slice(2);
  const hostedAppArgumentErrors = validateHostedAppInventoryArguments(commandArguments);
  const hostedAppInventory = parseHostedAppInventoryArgument(commandArguments);
  const hostedAppInventoryErrors = validateHostedAppInventory(hostedAppInventory);
  const hostedAppInputErrors = [...hostedAppArgumentErrors, ...hostedAppInventoryErrors];
  errors.push(...hostedAppInputErrors);
  const runtime = process.argv.includes("--runtime");
  const environment = runtime || process.env.CODEX_CLOUD === "1" || process.argv.includes("--environment");
  if (runtime) errors.push(...(await validateCodexCloudRuntime()));
  else if (environment) errors.push(...validateCodexCloudEnvironment());
  if (
    runtime &&
    process.env.CODEX_CLOUD_PROVISIONING === "1" &&
    gitCheckoutFreshness(repoRoot).freshness === "unverified"
  ) {
    console.warn(
      "[Codex Cloud Check] WARN: checkout freshness is unverified during provisioning; run explicit acceptance with CODEX_CLOUD_EXPECTED_BASE_SHA.",
    );
  }
  if (environment && hostedAppInputErrors.length === 0) {
    console.log("[Codex Cloud Environment] sanitized effective modes and capabilities:");
    for (const line of sanitizedCloudCapabilityLines(process.env, { hostedAppInventory })) console.log(`  ${line}`);
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`[Codex Cloud Check] FAIL: ${error}`);
    process.exitCode = 1;
  } else {
    const scope = codexCloudValidationScope({
      runtime,
      environment,
      browserInstallSkipped: process.env.CODEX_CLOUD_SKIP_BROWSER_INSTALL === "1",
    });
    console.log(`[Codex Cloud Check] PASS: ${scope} Cloud contracts match.`);
  }
}
