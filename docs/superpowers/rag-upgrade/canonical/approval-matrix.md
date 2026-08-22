# RAG upgrade authority and evidence matrix

Authorization is action-specific. A local implementation request does not authorize hosted reads, provider calls, mutations, publication, or deployment.

| Action                                                                                          | Default                                                          | Required evidence before action                                                         | Result label                              |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| Local source inspection, edits, synthetic fixtures and focused offline tests                    | Allowed inside the requested implementation scope                | Correct package/base, clean isolation, task brief                                       | Local/offline evidence                    |
| Per-task local commits used by Subagent-Driven Development review packages                      | Stop unless explicitly authorized once for the execution session | Exact branch/worktree and statement that no push follows implicitly                     | Local committed evidence                  |
| Push, PR, merge or publication of the packages or implementation                                | Stop unless explicitly requested                                 | Exact branch, base, head, diff and required checks                                      | Published only after current remote proof |
| Connected read-only verification of official Australian publisher URL, licence and content mode | Stop unless explicitly authorized                                | Named domains, fields collected, no protected content copy, checked-at/reviewer receipt | Connected source-verification evidence    |
| Hosted Supabase inventory, schema check or authoritative generated types                        | Stop unless explicitly authorized                                | Exact project identity, read-only query/command, data exposure statement                | Hosted read-only/source-current evidence  |
| Apply a migration or deploy a function/worker                                                   | Stop unless explicitly authorized                                | Exact project/environment, migration/function list, grants/RLS review, rollback         | Hosted mutation/deployment evidence       |
| Fetch/index permitted public-source content or send content to an embedding/generation provider | Stop unless explicitly authorized                                | Source/content mode/licence, exact documents, provider/residency, estimated calls/cost  | Provider/source acquisition evidence      |
| Shadow reindex stage or evaluation                                                              | Stop unless explicitly authorized per operation manifest         | Project-bound recovery evidence, IDs/counts/digests, cost, stop conditions              | Hosted staged/evaluated evidence          |
| Promote or roll back a generation/site release                                                  | Stop unless explicitly authorized per operation manifest         | GO/rollback receipt, exact state/recovery/report digests, retained prior generation     | Promotion/rollback evidence               |
| Cleanup retained/abandoned generations or Storage objects                                       | Stop unless explicitly authorized                                | Exact manifest, retention eligibility, expected count/digest, recovery proof            | Destructive cleanup receipt               |
| Provider canary or blinded v19-versus-v20 comparison                                            | Stop unless explicitly authorized                                | De-identified case set, baseline SHA/mode, model/route/budget, cost and abort limits    | Provider canary evidence                  |
| Production flag activation                                                                      | Stop unless explicitly authorized                                | All hard gates, rollback, SLOs, canary comparison and operator owner                    | Production activation evidence            |

## Source-specific rules

- Current eligible uploaded indexed guidelines are primary for clinical guidance and conflicts.
- Published Clinical KB site content is public to anonymous, authenticated and administrator readers; only administrator-authorized server paths may add, edit, publish or retire it.
- Healthdirect is excluded from discovery, ingestion, retrieval, prompts, citations and suggestions.
- eTG and AMH are trusted `reference_link`/`link_only` entries. Their protected content is never fetched, copied, embedded, indexed, summarized or quoted.
- The connected source-verification checkpoint records only publisher, official URL, licence/content-mode evidence, checked-at date and reviewer. Offline Cloud work consumes the reviewed manifest and cannot claim current-source verification.

## Stop conditions

Stop the current phase on base drift that affects a named owner, migration version collision, task/package parity drift, missing required Superpowers capability, absent task-commit authority for commit-based review, private/staging content entering retrieval, public reader divergence, source-policy violation, unsupported numeric claim, deadline/abort regression, destructive default, or a live/provider action without exact approval.
