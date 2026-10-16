---
name: rag
description: Validate PsychSift retrieval, classification, ranking, grounding, citations, and answer behavior offline before preparing any live evaluation approval gate. Use for RAG changes, golden regressions, search quality, or answer-quality work.
---

# RAG

1. Run `npm run workflow:rag-lab -- --write-evidence` for the affected paths.
2. Compare fixtures, manifests, tests, and prior local artifacts before changing behavior.
3. Reproduce regressions with the smallest deterministic offline case.
4. Run focused retrieval tests, `npm run check:rag:fixtures`, and `npm run eval:rag:offline` as selected.
5. Enforce the RAG ranking-protection contract (`ragRankingPatterns` in `scripts/pr-policy.mjs` / `ragRanking`, including `src/lib/rag.ts`, `src/lib/rag/**`, `src/lib/chunking.ts`, `src/lib/clinical-search.ts`, `src/lib/evidence-relevance.ts`, `src/lib/answer-verification.ts`, `supabase/migrations/*search*`, and all other protected retrieval/input-producer surfaces): notify the user before editing any protected surface (even for incidental changes), include a `RAG impact:` PR line, and for any ranking/retrieval behaviour change require a provider-backed live before/after `eval-canary` pair (live canary pairs require explicit owner approval; offline `eval:rag:offline` / `check:rag:fixtures` do not substitute for the live canary).
6. Preserve source governance, owner scope, conservative fallback, and rollback behavior.
7. Ask before live retrieval, answer, Supabase, OpenAI, or provider-backed evaluation.
