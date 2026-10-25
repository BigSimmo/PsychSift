# Eval canary ledger

_Started 24 Oct 2026._

Every merge that changes protected search or answer behaviour should record its before and after
Eval Canary pair here, so the evidence lives in one place instead of scattered commit messages. The
rule itself is in [safeguards.md](safeguards.md) and the `# RAG ranking protection` section of
`AGENTS.md`; this file only records what happened.

For each PR, record:

- the PR number and the date it merged;
- the before run: its run ID and the commit it ran on;
- the after run: its run ID and the commit it ran on;
- the recall figures (document recall and content recall, plus the answer and search pass counts);
- the IDs of any failing eval cases.

Write "not recorded" for anything you cannot point to. Never fill a gap from memory.

## Ledger

The rows below were backfilled on 24 Oct 2026 from git commit messages only, except where the
source column says otherwise. "Pending" means the commit message said the run was still to come;
no later commit records that it ran.

| PR    | Merged      | Change                                                                                                             | Before run (ID, commit)          | After run (ID, commit)                                                                                  | Recall                   | Failing cases                                                                                                                    | Source                                                                                      |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| #3698 | 21 Oct 2026 | Answers that mark themselves ungrounded are gated as unsupported                                                   | Not recorded                     | Not recorded                                                                                            | Not recorded             | Not recorded                                                                                                                     | Commit `52150f017`: "live canary pair pending owner spend approval"                         |
| #3699 | 21 Oct 2026 | Chunk text for newly indexed documents (table titles, threshold lines)                                             | Not recorded                     | Not recorded                                                                                            | Not recorded             | Not recorded                                                                                                                     | Merge commit `9ed4dc821`: "live canary pair pending owner spend approval"                   |
| #3711 | 21 Oct 2026 | Table facts: top five per chunk by `textRank`                                                                      | Not recorded                     | Not recorded                                                                                            | Not recorded             | Not recorded                                                                                                                     | Merge commit `9bd664180`: "Split out of #3707 so it gets its own canary pair"; no run named |
| #3742 | 22 Oct 2026 | Up to two exact quote cards at medium trust                                                                        | Not recorded                     | Not recorded                                                                                            | Not recorded             | Not recorded                                                                                                                     | No canary or `RAG impact:` line found in its commit messages                                |
| #3743 | 22 Oct 2026 | Outdated (superseded) sources removed from answer evidence                                                         | Not recorded                     | Not recorded                                                                                            | Not recorded             | Not recorded                                                                                                                     | Commit `09c81c94c`: "canary pair pending"                                                   |
| #3751 | 22 Oct 2026 | Extractive answers skip policy admin text and glued headings                                                       | 39614340500, commit not recorded | 39711681854, "run on the merged #3751"; exact commit not recorded                                       | Not recorded             | Case IDs not recorded; commit `8518e8940` says the lithium level timing and metabolic monitoring answers were still partly wrong | Commits `78380fbd9` and `8518e8940`                                                         |
| #3762 | 22 Oct 2026 | Monitoring answers skip bare headings, other medicines and link tails                                              | 39711681854, commit not recorded | Commit `8518e8940` says the confirmation run "needs the owner's yes"; see the note on 39759615452 below | See the 39759615452 note | See the 39759615452 note                                                                                                         | Commits `8518e8940` and `c443e8e44`                                                         |
| #3781 | Not merged  | Six protected fixes (RET-N1, NEW-G-03, NEW-G-01, NEW-G-04, EXT-01, E2E-04); owner yes 24 Oct, US$8 cap, 4 runs max | Pending                          | Pending                                                                                                 | Pending                  | Pending                                                                                                                          | Owner decision card, 24 Oct 2026 23:58 UTC                                                  |

## Other runs named in the history

- **39759615452 (22 Oct 2026) is the re-index pilot baseline.** The pilot decision
  ([2026-10-23-reindex-pilot-approved.md](../decisions/2026-10-23-reindex-pilot-approved.md))
  records it on main `0a01d2567`, which is the #3762 merge commit. Whether it was also treated as
  the #3762 confirmation run is not recorded. Results: answers 43/44, search 36/36, recall 100%,
  with one known miss, `admission-discharge-coverage-paraphrase`. Source for these figures:
  project notes, not a committed artifact.
- **39555267613 (21 Oct 2026)** refreshed the ranking snapshot (PR #3713,
  `scripts/fixtures/rag-ranking-candidate-snapshot.v1.provenance.json`; started 06:25 UTC). That
  was after #3699 merged and before #3698 and #3711 merged, but no commit message names it as the
  before or after run for any PR. Its commit and recall figures are not recorded.
