---
name: claude-plugin-native-deps-trap
description: Verify plugin dependency readiness; an August 2026 workstation incident exposed missing native dependencies and misleading build warnings
metadata:
  type: reference
---

Check the current plugin version, installation behavior and dependency readiness before proposing
a repair. The symptoms and versions below were observed on a workstation in August 2026; they do
not prove that the same dependencies, install policy or failure exists on the current host.
Plugin installation and memory access remain subject to the task's authorization and
current memory policy (`docs/agents/shared-context-and-memory.md`).

In that incident, `claude plugin install` did not install the plugin's npm dependencies. For plugins with
native modules (episodic-memory needs better-sqlite3, onnxruntime-node, sharp, protobufjs)
the CLI and MCP server fail with `ERR_MODULE_NOT_FOUND` until you run `npm install
--omit=dev` inside the plugin's cache directory
(`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`). That install took ~9 minutes
for episodic-memory 1.4.2.

Second trap: npm 11 on that workstation blocked package install scripts by default
(`npm warn allow-scripts`), so native rebuilds report failure even though the package files
land. episodic-memory's own postinstall printed
"rebuild of better-sqlite3 failed (status=1)". Despite that warning, better-sqlite3 and the
HuggingFace embeddings both worked — verified 2026-08-21 by running `node
cli/episodic-memory.js stats` and a real `search` that returned 81% matches. So treat that
postinstall warning as advisory, not proof of breakage; prove it with `stats` + `search`
before either declaring it broken or declaring it fine.

Related: archived Windows test incidents (`docs/archive/cloud-session-state-2026-10-16/local-test-failures-windows.md`), [[checks-that-cannot-fail]].

Resolve repository paths against the verified current checkout root, not this installed memory directory.
