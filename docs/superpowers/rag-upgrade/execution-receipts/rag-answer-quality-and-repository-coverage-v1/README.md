# RAG upgrade execution receipts

This tracked directory is the durable cross-session ledger for programme `rag-answer-quality-and-repository-coverage-v1`.

For each accepted manifest phase, copy the canonical `phase-receipt.template.json` to a filename equal to the exact phase ID plus `.json`, replace every example value with observed evidence, and validate it with `npm run plans:rag:receipts:check -- --receipt` followed by the repository-relative receipt path. After P17, copy `programme-receipt.template.json` to `PROGRAMME.json` and validate the whole-programme review with `--programme`. Never pre-create an accepted receipt, reuse a receipt across package hashes, or treat `.superpowers/sdd/progress.md` as programme evidence.

The Local/Cloud package is planning evidence only until it is committed on its recorded current-main base. P18 connected/provider/hosted actions remain separate approval-gated receipts; an offline phase receipt cannot claim them complete.
