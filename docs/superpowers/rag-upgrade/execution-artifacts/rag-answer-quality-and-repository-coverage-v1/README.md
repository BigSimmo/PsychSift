# RAG upgrade execution artifacts

Accepted phase receipts reference immutable artifacts below this directory. Use one subdirectory per exact manifest phase ID and `programme/` for the final whole-programme review.

Each phase directory retains the extracted task brief, implementer report, every full-base review diff, every reviewer report, and every phase-review diff/report. Artifacts must contain no secrets, protected document text, patient data, environment values, signed URLs, or raw provider payloads. The receipt records each repository-relative path and SHA-256 digest; the checker requires accepted dependency artifacts to be tracked and byte-identical at `HEAD`.

Ignored `.superpowers/sdd` files are disposable scratch only. They never satisfy cross-session evidence or final review.
