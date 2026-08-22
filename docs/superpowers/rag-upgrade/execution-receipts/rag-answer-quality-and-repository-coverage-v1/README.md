# RAG upgrade execution receipts

This tracked directory is the durable cross-session ledger for programme `rag-answer-quality-and-repository-coverage-v1`.

For each accepted P00–P17 phase, copy the canonical `phase-receipt.template.json` to a filename equal to the exact phase ID plus `.json`, replace every example value with observed evidence, and validate it with `npm run plans:rag:receipts:check -- --receipt` followed by the repository-relative receipt path. After P17, copy `programme-receipt.template.json` to `PROGRAMME.json` and validate the whole-programme review with `--programme`. Never pre-create an accepted receipt, reuse a receipt across package hashes, or treat `.superpowers/sdd/progress.md` as programme evidence.

After the accepted Cloud programme is published, create connected receipts under `local/L00.json` through `local/L10.json` using `connected-phase-receipt.template.json`. Validate a working connected receipt with `--connected` plus the repository-relative path, and accept it with `--accept-local-phase` plus the phase id. They form a separate chain rooted at the atomic `PROGRAMME.json` commit. `PROGRAMME.json` remains immutable and retains its six open gates. After accepted L10, validate `OPERATIONAL.json` with `--operational` plus its repository-relative path, and accept it with `--accept-operational` plus that same path. L10 creates `OPERATIONAL.json` only after the final local receipt, empty residual set and whole-operational review.

The Local/Cloud package is planning evidence only until committed on its recorded current-main base. Connected/provider/hosted actions require action-specific approvals and their own receipts; an offline phase receipt cannot claim them complete.
