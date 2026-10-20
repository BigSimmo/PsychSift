---
name: ai-architecture-review
description: Reviews RAG flows, context assembly, model routing, structured outputs, safety filters, provenance, fallbacks, evals, cost, and latency. Use during retrieval or answer generation changes.
---

# AI Architecture Review Skill

Use this skill when reviewing or modifying the RAG (Retrieval-Augmented Generation) pipeline, document retrieval, and LLM integrations.

## Repository Review Protocol

Follow `AGENTS.md` review throttling and `docs/codex-review-protocol.md` before starting. Do not review opportunistically or mutate files during pure review. After a completed PR review, post one `Review record` comment on the PR (see [Records](../../../docs/agents/pull-request-workflow.md#records)); never edit the frozen `docs/branch-review-ledger.md` table.

## Review Checklist

### 0. RAG ranking protection (read before editing)

Before touching any protected retrieval/ranking surface, read `AGENTS.md` `# RAG ranking
protection` and `docs/rag-behaviour/` (README → behaviour-map → refuted-approaches →
safeguards). Flag the touch to the user **before editing**, even for incidental refactors.

Protected surfaces include `src/lib/rag/**`, clinical-search / retrieval-selection /
released-search-order / ranking-config, evidence and result-sort helpers, source-authority
tiering, the eval harness and golden fixtures, retrieval RPCs, and the retrieval-input
producers named in AGENTS (chunking/extractors, document-index-units, enrichment, embedding
fields, table facts, assertion tagging). The authoritative list is `ragRankingPatterns` in
`scripts/pr-policy.mjs`.

- Behaviour change needs a live eval-canary before/after pair (provider-backed — needs
  explicit user approval). Offline-green alone is not enough.
- Write a PR `RAG impact:` line when those surfaces change.
- Prefer the Claude `rag-retrieval-reviewer` / `clinical-governance-reviewer` agents for deep
  review of protected ranking or grounded-evidence changes.

Also honour `AGENTS.md` `# API and provider confirmation boundary`: never run OpenAI,
Supabase, hosted CI, or provider-backed evals without explicit confirmation.

### 1. Retrieval Quality & Provenance

- **Hybrid Search:** Confirm queries use proper hybrid search patterns (pgvector + semantic/trigram matching) and respect user/organization boundaries.
- **Provenance / Citations:** Ensure generated answers are strongly tied to source documents and include clean, traceable citation references.
- **Fail-Closed Policy:** If no relevant documents are retrieved or verification fails, the system must degrade gracefully or return a clear "No evidence found" response rather than hallucinating.

### 2. Model Routing & Timeout Logic

- **Routing Rules:** Check that routing between fast and strong models follows defined rules (e.g. `RAG_PROVIDER_MODE`).
- **Timeouts:** Ensure LLM calls are bounded by client and server-side timeouts (e.g., `OPENAI_ANSWER_TIMEOUT_MS`).

### 3. Structured Output & Safety

- **Schema Conformity:** Validate that LLM responses use strict schema structures (e.g., OpenAI structured JSON output) to prevent parsing errors.
- **Safety Filters:** Check that toxicity, safety filters, and prompt injection mitigations are active on user inputs and LLM outputs.
