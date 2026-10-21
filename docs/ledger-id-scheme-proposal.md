# Collision-free outstanding-issue ids — design proposal

**Status:** design only — no implementation, no id allocated by this document
**Ledger row:** `#168` (P2, rec) · closely related `#156` (same race, resolution-path evidence)
**Distinct from:** `#292`, which is two sessions colliding on the **work** a row describes. A
collision-free id leaves that untouched.
**Measured:** 2026-08-14 against `origin/main` at `d47aa6d` — 314 rows, marker at `next-id=317`

---

## 1. The problem

Ids are allocated read-modify-write against the `issues:next-id` marker **inside the very file
being edited**. `scripts/outstanding-issues.mjs` reads the marker, claims that number, and
rewrites the marker to `N + 1`. Two branches open at the same time both read `N` and both
write `N`.

Because duplicate ids are unacceptable, a union merge driver is unsafe — `.gitattributes` says
so explicitly, which is why this file deliberately has no driver and **every overlapping append
conflicts by hand**.

Manual resolution is where rows get dropped. The record is specific:

- PR #1490 was closed during a conflict resolution and took the only record of four snapshots
  with it (`#152`).
- One P3 row was renumbered `#135` → `#141` → `#145` → `#147` → `#149` across four sync cycles
  because `main` had taken each id in turn (`#156`, measured on PR #1451).
- `#168` itself was written as `#159`, then renumbered because `main` had already used `#159`.
- The GitHub **Update branch** button produced a head carrying **two rows numbered `#141` and
  two `next-id` markers**, leaving the marker _below_ `main`'s highest id — so the next
  allocation would have reused a live number. `git merge` reported success; only
  `npm run check:outstanding-issues` caught it (`#156`).

The inbox (`scripts/ledger-inbox.mjs`) removed the mechanical errors — requests are immutable
UUID-named files and only `npm run issues:reconcile` writes the canonical ledger — but it
explicitly did not remove this one. Reconciliation still allocates from the marker, so two
reconcile branches still contend, and the single-writer discipline is what makes that
tolerable rather than fixed.

---

## 2. What the id has to do

Any scheme has to satisfy four things at once, which is why the obvious answers are wrong:

1. **Collision-free without coordination.** Two sessions that never see each other must not
   produce the same id.
2. **Stable once written.** Ids are cited by other rows, by review records under
   `docs/archive/branch-review-records/`, by `AGENTS.md`, by `.claude/skills/issues/SKILL.md`, and by
   commit messages and PR bodies across the repo's history. An id that can be renumbered is the
   defect, not the format.
3. **Readable enough to say aloud.** `/issues` output, the `SessionStart` hook, and every
   handoff summary read ids back to a human. `#151` works in conversation; a bare
   `01JQ8ZK3M7Q9V2W4X6Y8Z0ABCD` does not.
4. **Sortable by creation.** The ledger's queue and archive both read better in the order the
   work arrived.

---

## 3. Recommendation — ULID stored, permanent short display id allocated

Allocate a **ULID** as the durable id and a **permanent short display id** for human use.

- **ULID**, not UUIDv4, because a ULID is lexicographically sortable by its millisecond
  timestamp prefix — requirement 4 — while remaining collision-free without coordination.
  UUIDv7 is an equally good fit if a dependency is preferred over ~20 lines of local code; the
  repo already generates UUIDv4 via `randomUUID()` in `ledger-inbox.mjs`, so neither needs a
  new package.
- **Display id** starts as the first 6 characters of the ULID's random suffix, rendered
  `#K3M7Q9`, and is stored with the row at allocation time. Six Crockford base-32 characters is
  ~1.07 billion values, so a collision is rare at the observed rate of roughly 320 rows a year.
- **Collision handling happens before writing.** The allocator checks display-id uniqueness; if
  the initial 6-character candidate is already allocated, it takes additional characters until
  it finds an unused candidate, then stores that result. Existing display ids are never
  lengthened or otherwise changed. This preserves every written `#K3M7Q9` citation while keeping
  the durable ULID as the collision-free machine identity.

Rejected alternatives, briefly:

- **Timestamp + slug** (`#2026-08-14-merge-loss`) is readable and sortable, but two sessions
  filing similar rows on the same day collide on the slug, and the slug wants to change when
  the row is re-scoped — reintroducing renumbering by another name.
- **Content hash** is collision-free but neither sortable nor stable: any edit to the row
  changes its identity.
- **Keeping sequential ids and adding a lock** does not work across branches. There is no
  shared state at allocation time; that is the whole problem.

---

## 4. Migration path

**The 314 existing sequential ids keep their literal ids, permanently.** Renumbering them is
off the table — they are cited across the ledger, the review records, the agent instructions
and the entire commit history, and a rewrite would invalidate every one of those citations
while producing exactly the renumbering churn this row exists to end.

So the two forms coexist, and the migration is additive:

| Step | Change                                                                                                                                                        | Risk                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1    | Widen every id validator to accept both `#NNN` and the new stored display id, while allocation still uses the marker. No behaviour change; purely permissive. | Low. Fully reversible.                                          |
| 2    | Add ULID and display-id fields to new rows and switch allocation to them. The `issues:next-id` marker stops being read.                                       | Medium — this is the cutover.                                   |
| 3    | Remove the marker and its `next-id` guards once no writer consults it.                                                                                        | Low, but only after step 2 has been through a few real appends. |
| 4    | Reconsider a union merge driver, which becomes safe only once **no** id is allocated read-modify-write.                                                       | Deliberately last. See the Stop below.                          |

**Every place that currently assumes a sequential id** — all of these need step 1 before
anything else moves:

- `scripts/ledger-inbox.mjs` — `/^#\d{3,}$/` in `validateRequest`, twice (the `done` and
  `update` actions).
- `scripts/check-outstanding-issues.mjs` — `ID_CELL = /^#\d+$/`; the
  `MARKER = /<!--\s*issues:next-id=(\d+)\s*-->/` parse; the `nextId <= highest` assertion; and
  the `String(highest).padStart(3, "0")` formatting in its messages.
- `scripts/outstanding-issues.mjs` — the allocator that reads `parsed.nextId`, formats
  `#${String(number).padStart(3, "0")}`, and rewrites the marker to `nextId + 1`.
- `scripts/issues-report.mjs` and `.claude/hooks/issues-surface.sh`, which render ids back to
  the reader.

A row-per-file variant — one file per row in a new per-row directory under `docs/`, with the
table generated the way `docs/site-map.md` already is — removes the shared hunk entirely and is
the stronger end state. It is a larger change and should be decided separately; the id scheme
is a prerequisite for it either way, since per-row filenames need collision-free names.

---

## 5. What this does not fix

`#292` — two sessions independently building the same queued item — is untouched by any of
this. That is a collision on the **work** a row describes, not on its id, and the mitigation
there is the open-PR check already written into the three skills. Do not conflate them when
scoping the implementation.

`#156`'s second finding is also untouched: a merge that silently drops an appended prose block
is invisible to `check:outstanding-issues`, which validates ids and structure rather than
whether both sides' text survived. A collision-free id makes such merges rarer; it does not
make them detectable. `npm run audit:merge-loss` is the closest thing the repo now has to that
detection.

---

## 6. Stop

- **Do not reinstate `merge=union` while ids are sequential.** That combination was tried in
  PR #1416 and removed for duplicating rows and the marker. It only becomes safe after step 3.
- **Do not renumber existing rows** to make the ledger uniform. The citations are the point.
- **Do not implement this from this document alone.** It is a proposal; the cutover in step 2
  wants its own PR, its own review, and a check that both id forms round-trip through
  `issues:add`, `issues:update`, `issues:done` and `issues:reconcile` before the marker is
  removed.
