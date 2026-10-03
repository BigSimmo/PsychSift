const reviewedActionPins = new Map([
  [
    "actions/checkout",
    new Map([
      ["9f698171ed81b15d1823a05fc7211befd50c8ae0", "v6.0.3"],
      ["9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0", "v7.0.0"],
      ["3d3c42e5aac5ba805825da76410c181273ba90b1", "v7.0.1"],
    ]),
  ],
  [
    "actions/setup-node",
    new Map([
      ["a0853c24544627f65ddf259abe73b1d18a591444", "v5.0.0"],
      ["820762786026740c76f36085b0efc47a31fe5020", "v7.0.0"],
    ]),
  ],
  ["actions/github-script", new Map([["3a2844b7e9c422d3c10d287c895573f7108da1b3", "v9.0.0"]])],
  [
    "anthropics/claude-code-action",
    new Map([
      ["af0559ee4f514d1ef21826982bed13f7edc3c35e", "v1.0.178"],
      ["b76a0776ae74036e77cd11018083743453d7ad35", "v1.0.179"],
      ["be7b93b1907a4abad570368f3c74b6fe3807510b", "v1.0.183"],
      // Reviewed 2026-08-10 for PR #1794: annotated tag v1.0.187 peels to this
      // commit; release notes cover credential-pattern redaction in published
      // run output, config-snapshot scoping to the working tree, and checkout
      // auth cleanup when API commit signing is enabled.
      ["1623c36729ac1cd5895198cded705a287de7db79", "v1.0.187"],
      // Reviewed 2026-08-17 for PR #2011 (Run PR sweep): annotated tag v1.0.193
      // peels to this commit. Release notes for v1.0.188-v1.0.193 cover only
      // MCP GitHub-Actions-results pagination, structured-tool-result text
      // preservation, content-based (not extension-based) binary-file
      // detection, branch-name validation under commit signing, docs fixes,
      // and setup-bun cache tuning — no change to permissions, secrets
      // handling, or the action's trust boundary.
      ["9d7150bc8a3dae8149739a88019d192b579ad90c", "v1.0.193"],
      // Reviewed 2026-08-24 for PR #2325 (Dependabot github-actions group):
      // annotated tag v1.0.199 peels to this commit. Release notes for
      // v1.0.194-v1.0.199 cover GraphQL client URL handling, keeping a
      // base-branch config revert out of the auto-commit, MCP GitHub
      // aggregate-selector recognition, delete_files path hardening,
      // shallow-checkout fetch-depth limiting, base-action PATH fix,
      // --allowedTools signed-prompt handling, secret-redaction unification,
      // ALL_INPUTS env stripping, and a shell-quote CVE bump — no change to
      // permissions, secrets handling, or the action's trust boundary.
      ["dcb57747bfceeaa1fa72638cae52295d1d853d4a", "v1.0.199"],
      // Reviewed 2026-08-31 for PR #2469 (Dependabot github-actions group):
      // annotated tag v1.0.210 peels to this commit. Diff v1.0.199...v1.0.210
      // is Claude Code/Agent SDK bumps plus fixes for delete_files prompt
      // paths, parentheses in branch names, stalled download_job_log bound,
      // encoded branch names in GitHub links, and .gitattributes — no change
      // to permissions, secrets handling, or the action's trust boundary.
      ["a874e9ecd7bb36efdad65429c6b35815f5a08f10", "v1.0.210"],
      // Reviewed 2026-09-06 for PR #2647 (Dependabot github-actions group):
      // annotated tag v1.0.215 peels to this commit. Diff v1.0.210...v1.0.215
      // is only Claude Code (2.1.251->2.1.260) and Agent SDK (0.3.251->0.3.260)
      // version bumps in action.yml/run.ts/package.json/bun.lock — no change
      // to permissions, secrets handling, or the action's trust boundary.
      ["ef8bb1e43bf303cff727a1dd0b8837029fe982a2", "v1.0.215"],
      // Reviewed 2026-09-17 for PR #2796 (Dependabot github-actions group):
      // annotated tag v1.0.223 peels to this commit. Diff v1.0.215...v1.0.223
      // is only Claude Code (2.1.260->2.1.270) and Agent SDK (0.3.260->0.3.270)
      // version bumps in action.yml/run.ts/package.json/bun.lock — no change
      // to permissions, secrets handling, or the action's trust boundary.
      ["9cdae7f0d995e3ba7c33f226087fdf82a59cd520", "v1.0.223"],
      // Reviewed 2026-09-21 for PR #2950 (Dependabot github-actions group):
      // annotated tag v1.0.230 peels to this commit. Diff v1.0.223...v1.0.230
      // is only Claude Code (2.1.270->2.1.277) and Agent SDK (0.3.270->0.3.277)
      // version bumps in action.yml/run.ts/package.json/bun.lock — no change
      // to permissions, secrets handling, or the action's trust boundary.
      ["4036a180cf690f49529f5d8c79c998855287f590", "v1.0.230"],
      // Reviewed 2026-09-28 for PR #3170 (Dependabot github-actions group):
      // annotated tag v1.0.235 peels to this commit. Diff v1.0.230...v1.0.235
      // is only Claude Code (2.1.277->2.1.283) and Agent SDK (0.3.277->0.3.283)
      // version bumps in action.yml/run.ts/package.json/bun.lock, plus the
      // upstream repo's own integration-test model pin — no change to
      // permissions, secrets handling, or the action's trust boundary.
      ["756cc22e19660d20e8cc9496b4f242475a7f7790", "v1.0.235"],
    ]),
  ],
  ["actions/cache", new Map([["55cc8345863c7cc4c66a329aec7e433d2d1c52a9", "v6"]])],
  ["actions/cache/restore", new Map([["55cc8345863c7cc4c66a329aec7e433d2d1c52a9", "v6"]])],
  ["actions/cache/save", new Map([["55cc8345863c7cc4c66a329aec7e433d2d1c52a9", "v6"]])],
  ["actions/upload-artifact", new Map([["043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", "v7"]])],
  ["actions/download-artifact", new Map([["3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c", "v8.0.1"]])],
  ["denoland/setup-deno", new Map([["22d081ff2d3a40755e97629de92e3bcbfa7cf2ed", "v2.0.5"]])],
  [
    "supabase/setup-cli",
    new Map([
      ["46f7f98c7f948ad727d22c1e67fab04c223a0520", "v3"],
      // Reviewed 2026-09-28 for PR #3170 (Dependabot github-actions group):
      // tags v3.0.1 and moving v3 both resolve to this commit (workflow comment
      // stays # v3). Diff v3.0.0...v3.0.1 only stops forcing the GHCR image
      // registry for CLI >= 2.108.0 (letting the CLI's own registry fallback
      // apply) and keeps an explicit caller registry, plus dev-tool bumps — no
      // change to permissions, secrets handling, or the action's trust boundary.
      // The Migration replay image cache already matches both registries.
      ["45a513f8c64c0bc8e0e3dfe572b5c95be85f6359", "v3"],
    ]),
  ],
  ["gitleaks/gitleaks-action", new Map([["e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e", "v3"]])],
  [
    "actions/ai-inference",
    new Map([
      ["a7805884c80886efc241e94a5351df715968a0ad", "v2"],
      // Reviewed 2026-08-24 for PR #2325 (Dependabot github-actions group):
      // annotated tag v3 peels to this commit. v3 removes github-models
      // support and makes Copilot the only inference provider, plus routine
      // dependency bumps (js-yaml, hono, vite, rollup plugin, tmp,
      // actions/setup-node, actions/upload-artifact) — no change to the
      // action's own permissions or secrets handling; this workflow already
      // only used the Copilot-backed default provider.
      ["2c43c91ae16266ca159d311430343c67a5ffa222", "v3"],
    ]),
  ],
  ["peter-evans/create-or-update-comment", new Map([["e8674b075228eee787fea43ef493e45ece1004c9", "v5"]])],
  [
    "docker/setup-buildx-action",
    new Map([
      ["bb05f3f5519dd87d3ba754cc423b652a5edd6d2c", "v4"],
      // Reviewed 2026-08-24 for PR #2325 (Dependabot github-actions group):
      // annotated tag v4.3.0 peels to this commit. Release notes cover only
      // internal dependency bumps (@docker/actions-toolkit, brace-expansion,
      // js-yaml, postcss, undici) — no change to the action's own
      // permissions or secrets handling.
      ["37fe631027851001ddb9b187196cc803df7f5f0e", "v4"],
      // Reviewed 2026-09-21 for PR #2950 (Dependabot github-actions group):
      // lightweight tag v4.4.1 peels to this commit (workflow comment stays # v4).
      // Diff v4.3.0...v4.4.1 covers Build Cloud/buildx version gating, BuildKit
      // image pre-pull for docker-container driver, and error-message helpers —
      // no change to the action's own permissions or secrets handling.
      ["f87e5991a6d7451dcb8d9637bfbc97413f497069", "v4"],
    ]),
  ],
  [
    "docker/build-push-action",
    new Map([
      ["53b7df96c91f9c12dcc8a07bcb9ccacbed38856a", "v7"],
      // Reviewed 2026-09-21 for PR #2950 (Dependabot github-actions group):
      // lightweight tag v7.4.0 peels to this commit (workflow comment stays # v7).
      // Diff v7.3.0...v7.4.0 is toolkit dependency bumps, error-message helpers,
      // and GitHub.printUntrusted for metadata output — no change to secrets/
      // github-token inputs or the action's trust boundary.
      ["c3c9e263c25d99ce0380d002d59b67737d91b0dc", "v7"],
    ]),
  ],
  // Reviewed 2026-07-31: official autofix.ci action; tag v1.3.4 / moving v1 both
  // resolve to this immutable commit (node24 runtime). Used only after local
  // Prettier write; the action itself never receives write tokens in-workflow.
  ["autofix-ci/action", new Map([["c5b2d67aa2274e7b5a18224e8171550871fc7e4a", "v1.3.4"]])],
]);

const usesPattern = /^\s*(?:-\s*)?uses:\s*([^@\s]+)@([^\s#]+)(?:\s+#\s*(\S.*?))?\s*$/;
const immutableCommitSha = /^[0-9a-f]{40}$/;

export function validateActionReference(line) {
  const match = line.match(usesPattern);
  if (!match) return null;

  const [, action, ref, versionComment] = match;
  if (action.startsWith("./")) return null;
  if (!immutableCommitSha.test(ref)) {
    return `${action}@${ref} is mutable. Pin external actions to a reviewed 40-character commit SHA.`;
  }

  const reviewedPins = reviewedActionPins.get(action);
  if (!reviewedPins) {
    return `${action}@${ref} is not in the reviewed action allowlist.`;
  }
  const expectedVersion = reviewedPins.get(ref);
  if (!expectedVersion) {
    return `${action}@${ref} is not a reviewed commit SHA for this action.`;
  }
  if (versionComment !== expectedVersion) {
    return `${action}@${ref} must retain the exact reviewed release comment '# ${expectedVersion}'.`;
  }
  return null;
}
