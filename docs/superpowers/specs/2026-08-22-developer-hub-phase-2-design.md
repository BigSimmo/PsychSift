# Developer hub — Phase 2 design (repo awareness)

Date: 2026-08-22
Status: **approved 2026-08-22.** The §4.1 scope question is decided — see the ruling there.
Scope: Phase 2 of four. Phase 1 shipped; phases 3–4 remain outline only.

## 1. Purpose

Phase 1 gave the hub its shell, an environment strip, and one live panel: the task ledger.
Phase 2 fills the four panels the registry already declares as `phase: 2`, all of them answering
**"what is the state of this repository right now?"** from data that already exists on disk:

| Panel            | Group     | Question it answers                                       |
| ---------------- | --------- | --------------------------------------------------------- |
| `routes`         | reference | What pages and modes exist, and which are reachable?      |
| `documentation`  | reference | What documents exist, how stale, and what links are dead? |
| `test-health`    | system    | What is quarantined or unstable, and until when?          |
| `work-in-flight` | work      | What has been reviewed, at which head, with what outcome? |

Flipping each entry's `phase` to `1` and adding an `href` is the whole registry change — that is
the extension point Phase 1 built.

## 2. What Phase 1 proved, and what this phase inherits

Three findings are load-bearing here and are not re-litigated.

**2.1 `docs/` and `data/` never reach production.** The runtime Docker stage copies `.next`,
`public`, `node_modules`, four named source files, `package.json` and `next.config.ts` — verified
by reading the Dockerfile. Any panel that reads a repo file at request time works in dev and finds
nothing in production. **Every Phase 2 panel therefore uses the Phase 1 pattern:** a build-time
generator writes JSON into `data/`, and a Server Component imports it so the bundler inlines it.
No `readFile`, ever.

**2.2 A generator must not require git at build time.** Phase 1's `prebuild` re-runs inside the
Docker image, where `.dockerignore` excludes `.git`, so a generator that shells out to git there
gets nothing and silently writes `null`. Phase 1 fixed this by **preserving the committed value
when git is unavailable**, which is fail-safe in one direction only: a preserved value can make
content look _older_ than it is, never fresher. Phase 2 needs git for two panels — document age and
review recency — and **must reuse that preservation pattern rather than rediscover it**.

**2.3 Server/Client boundary violations are invisible to every gate except a real build.** Phase 1
produced two. Typecheck does not model the boundary; Vitest has no boundary at all. A Server
Component that reads _data_ exported from a `"use client"` module receives a client-reference proxy
rather than the value. **Phase 2 panels stay Server Components, import no data from client modules,
and the plan carries `npm run build` as a mandatory acceptance gate, not an optional extra.**

## 3. Scope

### In scope

- One build-time generator producing `data/repo-awareness-snapshot.json`.
- One staleness gate for it, joining the existing `check:outstanding-issues` family.
- Four routes under `/mockups/development/`, each inheriting `DeveloperAreaGate` from the existing
  `development` layout — no new gate, no second gate.
- Flipping the four registry entries from `phase: 2` to `phase: 1` with their `href`s.

### Explicitly out of scope

- **Any live GitHub read.** See §4.1 — this is the decision that shapes the phase.
- Any Supabase read. That is Phase 3 and carries its own approval.
- Any write path. The hub stays read-only: mutation is only legal through the repo's own serialized
  tooling, and a browser control that bypassed it would either break that discipline or fail its gate.
- Wiring `isDemoMode()`, the signed-in email, or the document count into the environment strip.
  Phase 1 left those deliberately `null`; they belong with the phase that owns their data source.

### Non-goals

- A second source of truth. Every panel renders a file the repo already maintains. Where a fact is
  wrong, the fix belongs in that file's own tooling, never here.
- Replacing commands with buttons. Acting on repo state stays a command.

## 4. The decisions this phase turns on

### 4.1 "Work in flight" cannot mean what its name suggests

The Phase 1 spec's outline describes this panel as _"open changes, checks, review state"_ and
promises _"local data; no new permissions"_. **Those two clauses contradict each other.** Open
changes and their check status are GitHub state: which pull requests are open, whether CI is green,
whether a review is outstanding. None of it exists on disk. Reading it means a token, a network
call, and a new approval boundary this repo deliberately gates.

What _is_ on disk is substantial, and for the hub's stated purpose — decide what to do next — arguably
more useful:

- `docs/branch-review-records/` — **409 immutable review records**, each carrying date, ref, the full
  40-character head SHA, scope, outcome, and the checks that were run.
- `docs/branch-review-ledger.md` and its archives — the frozen historical table.
- Branch ancestry and merge state, resolvable at generation time while git is available.

**Recommendation: rename the panel to "Review state" and scope it to what the repo knows.** It would
answer "has this ref been reviewed at this exact head, with what outcome, and is that head still
current?" — precisely the question `npm run ledger:lookup` exists to answer, and one currently
answerable only from a terminal.

**DECIDED 2026-08-22 by the owner: rename the panel to "Review state" and scope it to the repository's
own records.** The alternative considered and rejected for now was deferring the panel to a later
phase that takes GitHub access as an explicit, approved dependency; it remains available if live PR
state is ever wanted, as a separate phase with its own approval.

What this decision forecloses, stated so a later reader does not re-open it by accident: the panel
will **not** show which pull requests are open, whether their CI is green, or whether a review is
outstanding. It answers "has this ref been reviewed at this exact head, with what outcome" — history,
not live state. The registry entry's `id` stays `work-in-flight` so the Phase 1 extension mechanism
is untouched; only its `name` and `summary` change, because a label promising more than its data
delivers is the `#338` failure wearing different clothes.

### 4.2 One snapshot and one gate, not four

Four panels could take four generators and four gates. They should not. Every additional gate is
another thing that can cry wolf, and this repo's own experience is that a gate which fires when
nothing is wrong is one people learn to route around. One generator, one `data/` file, one `check:`
command, one failure message naming the fix.

The snapshot is a single object with four independent top-level keys, so a parse failure in one
section fails the build loudly rather than silently emptying one panel.

### 4.3 Each panel takes its own route

Phase 1 established the rule: a panel earns its own route when it is data-heavy, or needs a source
the hub must not depend on. All four qualify — the generated site map alone is 71 KB. The hub keeps
its grouped cards; each card links to its route.

## 5. Data contract

`data/repo-awareness-snapshot.json`:

```json
{
  "version": "repo-awareness-snapshot-v1",
  "captured_revision": { "sha": "<40-char>", "committed_at": "<ISO 8601>" },
  "routes": {
    "modes": [{ "id": "answer", "label": "Answer", "home": "/" }],
    "pages": [{ "path": "/dsm", "kind": "page", "reachable": true }]
  },
  "documentation": {
    "documents": [{ "path": "docs/testing.md", "title": "…", "last_changed": "2026-08-11", "generated": false }],
    "broken_links": [{ "from": "docs/foo.md", "target": "bar.md" }]
  },
  "test_health": {
    "quarantined": [{ "test": "…", "reason": "…", "expires": "2026-09-01", "expired": false }],
    "counts": { "quarantined": 0, "expired": 0 }
  },
  "review_state": {
    "records": [{ "date": "2026-08-15", "ref": "…", "head": "<40-char>", "scope": "…", "outcome": "…" }],
    "counts": { "records": 409 }
  }
}
```

Rules, each inherited from a Phase 1 lesson rather than invented:

- `version` is checked at read time. A mismatch throws; it never degrades to a partial render.
- **No `generated_at`.** The file must be byte-deterministic or the gate fails on every run.
- `captured_revision` follows §2.2: git when available, the committed value when not, `null` only
  when there is no prior value to preserve.
- Counts are computed once by the generator and rendered as given, so a count and its own list
  cannot disagree.
- A malformed input fails the generator loudly and names the file. **No silent row-dropping** — the
  ledger page's "Other" bucket exists because a silent drop under-reports outstanding work.

## 6. Freshness

Identical to Phase 1 §6, reusing its components: generation wired into `docs:update` and `prebuild`,
a gate that fails the build on drift, and the existing `FreshnessStamp` — which Phase 1 deliberately
built generic over "content date vs viewed date" for exactly this reuse.

`test_health` needs one extra honesty rule. `tests/flake-ledger.json` currently holds **zero
flakes**. A panel that renders nothing there is indistinguishable from one that failed to load. It
must say "no tests are quarantined" in words — the same rule that makes the environment strip say
"build unknown" rather than render a blank.

## 7. Failure behaviour

| Condition                             | Behaviour                                                 |
| ------------------------------------- | --------------------------------------------------------- |
| Any input file missing or unparseable | Generator exits non-zero naming the file. Build fails.    |
| Snapshot missing at build             | Import fails. Build fails. Never an empty page.           |
| Snapshot `version` unrecognised       | Throws at read. Never a partial render.                   |
| Snapshot disagrees with the repo      | The `check:` gate fails with the exact fix command.       |
| Git unavailable                       | `captured_revision` preserved per §2.2, never fabricated. |
| A section is empty                    | The panel says so in words. Never a blank container.      |

## 8. Verification

Beyond unit and DOM tests, three gates are mandatory rather than discretionary, each because Phase 1
proved the cheaper gates blind to it:

1. **`npm run build`** — the only gate that catches a Server/Client boundary violation (§2.3).
2. **A no-git generator test** — the `git archive` technique that confirmed the Phase 1 defect.
3. **`npm run verify:phone-chrome`** — required whenever the shared `InPageNavHeader` is mounted,
   even though these pages are desktop-first, because a defect there degrades pages that are used
   on a phone.

## 9. Open questions for the owner

1. ~~**§4.1 — re-scope "Work in flight" to "Review state", or defer it to a GitHub-enabled phase?**~~
   **Answered 2026-08-22: re-scope to "Review state".** See §4.1.
2. Should the routes panel flag _orphan_ routes — a production page with no inbound nav link? CI
   already enforces that, so the panel would re-display a fact a gate guarantees. Cheap, but
   duplication.
3. Is document _age_ worth showing without a staleness policy to judge it against? "Last changed
   2026-02-11" invites a reader to infer rot that may not exist.
