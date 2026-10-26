# Skipped / todo / fixme test inventory

Generated 2026-10-26 by a read-only scan (audit item 7). No tests were changed. "Reason" is heuristic: the comment directly above or on the line, or the skip condition message; **NO REASON** marks entries with no comment or message (many are self-describing platform conditions such as `skipIf(win32)`; where a test title was captured instead of a reason, read the line). Conditional skips (`skipIf`, env-gated `describe.skip`) are included.

Total: 60 (no reason: 22)

| Location | Kind | Line | Reason |
|---|---|---|---|
| `tests/check-edge-functions-lock.test.ts:17` | skip | it.skipIf(process.platform === "win32")( | This fixture relies on POSIX executable/shebang lookup; Windows does not launch extensionless scripts through spawnSync's shell-free PATH lookup. |
| `tests/ci-cache-safety.test.ts:659` | skip | describe.skipIf(process.platform === "win32")("PR required aggregate — cancelled vs failed | **NO REASON** |
| `tests/claude-cloud-lifecycle.test.ts:255` | skip | it.skipIf(process.platform === "win32")("refuses a symlinked skill parent without touching | **NO REASON** |
| `tests/claude-cloud-lifecycle.test.ts:315` | skip | describe.skipIf(process.platform === "win32")("Claude cached setup uses active resources", | **NO REASON** |
| `tests/claude-cloud-lifecycle.test.ts:453` | skip | describe.skipIf(process.platform === "win32")("sequential Claude SessionStart", () => { | **NO REASON** |
| `tests/claude-cloud-profile.test.ts:338` | skip | it.skipIf(process.platform === "win32")("preserves a host memory symlink whose target is t | **NO REASON** |
| `tests/claude-cloud-profile.test.ts:393` | skip | it.skipIf(!hasVendoredSkills)("preserves an unmanaged skill entry that is not a directory" | preserves an unmanaged skill entry that is not a directory |
| `tests/claude-cloud-profile.test.ts:824` | skip | it.skipIf(!hasVendoredSkills)("copies skills as real directories, not as the workstation's | copies skills as real directories, not as the workstation |
| `tests/claude-cloud-write-safety.test.ts:42` | skip | it.skipIf(process.platform === "win32")( | **NO REASON** |
| `tests/claude-cloud-write-safety.test.ts:72` | skip | it.skipIf(process.platform === "win32")("retains executable source permissions for install | **NO REASON** |
| `tests/clinical-hazard-controls.test.ts:497` | skip | it.skipIf(!checkGit)("passes the committed register as of its own date, in either mode", ( | The CLI proves reviewedCommit ancestry itself, so it needs a checkout that holds that history. |
| `tests/clinical-hazard-controls.test.ts:502` | skip | it.skipIf(!checkGit)("fails a lapsed register when strict and only warns in pull-request m | fails a lapsed register when strict and only warns in pull-request mode |
| `tests/clinical-hazard-controls.test.ts:514` | skip | it.skipIf(!checkGit)("ignores pull-request mode under --release, as governance:release run | ignores pull-request mode under --release, as governance:release runs it |
| `tests/clinical-hazard-controls.test.ts:527` | skip | it.skipIf(!checkGit)("ignores explicit development scope under --release at the CLI bounda | ignores explicit development scope under --release at the CLI boundary |
| `tests/clinical-hazard-controls.test.ts:535` | skip | it.skipIf(!checkGit)("refuses pull-request mode on a non-main push, or without a base, and | refuses pull-request mode on a non-main push, or without a base, and stays strict |
| `tests/codex-cloud-policy-harness.test.ts:513` | skip | it.skipIf(process.platform === "win32").each(["symlink", "unmanaged"])( | unmanaged |
| `tests/codex-cloud-policy-harness.test.ts:789` | skip | it.skipIf(process.platform === "win32").each(["directory", "symlink-to-directory"])( | symlink-to-directory |
| `tests/codex-cloud-setup.test.ts:1344` | skip | it.skipIf(process.platform === "win32").each([false, true])( | **NO REASON** |
| `tests/codex-cloud-setup.test.ts:1427` | skip | it.skipIf(process.platform === "win32").each(["unmanaged-destination", "runtime-directory" | runtime-directory |
| `tests/container-ci-contract.test.ts:148` | skip | it.skipIf(process.platform === "win32")( | **NO REASON** |
| `tests/container-ci-contract.test.ts:224` | skip | it.skipIf(process.platform === "win32")("rejects a dangling symlink as a present path", () | **NO REASON** |
| `tests/container-ci-contract.test.ts:409` | skip | it.skipIf(process.platform === "win32").each([false, true])( | **NO REASON** |
| `tests/drift-rootless.test.ts:192` | skip | it.skipIf(process.platform === "win32")( | **NO REASON** |
| `tests/drift-rootless.test.ts:291` | skip | it.skipIf(process.platform !== "linux").each([false, true])( | **NO REASON** |
| `tests/drift-rootless.test.ts:342` | skip | it.skipIf(process.platform !== "linux")( | **NO REASON** |
| `tests/drift-rootless.test.ts:378` | skip | it.skipIf(process.platform !== "linux")( | **NO REASON** |
| `tests/gate-receipts.test.ts:519` | skip | it.skipIf(process.platform === "win32")( | **NO REASON** |
| `tests/organisation-hooks.test.ts:349` | skip | it.skipIf(posixOnly)("judges a link to a ranking file as the file it points to", () => { | judges a link to a ranking file as the file it points to |
| `tests/organisation-hooks.test.ts:360` | skip | it.skipIf(posixOnly)("judges a link leading out of the checkout, or a broken one, by its o | judges a link leading out of the checkout, or a broken one, by its own path |
| `tests/organisation-hooks.test.ts:392` | skip | it.skipIf(posixOnly)("trusts only a private real directory owned by this user", () => { | trusts only a private real directory owned by this user |
| `tests/organisation-hooks.test.ts:407` | skip | it.skipIf(posixOnly)("repeats the notes and writes nothing in an untrusted folder", () =>  | repeats the notes and writes nothing in an untrusted folder |
| `tests/organisation-hooks.test.ts:418` | skip | it.skipIf(posixOnly)("refuses a state file that is a link, and never writes through it", ( | refuses a state file that is a link, and never writes through it |
| `tests/organisation-hooks.test.ts:430` | skip | it.skipIf(posixOnly)("writes a private state file and leaves no temp file behind", () => { | writes a private state file and leaves no temp file behind |
| `tests/organisation-hooks.test.ts:483` | skip | describe.skipIf(process.platform === "win32")("hook wrappers: exit 0 and never decide", () | The wrappers are a Bash contract exercised on Linux CI. On Windows `bash.exe` can be the WSL launcher, which cannot run these native paths, so the wrapper tests |
| `tests/organisation-index-section.test.ts:229` | skip | describe.skipIf(process.platform === "win32")("pre-commit docs sync", () => { | The hook runs through POSIX sh, which Windows runners do not provide. |
| `tests/organisation-rule-consistency.test.ts:221` | skip | describe.skipIf(process.platform === "win32")("approved scan batch completion", () => { | **NO REASON** |
| `tests/pdf-extractor.test.ts:208` | skip | it.skipIf(process.platform === "win32")("rejects cleanly if the python process dies with S | **NO REASON** |
| `tests/pdf-extractor.test.ts:231` | skip | it.skipIf(process.platform === "win32")("rejects cleanly when the python process exits wit | **NO REASON** |
| `tests/pr-handoff-stop.test.ts:84` | skip | describe.skipIf(process.platform === "win32")("pr-handoff-stop hook — CronCreate only", () | The hook is a Bash contract exercised on Linux CI. Windows' `bash.exe` is a WSL launcher: it cannot execute the native absolute paths this fixture gives it and  |
| `tests/privacy-readiness-contract.test.ts:453` | skip | it.skipIf(!checkGit)("ignores pull-request mode in release mode", () => { | Release mode refuses to run at all on a checkout without the reviewed history, before any date is read, so this proof needs that history. |
| `tests/privacy-readiness-contract.test.ts:460` | skip | it.skipIf(!checkGit)("ignores explicit development scope under --release at the CLI bounda | ignores explicit development scope under --release at the CLI boundary |
| `tests/push-format-guard.test.ts:136` | skip | describe.skipIf(process.platform === "win32")("push-format-guard", () => { | WSL launcher: it cannot execute the native absolute paths this fixture gives it, and `core.fileMode=false` on the ReFS Dev Drive makes the not-executable case u |
| `tests/script-entrypoint-guard.test.ts:108` | skip | it.skipIf(!canLink)( | still runs when started through a link to the script, as with a Windows directory junction |
| `tests/setup-codex-worktree.test.ts:98` | skip | it.skipIf(process.platform === "win32")("keeps copied node_modules links relative to the n | **NO REASON** |
| `tests/test-focused-selection.test.ts:88` | skip | it.skipIf(process.platform === "win32")("checks the canonical ownership of an in-repositor | **NO REASON** |
| `tests/trivy-image-scan.test.ts:78` | skip | it.skipIf(process.platform === "win32").each(["local", "docker"])( | docker |
| `tests/ui-accessibility.spec.ts:424` | skip | test.skip( | **NO REASON** |
| `tests/ui-chrome-scroll.spec.ts:218` | skip | test.skip(({ isMobile }) => isMobile, "tablet/desktop wheel scrolling does not apply to th | These breakpoints drive the page with a mouse wheel and pin tablet/desktop owners. The iPhone projects (isMobile) have no wheel and never render those owners. |
| `tests/ui-document-canvas.spec.ts:142` | skip | test.skip(browserName !== "chromium", "The viewer-canvas raster gate runs on the pinned Ch | Chromium-only, in the same spirit as the focused PWA suite: the engine feature pdf.js 6 needs is not what this gate exists to test, and a red weekly Firefox/Web |
| `tests/ui-phone-scroll-assessments.spec.ts:178` | skip | test.skip(browserName !== "chromium", "Chrome tracing is developer evidence, not a Safari  | chromium |
| `tests/ui-pwa.spec.ts:132` | skip | test.skip(browserName !== "chromium", "The installability protocol and focused PWA gate ar | chromium |
| `tests/ui-pwa.spec.ts:670` | skip | test.skip( | mobile-webkit |
| `tests/ui-sources.spec.ts:152` | skip | test.skip(browserName !== "chromium", "forced-colors emulation is Chromium-only"); | chromium |
| `tests/ui-style-contract.spec.ts:20` | skip | test.skip(({ browserName }) => browserName !== "chromium", "computed-style serialisation i | chromium |
| `tests/ui-style-contract.spec.ts:326` | skip | test.skip(({ browserName }) => browserName !== "chromium", "computed-style serialisation i | chromium |
| `tests/ui-style-contract.spec.ts:502` | skip | test.skip(({ browserName }) => browserName !== "chromium", "forced-colors remaps are Chrom | chromium |
| `tests/ui-style-contract.spec.ts:566` | skip | test.skip(({ browserName }) => browserName !== "chromium", "computed z-index serialisation | chromium |
| `tests/ui-token-layer-resolution.spec.ts:183` | skip | test.skip( | chromium |
| `tests/ui-universal-search.spec.ts:152` | skip | test.skip(test.info().project.use.isMobile === true, "the typeahead dropdown is desktop-on | the typeahead dropdown is desktop-only by design |
| `tests/ui-visual-baseline.spec.ts:275` | skip | test.skip( | No baseline committed yet for |
