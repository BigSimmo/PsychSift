#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const CODEX_CLOUD_REPOSITORY = "BigSimmo/PsychSift";
export const CODEX_CLOUD_ORIGIN_URL = `https://github.com/${CODEX_CLOUD_REPOSITORY}.git`;

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

function output(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

export function remoteContainsCredentials(remoteUrl) {
  if (typeof remoteUrl !== "string") return false;
  return /^https?:\/\/[^/@\s]+@/i.test(remoteUrl) || /(?:token|pat|oauth2):[^@\s]+@/i.test(remoteUrl);
}

export function remoteRepositoryIdentity(remoteUrl) {
  if (typeof remoteUrl !== "string" || remoteContainsCredentials(remoteUrl)) return null;
  const normalized = remoteUrl
    .trim()
    .replace(/^git@github\.com:/i, "")
    .replace(/^ssh:\/\/git@github\.com\//i, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : null;
}

export function inspectOriginRemote(root) {
  // Read the configured URL, not `git remote get-url`. The latter applies
  // global `url.*.insteadOf` rewrites, so a credential-free origin becomes a
  // credential-bearing URL in environments (Cursor Cloud, some CI helpers)
  // that inject token insteadOf rules. This helper decides whether *origin
  // itself* embeds credentials; rewritten fetch URLs are a separate path.
  const result = run("git", ["config", "--get", "remote.origin.url"], root);
  if (result.status !== 0) {
    return {
      configured: false,
      repositoryMatch: false,
      credentialsEmbedded: false,
    };
  }

  const remoteUrl = result.stdout.trim();
  return {
    configured: true,
    repositoryMatch: remoteRepositoryIdentity(remoteUrl) === CODEX_CLOUD_REPOSITORY,
    credentialsEmbedded: remoteContainsCredentials(remoteUrl),
  };
}

export function ensureOriginRemote(root) {
  const before = inspectOriginRemote(root);
  if (before.configured) {
    if (before.credentialsEmbedded) {
      throw new Error("origin contains embedded credentials; refusing to preserve or replace it automatically.");
    }
    if (!before.repositoryMatch) {
      throw new Error(`origin does not identify ${CODEX_CLOUD_REPOSITORY}; refusing to overwrite it.`);
    }
    return { action: "preserved", ...before };
  }

  const add = run("git", ["remote", "add", "origin", CODEX_CLOUD_ORIGIN_URL], root);
  if (add.status !== 0) throw new Error(`Could not add origin: ${output(add).split(/\r?\n/).at(-1)}`);
  return { action: "added", ...inspectOriginRemote(root) };
}

export function configureGitHubCliCredentialHelper(root) {
  const result = run("gh", ["auth", "setup-git", "--hostname", "github.com"], root);
  return result.status === 0;
}

export function hasSafeGitHubCredentialHelper(root) {
  const results = [
    run("git", ["config", "--global", "--get-all", "credential.https://github.com.helper"], root),
    run("git", ["config", "--global", "--get-all", "credential.helper"], root),
  ];
  const helpers = results.filter((result) => result.status === 0).flatMap((result) => result.stdout.split(/\r?\n/));
  return helpers.some(
    (helper) => /\bgh(?:\.exe)?\s+auth\s+git-credential\b/i.test(helper) && !remoteContainsCredentials(helper),
  );
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const remote = ensureOriginRemote(repoRoot);
  const configureHelper = process.argv.includes("--configure-gh-helper");
  const helperConfigured = configureHelper
    ? configureGitHubCliCredentialHelper(repoRoot) && hasSafeGitHubCredentialHelper(repoRoot)
    : hasSafeGitHubCredentialHelper(repoRoot);

  console.log(
    `[Codex Cloud Git] origin=${remote.action} repository=${CODEX_CLOUD_REPOSITORY} credential_embedded=${remote.credentialsEmbedded}`,
  );
  console.log(`[Codex Cloud Git] github_cli_helper_configured=${helperConfigured}`);
}

if (isDirectEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[Codex Cloud Git] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
