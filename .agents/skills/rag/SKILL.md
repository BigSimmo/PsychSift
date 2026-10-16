---
name: rag
description: Validate PsychSift retrieval, classification, ranking, grounding, citations, and answer behavior offline before preparing any live evaluation approval gate. Use for RAG changes, golden regressions, search quality, or answer-quality work.
---

# RAG

1. Run `npm run workflow:rag-lab -- --write-evidence` for the affected paths.
2. Compare fixtures, manifests, tests, and prior local artifacts before changing behavior.
3. Reproduce regressions with the smallest deterministic offline case.
4. Run focused retrieval tests, `npm run check:rag:fixtures`, and `npm run eval:rag:offline` as selected.
5. Enforce the RAG ranking-protection contract (`scripts/pr-policy.mjs` `ragRanking`): ranking/retrieval-protected files (`src/lib/rag.ts`, `src/lib/rag/**`, `src/lib/chunking.ts`, `src/lib/clinical-search.ts`, `src/lib/evidence-relevance.ts`, `src/lib/answer-verification.ts`, `supabase/migrations/*search*`) require explicit owner approval before modification and must preserve canary pairs (`eval:rag:offline` / `check:rag:fixtures`).
6. Preserve source governance, owner scope, conservative fallback, and rollback behavior.
7. Ask before live retrieval, answer, Supabase, OpenAI, or provider-backed evaluation.
