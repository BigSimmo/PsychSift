import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `.claude/settings.json` is the only place where AGENTS.md's provider-confirmation
 * boundary is enforced rather than merely stated. Prose did not hold for the PR-following
 * rule — `.claude/hooks/pr-handoff-stop.sh` says so in its own header, "prose rules in
 * AGENTS.md have not held, a denied tool call does" — and there is no reason to expect it to
 * hold better for provider access.
 *
 * These tests pin the two properties that make the block trustworthy. Both were asserted in
 * review before they were ever measured, which is the failure shape this session kept hitting:
 * a check that cannot fail is not a check.
 *
 * 1. **No `allow` rule may reach a provider-backed script.** The block deliberately avoids
 *    broad wildcards such as `Bash(npm run check:*)` precisely so the outcome never depends on
 *    allow-versus-ask precedence. If someone later broadens the allow list for convenience,
 *    this goes red.
 * 2. **Every provider-backed script must carry an `ask` rule.** `ask` is also the default for
 *    an unlisted command, so these rules buy no protection on their own — what they buy is a
 *    machine-readable statement of the boundary that survives a future broadening, and a list
 *    that fails loudly when a new provider script is added without one.
 *
 * Plus one hook property: every hook command invokes its script through an interpreter rather
 * than by bare path. `session-start.sh` was registered by bare path AND checked in as mode
 * 100644, so on the Linux web containers that are the only place it does any work, it could
 * not run. See the "Claude Code hook scripts" section in AGENTS.md.
 */

const repoRoot = process.cwd();
const settings = JSON.parse(readFileSync(join(repoRoot, ".claude/settings.json"), "utf8"));
const packageScripts: Record<string, string> = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts;

/**
 * Claude Code's Bash permission rules: `Bash(cmd)` matches that command exactly, and a
 * trailing `:*` (or ` --*`) makes it a prefix match. Anything else is not a Bash rule.
 */
function bashRuleMatches(rule: string, command: string): boolean {
  // PowerShell rules (Josh's Windows sessions) carry the same commands, so they are held to the
  // same provider boundary. Their prefix form is `<command> *`.
  const parsed = /^(?:Bash|PowerShell)\((.*)\)$/.exec(rule);
  if (!parsed) return false;
  const pattern = parsed[1];
  if (pattern.endsWith(":*")) return command.startsWith(pattern.slice(0, -2));
  if (pattern.endsWith(" *")) return command.startsWith(pattern.slice(0, -2));
  if (pattern.endsWith(" --*")) return command.startsWith(pattern.slice(0, -4));
  if (pattern.endsWith("*")) return command.startsWith(pattern.slice(0, -1));
  return command === pattern;
}

/**
 * Provider-backed or destructive npm scripts, per AGENTS.md "API and provider confirmation
 * boundary": anything that reaches OpenAI, live Supabase, GitHub, hosted CI, or mutates the
 * live index. Derived from the script names rather than hand-listed, so a newly added
 * `eval:` or `reindex:` script is covered the day it lands.
 */
const PROVIDER_BACKED =
  /supabase-project|^eval:|^test:live|^verify:release|github-shell-access:live|^sync:pr-br|production-readiness|cross-tenant|^import:docs|^enrich:|^classify:|^reindex|governance:release/;

const providerScripts = Object.keys(packageScripts).filter((name) => PROVIDER_BACKED.test(name));

describe("claude code permissions", () => {
  it("recognises a meaningful set of provider-backed scripts", () => {
    // A regex that silently stops matching would make both tests below vacuously pass.
    expect(providerScripts.length).toBeGreaterThan(20);
  });

  it.each(providerScripts)("npm run %s is not reachable through an allow rule", (script) => {
    const command = `npm run ${script}`;
    const reachedBy = (settings.permissions.allow as string[]).filter((rule) => bashRuleMatches(rule, command));
    expect(
      reachedBy,
      `${command} is provider-backed but matched allow rule(s): ${reachedBy.join(", ")}. ` +
        `Narrow the allow pattern rather than relying on ask-over-allow precedence.`,
    ).toEqual([]);
  });

  // Each shell tool needs its own ask rule: a Bash rule never matches a PowerShell invocation.
  it.each(providerScripts.flatMap((script) => [["Bash", script] as const, ["PowerShell", script] as const]))(
    "%s: npm run %s carries an explicit ask rule",
    (tool, script) => {
      const command = `npm run ${script}`;
      const asked = (settings.permissions.ask as string[]).filter(
        (rule) => rule.startsWith(`${tool}(`) && bashRuleMatches(rule, command),
      );
      expect(asked.length, `${command} is provider-backed but has no ${tool} ask rule`).toBeGreaterThan(0);
    },
  );

  // Commands that look read-only but can write files, read ignored secrets, run a program or
  // install packages. Review of PR #3243 reproduced each one.
  it.each([
    "git grep --no-index secret -- .env.local",
    "git fetch --force origin main:main",
    "git reflog expire --all",
    "npm run check:organisation -- --fix",
    "npm run check:worker-python-lock",
    "npm run check:worker-python-cloud-lock",
  ])("PowerShell: %s is not auto-allowed", (command) => {
    const reachedBy = (settings.permissions.allow as string[]).filter(
      (rule) => rule.startsWith("PowerShell(") && bashRuleMatches(rule, command),
    );
    expect(reachedBy).toEqual([]);
  });

  it("denies the file-writing --output form of git log, diff and show in PowerShell", () => {
    const deny = settings.permissions.deny as string[];
    for (const sub of ["log", "diff", "show"]) expect(deny).toContain(`PowerShell(git ${sub} *--output*)`);
  });

  it("denies reading local env files", () => {
    const deny = settings.permissions.deny as string[];
    for (const target of ["Read(./.env)", "Read(./.env.local)"]) {
      expect(deny, `${target} must stay denied — a staging key leaked on 2026-08-18`).toContain(target);
    }
  });

  /**
   * The `.mcp.json` server is named `supabase`, so its tools arrive as `mcp__supabase__*`. The
   * cloud route `docs/claude-cloud.md` recommends instead — a claude.ai connector — surfaces the
   * same tools as `mcp__Supabase__*` (capital S). Whether Claude Code matches MCP rule names
   * case-insensitively could not be verified offline (audit L40), so the write-capable tools
   * this file hard-denies are spelled both ways: an `apply_migration` reaching the live clinical
   * database via the connector must not be left in the default ask state on a case detail.
   */
  it("denies every write-capable Supabase MCP tool under both the server and connector spellings", () => {
    const deny = settings.permissions.deny as string[];
    const serverSpelled = deny.filter((rule) => rule.startsWith("mcp__supabase__"));
    expect(serverSpelled.length, "the Supabase write-tool deny list must not be empty").toBeGreaterThan(5);
    for (const rule of serverSpelled) {
      const twin = rule.replace(/^mcp__supabase__/, "mcp__Supabase__");
      expect(deny, `${rule} is denied but its connector spelling ${twin} is not`).toContain(twin);
    }
    for (const tool of ["execute_sql", "apply_migration", "deploy_edge_function", "merge_branch"]) {
      expect(deny).toContain(`mcp__supabase__${tool}`);
      expect(deny).toContain(`mcp__Supabase__${tool}`);
    }
  });

  it("soft-denies live supabase inspection in auto mode", () => {
    const allow = (settings.autoMode?.allow ?? []) as string[];
    const softDeny = (settings.autoMode?.soft_deny ?? []) as string[];
    expect(allow.some((rule) => rule.includes("supabase"))).toBe(false);
    expect(softDeny.some((rule) => rule.includes("supabase migration list"))).toBe(true);
  });

  /**
   * `Bash(tasklist*)` (no separator) is not a recognised prefix form under `bashRuleMatches` —
   * only an exact `Bash(command)` rule or a trailing `:*`/` --*` is — so it matched nothing real
   * and never actually reduced the intended Windows-process-check prompts. Worse, a bare wildcard
   * suffix has no word boundary: had it been reached through some other matcher it would also
   * catch unrelated commands (`tasklist-helper`) and credential-bearing remote invocations
   * (`tasklist /S remote-host /U DOMAIN\user /P secret`), which are a fundamentally different risk
   * profile from a local read-only process listing and must keep requiring confirmation. The fix
   * enumerates the exact local invocations instead of using any wildcard, so there is no separator
   * form to get wrong.
   */
  it("allows the exact local tasklist invocations", () => {
    const allow = settings.permissions.allow as string[];
    for (const command of ["tasklist", "tasklist /v"]) {
      const reachedBy = allow.filter((rule) => bashRuleMatches(rule, command));
      expect(reachedBy.length, `${command} should be allowed by an exact Bash rule`).toBeGreaterThan(0);
    }
  });

  it("does not allow tasklist-helper or other unrelated commands via the tasklist rule", () => {
    const allow = settings.permissions.allow as string[];
    const reachedBy = allow.filter((rule) => bashRuleMatches(rule, "tasklist-helper"));
    expect(reachedBy, `tasklist-helper matched allow rule(s): ${reachedBy.join(", ")}`).toEqual([]);
  });

  it("does not allow the remote/credential-bearing tasklist form — it must still require confirmation", () => {
    const allow = settings.permissions.allow as string[];
    const command = "tasklist /S remote-host /U DOMAIN\\user /P secret";
    const reachedBy = allow.filter((rule) => bashRuleMatches(rule, command));
    expect(
      reachedBy,
      `remote/credential tasklist form matched allow rule(s): ${reachedBy.join(", ")} — this has a different risk profile than a local read-only check and must not be silently allowed`,
    ).toEqual([]);
  });
});

/**
 * Loosening `Bash(git push:*)`, `Bash(git add:*)`, and `Bash(gh pr create:*)` for routine
 * work (PR #2243) opened three gaps review caught, all on this same permissions file:
 *
 * 1. The generic push allow rule also matches a `HEAD:main` (or `<branch>:main`) destination
 *    refspec, not just a literal `main`/`master` source ref — the existing deny rules only
 *    covered the latter shape.
 * 2. The generic `git add` allow rule also matches `git add -f`/`--force`, which force-stages
 *    an otherwise-.gitignore'd file (e.g. `.env.local`) with no confirmation.
 * 3. `gh pr create` was blanket-allowed, letting an agent open a PR and trigger hosted CI
 *    without the confirmation provider-backed GitHub writes otherwise require.
 *
 * The 2026-09-02 audit (M21) then showed that closing `HEAD:main` was not enough: permission
 * rules are prefix matches, so the blanket `Bash(git push:*)` allow let every other spelling
 * through with no prompt — `origin --force <b>`, `origin +<b>` (refspec force), `-u origin main`,
 * `--delete`, `--mirror`, and `--no-verify` (which also skips `guard-push.mjs`). The fix is
 * two-sided: the allow list names only the safe spellings (plain `git push`, `git push origin
 * HEAD`, and `git push -u origin claude/<branch>`), so every other spelling falls back to the
 * default ask; and the deny list spells out the force, delete, mirror, hook-skipping, and
 * main/master-target shapes so those hard-stop rather than prompt.
 *
 * These tests pin the fixes using the same `bashRuleMatches` prefix-match model above.
 */
describe("git push tightening", () => {
  const deny = settings.permissions.deny as string[];
  const allow = settings.permissions.allow as string[];

  const safePushCommands = ["git push", "git push origin HEAD", "git push -u origin claude/audit-fix"];

  it.each(safePushCommands)("%s is allowed without a prompt", (command) => {
    const reachedBy = allow.filter((rule) => bashRuleMatches(rule, command));
    expect(reachedBy.length, `${command} is the routine handoff push and should be allowed`).toBeGreaterThan(0);
    expect(deny.filter((rule) => bashRuleMatches(rule, command))).toEqual([]);
  });

  it("does not carry a blanket git push allow rule", () => {
    // `Bash(git push:*)` is the rule that made every dangerous spelling below an auto-allow.
    expect(allow).not.toContain("Bash(git push:*)");
    expect(allow.filter((rule) => /^Bash\(git push:\*\)$/.test(rule))).toEqual([]);
  });

  const dangerousPushCommands = [
    // main/master targets in every spelling
    "git push origin main",
    "git push origin master",
    "git push origin HEAD:main",
    "git push origin HEAD:main --force-with-lease",
    "git push origin HEAD:master",
    "git push -u origin main",
    "git push -u origin master",
    "git push --set-upstream origin main",
    "git push --set-upstream origin master",
    "git push -u origin HEAD:main",
    // force in every spelling
    "git push --force origin feature",
    "git push -f origin feature",
    "git push --force-with-lease origin feature",
    "git push origin --force feature",
    "git push origin -f feature",
    "git push origin --force-with-lease feature",
    "git push origin +feature",
    "git push origin +HEAD:main",
    "git push +feature",
    "git push -u origin +feature",
    // remote deletion and mirroring
    "git push --delete origin feature",
    "git push -d origin feature",
    "git push origin --delete feature",
    "git push origin -d feature",
    "git push origin :feature",
    "git push --mirror origin",
    // skipping the pre-push guard
    "git push --no-verify origin feature",
    "git push origin --no-verify feature",
  ];

  it.each(dangerousPushCommands)("%s is matched by a deny rule", (command) => {
    const matched = deny.filter((rule) => bashRuleMatches(rule, command));
    expect(
      matched.length,
      `${command} rewrites history, deletes a remote ref, skips the push guard, or targets the ` +
        `protected main/master branch — it must stay denied`,
    ).toBeGreaterThan(0);
  });

  it.each(dangerousPushCommands)("%s is not reachable through an allow rule", (command) => {
    const matched = allow.filter((rule) => bashRuleMatches(rule, command));
    expect(
      matched,
      `${command} matched allow rule(s): ${matched.join(", ")} — the allow list must name only ` +
        `the safe push spellings so deny never has to win on precedence alone`,
    ).toEqual([]);
  });

  // Spellings the deny list cannot express as a prefix (a `<src>:main` destination on an
  // otherwise ordinary branch push, or `--force` trailing the branch) must at least not be
  // auto-allowed: with no allow match they fall back to the default ask.
  const promptOnlyPushCommands = [
    "git push origin feature:main",
    "git push origin refs/heads/x:refs/heads/main",
    "git push origin feature --force",
    "git push -u origin feature",
    "git push origin claude/branch",
  ];

  it.each(promptOnlyPushCommands)("%s is not reachable through an allow rule", (command) => {
    const matched = allow.filter((rule) => bashRuleMatches(rule, command));
    expect(matched, `${command} matched allow rule(s): ${matched.join(", ")}`).toEqual([]);
  });
});

describe("git add forced-staging tightening", () => {
  const forcedAddCommands = ["git add -f .env.local", "git add --force .env.local"];

  it.each(forcedAddCommands)("%s carries an explicit ask rule", (command) => {
    const asked = (settings.permissions.ask as string[]).filter((rule) => bashRuleMatches(rule, command));
    expect(
      asked.length,
      `${command} force-stages an ignored file, which combined with the now-allowed git commit/push ` +
        `is a path to publishing credentials — it must require confirmation`,
    ).toBeGreaterThan(0);
  });

  it.each(forcedAddCommands)(
    "%s is still matched by the generic git add allow rule (ask must win via precedence)",
    (command) => {
      const allowed = (settings.permissions.allow as string[]).filter((rule) => bashRuleMatches(rule, command));
      expect(allowed.length).toBeGreaterThan(0);
    },
  );
});

describe("gh pr create requires confirmation", () => {
  const command = "gh pr create --fill";

  it("is not reachable through an allow rule", () => {
    const allowed = (settings.permissions.allow as string[]).filter((rule) => bashRuleMatches(rule, command));
    expect(allowed, `${command} must not be blanket-allowed — it publishes a PR and triggers hosted CI`).toEqual([]);
  });

  it("carries an explicit ask rule", () => {
    const asked = (settings.permissions.ask as string[]).filter((rule) => bashRuleMatches(rule, command));
    expect(asked.length).toBeGreaterThan(0);
  });
});

describe("claude hook registrations", () => {
  const commands: { event: string; command: string }[] = [];
  for (const [event, matchers] of Object.entries(
    settings.hooks as Record<string, { hooks: { command: string }[] }[]>,
  )) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks) commands.push({ event, command: hook.command });
    }
  }

  it("registers at least the known hook events", () => {
    expect(commands.length).toBeGreaterThanOrEqual(5);
  });

  it.each(commands.map((c) => [c.event, c.command]))(
    "%s hook runs through an interpreter, not a bare path: %s",
    (_event, command) => {
      // A bare `$CLAUDE_PROJECT_DIR/.../foo.sh` depends on the checked-in executable bit, which
      // is invisible on this repo's Windows Dev Drive (core.fileMode=false) and was already
      // wrong once. Requiring `bash "..."` removes the dependency entirely.
      expect(
        /^(bash|sh|node|npx) /.test(command as string),
        `hook command must start with an interpreter: ${command}`,
      ).toBe(true);
    },
  );

  it.each(commands.map((c) => [c.event, c.command]))("%s hook declares an explicit timeout: %s", (event) => {
    const matchers = (settings.hooks as Record<string, { hooks: { timeout?: number }[] }[]>)[event as string];
    for (const matcher of matchers) {
      for (const hook of matcher.hooks) {
        // The default is 60s. session-start.sh downloads a Node tarball and runs npm ci on a
        // cold container, and a killed hook leaves dependencies half installed.
        expect(typeof hook.timeout, `${event} hook is missing a timeout`).toBe("number");
      }
    }
  });
});
