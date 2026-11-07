# Mockup retirement policy

_Updated 2026-11-05 — distinguish historical prototypes from the active developer hub; Prototypes owns._

When a mockup may be deleted, who decides, where it goes, and what evidence is required.

Enforced by `npm run check:mockups` (`scripts/check-mockup-retirement.mjs`), which runs in
`verify:cheap` and CI. The index it reads is [`mockups/README.md`](../mockups/README.md).

## Why this exists

On 2026-08-20 PR #2204 proposed ~1,644 lines of "dead" code on a reachability scan and was
walked back seven times. Four of the seven survivors had zero importers and were all alive.
`scripts/check-dead-code-candidate.mjs` was written to stop that happening to a **symbol**.
This policy is its route-and-file-level sibling.

A 2026-09-02 survey of the whole mockup surface (~430 files, ~98,000 lines) found three
things that make "delete the superseded generations" much more dangerous than it looks.

### 1. A mockup here is usually a provenance artifact, not a stale draft

In this repository a mockup and the production change it justifies are usually added **in the
same commit**. `search-heading` arrived with the search-band rewrite; `universal-search-command`
with `universal-search-command-surface.tsx`; `sidebar-live` with `ClinicalSidebar` and
`use-sidebar-pins.ts`; all nine document mockups with `src/components/document-viewer/section-nav.tsx`.

So a mockup is normally the design record attached to a shipped commit. Retirement is only
ever right for a **losing generation inside a multi-generation study**, once the winner is
identified and the loser is cited nowhere. Of 20 design-scratch families surveyed, that door
opened for two.

### 2. Filename supersession is systematically backwards

`answer-chat-perfected-v2` **imports** `answer-chat-perfected`; so does
`answer-loading-redesign`. Dictionary rounds 2 and 3 both import round 1. Services-filter
round 2 imports round 1. In the privacy family the _study_ imports the _chosen_ file. In at
least five families, deleting "the older generation" breaks the newer one.

A `-v2`, `-final`, `-refined` or `-perfected` suffix is not evidence of anything.

### 3. A prototype path does not prove design scratch

When this policy was written, the developer hub, Care Plan, Caring Contacts and Ward Flow were
production applications behind a developer gate. With their implementation modules they came to
~199 files and ~45,000 lines — and 82 modules had no "mockup" in their name, so path globs missed
them. Caring Contacts and Ward Flow were retired on 2026-09-26. The owner retired
[Care Plan on 2026-10-21 and the `/mockups/development` Owner panel copy on 2026-10-22](decisions/2026-10-21-retire-care-plan-and-design-studies.md).

The active developer hub is `/admin/developer-hub`, protected by `DeveloperAreaGate`; the former
`/mockups/development` addresses redirect there. No developer-gated prefix remains under
`/mockups`, and the production proxy blocks every mockup request it receives. The earlier
applications still demonstrate why retirement authority follows actual consumers and owner
decisions rather than filenames.

## Tiers — decided by evidence of a consumer, never by path

| Tier                                | What it is                                                                                                                                         | Retirable?                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **A — Design scratch**              | A design study whose only consumer is its own mockup route                                                                                         | Yes, on the evidence bar below                    |
| **B — Developer-gated application** | Developer-gated applications and their implementation modules                                                                                      | **Only on a recorded owner decision** — see below |
| **C — Fixture / infrastructure**    | Test fixtures, compatibility redirects, the shared `/mockups` shell, boundary-test subjects, and modules whose real consumers are scripts or tests | **Never alone** — only alongside its consumer     |

Tier B membership is read at runtime from `DEVELOPER_GATED_PATH_PREFIXES` in
`src/lib/developer-area/headers.ts`, never restated here, so the check follows that list the
day it changes.

Tier C exists because path is not a reliable signal, and two files prove it:
`src/lib/rag/rag-eval-cases.ts` (1,400 lines) is mockup-exclusive by route reachability but is
imported by nine scripts and seven tests, and its dependency `src/lib/eval-document-matching.ts`
is named literally in `scripts/pr-policy.mjs` as a RAG-ranking-protected path. A reachability
scan classifies both as mockup-only. Both are alive.

## The evidence bar

All six must hold. This is the Favourites retirement of 2026-08-27 — the only one this
repository has performed — written down.

1. **A written successor exists.** A named replacement recorded in `mockups/README.md`, in a
   doc, or in the commit that shipped it. Filename ordering is never evidence, and neither is
   commit ordering: in the document families every draft and the production implementation
   share one commit.
2. **Import search is clean.** Nothing under `src`, `tests`, `scripts` or `worker` imports it,
   names it as a string literal, or reads it from disk. This includes CSS `composes` edges and
   template-literal hrefs — neither of which any import graph shows.
3. **No committed test pins it**, or the test retires in the same commit as its subject.
4. **`npm run check:dead-code-candidate -- --diff origin/main` clears its removed exports**,
   run against a deepened clone (`git fetch --deepen=2000`; on a shallow clone the gate
   refuses because it cannot date anything). Its thresholds and refusal list are never tuned
   to make a diff pass — PR #2204's diff was cut back to satisfy the gate, not the reverse.
5. **It is Tier A.**
6. **The retirement is recorded** under `## Retired mockups` in `mockups/README.md`, naming
   the route and its successor. The record must survive the deletion.

**The negative rule, which is the point of this policy:** an unevidenced generation is not
retired, it is _asked about_. "Parallel draft, no recorded winner" is a legitimate, stable
resting state — not a backlog item, and not an invitation to guess.

## Who decides

- **Tier A with a written successor** — any contributor, following the checklist above.
- **Tier A with no recorded winner** — the repository owner decides, and records that decision
  in `mockups/README.md` in a separate commit _before_ any deletion. An AI session may propose
  and must never pick.
- **Tier B** — a product decision, and the owner's alone. It is recorded in the
  `## Retired developer-gated routes (owner decisions)` table in `mockups/README.md`, which the
  check reads: a gated deletion absent from that table fails, exactly as before, and a route
  recorded there that still exists on disk fails too. Every column is required, because a row
  that names a route and nothing else records no decision. An AI session may propose and must
  never write a row on its own account.

  This route exists because "never" and "fails the build" together meant a gated screen could not
  be retired however the product changed — the refusal was not a question being asked. It is
  deliberately the most demanding record in this policy, not the least.

- **Tier C** — only alongside its consumer.

## Where a retired mockup goes

Deleted. Git history is the archive; the `mockups/README.md` write-up is the durable record.
This follows the breadcrumb-header precedent already in that file: _"recover the route from
history if the alternatives need re-reading."_

Do not move retired mockups to an archive directory. A second copy of design scratch is the
problem this policy exists to prevent, not a solution to it.

## What the check enforces

`npm run check:mockups` reads files only — no build, no network.

| Mode                                                                                                    | Enforces                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| default                                                                                                 | **Index completeness** — every route directory under `src/app/mockups/` has an entry in `mockups/README.md`. **Index accuracy** — nothing listed as retired still exists on disk                                                                                                                                                                                                                           |
| `--diff <base>` (run as `--diff auto` inside `check:mockups`, so it is enforced everywhere the gate is) | **Tier B refusal** — a deletion under a developer-gated prefix fails. **Tier C and import-graph safety** — a deleted file still imported, named as a string literal, reached by a relative or dynamic import, referenced by a CSS `composes`, named by its `/mockups/<slug>` URL, or read from disk by any survivor fails. **Evidence of record** — a deleted route absent from `## Retired mockups` fails |
| `--self-test`                                                                                           | The parser and classifier assertions, as required of every gate in this repository                                                                                                                                                                                                                                                                                                                         |

The check fails **closed**: an unreadable file, a missing route root, a reordered Retired-table
header, or an unresolvable diff base is a refusal, never a pass.

`auto` resolves the base from `MOCKUP_RETIREMENT_BASE` if set, otherwise the merge base with
`origin/main`. That is what lets one script name cover local runs, `verify:cheap` and CI without
each caller knowing the branch shape.

Note what it deliberately does _not_ do. It never decides that something is superseded, and it
never clears a candidate — reachability is exactly what proved insufficient. It makes the
written record the gate and refuses everything the record does not cover.

## What this policy does not change

- **It extends no gate exemption.** Mockups are exempt from `require-button-wiring` and
  `tests/route-reachability.test.ts`, and separately from `no-hardcoded-hex`,
  `require-z-index-ladder`, `require-lucide-icon-aria`, `check:icon-scale`,
  `check:design-system-contract`, and the required Playwright lane. That list is what already
  exists, recorded here because AGENTS.md and CLAUDE.md understated it until 2026-09-02.

  One exemption is commonly assumed and does **not** exist. **`knip` can see most of this
  surface**: its ignore is a _basename_ filter (`**/*mockup*`), so
  `*-mockups.tsx` is exempt while the `src/app/mockups/<slug>/page.tsx` routes and the
  `*/mockups/**` subtrees are not — `knip --include files` reports inside them today. What
  suppresses those findings is `check:knip` running only
  `--include dependencies,unlisted,unresolved,duplicates`, which omits unused-file and
  unused-export analysis repo-wide. That is not a mockup carve-out, and it is why this policy
  cannot lean on knip.

  Nothing here widens any exemption, and the surface stays typechecked and stays inside the
  `mockups` bundle bucket.

- **Never refresh the mockups bundle baseline downward toward zero.** `compareToBudget` in
  `scripts/check-bundle-budget.mjs` treats growth from a zero baseline as `+Infinity` and
  hard-fails, which would turn a 25%-tolerance hygiene ceiling into a zero-tolerance gate on
  the next mockup anyone adds. Note also that `check:bundle-budget` cannot prove a retirement
  safe: its mockup-route guard is skipped entirely when `.next/server/app/mockups` is absent,
  so a total removal measures zero and passes. Use a before/after `--json` pair on a cold
  build (`rm -rf .next` first) as the evidence of what was saved.
