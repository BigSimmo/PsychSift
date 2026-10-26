# Decision: One Supermemory route per environment, limited by the owner's credits

- **Status:** decided 2026-10-26
- **Source:** `docs/agents/shared-context-and-memory.md`, find "the owner's Supermemory credits are the only spending limit"
- **Retires:** `memory-per-run-spending-approval`, `local-sqlite-memory-checkpoints`

On 26 Oct 2026 the owner chose one Supermemory route per environment. Windows agents use the commissioned `curated-save-only` adapter, and dot and cloud sessions use the official authenticated Supermemory MCP with an explicit namespace on every call. Routine memory recall, saves and bounded memory checks no longer need a per-run spending approval, and the owner's Supermemory credits are the only spending limit, with the note size, result count, duplicate and no-retry bounds kept. Other paid services and model charges keep their per-run approval. The older local SQLite checkpoint route stays retired.

If this summary and the source ever differ, the source wins.
