# Branch review records: archival policy

What may and may not be done to the immutable one-row files under
`docs/branch-review-records/`. This document exists so that nobody has to re-derive it from
the source a second time: every claim below is backed by the enforcing code, quoted verbatim
with its file and line, and every claim is labelled as one of three things — **blocked by
code**, **forbidden by policy but caught by nothing**, or **permitted**.

The distinction matters more here than in most of the repository, because the most tempting
housekeeping operation on this directory — sorting 576 flat files into dated subfolders —
is neither blocked nor merely discouraged. It silently deletes review history while every
gate in the repository continues to report green.

## If you are about to…

| You want to…                                                          | Do this                                                                                                                               | Status                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Record a new review                                                   | `npm run ledger:append`                                                                                                               | Permitted; the only sanctioned way to create a record                         |
| Fix a record that says something wrong                                | Append a superseding record with `npm run ledger:append -- … --supersede`                                                             | Permitted; editing the wrong record is not an option                          |
| Find a record                                                         | `npm run ledger:lookup`, or browse [branch-review-index.md](branch-review-index.md)                                                   | Permitted; `ledger:lookup` is authoritative and the index is a derived view   |
| Correct a typo inside an existing record                              | Supersede it — do not edit it                                                                                                         | Editing the row is blocked by code; editing plus renaming is forbidden policy |
| Combine several small records into one file                           | Nothing; the shape is fixed at one row per file                                                                                       | Blocked by code                                                               |
| Move records into `2026/08/` or any other subfolder                   | Nothing. Read [Foldering is silent data loss](#foldering-is-silent-data-loss) before considering it                                   | Not blocked, not detected, and destructive                                    |
| Delete an obsolete record                                             | Nothing; supersede instead                                                                                                            | Forbidden by policy and almost entirely undetected                            |
| Shrink the directory                                                  | You cannot. See [Growth is the price of the design](#growth-is-the-price-of-the-design)                                               | No safe mechanism exists                                                      |
| Rotate or archive the **legacy table** `docs/branch-review-ledger.md` | That is a different corpus with a different rule set; see [The legacy table is not this corpus](#the-legacy-table-is-not-this-corpus) | Permitted under an explicit opt-in                                            |

## What the corpus is

Each record is a single Markdown table row in its own file, named for the SHA-256 of that
row. The file name is therefore a content address: the row and the name are one fact stored
twice, and every integrity check recomputes one from the other.

`scripts/branch-review-ledger.mjs:188-191`:

```js
export function reviewRecordPath(row) {
  const hash = createHash("sha256").update(row, "utf8").digest("hex");
  return path.posix.join(RECORDS_DIR, `${hash}${RECORD_SUFFIX}`);
}
```

The design is deliberate and its reason is recorded beside the reader, at
`scripts/branch-review-ledger.mjs:172`: "Immutable review records avoid a shared append hunk
across active PRs." Concurrent pull requests never touch the same file, so they never
conflict — which is the property that all of the constraints below exist to protect.

## Permitted

These are the operations the system is built to support. None of them needs special
approval, and between them they cover every legitimate need.

**Appending a new record.** `npm run ledger:append` builds the row, computes its content
address and writes exactly one file. This is the only supported way to create a record.

**Superseding an inaccurate record.** Because editing is not available, correction happens by
appending. When a new append collides with an existing record on the same ref, HEAD and
scope, the tool refuses unless `--supersede` is passed, and with it the new record's scope
cell is disambiguated from the record it replaces. `scripts/branch-review-ledger.mjs:559-567`:

```js
const priorDate = near.at(-1).date;
let suffix = 1;
do {
  scope =
    suffix === 1
      ? `${String(flags.scope)} (supersedes ${priorDate})`
      : `${String(flags.scope)} (supersedes ${priorDate} #${suffix})`;
  suffix += 1;
} while (rows.some((existing) => sameRefHeadScope(existing, scope)));
```

The prior record stays on disk. That is the point: the corpus records what was reviewed and
concluded at the time, including conclusions later found wrong, and a superseding record
makes the correction legible rather than erasing the error.

**Migrating a pre-system row.** An already-open branch carrying a row in the frozen legacy
table runs `npm run ledger:migrate-legacy`, which converts that row into an immutable record
and removes only the branch's own added row from the table.

**Generating derived views.** `docs/branch-review-index.md` is a generated, non-authoritative
browsing surface over the same corpus. Producing views like it changes nothing about the
records themselves and is unconstrained.

## Blocked by code

### Editing a record's row

The file name is the SHA-256 of the row and is recomputed on every run of
`npm run check:branch-review-ledger`. Change one character of the row without renaming the
file and the check fails. `scripts/check-branch-review-ledger.mjs:379-381`:

```js
if (reviewRecordPath(row.raw) !== relativePath) {
  failures.push(`${relativePath}: filename must be the SHA-256 content address for its record row.`);
}
```

**The loophole, stated plainly:** editing the row _and_ renaming the file to the new hash
passes every check in the repository. Nothing compares record files against a base ref —
`check-branch-review-ledger.mjs` validates each file in isolation against its own name, and
`check-ledger-write-discipline.mjs` does not govern this directory at all (see
[Deleting a record](#deleting-a-record)). A rewritten-and-renamed record is therefore
**forbidden by policy and caught by nothing**. The prohibition is stated at
`docs/branch-review-ledger.md:5` — "Never rewrite an existing review record's content; append
a correction or superseding record instead" — and again at `docs/codex-review-protocol.md:65`:
"never edit or delete an existing record; append a correction or superseding record
(`--supersede`) instead."

### Merging or compacting several records into one file

Every record file must be exactly one row and nothing else — no heading, no prose, no second
row. `scripts/check-branch-review-ledger.mjs:374-377`:

```js
if (rows.length !== 1 || markdown.trim() !== rows[0]?.raw) {
  failures.push(`${relativePath}: immutable record must contain exactly one table row and no prose.`);
  return { failures, rows: [] };
}
```

Compaction — the obvious response to 576 tiny files — is therefore unavailable. A file
holding two rows fails on the row count, and even if it held one row it would then fail the
content-address check unless renamed, since its bytes would no longer hash to its name.

### Hand-adding a record

A hand-written file is not rejected on principle; it is rejected in practice, because it must
satisfy every clause of `validateImmutableRecord` (`scripts/check-branch-review-ledger.mjs:367-389`)
_and_ be named for the SHA-256 of its own row. In practice that means using
`npm run ledger:append`, which is what policy requires anyway. `docs/branch-review-ledger.md:11`
states it directly ("Do not hand-edit this table or a record file"), and
`docs/codex-review-protocol.md:65` gives the reason: "Do not hand-write a record —
hand-written rows are what produced the mojibake, wrong-width, and duplicate records the
2026-07-28 hygiene pass had to repair."

## Foldering is silent data loss

This is the operation that looks like tidying and behaves like deletion, and it is the single
most important thing in this document.

The only enumerator of the corpus is a **non-recursive** `readdirSync` that filters on a name
suffix. `scripts/branch-review-ledger.mjs:173-180`:

```js
export function listLedgerRecordPaths() {
  const absRecords = path.join(root, RECORDS_DIR);
  if (!existsSync(absRecords)) return [];
  return readdirSync(absRecords)
    .filter((name) => name.endsWith(RECORD_SUFFIX))
    .sort()
    .map((name) => path.posix.join(RECORDS_DIR, name));
}
```

A directory entry named `2026` does not end in `.record.md`, so the filter drops it and
nothing ever descends into it. Every record inside it disappears from `npm run ledger:lookup`,
from `npm run check:branch-review-ledger`, and from the repo-awareness snapshot — and **every
gate still passes**, because a moved file is not a malformed file. There is no count to
compare against, no manifest that says how many records there should be, and no base-ref
comparison anywhere in the chain. The reviews are still on disk and still in git history, but
the system that exists to stop duplicate reviews can no longer see them, so the branches they
cover will simply be reviewed again.

The same flatness holds for the second reader. `scripts/generate-repo-awareness-snapshot.ts:323`:

```ts
export const REVIEW_RECORDS_PATHSPEC = ":(glob)docs/branch-review-records/*.record.md";
```

In git's `:(glob)` magic a single `*` does not cross a `/`, so a record at
`docs/branch-review-records/2026/08/<hash>.record.md` is not matched. The filesystem fallback
used when git is unavailable is flat in the same way
(`scripts/generate-repo-awareness-snapshot.ts:388-395`), filtering `entry.isFile()` and a
`.record.md` suffix within the one directory.

**A tidier folder layout here is not a tidier layout. It is silent data loss that no check
will report.**

There is an adjacent trap in the same code. `listLedgerRecordPaths` filters on the name only,
with no `isFile()` test, so a _directory_ named `something.record.md` survives the filter and
is handed to `readFileSync` at `scripts/check-branch-review-ledger.mjs:418`, which throws
`EISDIR`. The failure mode is at least loud, unlike the foldering case, but the cause will not
be obvious from the message.

If the directory layout must ever change, the only safe route is a deliberate, explicitly
reviewed migration that changes the **reader** — `listLedgerRecordPaths`, the snapshot
pathspec and its filesystem fallback — in the same change as the files move, with a count
assertion proving the corpus is the same size before and after. Never a bare `git mv`.

## Forbidden by policy but caught by nothing

### Deleting a record

Policy is unambiguous. `docs/codex-review-protocol.md:65`: "never edit or delete an existing
record; append a correction or superseding record (`--supersede`) instead."

Enforcement, until now, was absent. No gate compares the set of record files against a base
ref:

- `scripts/check-branch-review-ledger.mjs` only iterates the files that exist. A file that is
  gone is never named, so it is never validated and never missed.
- `scripts/check-ledger-write-discipline.mjs` governs three paths and this directory is not
  among them. `scripts/check-ledger-write-discipline.mjs:28-31`:

  ```js
  const REVIEW_LEDGER = "docs/branch-review-ledger.md";
  const ISSUES_LEDGER = "docs/outstanding-issues.md";
  const INBOX = "docs/outstanding-issues-inbox";
  const APPLIED = `${INBOX}/applied`;
  ```

  and its path classifier at `scripts/check-ledger-write-discipline.mjs:178-183`:

  ```js
  function governedReason(relative) {
    if (relative === ISSUES_LEDGER) return "the canonical outstanding-issues ledger";
    if (relative === REVIEW_LEDGER) return "the frozen branch-review ledger";
    if (relative === INBOX || relative.startsWith(`${INBOX}/`)) return "an outstanding-issues inbox request";
    return undefined;
  }
  ```

  Neither list mentions `docs/branch-review-records`.

- The staleness backstop is deliberately blind here. `scripts/check-repo-awareness-snapshot.ts:22-41`:

  ```ts
   * `review_state` is also deliberately NOT compared in check gates. Review
   * records are dynamic and concurrent merges to `main` append new review records,
   * which would cause feature branch staleness check failures and merge conflicts.
   *
   * Excluding them fails safe: every deterministic content difference in routes,
   * documentation, and test health is still caught.
   *
   * Excluding a key from comparison was never enough on its own, though, and
   * `#EFETZT` is what that cost: the un-compared content still shipped in the
   * committed file, still changed on both sides of every append, and still
   * conflicted [...]
   */
  const COMPARED_CONTENT_KEYS = ["routes", "documentation", "test_health"] as const;
  ```

  That exclusion is correct for its own purpose and is not a bug to fix, but it does mean the
  snapshot gate cannot notice a record vanishing either.

  The second paragraph above is the sharper lesson, added by #2530 after this document was
  first written: **not gating a derived file is not the same as making it safe.** The
  un-compared snapshot content still conflicted on every append, which sets
  `mergeable_state=dirty`, suppresses `refs/pull/<n>/merge`, and leaves the check list empty
  rather than red — a far worse failure than a red check, because empty reads as green. The
  index in this change avoids that trap for a different reason rather than by luck: nothing
  regenerates it on an ordinary pull request. Only `npm run docs:update` and an explicit
  `npm run ledger:index` rewrite it, so it does not change on both sides of a concurrent
  append the way a snapshot regenerated by every branch does. If that ever changes — if the
  index is wired into the pre-commit hook, or into a generator every branch runs — it must
  first be given a shape that merges cleanly, exactly as `review_state` was.

**New with the generated index — the first partial enforcement.** `docs/branch-review-index.md`
links every record it lists with a relative Markdown link, and `npm run docs:check-links`
(which runs in `verify:full` and in CI) resolves relative link targets and fails when one does
not exist. Deleting a record that the index lists therefore now breaks a required check. Be
honest about the limit: this catches only deletions of records the index **already lists**, so
a record appended and deleted before the index is next regenerated remains completely
invisible, and so does any deletion made in the same change that regenerates the index. It is
an incidental first net, not a deletion gate.

## Overrides: there are none that apply

- `scripts/check-branch-review-ledger.mjs` contains **no `process.env` reference at all**. There
  is no skip flag, no override, and no environment-dependent behaviour. Verified by grep: zero
  matches in the file.
- `scripts/check-ledger-write-discipline.mjs` has no bypass environment variable of its own,
  and the reason is on the record at `docs/outstanding-issues.md:401`: "No override env var:
  both callers are unaffected by construction, so an escape hatch would only reopen the hole."
- `SKIP_LEDGER_WRITE_GUARD=1` skips only the **pre-push wrapper**, not the check itself.
  `scripts/guard-push.mjs:1258-1261`:

  ```js
  function ledgerWriteGuard(ranges) {
    if (process.env.SKIP_LEDGER_WRITE_GUARD === "1") {
      return { name: "ledger-write", ok: true, skipped: "SKIP_LEDGER_WRITE_GUARD=1" };
    }
  ```

- `ALLOW_LEGACY_REVIEW_LEDGER_MAINTENANCE=true` unlocks `npm run ledger:rotate` and
  `npm run ledger:dedupe`, and those two commands operate on the **legacy table and its
  archives only**. Nothing in that path can move, merge or delete a record file.
  `scripts/branch-review-ledger.mjs:701-717`:

  ```js
  /** Historical maintenance writes need an intentional, visible opt-in. */
  export function legacyMaintenanceAllowed({
    dryRun = false,
    allow = process.env.ALLOW_LEGACY_REVIEW_LEDGER_MAINTENANCE,
  } = {}) {
    return dryRun || allow === "true";
  }

  function requireLegacyMaintenance(command, dryRun) {
    if (legacyMaintenanceAllowed({ dryRun })) return true;
    console.error(
      `refusing ${command}: the historical review table is frozen. ` +
        "Use --dry-run to inspect, then set ALLOW_LEGACY_REVIEW_LEDGER_MAINTENANCE=true for an explicitly approved repair.",
    );
    process.exitCode = 1;
    return false;
  }
  ```

  Its only two callers are `runRotate` and `runDedupe`.

## The legacy table is not this corpus

`docs/branch-review-ledger.md` is the frozen historical table that predates immutable records.
It is a different corpus with a different rule set: it may be rotated into `docs/archive/`
under the explicit opt-in above, and `npm run check:ledger-write-discipline` governs changes to
its dated rows. Do not reason from what is permitted there to what is permitted here. Rotating
the table is sanctioned housekeeping; the equivalent move applied to record files is the silent
data loss described above.

## Why there is no drift gate on the generated index

`docs/branch-review-index.md` is generated, and generated files elsewhere in this repository
are usually pinned by a byte-equality check. This one deliberately is not.

The corpus grows at roughly 26 records per day — 576 records spanning 2026-08-12 to
2026-09-02, with 570 of them written during August and a single-day peak of 97 on 2026-08-18.
A byte-equality gate against that would redden `main` after nearly every merge, because every
merge that appends a record invalidates the committed index; and it would conflict between
concurrent pull requests, because each would regenerate the same file over a different set of
records. That is precisely the reasoning already recorded for `review_state` at
`scripts/check-repo-awareness-snapshot.ts:21-28`, quoted above, and it applies here for the
same reason.

The consequence has to be stated plainly rather than glossed over: **the index may lag.** It
lists the records that existed when it was last generated, and nothing reports how far behind
it is. `npm run ledger:lookup` remains the authoritative read of the corpus and is what a
review decision must be based on. The index is a browsing convenience, refreshed by
`npm run docs:update`.

## Growth is the price of the design

The measured facts, as of 2026-09-02:

- 577 entries in `docs/branch-review-records/` — 576 records plus this directory's README —
  totalling 2.4 MB.
- That is more than half of the 1,144 tracked Markdown files under `docs/`.
- `docs/` now outweighs `src/`: 26 MB against 23 MB by apparent size (`du -sh --apparent-size`),
  32 MB against 23 MB by allocated blocks (`du -sh`). Quote the method with the number — the two
  differ by ~6 MB here because `docs/` holds thousands of small files, and a figure without its
  method invites a later reader to "correct" it to the other one. Either way the documentation
  tree is larger than the application it documents.

The conclusion the code forces is uncomfortable but unavoidable: **this cannot be solved by
archiving, compaction, or foldering.** Compaction is blocked by the one-row-per-file check.
Archiving into a subdirectory is the foldering case and is silently destructive. Deleting is
forbidden by policy and is exactly the history loss the corpus exists to prevent. There is no
fourth option hiding behind those three.

The append-only design is deliberate and it is correct. Concurrent pull requests never contend
on a shared hunk, an equivalent retry converges on the same file rather than duplicating, and
the review history is tamper-evident by construction. The growth is the cost of those
properties, and it is a cost worth paying at this size.

If growth ever genuinely must be addressed, the only safe direction is a deliberate,
explicitly reviewed migration that changes the reader in the same change as the layout — see
[Foldering is silent data loss](#foldering-is-silent-data-loss) for what that entails. Do not
weaken, relax, or exempt any gate to make room; every constraint documented above is load
bearing, and the two that are not enforced are weaknesses to be aware of, not licences.
