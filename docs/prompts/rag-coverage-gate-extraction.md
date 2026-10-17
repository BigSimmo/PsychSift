# Coverage-gate extraction — retired implementation prompt

The extraction is implemented: [rag-coverage-gate.ts](../../src/lib/rag/rag-coverage-gate.ts)
owns `evaluateEvidenceCoverageGate`, and [rag.ts](../../src/lib/rag/rag.ts) imports and re-exports it.
Do not relaunch the old extraction against the current tree.

The [original prompt](../archive/rag-coverage-gate-extraction-2026-10-16.md) is retained as historical
task evidence. For new work, establish a current objective and follow [repository instructions](../../AGENTS.md),
[current Cloud policy](../agents/codex-cloud-environment.md) and [RAG safeguards](../rag-behaviour/README.md).
The archived prompt grants no provider, canary, commit or publication authority.
