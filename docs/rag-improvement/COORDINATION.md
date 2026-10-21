# RAG improvement programme — coordination handover

> **Status (2026-10-20): programme complete; kept as history.** Every packet in the
> [HANDOVER status table](HANDOVER.md) has merged or been closed, and S8 onward stays gated on an owner
> decision. This is no longer the operational board: open RAG work lives in
> [`docs/outstanding-issues.md`](../outstanding-issues.md), and the rules live in
> [`docs/rag-behaviour/`](../rag-behaviour/README.md). Code comments still cite its sections, so it stays in
> place rather than moving to `docs/archive/`.

**Status:** maintained coordinator context (2026-08-13). This file hands the **coordinator
role** to a future chat: the session that dispatches worker sessions, drives their PRs to
green, merges them, approves canaries, and keeps the programme moving. Worker sessions read
[HANDOVER.md](HANDOVER.md); the design authority is [README.md](README.md); this file is
everything the coordinator additionally needs — the programme's history, the operating
decisions already made with the owner, and the playbook learned running the first cycle.

The three files are deliberately layered: README = _what to build and why_, HANDOVER =
_what each worker session does_, COORDINATION = _how the owner's chat runs the programme_.
Do not duplicate content across them; link instead.

---

## 1. Programme history (what has already happened)

Chronological, with the durable artefacts:

1. **PDF review + programme guide.** The owner's uploaded "Clinical RAG Improvement
   Programme" PDF was reviewed against the repo; agreed items kept, seven corrections made
   (stale pin, `check:rag:fixtures` name collision, intent detection already existing in
   triplicate, missing engagement with `docs/rag-behaviour/refuted-approaches.md`, `#231`'s
   real stop condition, single-owner roles, wrong follow-up assumptions). Result:
   `docs/rag-improvement/README.md` — **PR #1895, merged 2026-08-13**. The owner's
   priorities baked in: answer-quality track first, moderate (~1.5×) length increase.
2. **A1 phase 1 landed via babysit.** **PR #1899** ("record the structured
   generation-quality verdict on fallback", branch
   `claude/lithium-generation-quality-debug-ji1vce`) — structured `GenerationQualityError`
   diagnostics, `generation_quality_gate:*` retry reasons, fallback metadata,
   `scripts/probe-generation-quality.ts`. Driving it to merge required three fixes (see the
   playbook in §5): a real merge conflict with main resolved by keeping **both** sides'
   additive fallback diagnostics; a pre-existing test failure fixed by updating the expected
   verdict `template_like_answer` → `empty_after_sanitize` (current `sanitizeAnswerText`
   strips that fixture to empty, so the first rung of the failure-reason ladder wins); and a
   maintainability-budget breach fixed by extracting the prompt constant verbatim to
   `src/lib/rag/rag-answer-instructions.ts`. **Merged 2026-08-13** (merge commit `c924b65`).
3. **Worker handover pack.** `docs/rag-improvement/HANDOVER.md` — packets S1–S7+, status
   table, checklists, per-packet paste-ready prompts. **PR #1908, merged 2026-08-13.**

Nothing else from the programme has started. S1 and S4 are the next dispatches.

## 2. The coordinator role

The coordinator chat does what worker sessions must not:

- **Dispatch** exactly one worker session per packet, using the HANDOVER §7 prompt for that
  packet — or, preferably, the _tailored_ version the previous worker session emitted as its
  closing "handoff for the next chat" section (see §4).
- **Babysit** each worker PR to green and **merge** it (workers stop at the open PR by
  contract). Use the playbook in §5.
- **Approve and dispatch canaries.** Live eval-canary pairs (~$1–2/run, `eval-canary`
  repository dispatch, no `workflow_dispatch`) are per-run owner decisions. The coordinator
  relays the owner's approval; it never self-approves. Same for provider-backed evals
  (`eval:rag`, `eval:quality`, `eval:retrieval:quality`, `verify:release`,
  `check:supabase-project`, `test:live`) and live Supabase reads.
- **Keep the status table honest** — verify HANDOVER §2 rows against live GitHub/git state
  at the start of each coordination turn; correct stale rows in the next docs-carrying PR.
- **Capture follow-ups** into `docs/outstanding-issues.md` via `/issues` before context is
  lost.

Worker sessions implement one packet, run gates, open one PR, append the ledger, update
their status row, and stop. They never merge, never watch CI, never dispatch canaries.

## 3. Scheduling and session-configuration decisions (already made with the owner)

**Wave plan** (Track A is strictly consecutive — shared files and evidence dependencies;
Track B is the parallel lane):

| Wave | Dispatch (one fresh chat per task)                                                                                                                                        | Gate to the next wave                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 0    | **D1** (this docs PR) + **S4** + **S1b** + **#212 T4** in parallel; **C1** post-S1 canary (done)                                                                          | D1 merged (unblocks R0); S1b merged + canary green (unblocks S1c) |
| 1    | **S1c** + **S1d** + **G1** + **S5** + **S6** in parallel (disjoint files); S1c and S1d merged one at a time, each with its own canary pair (R0 reconcile landed as #2045) | S1c and S1d merged + canaries green                               |
| 2    | **S2** (+S2b if split) + **S5** + **S6** (S5/S6 after S4 merges)                                                                                                          | S2 merged + canary pair + `eval:answer-quality` + Gate E          |
| 3    | **S3** + #212 closure                                                                                                                                                     | S3 merged                                                         |
| 4    | S7+ only after explicit owner decisions (Gate B verdict, experiment appetite)                                                                                             | —                                                                 |

Waves 1–2 of the original plan (S1 + S4, then S2 + S5 + S6) were re-cut on 2026-08-17 after S1
landed: the owner chose **R1 before S2** (S1's residual R1 explains most remaining lithium
timeouts and A2/A3 add length), and **governance Option B** for the document-summary
`similarity: 1` question. Track A stays strictly consecutive; Track B and the `#212` sibling
stream are the parallel lanes.

One session per packet, never two — the duplicate-PR trap is real and recorded (`#292`:
PRs #1766/#1767 shipped the same conversion twice, four hours apart).

**Per-packet session settings** (agreed with the owner):

| Task                    | Model       | Reasoning effort                                                   | Plan mode                                                                | Fast mode |
| ----------------------- | ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------- |
| Coordinator (this chat) | Fable       | Medium — routing, not building                                     | Only while re-planning                                                   | No        |
| C1 canary compare       | coordinator | Low                                                                | No                                                                       | —         |
| D1 docs / R0 reconcile  | Sonnet      | Medium / Low                                                       | No                                                                       | OK        |
| S1 (done)               | Fable       | High (not xhigh — the plan exists; the session is build/diagnosis) | Yes — approve the mitigation-rung choice before edits                    | No        |
| S1b (R1 routing)        | Fable       | High                                                               | Yes — approve the class list before edits                                | No        |
| S1c (R2 + R3)           | Fable       | High                                                               | Yes                                                                      | No        |
| G1 (Option B tag)       | Opus        | High                                                               | Optional                                                                 | No        |
| S2 (and S2b if split)   | Fable       | High                                                               | Yes — eyeball the composition menu + length targets (clinical judgement) | No        |
| S3                      | Opus        | Medium–high                                                        | Optional                                                                 | OK        |
| S4                      | Opus        | Medium                                                             | No                                                                       | OK        |
| S5/S6                   | Fable       | High for sandbox/isolation design, medium for plumbing             | For the design decisions                                                 | No        |
| #212 T4 (worker)        | Fable       | High — concurrent job claimer, retry/poison-pill risk              | Yes — approve per-site fail/skip decisions                               | No        |

Rationale anchors: `AGENTS.md` "Reasoning effort calibration" (RAG surfaces = top row;
xhigh planning over-produces; debugging inverts plan/build effort), and plan mode only in
sessions the owner will check back on — a fire-and-forget session parked in plan mode
stalls indefinitely.

## 4. The worker-prompt pattern (chained handoffs)

Every packet prompt from HANDOVER §7 gets one closing paragraph added when dispatched
(established with the owner for S1; reuse the pattern for all packets):

> **Handoff for the next chat:** as the final section of your last message, produce the
> ready-to-paste prompt for the next session. Start from the next packet's prompt in
> `docs/rag-improvement/HANDOVER.md` §7 and tailor it with this session's outcomes: your PR
> number and branch, the key findings/decisions the next packet depends on, any approval
> still pending, and anything you discovered that changes the next packet (flag it as a
> proposed HANDOVER edit rather than silently deviating). Label it clearly "Paste into the
> next session after you merge my PR".

The S1 dispatch prompt already exists in tailored form (HANDOVER §7 S1 + the reading order
including merged PR #1899's diff, the `rag.ts` 4,362-line budget warning, and the handoff
paragraph). If the coordinator needs to regenerate it, compose: HANDOVER §7 S1 prompt +
"read merged #1899's diff first; do not re-implement it" + budget warning + handoff
paragraph.

## 5. Babysit playbook (learned driving #1899 to merge)

- **Subscribe, don't poll:** `subscribe_pr_activity` for the PR; webhook events wake the
  session. `send_later` self check-ins may require an MCP approval the session cannot grant
  non-interactively — if blocked, rely on events and a manual owner nudge.
- **`dirty` is a claim, not a fact:** confirm with
  `git merge-tree --write-tree origin/main <tip>` before treating GitHub's
  `mergeable_state: dirty` as a real conflict. Behind-but-clean → sync once, late.
- **Resolve conflicts in a scratch worktree** (`git worktree add … <pr-branch>`), symlink
  `node_modules` from the main checkout for gates. When two sessions added _different
  additive_ fields at the same site (the common case here), the right resolution keeps both
  sides. Regenerate derived docs (`npm run docs:update`) rather than hand-resolving counts.
- **A failing test on the merge head may predate you:** check it against the PR's own head
  before blaming the merge. The #1899 case was a semantic drift — main's sanitizer changed
  which quality-verdict token a fixture trips; the fix was updating the expectation with a
  comment, not weakening the mechanism.
- **`src/lib/rag/rag.ts` has a 4,362-line no-growth budget**
  (`scripts/check-maintainability-budgets.mjs`, currently ~4,343 after the
  `rag-answer-instructions.ts` extraction). Additive diagnostics PRs can breach it on
  merge. Fix by extracting a cohesive module (pure move), never by raising the budget.
- **Expected noise:** CodeRabbit rate-limit comment edits (no action); the `ci-triage` bot
  comment restating failures you are already fixing (no action); `PR required` failing as
  the aggregate of a failure you've fixed on a superseded head (no action once pushed).
- **The PR-handoff stop hook re-arms** after every PR the coordinator session itself
  creates, blocking GitHub PR reads and loop tools. The owner's explicit babysit/merge
  instruction is the unlock; the deny message names the exact marker-removal command.
- **After merge:** verify the landing by content (the merged tree contains the expected
  files/lines — squash merges orphan branch SHAs), clean up worktrees, and skip
  babysit-only ledger pushes (the repo forbids tips whose sole delta is a babysit record).

## 6. Standing approvals map

Granted by the programme's standing decisions (no fresh ask needed):

- Dispatching worker sessions with the HANDOVER prompts; merging worker PRs that are green
  with all required checks and no unresolved actionable threads, when the owner has asked
  for babysit-to-merge on that PR or wave.
- Offline gates, `verify:pr-local`, focused tests, `eval:rag:offline`,
  `check:rag:fixtures` — all local/offline verification.
- Docs-only PRs maintaining HANDOVER/COORDINATION state.

Always a fresh owner ask, every single time:

- Live eval-canary dispatches (each run), any provider-backed eval or live test, live
  Supabase queries, reindexing, migrations, deployment actions, enabling any flag in
  production, and anything in `docs/rag-behaviour/refuted-approaches.md` territory.

## 7. Current state and next actions (update on change)

- **Done (2026-08-17):** #1895, #1899, #1908 (2026-08-13); **#2022 S1** (squash `2bd146eed`);
  **#2024 D1** (`78fe906b8`); **#2035 S1b** (merge `92f7618c0`); **#2036 S4** (`f5b093291`);
  **#2037 #212 T4** (`1726537b7`); **#2045 R0 reconcile** (28 requests; #212 closed); **#2048 D2** (S1d packet); **#2056 S5** (merge `093f9340c`: B1 `verification_latency_ms` behind `RAG_TELEMETRY_EXTENDED`, B2 `eval:rag:adversarial:offline` with 3 self-expiring divergence pins). Canary
  pairs: S1 baseline 32025082010 → S1b post 32039841070, recall 1.0/1.0, zero per-case rr
  regressions, answer gate 44/44. The first S1b post run (32038751592) was red on one non-golden
  case; root-caused to the finalizer gap-recovery hole → packet S1d, not S1b.
- **Owner decisions:** R1 before S2; governance Option B; S1d lands before S2.
- **Wave 1 status (2026-08-18):** all packets merged — S1c (#2052; follow-up #2063 kept), S1d
  (#2054, merge `0bbd64fbc`), G1 (#2053, merge `125e98526`), S6 (#2057). Post-S1d canary run
  32097916649 (`9904fbda8`) was **red** on `agitation-im-po-route-short-terms` (extractive path,
  deterministic, 5 → 0 citations); live bisect placed it on the S1c follow-up **#2065**
  (condition-first `for/in` regex in `rag-claim-support.ts`), not S1d/G1. **Revert PR #2088** is
  open (probe restores 5 citations; offline 614/614). A confirmation canary follows its merge and
  becomes the new baseline. Reconcile D4 applied 17 requests (G1/S1c/governance rows closed).
- **Current state (2026-08-21):** Track A is complete through **S3** (`#2108`, squash
  `511d22f4d`, A4 follow-up suggestions). **Gate B PASSED** (`#2154`, 2026-08-18, evidence run
  `32176604314` at `8a92378`), and **S7/B4** (Docling worker shadow mode, `#2170`, squash
  `5437c309f`) is merged with shadow mode defaulting to `legacy` — turning it on in production is
  an operator step, not code. **S8+ remains owner-gated**: B5 (Ragas pilot) needs Gate A sign-off
  before it can start, B6 (reranker benchmark) needs an owner go/no-go coordinated with `#001`, B7
  (DSPy) is blocked on a clinician-reviewed dataset that does not exist yet.
- **Owed by the owner now:** the Gate E blinded clinical-quality read on the S2 (v19 prompt)
  answers — recorded "pending" in HANDOVER.md §1 (see README.md §4 for what Gate E covers); the
  shadow-mode production enable decision for B4 (Railway variable; preconditions in
  `docs/worker-deploy-runbook.md`); the Gate A sign-off B5 is waiting on; a B6 go/no-go; and
  disposition of the three pinned adversarial divergences in the ledger — `#C2D9JF`
  (scope-other-owner-document), `#NTAV3D` (scope-guessed-chunk-id), `#VXB8XA`
  (cite-mismatched-attribution).
- **Live board (artifact, owner-private):** RAG Master Plan v2 —
  `https://claude.ai/code/artifact/d5dba709-0df3-40e3-8a45-15997231533d`.

## 8. Coordination-chat bootstrap prompt

Paste this into a fresh chat to stand up the coordinator:

> You are the coordination chat for the Clinical KB RAG improvement programme in
> BigSimmo/Database. Read, in order: `docs/rag-improvement/COORDINATION.md` (your role,
> history, decisions, playbook), `docs/rag-improvement/HANDOVER.md` (worker packets,
> status table, worker prompts), and skim `docs/rag-improvement/README.md` §5 for the
> track structure. Then verify live state before trusting any of it: check the HANDOVER
> status table against the actual open/merged PRs and branches on GitHub, and note any
> stale rows for correction in the next docs PR.
>
> Report back: (1) current programme state, (2) which wave we are in and what is ready to
> dispatch, (3) the exact tailored prompt(s) for the next worker session(s) per
> COORDINATION §4, and (4) anything waiting on my decision (merges, canary approvals).
> Then wait for my instruction — dispatching sessions, babysitting a PR to merge, or
> approving a canary are my calls, per the standing approvals map in COORDINATION §6.
> Never start implementing a packet yourself in this chat; the coordinator dispatches and
> merges, workers build.
