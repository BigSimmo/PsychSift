import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  codexCloudValidationScope,
  cloudSetupContainsMcpRegistration,
  configuredProviderCredentialNames,
  expectedMcpConfiguration,
  executableFile,
  gitCheckoutFreshness,
  localGitBaseline,
  obsoleteNpmProxyVariables,
  hostedAppInventoryCapabilityLine,
  parseHostedAppInventoryArgument,
  parseMcpServerMetadata,
  playwrightBrowserErrors,
  providerCredentialVariables,
  pythonWorkerImportError,
  pythonWorkerVersionLine,
  pythonWorkerImports,
  sanitizedCloudCapabilityLines,
  validateCodexCloudEnvironment,
  validateCloudNpmInstallContract,
  validateCodexProjectMcpConfiguration,
  validateHostedAppInventory,
  validateHostedAppInventoryArguments,
  validateMcpConfiguration,
} from "../scripts/check-codex-cloud-setup.mjs";
import { providerEnvironmentKeys } from "../scripts/test-environment.mjs";
import {
  CODEX_CLOUD_ORIGIN_URL,
  ensureOriginRemote,
  inspectOriginRemote,
} from "../scripts/ensure-codex-cloud-git-remote.mjs";

const temporaryDirectories: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setupScript = "scripts/setup-codex-cloud.sh";
const bashCommand =
  process.platform === "win32"
    ? path.join(process.env.ProgramFiles || "C:\\Program Files", "Git/bin/bash.exe")
    : "bash";
const requiredPolicyExcludes = [
  "OPENAI_API_KEY",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "OPENAI_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_PROJECT_NAME",
  "SUPABASE_STAGING_PROJECT_REF",
  "SUPABASE_STAGING_PROJECT_NAME",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "CROSS_TENANT_SERVICE_ROLE_KEY",
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
  "E2E_AUTH_ENABLED",
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "ALLOW_PROVIDER_TESTS",
] as const;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function temporaryGitRepository() {
  const directory = temporaryDirectory("codex-cloud-git-");
  expect(spawnSync("git", ["init", "--quiet", "--initial-branch=task", directory]).status).toBe(0);
  return directory;
}

function git(directory: string, ...args: string[]) {
  return spawnSync("git", ["-C", directory, ...args], { encoding: "utf8" });
}

function bashPathEntry(entry: string) {
  if (process.platform !== "win32") return entry;
  return entry.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/");
}

function bashPathList(value: string) {
  if (process.platform !== "win32") return value;
  return value.split(path.delimiter).filter(Boolean).map(bashPathEntry).join(":");
}

function writeFakePython(directory: string, name: string, version: string) {
  const executable = path.join(directory, name);
  writeFileSync(executable, `#!/usr/bin/env bash\nprintf '%s\\n' '${version}'\n`);
  chmodSync(executable, 0o755);
  return executable;
}

function runSetupPolicyOnly(home: string, env: Record<string, string | undefined> = {}) {
  // The test redirects HOME to isolate the generated Codex config. Put the
  // running test process's Node binary first so version-manager launchers that
  // resolve their runtime through HOME remain usable until setup reaches the
  // policy-only stop.
  const nodeBin = path.dirname(process.execPath);
  const requestedPath = env.PATH || [nodeBin, process.env.PATH].filter(Boolean).join(path.delimiter);
  return spawnSync(bashCommand, [setupScript, "--policy-only-test-harness"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: bashPathEntry(home),
      CODEX_CLOUD_SETUP_STOP_AFTER_POLICY: "1",
      NODE_ENV: "test",
      ...env,
      PATH: bashPathList(requestedPath),
    },
  });
}

function readCodexConfig(home: string) {
  return readFileSync(path.join(home, ".codex/config.toml"), "utf8");
}

function readRuntimeProfile(home: string) {
  return readFileSync(path.join(home, ".clinical-kb-codex-cloud.sh"), "utf8");
}

describe("Codex Cloud environment contract", () => {
  it.each([
    'printf "%s\\n" "# [mcp_servers.hidden]"',
    "printf '%s\\n' '# [mcp_servers.hidden]'",
    'printf "%s\\n" "prefix # [mcp_servers.hidden]"',
    "printf '%s\\n' prefix\\ #mcp_servers.hidden",
    'printf "%s\\n" "first line\n# [mcp_servers.hidden]"',
    "printf '%s\\n' $'escaped\\' # [mcp_servers.hidden]'",
    'printf "%s" "$(printf "prefix # [mcp_servers.hidden]")"',
    'printf "%s" "`printf "prefix # [mcp_servers.hidden]"`"',
    'printf "%s" "${unused:-"prefix # [mcp_servers.hidden]"}"',
  ])("detects MCP output despite quoted or escaped hashes: %s", (source) => {
    expect(cloudSetupContainsMcpRegistration(source)).toBe(true);
  });

  it("ignores real full-line and inline shell comments", () => {
    expect(cloudSetupContainsMcpRegistration('# mcp_servers.hidden\nprintf "policy" # mcp_servers.hidden')).toBe(false);
    expect(cloudSetupContainsMcpRegistration('printf "%s" "$(printf policy)" # mcp_servers.hidden')).toBe(false);
  });

  it("keeps the checked-in setup reproducible and provider-safe", () => {
    const staticEnvironment = { ...process.env };
    delete staticEnvironment.CODEX_CLOUD;
    const result = spawnSync(process.execPath, ["scripts/check-codex-cloud-setup.mjs"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: staticEnvironment,
      shell: false,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("[Codex Cloud Check] PASS: static Cloud contracts match.");
  });

  it("keeps the Cloud npm install locked, cache-friendly, and lifecycle-capable", () => {
    const setup = readFileSync(new URL("../scripts/setup-codex-cloud.sh", import.meta.url), "utf8");

    expect(validateCloudNpmInstallContract(setup)).toEqual([]);
    expect(setup).toContain("require_npm_config ignore-scripts false");
    expect(setup).toContain("require_npm_config package-lock true");
    expect(setup).toContain("require_npm_config package-lock-only false");
    expect(setup).toContain("require_npm_config dry-run false");
  });

  it.each([
    [
      "reordered flags",
      'setup_step="node-dependencies"\n  npm ci --no-fund --include=dev --no-audit --prefer-offline\nsetup_step="next"',
      true,
    ],
    [
      "shell continuation",
      'setup_step="node-dependencies"\n  npm ci --include=dev \\\n    --prefer-offline --no-audit --no-fund\nsetup_step="next"',
      true,
    ],
    [
      "unrelated global installs",
      'npm install --global tool@1\nsetup_step="node-dependencies"\nnpm ci --include=dev --prefer-offline --no-audit --no-fund\nsetup_step="next"\nnpm i -g other@1',
      true,
    ],
    [
      "unsafe force flag",
      'setup_step="node-dependencies"\nnpm ci --include=dev --prefer-offline --no-audit --no-fund --force\nsetup_step="next"',
      false,
    ],
    [
      "unsafe legacy peer flag",
      'setup_step="node-dependencies"\nnpm ci --include=dev --prefer-offline --no-audit --no-fund --legacy-peer-deps\nsetup_step="next"',
      false,
    ],
    [
      "mutable local install",
      'setup_step="node-dependencies"\nnpm install --include=dev --prefer-offline --no-audit --no-fund\nsetup_step="next"',
      false,
    ],
    [
      "duplicate project installs",
      'setup_step="node-dependencies"\nnpm ci --include=dev --prefer-offline --no-audit --no-fund\nnpm ci --include=dev --prefer-offline --no-audit --no-fund\nsetup_step="next"',
      false,
    ],
    [
      "variable-expanded command",
      'setup_step="node-dependencies"\n$npm_command ci --include=dev --prefer-offline --no-audit --no-fund\nsetup_step="next"',
      false,
    ],
    [
      "chained command",
      'setup_step="node-dependencies"\nprepare && npm ci --include=dev --prefer-offline --no-audit --no-fund\nsetup_step="next"',
      false,
    ],
  ])("validates the Cloud npm install contract: %s", (_name, setup, valid) => {
    expect(validateCloudNpmInstallContract(setup as string).length === 0).toBe(valid);
  });

  it("reports sensitive and proxy variable names without exposing values", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      OPENAI_API_KEY: "never-print-this",
      FIGMA_CLIENT_SECRET: "never-print-this-figma-secret",
      CROSS_TENANT_SERVICE_ROLE_KEY: "never-print-this-either",
      npm_config_https_proxy: "https://user:secret@example.test",
      HTTP_PROXY: "http://supported.example.test",
    };

    expect(configuredProviderCredentialNames(env)).toEqual([
      "OPENAI_API_KEY",
      "CROSS_TENANT_SERVICE_ROLE_KEY",
      "FIGMA_CLIENT_SECRET",
    ]);
    expect(
      configuredProviderCredentialNames({
        CODEX_CLOUD_GITHUB_PAT: "never-print-this",
      }),
    ).toEqual(["CODEX_CLOUD_GITHUB_PAT"]);
    expect(obsoleteNpmProxyVariables(env)).toEqual(["npm_config_https_proxy"]);
  });

  it("covers every provider-capable test variable in the Cloud credential inventory", () => {
    for (const key of providerEnvironmentKeys) expect(providerCredentialVariables).toContain(key);
  });

  it("validates effective offline modes and keeps connected verification explicit", () => {
    const offline = {
      CODEX_CLOUD: "1",
      CODEX_CLOUD_ACCESS_PROFILE: "offline",
      RAG_PROVIDER_MODE: "offline",
      NEXT_PUBLIC_DEMO_MODE: "true",
      PLAYWRIGHT_OFFLINE_MODE: "true",
    };
    expect(validateCodexCloudEnvironment(offline)).toEqual([]);
    expect(
      validateCodexCloudEnvironment({
        ...offline,
        NEXT_PUBLIC_DEMO_MODE: "false",
      }),
    ).toContain("NEXT_PUBLIC_DEMO_MODE must be true in offline mode.");
    expect(
      validateCodexCloudEnvironment({
        ...offline,
        CODEX_CLOUD_ACCESS_PROFILE: "connected",
        RAG_PROVIDER_MODE: "auto",
        NEXT_PUBLIC_DEMO_MODE: "false",
        PLAYWRIGHT_OFFLINE_MODE: "false",
      }),
    ).toContain("RAG_PROVIDER_MODE must be an approved value in connected mode.");

    expect(
      validateCodexCloudEnvironment({
        ...offline,
        CODEX_CLOUD_ACCESS_PROFILE: "connected",
        RAG_PROVIDER_MODE: "offline",
        SUPABASE_ACCESS_TOKEN: "setup-only-secret",
      }),
    ).toContain("Connected mode exposes provider environment variables: SUPABASE_ACCESS_TOKEN.");
  });

  it("emits sanitized modes, credential presence, and MCP metadata only", () => {
    const secret = "sensitive-test-value";
    const lines = sanitizedCloudCapabilityLines(
      {
        CODEX_CLOUD: "1",
        CODEX_CLOUD_ACCESS_PROFILE: "offline",
        RAG_PROVIDER_MODE: "offline",
        NEXT_PUBLIC_DEMO_MODE: "true",
        PLAYWRIGHT_OFFLINE_MODE: "true",
        OPENAI_API_KEY: secret,
      },
      {
        origin: {
          configured: true,
          repositoryMatch: true,
          credentialsEmbedded: false,
        },
        codexCliAvailable: true,
        safeGitHelper: true,
        checkout: {
          head: "a".repeat(40),
          localMain: "b".repeat(40),
          originMain: "c".repeat(40),
          expectedBase: "a".repeat(40),
          expectedBaseAncestor: "true",
          freshness: "verified",
        },
        mcpServers: [
          {
            name: "railway",
            type: "http",
            command: "none",
            endpoint: "https://mcp.railway.com/",
            queryNames: [],
            environmentNames: [],
          },
        ],
      },
    );
    const report = lines.join("\n");
    expect(report).toContain("hosted_workspace.class_documented=personal-pro");
    expect(report).toContain("OPENAI_API_KEY.present=true");
    expect(report).toContain("hosted_app.inventory=external-unverified-until-fresh-task");
    expect(report).toContain("provider_route.github=codex-native-connector");
    expect(report).toContain("provider_route.railway=chatgpt-official-app");
    expect(report).toContain("provider_route.supabase=chatgpt-project-scoped-read-only-app");
    expect(report).toContain(
      "desktop_cli_mcp.template=railway type=http command=none endpoint=https://mcp.railway.com/",
    );
    expect(report).toContain(`git.head=${"a".repeat(40)}`);
    expect(report).toContain("git.expected_base_ancestor=true");
    expect(report).toContain("git.checkout_freshness=verified");
    expect(report).not.toContain(secret);
    expect(report).not.toContain("sensitive-test");
    expect(
      sanitizedCloudCapabilityLines(
        {
          CODEX_CLOUD: "1",
          CODEX_CLOUD_ACCESS_PROFILE: "connected",
          RAG_PROVIDER_MODE: "auto",
        },
        {
          origin: { configured: true, repositoryMatch: true, credentialsEmbedded: false },
          codexCliAvailable: false,
          safeGitHelper: false,
          checkout: {
            head: "unavailable",
            localMain: "unavailable",
            originMain: "unavailable",
            expectedBase: "unset",
            expectedBaseAncestor: "unverified",
            freshness: "unverified",
          },
          mcpServers: [],
        },
      ),
    ).toContain("RAG_PROVIDER_MODE=invalid");
  });

  it("parses MCP transport metadata without query or environment values", () => {
    const secret = "never-print-mcp-value";
    const metadata = parseMcpServerMetadata(
      JSON.stringify({
        mcpServers: {
          supabase: {
            type: "http",
            url: `https://mcp.supabase.com/mcp?project_ref=example&read_only=true&token=${secret}`,
            env: { SUPABASE_ACCESS_TOKEN: secret },
          },
        },
      }),
    );
    expect(metadata).toEqual([
      {
        name: "supabase",
        type: "http",
        command: "none",
        endpoint: "https://mcp.supabase.com/mcp",
        queryNames: ["project_ref", "read_only", "token"],
        environmentNames: ["SUPABASE_ACCESS_TOKEN"],
      },
    ]);
    expect(JSON.stringify(metadata)).not.toContain(secret);
  });

  it("requires hosted Railway OAuth and project-scoped read-only Supabase MCP", () => {
    const valid = JSON.stringify({
      mcpServers: {
        railway: {
          type: "http",
          url: expectedMcpConfiguration.railwayUrl.replace(/\/$/, ""),
        },
        supabase: {
          type: "http",
          url: `${expectedMcpConfiguration.supabaseUrl}?project_ref=${expectedMcpConfiguration.supabaseProjectRef}&read_only=true&features=${expectedMcpConfiguration.supabaseFeatures.join(",")}`,
        },
      },
    });
    expect(validateMcpConfiguration(valid)).toEqual([]);
    expect(validateMcpConfiguration(valid.replace("read_only=true", "read_only=false"))).toContain(
      "Supabase MCP must keep the production project read-only.",
    );
    expect(validateMcpConfiguration(valid.replace('"supabase":', '"unexpected":{},"supabase":'))).toContain(
      "Desktop/CLI .mcp.json must contain only Railway and Supabase.",
    );
    expect(validateMcpConfiguration(valid.replace('"railway":{"type"', '"railway":{"headers":{},"type"'))).toContain(
      "railway MCP must use OAuth without embedded environment variables or headers.",
    );
    expect(validateMcpConfiguration(valid.replace("&read_only=true", "&read_only=true&token=forbidden"))).toContain(
      "Supabase MCP must not include additional query parameters.",
    );
    expect(validateMcpConfiguration(valid.replace("&read_only=true", "&read_only=true&read_only=false"))).toContain(
      "Supabase MCP must not include additional query parameters.",
    );
  });

  it("keeps project .codex/config.toml MCP registrations disabled and secret-free", () => {
    const tracked = readFileSync(new URL("../.codex/config.toml", import.meta.url), "utf8");
    expect(validateCodexProjectMcpConfiguration(tracked)).toEqual([]);
    for (const projectPreference of [
      'model = "gpt-5.6-sol"',
      '"model" = "gpt-5.6-sol"',
      "'model_reasoning_effort' = 'high'",
    ]) {
      expect(
        validateCodexProjectMcpConfiguration(
          tracked.replace("[mcp_servers.figma_cloud]", `${projectPreference}\n\n[mcp_servers.figma_cloud]`),
        ),
      ).toContain(
        ".codex/config.toml must not set repository-wide model or model_reasoning_effort; leave them to the task or desktop picker.",
      );
    }
    expect(
      validateCodexProjectMcpConfiguration(tracked.replace("[mcp_servers.railway]", "[mcp_servers.railway_cloud]")),
    ).toContain(
      `.codex/config.toml must register exactly these MCP servers: figma_cloud, railway, sentry_cloud, supabase_cloud. unexpected: railway_cloud; missing: railway. Use the canonical railway template name; stale railway_cloud registrations are host-local OAuth apps and must not be reintroduced here.`,
    );
    expect(validateCodexProjectMcpConfiguration(tracked.replaceAll("enabled = false", "enabled = true"))).toContain(
      `.codex/config.toml figma_cloud must set enabled = false (opt in via $CODEX_HOME/config.toml or a never-committed local edit; do not commit enabled = true).`,
    );
    expect(
      validateCodexProjectMcpConfiguration(
        tracked.replace('default_tools_approval_mode = "writes"', 'default_tools_approval_mode = "auto"'),
      ),
    ).toContain(
      `.codex/config.toml figma_cloud must set default_tools_approval_mode = "writes" because write-capable tools require explicit approval.`,
    );
    expect(
      validateCodexProjectMcpConfiguration(
        tracked.replace('default_tools_approval_mode = "prompt"', 'default_tools_approval_mode = "auto"'),
      ),
    ).toContain(
      `.codex/config.toml supabase_cloud must set default_tools_approval_mode = "prompt" because the production server is constrained read-only.`,
    );
    expect(
      validateCodexProjectMcpConfiguration(
        tracked.replace(
          'url = "https://mcp.figma.com/mcp"',
          'url = "https://mcp.figma.com/mcp"\nbearer_token_env_var = "FIGMA_TOKEN"',
        ),
      ),
    ).toContain(
      `.codex/config.toml figma_cloud must not embed bearer_token_env_var; keep OAuth credentials in the host store.`,
    );
    expect(
      validateCodexProjectMcpConfiguration(
        tracked.replace(
          'url = "https://mcp.figma.com/mcp"',
          'url = "https://mcp.figma.com/mcp"\nhttp_headers.Authorization = "Bearer redacted-test"',
        ),
      ),
    ).toContain(
      `.codex/config.toml figma_cloud must not embed http_headers; keep OAuth credentials in the host store.`,
    );
    expect(
      validateCodexProjectMcpConfiguration(
        tracked.replace(
          'url = "https://mcp.figma.com/mcp"',
          'url = "https://mcp.figma.com/mcp"\nscopes = ["files:write"]',
        ),
      ),
    ).toContain(`.codex/config.toml figma_cloud must be URL-only; unsupported key scopes.`);
    expect(
      validateCodexProjectMcpConfiguration(
        tracked.replace(
          'url = "https://mcp.figma.com/mcp"',
          'url = "https://mcp.figma.com/mcp"\n__anything = "secret"',
        ),
      ),
    ).toContain(`.codex/config.toml figma_cloud must be URL-only; unsupported key __anything.`);
    expect(
      validateCodexProjectMcpConfiguration(
        tracked.replace(
          "[mcp_servers.supabase_cloud]",
          "[mcp_servers.figma_cloud.tools]\n__hasNestedTables = false\n\n[mcp_servers.supabase_cloud]",
        ),
      ),
    ).toContain(
      `.codex/config.toml figma_cloud must not declare nested tool override tables in the shared project config.`,
    );
    expect(
      validateCodexProjectMcpConfiguration(
        tracked.replace(
          "[mcp_servers.figma_cloud]",
          'mcp_servers.figma_cloud.http_headers.Authorization = "Bearer redacted-test"\n\n[mcp_servers.figma_cloud]',
        ),
      ),
    ).toContain(
      `.codex/config.toml figma_cloud must not embed http_headers; keep OAuth credentials in the host store.`,
    );
    expect(
      validateCodexProjectMcpConfiguration(
        tracked.replace(
          "project_ref=sjrfecxgysukkwxsowpy&read_only=true&features=",
          "project_ref=sjrfecxgysukkwxsowpy&read_only=false&features=",
        ),
      ),
    ).toContain(`.codex/config.toml supabase_cloud must keep the production project read-only.`);
  });

  it("keeps Railway's cross-client template separate from the hosted OAuth app", () => {
    const projectTemplate = readFileSync(new URL("../.codex/config.toml", import.meta.url), "utf8");
    const crossClientTemplate = readFileSync(new URL("../.mcp.json", import.meta.url), "utf8");
    const ownershipDocumentation = readFileSync(new URL("../docs/codex-cloud.md", import.meta.url), "utf8");

    expect(validateCodexProjectMcpConfiguration(projectTemplate)).toEqual([]);
    expect(validateMcpConfiguration(crossClientTemplate)).toEqual([]);
    expect(projectTemplate).toMatch(/\[mcp_servers\.railway\][\s\S]*?enabled = false/);
    expect(projectTemplate).not.toContain("[mcp_servers.railway_connected]");
    expect(ownershipDocumentation).toContain("cross-client Desktop/CLI template");
    expect(ownershipDocumentation).toMatch(/separately installed\/authenticated\s+workspace app/);
  });

  it("rejects a stale Railway app from an explicitly supplied hosted inventory", () => {
    const inventory = parseHostedAppInventoryArgument([
      "--environment",
      "--hosted-app-inventory=github,railway_cloud,supabase",
    ]);
    expect(inventory).toEqual(["github", "railway_cloud", "supabase"]);
    expect(validateHostedAppInventory(inventory)).toContain(
      "Hosted app inventory contains stale railway_cloud; remove or reconnect that host-local app, then start a fresh task and supply the new inventory.",
    );
    expect(validateHostedAppInventory(["github", "railway", "supabase"])).toEqual([]);
    expect(validateHostedAppInventory(["GitHub", "Slack", "Linear"])).toEqual([]);
    expect(validateHostedAppInventory(["github", "custom-app"])).toContain(
      "Hosted app inventory contains unrecognized connector identifiers; update the checker allowlist before accepting them as evidence.",
    );
    const secretShaped = ["xoxb", "12345678"].join("-");
    expect(validateHostedAppInventory(["github", secretShaped])).toContain(
      "Hosted app inventory appears to contain a credential; supply connector names only, never tokens or secrets.",
    );
    const jwtShaped = [["eyJ", "abcdefgh"].join(""), "ijklmnop", "qrstuvwx"].join(".");
    expect(validateHostedAppInventory(["github", jwtShaped])).toContain(
      "Hosted app inventory appears to contain a credential; supply connector names only, never tokens or secrets.",
    );
    const capabilityLine = hostedAppInventoryCapabilityLine(["GitHub", "railway", "supabase", "Slack", "Linear"]);
    expect(capabilityLine).toContain("hosted_app.inventory=provided count=5");
    expect(capabilityLine).toContain("github=true");
    expect(capabilityLine).toContain("railway=true");
    expect(capabilityLine).toContain("supabase=true");
    expect(capabilityLine).toContain("slack=true");
    expect(capabilityLine).toContain("linear=true");
    expect(capabilityLine).toContain("stale_railway_cloud=false");
    expect(capabilityLine).toContain("unknown=0");
    const leaked = hostedAppInventoryCapabilityLine(["github", secretShaped]);
    expect(leaked).toContain("unknown=1");
    expect(leaked).not.toContain(secretShaped);
    expect(
      sanitizedCloudCapabilityLines({}, { hostedAppInventory: ["github", secretShaped] }).join("\n"),
    ).not.toContain(secretShaped);
    expect(validateHostedAppInventoryArguments(["--hosted-app-inventory", "github,railway"])).toContain(
      "Unsupported Cloud-check argument; hosted app inventory must use exactly --hosted-app-inventory=<comma-separated-apps>.",
    );
    expect(validateHostedAppInventoryArguments(["--hosted-app-inventroy=github,railway"])).toContain(
      "Unsupported Cloud-check argument; hosted app inventory must use exactly --hosted-app-inventory=<comma-separated-apps>.",
    );
    expect(
      validateHostedAppInventoryArguments(["--hosted-app-inventory=github", "--hosted-app-inventory=railway"]),
    ).toContain("Hosted app inventory may be supplied only once.");
    expect(validateHostedAppInventoryArguments(["--environment", "--runtime"])).toEqual([]);

    const malformedCli = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../scripts/check-codex-cloud-setup.mjs", import.meta.url)),
        "--environment",
        "--hosted-app-inventroy=github",
      ],
      { cwd: repoRoot, encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" } },
    );
    expect(malformedCli.status).toBe(1);
    expect(malformedCli.stderr).toContain("Unsupported Cloud-check argument");
    expect(malformedCli.stdout).not.toContain("hosted_app.inventory=");
  });

  it("probes the raw task environment without printing credential values", () => {
    const secret = "never-print-raw-provider-value";
    const result = spawnSync(bashCommand, ["scripts/check-codex-cloud-raw-env.sh"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { PATH: process.env.PATH, NODE_ENV: "test", OPENAI_API_KEY: secret },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("OPENAI_API_KEY");
    expect(result.stderr).toContain("STOP:");
    expect(result.stderr).not.toContain(secret);
  });

  it("name-scopes the documented OPENAI_BASE_URL launcher defect separately from unexpected leaks", () => {
    const known = spawnSync(bashCommand, ["scripts/check-codex-cloud-raw-env.sh"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { PATH: process.env.PATH, NODE_ENV: "test", OPENAI_BASE_URL: "https://example.invalid" },
    });
    expect(known.status).toBe(2);
    expect(known.stderr).toContain("FAIL-KNOWN:");
    expect(known.stderr).toContain("OPENAI_BASE_URL");
    expect(known.stderr).toContain("CONTINUE-RESTRICTED:");
    expect(known.stderr).toContain("redirect OpenAI-bound traffic");
    expect(known.stderr).toContain("bypasses the profile/shim scrub");
    expect(known.stderr).not.toContain("https://example.invalid");

    const mixed = spawnSync(bashCommand, ["scripts/check-codex-cloud-raw-env.sh"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        OPENAI_BASE_URL: "https://example.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "never-print-service-role",
      },
    });
    expect(mixed.status).toBe(1);
    expect(mixed.stderr).toContain("FAIL:");
    expect(mixed.stderr).toContain("STOP:");
    expect(mixed.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(mixed.stderr).not.toContain("never-print-service-role");
    expect(mixed.stderr).not.toContain("CONTINUE-RESTRICTED:");
  });

  it("keeps setup and maintenance repairs guarded for repeat execution", () => {
    const setup = readFileSync(new URL("../scripts/setup-codex-cloud.sh", import.meta.url), "utf8");
    const maintenance = readFileSync(new URL("../scripts/maintain-codex-cloud.sh", import.meta.url), "utf8");
    const commandShims = readFileSync(
      new URL("../scripts/install-codex-cloud-command-shims.sh", import.meta.url),
      "utf8",
    );
    const checkoutBaseRefresh = readFileSync(
      new URL("../scripts/refresh-codex-cloud-base.sh", import.meta.url),
      "utf8",
    );
    const patDelete = readFileSync(
      new URL("../scripts/delete-codex-cloud-branch-with-pat.sh", import.meta.url),
      "utf8",
    );
    expect(setup).toContain("if ! grep -Fq '.clinical-kb-codex-cloud.sh'");
    expect(setup).toContain('if [[ "$actual_version" != "$expected_version" ]]');
    expect(setup).toContain('expected_node_range="$(sed');
    expect(setup).toContain('if ! node_version_supported "$actual_node_version"; then');
    expect(setup).toContain('node_version_supported "$actual_node_version" || fail');
    expect(setup).not.toContain("actual_node_major=");
    expect(setup).toContain('"$HOME/.bash_profile"');
    expect(setup.match(/unset npm_config_http_proxy npm_config_https_proxy npm_config_proxy/g)).toHaveLength(2);
    expect(setup).toContain("worker/python/requirements-cloud.txt");
    expect(setup).toContain("diagnose-codex-cloud.mjs");
    expect(setup).toContain("CODEX_CLOUD=1 node scripts/diagnose-codex-cloud.mjs");
    expect(setup).toContain("CODEX_CLOUD=1 npm run diagnose:codex-cloud");
    expect(setup).toContain("trap diagnose_setup_failure ERR");
    expect(setup).toContain('setup_step="python-worker-requirements"');
    expect(setup).toContain("--require-hashes -r worker/python/requirements-cloud.txt");
    expect(setup).toContain('"$ocr_venv/bin/python" -m pip check');
    expect(setup.indexOf("unset OPENAI_API_KEY")).toBeLessThan(
      setup.indexOf('if [ "\\$CODEX_CLOUD_ACCESS_PROFILE" = "connected" ]'),
    );
    expect(setup).toContain("BEGIN clinical-kb-codex-cloud shell policy");
    expect(setup).toContain("END clinical-kb-codex-cloud shell policy");
    expect(setup).toContain("[shell_environment_policy]");
    expect(setup).toContain('inherit = "all"');
    expect(setup).toContain("Unmanaged [shell_environment_policy] table found");
    expect(setup).toContain("Incomplete managed shell policy block");
    expect(setup).toContain('export RAG_PROVIDER_MODE="${rag_provider_mode}"');
    expect(setup).toContain('rag_provider_mode="${RAG_PROVIDER_MODE:-offline}"');
    expect(setup).not.toContain('rag_provider_mode="${RAG_PROVIDER_MODE:-auto}"');
    expect(setup).toContain("SUPABASE_URL");
    expect(setup).toContain("SUPABASE_PROJECT_REF");
    expect(setup).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(setup).toContain("DATABASE_URL");
    expect(setup).toContain("CODEX_CLOUD_SETUP_STOP_AFTER_POLICY");
    expect(setup).toContain("CODEX_CLOUD_SETUP_TEST_FAIL_ATOMIC_WRITE");
    expect(setup).toContain("worker/python/requirements-cloud.txt");
    expect(setup).toContain("diagnose-codex-cloud.mjs");
    expect(setup).toContain("trap diagnose_setup_failure ERR");
    expect(setup).toContain('setup_step="python-worker-requirements"');
    expect(setup).not.toContain("@railway/cli");
    expect(setup).not.toContain('setup_step="railway-cli"');
    expect(setup).not.toContain("gh auth login");
    expect(setup).not.toContain("configure-codex-cloud-github-shell.sh");
    expect(maintenance).not.toContain("gh auth login");
    expect(maintenance).not.toContain("configure-codex-cloud-github-shell.sh");
    expect(setup).toContain("--require-hashes -r worker/python/requirements-cloud.txt");
    expect(setup).toContain('"$ocr_venv/bin/python" -m pip check');
    const refreshCommand = "bash scripts/refresh-codex-cloud-base.sh";
    const runtimeCheck = "CODEX_CLOUD_PROVISIONING=1 npm run check:codex-cloud -- --runtime";

    expect(setup).toContain(runtimeCheck);
    expect(setup).toContain(refreshCommand);
    expect(maintenance).toContain(runtimeCheck);
    expect(maintenance).toContain("ensure-codex-cloud-git-remote.mjs");
    expect(maintenance).toContain(refreshCommand);
    for (const script of [setup, maintenance]) {
      expect(script.indexOf(refreshCommand)).toBeLessThan(script.indexOf(runtimeCheck));
    }
    expect(commandShims).toContain('nvm version "$expected_node_major"');
    expect(commandShims).toContain('node_bin="$NVM_DIR/versions/node/$resolved_node_version/bin"');
    expect(commandShims).toContain('while [[ "\\$clean_path" == *":\\$HOME/.local/bin:"* ]]; do');
    expect(commandShims).toContain('clean_path="\\${clean_path//:\\$HOME\\/.local\\/bin:/:}"');
    expect(commandShims).toContain('if [[ -n "\\$clean_path" ]]; then');
    expect(commandShims).toContain('export PATH="$node_bin"');
    expect(commandShims).toContain('. "$runtime_profile"');
    expect(commandShims).toContain('mkdir -p "$HOME/.local/bin"');
    expect(checkoutBaseRefresh).toContain("git merge-base HEAD refs/remotes/origin/main");
    expect(checkoutBaseRefresh).toContain("cloud-expected-base-sha");
    expect(patDelete).toContain('[[ "${CODEX_CLOUD:-0}" != "1" ]]');
    expect(patDelete).toContain('[[ "$branch" != -* ]]');
    expect(patDelete).toContain("git check-ref-format --branch");
    expect(patDelete).toContain("git remote get-url --push --all origin");
    expect(patDelete).toContain("GIT_ASKPASS");
    expect(patDelete).toContain("core.hooksPath=/dev/null");
  });

  it("removes every adjacent command-shim PATH entry", () => {
    const home = temporaryDirectory("codex-cloud-shims-");
    const bashHome = bashPathEntry(home);
    const nodeVersion = "v24.19.0";
    const nodeBin = path.join(home, ".nvm", "versions", "node", nodeVersion, "bin");
    const bashNodeBin = bashPathEntry(nodeBin);
    mkdirSync(nodeBin, { recursive: true });
    for (const command of ["node", "npm", "npx"]) {
      const executable = path.join(nodeBin, command);
      writeFileSync(executable, '#!/usr/bin/env bash\nprintf "%s\\n" "$PATH"\n');
      chmodSync(executable, 0o755);
    }
    writeFileSync(
      path.join(home, ".clinical-kb-codex-cloud.sh"),
      [`export NVM_DIR="${bashHome}/.nvm"`, `nvm() { printf '${nodeVersion}\\n'; }`, ""].join("\n"),
    );

    const install = spawnSync(bashCommand, ["scripts/install-codex-cloud-command-shims.sh"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, HOME: bashHome, PATH: bashPathList(process.env.PATH || "") },
    });
    expect(install.status, install.stderr || install.stdout).toBe(0);

    const shimDir = `${bashHome}/.local/bin`;
    const result = spawnSync(bashCommand, [`${shimDir}/node`], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, HOME: bashHome, PATH: `${shimDir}:${shimDir}:/usr/bin:/bin` },
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const resolvedPath = result.stdout.trim().split(":");
    expect(resolvedPath[0]).toBe(bashNodeBin);
    expect(resolvedPath).not.toContain(shimDir);
    expect(resolvedPath).toEqual(expect.arrayContaining(["/usr/bin", "/bin"]));
  });

  it("prefers the exact Python 3.12 interpreter over an older python3 alias", () => {
    const home = temporaryDirectory("codex-cloud-python-home-");
    const bin = temporaryDirectory("codex-cloud-python-");
    writeFakePython(bin, "python3", "3.11");
    const exactPython = writeFakePython(bin, "python3.12", "3.12");
    const staleVenvBin = path.join(home, ".cache", "clinical-kb-codex", "ocr-venv-3.12", "bin");
    mkdirSync(staleVenvBin, { recursive: true });
    writeFakePython(staleVenvBin, "python3.12", "3.12");

    const result = spawnSync(bashCommand, ["scripts/select-codex-cloud-python.sh", "3.12"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: bashPathEntry(home),
        PATH: `${bashPathEntry(staleVenvBin)}:${bashPathEntry(bin)}:/usr/bin:/bin`,
      },
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout.trim()).toBe(bashPathEntry(exactPython));
  });

  it("writes managed shell policy behaviorally and preserves unrelated Codex config", () => {
    const home = temporaryDirectory("codex-cloud-home-");
    mkdirSync(path.join(home, ".codex"), { recursive: true });
    writeFileSync(
      path.join(home, ".codex/config.toml"),
      ["[mcp_servers.example]", 'command = "echo"', 'args = ["ping"]', ""].join("\n"),
    );

    const first = runSetupPolicyOnly(home, {
      CODEX_CLOUD_ACCESS_PROFILE: "offline",
    });
    expect(first.status, first.stderr || first.stdout).toBe(0);

    const config = readCodexConfig(home);
    expect(config).toContain("[mcp_servers.example]");
    expect(config).toContain("BEGIN clinical-kb-codex-cloud shell policy");
    expect(config).toContain("[shell_environment_policy]");
    expect(config).toContain('inherit = "all"');
    expect(config).not.toContain("[mcp_servers.railway_connected]");
    expect(config).not.toContain("[mcp_servers.supabase_connected]");
    for (const name of requiredPolicyExcludes) {
      expect(config).toContain(`"${name}"`);
    }
    expect(config.match(/^\[shell_environment_policy\]$/gm)).toHaveLength(1);

    const profile = readRuntimeProfile(home);
    expect(profile).toContain('export CODEX_CLOUD_ACCESS_PROFILE="offline"');
    expect(profile).toContain("export RAG_PROVIDER_MODE=offline");

    const second = runSetupPolicyOnly(home, {
      CODEX_CLOUD_ACCESS_PROFILE: "offline",
    });
    expect(second.status, second.stderr || second.stdout).toBe(0);
    const rewritten = readCodexConfig(home);
    expect(rewritten).toContain("[mcp_servers.example]");
    expect(rewritten.match(/^\[shell_environment_policy\]$/gm)).toHaveLength(1);
    expect(rewritten.match(/BEGIN clinical-kb-codex-cloud shell policy/g)).toHaveLength(1);
    // Two full `bash scripts/setup-codex-cloud.sh` runs. That is cheap on Linux
    // and is not on Windows, where each spawn goes through Git Bash: measured at
    // 24.96s on a Windows workstation running this file ALONE — 83% of the 30s
    // default in vitest.config.mts. Under a full `npm run test` the four workers
    // contend and it tips over, which is how this failed there while passing in
    // isolation and passing everywhere on Linux. The sibling case below already
    // carries this budget for the same reason; this one was missed.
  }, 120_000);

  it("pins connected retrieval mode and rejects unsafe shell-policy configs", () => {
    const connectedHome = temporaryDirectory("codex-cloud-connected-");
    mkdirSync(path.join(connectedHome, ".codex"), { recursive: true });
    // Seed the previous hosted registration shape between managed markers so re-run
    // cleanup is proven (fresh empty $HOME alone would not exercise that path).
    writeFileSync(
      path.join(connectedHome, ".codex/config.toml"),
      [
        "[mcp_servers.keep_outside]",
        'command = "echo"',
        "",
        "# BEGIN clinical-kb-codex-cloud shell policy (managed by setup-codex-cloud.sh)",
        "[mcp_servers.railway_connected]",
        'url = "https://mcp.railway.com"',
        "enabled = true",
        "[mcp_servers.supabase_connected]",
        'url = "https://mcp.supabase.com/mcp"',
        "enabled = true",
        "[shell_environment_policy]",
        'inherit = "all"',
        "exclude = []",
        "# END clinical-kb-codex-cloud shell policy (managed by setup-codex-cloud.sh)",
        "",
      ].join("\n"),
    );
    const connected = runSetupPolicyOnly(connectedHome, {
      CODEX_CLOUD_ACCESS_PROFILE: "connected",
      RAG_PROVIDER_MODE: "offline",
    });
    expect(connected.status, connected.stderr || connected.stdout).toBe(0);
    const connectedProfile = readRuntimeProfile(connectedHome);
    const connectedConfig = readCodexConfig(connectedHome);
    expect(connectedConfig).toContain("[mcp_servers.keep_outside]");
    expect(connectedConfig).not.toContain("[mcp_servers.railway_connected]");
    expect(connectedConfig).not.toContain("[mcp_servers.supabase_connected]");
    expect(connectedConfig).not.toContain("mcp_servers.railway");
    expect(connectedConfig).not.toContain("mcp_servers.supabase");
    expect(connectedProfile).toContain('export CODEX_CLOUD_ACCESS_PROFILE="connected"');
    expect(connectedProfile).toContain('export RAG_PROVIDER_MODE="offline"');
    expect(connectedProfile).not.toContain("${RAG_PROVIDER_MODE:-auto}");

    const unmanagedHome = temporaryDirectory("codex-cloud-unmanaged-");
    mkdirSync(path.join(unmanagedHome, ".codex"), { recursive: true });
    const unmanagedConfig = [
      "[mcp_servers.keep]",
      'command = "echo"',
      "",
      "[shell_environment_policy]",
      'inherit = "all"',
      "exclude = []",
      "",
    ].join("\n");
    const unmanagedPath = path.join(unmanagedHome, ".codex/config.toml");
    writeFileSync(unmanagedPath, unmanagedConfig);
    const unmanaged = runSetupPolicyOnly(unmanagedHome, {
      CODEX_CLOUD_ACCESS_PROFILE: "offline",
    });
    expect(unmanaged.status).not.toBe(0);
    expect(unmanaged.stderr).toContain("Unmanaged [shell_environment_policy] table found");
    expect(readFileSync(unmanagedPath, "utf8")).toBe(unmanagedConfig);

    for (const tableHeader of [
      "  [shell_environment_policy] # valid TOML",
      '[ "shell_environment_policy" ]',
      "['shell_environment_policy'] # valid TOML",
    ]) {
      const formattedHome = temporaryDirectory("codex-cloud-formatted-");
      mkdirSync(path.join(formattedHome, ".codex"), { recursive: true });
      const formattedConfig = [tableHeader, 'inherit = "all"', "exclude = []", ""].join("\n");
      const formattedPath = path.join(formattedHome, ".codex/config.toml");
      writeFileSync(formattedPath, formattedConfig);
      const formatted = runSetupPolicyOnly(formattedHome, {
        CODEX_CLOUD_ACCESS_PROFILE: "offline",
      });
      expect(formatted.status).not.toBe(0);
      expect(formatted.stderr).toContain("Unmanaged [shell_environment_policy] table found");
      expect(readFileSync(formattedPath, "utf8")).toBe(formattedConfig);
    }

    for (const formattedConfig of [
      'shell_environment_policy.inherit = "all"\n',
      'shell_environment_policy = { inherit = "all", exclude = [] }\n',
    ]) {
      const formattedHome = temporaryDirectory("codex-cloud-formatted-");
      mkdirSync(path.join(formattedHome, ".codex"), { recursive: true });
      const formattedPath = path.join(formattedHome, ".codex/config.toml");
      writeFileSync(formattedPath, formattedConfig);
      const formatted = runSetupPolicyOnly(formattedHome, {
        CODEX_CLOUD_ACCESS_PROFILE: "offline",
      });
      expect(formatted.status).not.toBe(0);
      expect(formatted.stderr).toContain("Unmanaged [shell_environment_policy] table found");
      expect(readFileSync(formattedPath, "utf8")).toBe(formattedConfig);
    }

    const atomicHome = temporaryDirectory("codex-cloud-atomic-");
    mkdirSync(path.join(atomicHome, ".codex"), { recursive: true });
    const atomicConfig = ["[mcp_servers.keep]", 'command = "echo"', ""].join("\n");
    const atomicPath = path.join(atomicHome, ".codex/config.toml");
    writeFileSync(atomicPath, atomicConfig);
    const atomic = runSetupPolicyOnly(atomicHome, {
      CODEX_CLOUD_ACCESS_PROFILE: "offline",
      CODEX_CLOUD_SETUP_TEST_FAIL_ATOMIC_WRITE: "1",
    });
    expect(atomic.status).not.toBe(0);
    expect(readFileSync(atomicPath, "utf8")).toBe(atomicConfig);
    expect(readdirSync(path.dirname(atomicPath)).filter((name) => name.startsWith(".config.toml."))).toEqual([]);

    const incompleteHome = temporaryDirectory("codex-cloud-incomplete-");
    mkdirSync(path.join(incompleteHome, ".codex"), { recursive: true });
    const incompleteConfig = [
      "[mcp_servers.keep]",
      'command = "echo"',
      "",
      "# BEGIN clinical-kb-codex-cloud shell policy (managed by setup-codex-cloud.sh)",
      "[shell_environment_policy]",
      'inherit = "all"',
      "",
    ].join("\n");
    const incompletePath = path.join(incompleteHome, ".codex/config.toml");
    writeFileSync(incompletePath, incompleteConfig);
    const incomplete = runSetupPolicyOnly(incompleteHome, {
      CODEX_CLOUD_ACCESS_PROFILE: "offline",
    });
    expect(incomplete.status).not.toBe(0);
    expect(incomplete.stderr).toContain("Incomplete managed shell policy block");
    expect(readFileSync(incompletePath, "utf8")).toBe(incompleteConfig);
  }, 120_000);

  it("accepts a task-only HEAD only inside Codex Cloud", () => {
    const directory = temporaryGitRepository();
    const commit = git(
      directory,
      "-c",
      "user.name=Codex",
      "-c",
      "user.email=codex@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "task",
    );
    expect(commit.status, commit.stderr).toBe(0);

    expect(localGitBaseline(directory, {})).toBeNull();
    expect(localGitBaseline(directory, { CODEX_CLOUD: "1" })).toBe("HEAD");

    const head = git(directory, "rev-parse", "HEAD").stdout.trim();
    expect(gitCheckoutFreshness(directory, { CODEX_CLOUD: "1" })).toEqual({
      head,
      localMain: "unavailable",
      originMain: "unavailable",
      expectedBase: "unset",
      expectedBaseAncestor: "unverified",
      freshness: "unverified",
    });
    expect(
      gitCheckoutFreshness(directory, {
        CODEX_CLOUD: "1",
        CODEX_CLOUD_EXPECTED_BASE_SHA: head,
      }),
    ).toMatchObject({
      expectedBase: head,
      expectedBaseAncestor: "true",
      freshness: "verified",
    });
    expect(
      gitCheckoutFreshness(directory, {
        CODEX_CLOUD: "1",
        CODEX_CLOUD_EXPECTED_BASE_SHA: "arbitrary-sensitive-value",
      }),
    ).toMatchObject({
      expectedBase: "invalid",
      expectedBaseAncestor: "unverified",
    });
    expect(
      gitCheckoutFreshness(directory, {
        CODEX_CLOUD: "1",
        CODEX_CLOUD_EXPECTED_BASE_SHA: `${head}\nmalformed`,
      }),
    ).toMatchObject({
      expectedBase: "invalid",
      expectedBaseAncestor: "unverified",
    });
  });

  it("normalizes Python package version output for capability reports", () => {
    const run = (() => ({
      status: 0,
      stdout: "medspacy=1.3.1 spacy=3.8.2\n",
    })) as unknown as typeof spawnSync;
    expect(pythonWorkerVersionLine(process.execPath, run)).toBe("python.worker_versions=medspacy=1.3.1,spacy=3.8.2");
  });

  it("launches and closes every installed Playwright browser", async () => {
    let closeCount = 0;
    const browserType = {
      executablePath: () => process.execPath,
      launch: async (options: { headless: boolean; timeout: number }) => {
        expect(options).toEqual({ headless: true, timeout: 1234 });
        return { close: async () => void (closeCount += 1) };
      },
    };
    expect(
      await playwrightBrowserErrors({ chromium: browserType, firefox: browserType, webkit: browserType }, 1234),
    ).toEqual([]);
    expect(closeCount).toBe(3);
  });

  it("does not describe a source-only runtime as fully browser-ready", () => {
    expect(
      codexCloudValidationScope({
        runtime: true,
        environment: true,
        browserInstallSkipped: true,
      }),
    ).toBe("static, environment, and source-only runtime (browser validation skipped)");
    expect(
      codexCloudValidationScope({
        runtime: true,
        environment: true,
        browserInstallSkipped: false,
      }),
    ).toBe("static, environment, and runtime");
  });

  it("distinguishes executable files from missing paths", () => {
    expect(executableFile(process.execPath)).toBe(true);
    expect(executableFile("/definitely/not/a/cloud/executable")).toBe(false);
  });

  it("verifies every Python worker import through the configured environment", () => {
    let invocation: string[] = [];
    const run = (command: string, args: string[]) => {
      invocation = [command, ...args];
      return { status: 0 };
    };

    expect(pythonWorkerImportError(process.execPath, run as typeof spawnSync)).toBeNull();
    expect(invocation).toEqual([process.execPath, "-c", `import ${pythonWorkerImports.join(", ")}`]);
    expect(
      pythonWorkerImportError(process.execPath, (() => ({
        status: 1,
      })) as unknown as typeof spawnSync),
    ).toContain("Python worker imports failed");
  });
});

describe("Codex Cloud origin repair", () => {
  // Assert the configured URL (`git config --get`), not `git remote get-url`.
  // Environments with global `url.*.insteadOf` token rewrites (Cursor Cloud)
  // expand get-url to a credential-bearing form even when origin itself is clean.
  const configuredOriginUrl = (directory: string) =>
    git(directory, "config", "--get", "remote.origin.url").stdout.trim();

  it("adds the credential-free origin once, then preserves it", () => {
    const directory = temporaryGitRepository();
    expect(ensureOriginRemote(directory).action).toBe("added");
    expect(ensureOriginRemote(directory).action).toBe("preserved");
    expect(configuredOriginUrl(directory)).toBe(CODEX_CLOUD_ORIGIN_URL);
    expect(inspectOriginRemote(directory)).toEqual({
      configured: true,
      repositoryMatch: true,
      credentialsEmbedded: false,
    });
  });

  it("never overwrites a wrong or credential-bearing origin", () => {
    const wrong = temporaryGitRepository();
    expect(git(wrong, "remote", "add", "origin", "https://github.com/example/other.git").status).toBe(0);
    expect(() => ensureOriginRemote(wrong)).toThrow(/refusing to overwrite/);
    expect(configuredOriginUrl(wrong)).toBe("https://github.com/example/other.git");

    const credentialed = temporaryGitRepository();
    const unsafe = "https://token-value@github.com/BigSimmo/PsychSift.git";
    expect(git(credentialed, "remote", "add", "origin", unsafe).status).toBe(0);
    expect(() => ensureOriginRemote(credentialed)).toThrow(/embedded credentials/);
    expect(configuredOriginUrl(credentialed)).toBe(unsafe);
  });
});
