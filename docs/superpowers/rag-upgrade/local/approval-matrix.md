# Authority and approval matrix

Authority is action- and target-specific. Earlier planning, a Cloud implementation prompt, repository credentials or a successful offline test never implies connected or production authority.

| Action                                          | Cloud P00–P17                        | Local owner                           | Required authority                                                                                      |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Read/edit offline source and synthetic fixtures | allowed for selected phase           | L00 may inspect                       | Phase prompt and named branch                                                                           |
| Per-task/receipt commits                        | allowed for selected phase           | connected receipt commits allowed     | Explicit named-branch commit authority                                                                  |
| Push accepted programme branch                  | allowed only by the execution prompt | L00+ push requires separate authority | Exact remote branch and accepted tip                                                                    |
| Current official-source metadata                | prohibited                           | L01                                   | Exact domains/fields, read-only scope, exposure and expiry                                              |
| Protected eTG/AMH content                       | prohibited                           | prohibited                            | Never copied/indexed/embedded/summarised/quoted; links only                                             |
| Healthdirect                                    | excluded                             | excluded                              | No acquisition or activation                                                                            |
| Hosted Supabase reads/types/RLS/grants          | prohibited                           | L02                                   | Exact project ref `sjrfecxgysukkwxsowpy`, role `postgres`, read-only commands and expiry                |
| Merge migrations / deploy hosted functions      | prohibited                           | L03                                   | Exact branch/PR, project ref `sjrfecxgysukkwxsowpy`, role `postgres`, window, state change and rollback |
| Reindex plan/dry-run                            | offline contract only                | L04                                   | Exact operation manifest and target corpus                                                              |
| Reindex stage/apply                             | prohibited                           | L04                                   | Separate apply approval, counts/digest, rollback and stop conditions                                    |
| Shadow/provider evaluation                      | prohibited                           | L05                                   | Exact cases, provider, exposure, cost ceiling and abort                                                 |
| Generation/provider canary                      | prohibited                           | L06                                   | Exact provider/model/cases, exposure, cost and abort                                                    |
| Dark deployment                                 | prohibited                           | L07                                   | Exact environment/version/window; activation excluded                                                   |
| Promotion/activation                            | prohibited                           | L08                                   | Separate exact promotion approval                                                                       |
| Rollback execution                              | prohibited                           | L08                                   | Separate exact rollback approval                                                                        |
| Production observation/acceptance               | prohibited                           | L09                                   | Exact audience/canaries/SLO/window and accountable approver                                             |
| Destructive cleanup                             | prohibited                           | L10                                   | Separate exact eligible count/digest/target and deletion approval after retention                       |

Each connected approval record names service, target, actions, scope, data exposure, expected state change, cost ceiling, rollback, stop conditions, authorizer, approval/expiry and whether destructive. A receipt cannot accept an operation outside that record or after expiry.

Read-only and mutation authority are never bundled. Deployment and activation are never bundled. Promotion and rollback are never bundled. Cleanup is never bundled with activation. If a hosted command can mutate state unexpectedly, classify it as mutation and obtain the stronger approval before running it.

Tracked evidence is sanitized metadata, hashes and aggregates only. Credentials, patient/protected data, source document contents, raw provider responses and unredacted hosted dumps remain outside Git in approved secure ignored output.
