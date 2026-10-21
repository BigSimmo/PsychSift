# Native security backports

The worker builds util-linux, Tesseract, ncurses and libxml2 from exact Debian source
versions, with pinned upstream security patches applied through quilt. Source
downloads retain APT's signed repository checks; a pinned DSC hash then binds
the source archives and Debian packaging. Each patch is checked before building.
Local revisions append `+psychsift1`; upstream versions are never relabelled.

Separate Docker stages run the ordinary Debian package build and its tests.
Only the declared runtime `.deb` files are copied into the runner. Their source,
version, package hashes, patch identities and test commands are retained under
`/usr/share/psychsift/native-security/`. Installed package versions and source
versions must match those receipts, including Debian's binary epochs. Existing
Python locks, model identities, legacy OCR and archive support remain unchanged.

- util-linux: upstream stable fixes for CVE-2026-76642, CVE-2026-78408 and
  CVE-2026-78410, including their required path-pinning prerequisites. Related
  loop-device and canonicalization fixes already present in Debian are preserved.
  The local openat2 fallback uses Linux's correct `0x04` no-symlinks flag;
  a compiled probe checks normal files, leaf/ancestor symlinks and escapes.
  The 2.41 source lacks CVE-2026-78409's vulnerable restricted-user path; this is
  an independently examined boundary, not a scanner suppression. Privileged
  exploit reproduction requires a suitably isolated, capable test environment.
- Tesseract: six upstream deserialization repairs, with explicit older-source
  adaptations recorded in its manifest. A local correction validates vector
  counts before publishing them to cleanup state. Adapted-template readers restore
  owned pointers before checking raw reads, reject incomplete nested records, and
  clean up reconstructed lists/configurations normally. The ordinary Debian OCR test,
  15 unchanged upstream cases, two vector cleanup cases, 19 adapted-template
  ownership controls and 11 numeric-deserializer controls remain required.
  The CLI and library are rebuilt together; general
  compatibility with arbitrary external C++ consumers is not asserted.
- ncurses: the upstream infocmp `-i` bounds repair for CVE-2025-69720. The
  full-size synthetic long-capability test and ordinary control run against the
  built executable. Optional ASan mode requires an instrumented executable;
  ordinary hardened execution is not described as sanitizer coverage.
- libxml2: five upstream bounds/option-propagation repairs are adapted to the
  actual 2.9.14 implementation, keeping its existing `.so.2` ABI. The empty-URI
  guard for CVE-2026-86139 is already present and receives no invented patch.
  The normal Debian tests and a focused, network-free XInclude options/control
  harness run against the newly built library. Multi-gigabyte overflow-trigger
  reproduction remains separate evidence; ordinary XML smoke is not proof of
  every overflow guard. The Python SAX binding also receives the exact upstream
  CVE-2026-74860 reference-count repair, with 32 enumeration ownership controls
  against the built extension. CVE-2026-6653 remains unresolved; its larger vendor
  candidate changes public entity/input structures and is excluded pending
  compatibility evidence.

The final image also runs its existing Python/OCR/clinical fixtures and runtime
validator, both venv dependency checks and a bounded offline conversion of a
synthetic raster PDF through the actual Docling/Tesseract configuration as UID 1000. No paid provider or production queue is used.

The historical detailed report attributed 60 package/CVE entries to these four
source families. That includes repeated source advisories, an unaffected
util-linux branch and two unresolved libxml2 advisories. It is not evidence of
60 independent exploitable paths, a current-image count, or 60 resolved findings.

Keep the complete image scan. A Debian advisory with no published fixed version
can continue to flag an honestly labelled local backport; source repair evidence
does not make that scan green. Per-CVE package/version diagnostics also go to
stderr in the CI log, while stdout retains the strict aggregate scan records.
No suppression, forced dependency removal or release exception is added.
