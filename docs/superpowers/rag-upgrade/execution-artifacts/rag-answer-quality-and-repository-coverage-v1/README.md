# RAG upgrade execution artifacts

Accepted phase receipts reference immutable artifacts below this directory. Use one subdirectory per exact P00–P17 phase ID, `programme/` for the final offline review, and L00–L10 subdirectories for local connected evidence. Use `operational/` for the final local whole-programme review.

Each phase directory retains the extracted task brief, implementer report, every full-base review diff, every reviewer report, and every phase-review diff/report. Artifacts must contain no secrets, protected document text, patient data, environment values, signed URLs, or raw provider payloads. The receipt records each repository-relative path and SHA-256 digest; the checker requires accepted dependency artifacts to be tracked and byte-identical at `HEAD`.

Every agent route needs a sanitized host/dispatch metadata artifact. Model prose and self-report are invalid route evidence. Connected artifacts contain redacted metadata, hashes and aggregates only; raw protected content, hosted dumps and provider payloads stay in approved ignored secure output.

Ignored `.superpowers/sdd` files are disposable scratch only. They never satisfy cross-session evidence or final review.
