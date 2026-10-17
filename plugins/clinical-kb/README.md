# PsychSift Codex Plugin

This plugin follows the repo-local structure used by `openai/plugins`:

- Marketplace: `.agents/plugins/marketplace.json`
- API-key-login marketplace: `.agents/plugins/api_marketplace.json`
- Plugin: `plugins/clinical-kb`
- Manifest: `plugins/clinical-kb/.codex-plugin/plugin.json`
- Skills: `plugins/clinical-kb/skills/`

The plugin currently ships repo guidance only. It does not add MCP servers, app connectors,
commands, hooks, dependencies, or runtime code.

Codex plugin discovery is marketplace-based. Resolve `./plugins/clinical-kb` from the
actual repository root reported by `git rev-parse --show-toplevel`; no Windows path
identifies every checkout. Verify that root belongs to `BigSimmo/PsychSift` before
registration. The marketplace files do not prove that this host supports, installed
or loaded the plugin.

If the current Codex host supports local marketplace registration and plugin installation
is authorised, add that verified checkout root, then install by marketplace name. For a
POSIX shell with the supported CLI:

```bash
task_repo_root="$(git rev-parse --show-toplevel)"
codex plugin marketplace add "$task_repo_root"
codex plugin add clinical-kb@clinical-kb-local
```

For API-key-login marketplace flows, the alternate marketplace name is `clinical-kb-api-local`.
Use the current host's supported plugin refresh or a fresh chat, then inspect the actual
skill inventory. Do not copy credentials or force a local CLI installation to imitate
hosted plugin availability.

The [current Cloud policy](../../docs/agents/codex-cloud-environment.md),
[user-controlled reasoning policy](../../docs/agents/codex-reasoning-effort.md) and
[agent allocation guidance](../../docs/agents/smart-agent-allocation.md) remain authoritative.
