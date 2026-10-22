# Context, adaptive agents and memory across local and cloud sessions

Read this reference when a task needs continuity, delegation, memory or a change of execution host. Keep routine startup context limited to the shared core and current project safeguards.

## Adapt to the work

Establish the outcome, applicable project and available host capabilities. Use direct work or deterministic tools for small tasks. For permitted delegation, assign independent bounded questions, ownership and decisive evidence; retain required clinical, security and independent-review floors. Set supported model and effort choices at the start when controls exist, and reassess when uncertainty or scope changes. Do not invent unsupported controls or infer execution settings from a request. Missing context calls for targeted source inspection; a failed hypothesis calls for revised diagnosis. Escalate capability when the decision requires it, without forced cheap-model trials or recursive agent chains.

## Keep context useful

Locate before reading; read relevant headings and decisive command output. Do not reload unchanged sources or duplicate checks without an applicable trigger. Batch independent reads and keep coupled edits and shared-resource gates serial. Before compaction, session transfer or a fresh task, preserve the original objective, branch/commit, owned diff, source/evidence identities, decisions, rejected hypotheses, blocker and next exact action. Use the project's existing checkpoint/receipt route and disclose unsynced receipts. Never put raw transcripts, credentials or patient data into a public checkpoint. Validate relevant drift when resuming. Report unknown cost or token savings as unknown.

## Use memory with explicit scope

Current instructions and live evidence outrank remembered material. Use native host memory, Supermemory or Basic Memory only when supported, authenticated and authorised for this purpose and destination. Inspect the owning project mapping and accessible spaces/projects; pass the confirmed scope on every search and write. Shared preferences belong in an explicitly approved shared-preferences scope, not a product's clinical or engineering space. Do not search an account-wide default, another product or a broadly collected knowledge space to fill an empty project.

Retrieve only the small relevant approved context. Preserve source/provenance and recheck drift-prone facts. For Supermemory, automatically curate short checked nonclinical project decisions, working preferences and task handovers under the owner's approved curated-content policy, with one confirmed destination, source/date and stable topic key. Preserve platform-native restrictions and per-run spending approval; draft locally and report pending when a cloud run is not approved. This is not permission to upload histories, existing notes or conversations. No blanket capture, bulk import, background synchronization or patient records. Forgetting and content outside that scope require exact-content/destination approval. Forgetting extracted memories may leave source documents behind; report the exact cleanup result.

Supermemory: available wherever the `supermemory` OAuth MCP connector (`supermemory-context` skill) is enabled for the host; it is not registered in tracked MCP config files, so check the callable tools first and continue from repository files and the approved checkpoint if it is absent. Confirm identity and available scope through `who_am_i` and `list_spaces`, then pass the explicit singular scope on every `search_memory`, `get_document` or approved `add_memory` call: the `namespace` argument on the current hosted server (older connectors name it `containerTag`), set to `psychsift_engineering`, `wardflow_design`, `caring_contacts_engineering` or `communication_engineering` (or the approved shared-preferences/continuity scope when curating cross-project preferences). Omitting it falls back to the account's active space or `sm_project_default`, so never omit it and never combine multiple projects in one scope. A searchable source document, queued save, extracted memory and successful fresh-session recall are different proof states.

Basic Memory: the global unscoped `basic-memory` MCP server is disabled so no background Python process or cross-project store runs. Local coding checkpoints use isolated per-project SQLite databases (`psychsift`, `ward-flow`, `caring-contacts`, `communication`) via the sub-5ms `shared-checkpoint-v2.mjs` helper. A local process and local notes are not reachable from an isolated cloud VM; in cloud sessions, use Supermemory MCP with the project's `namespace` (older connectors call it `containerTag`) or the repository's approved checkpoint/receipt files. Never expose the local service, switch routing, buy a subscription or upload notes implicitly.

If a memory route is missing, inaccessible or empty, disclose that state and continue using current repository files and the approved checkpoint. Never invent prior decisions or silently select another backend/project.

## Name publication targets explicitly

Every publication command names its own repository: Git uses one verified literal absolute `git -C` checkout path; GitHub CLI PR publication uses one literal `--repo github.com/OWNER/REPO` or its HTTPS URL, matched to a verified local GitHub origin. Verify actual destination and branch/base/head or PR identity before execution. Refuse missing, duplicate, dynamic or conflicting repository/configuration/environment selectors even in a known session. A preceding command, session directory or approval assertion supplies neither the target nor permission. Bounded guard checks do not prove remote existence or universal wrapper coverage.

## Check the actual host

Cloud sessions use the selected repository revision and their own tools, access, runtime and account settings. Personal Windows paths, desktop plugins, local services, credentials and OAuth sessions do not automatically transfer. Repository guidance cannot install a connector or grant permissions. Check the current branch/commit and actual callable tools before relying on them. Preserve existing project setup, dependency, raw-environment and provider gates. Use supported account settings for authenticated connectors; never copy secrets into tracked files or bypass setup-only secret boundaries.

To verify behaviour, use a small read-only synthetic task on the intended revision. Record native loading evidence where exposed, files actually opened, tool capabilities, scenario answers and host limitations. Observe decisions about a stale memory, wrong project, unavailable service, conflicting approval and context handoff. File equality and an agent saying it complied are weaker than observed actions; neither proves universal compliance or application deployment.

## Spending approval for each billable run

Before every billable API, provider, cloud, test or evaluation run, present the purpose; provider and model or service; exact scope and expected call count, input/output token volume and/or runtime; estimated TOTAL cost and currency; pricing basis, assumptions and estimation uncertainty; and a hard maximum spend. Include all foreseeable retrieval, embedding, judge/model, planned retry and downstream cloud/CI charges in both the total estimate and the cap. If a defensible cost bound is unavailable, pause before execution and state what pricing, volume, runtime, downstream-charge or limit information is missing.

Obtain the owner's explicit approval for that specific bounded run before execution. Broad coding, testing, full-access or general provider permission does not approve spending. Approval does not carry to a new run, extra retries, larger scope or increased limits: present the revised total and cap and obtain new explicit approval first. The spending gate also applies to billable checks or downstream jobs triggered by another otherwise authorised action.

Record the approved scope, volume/runtime and retry limits, currency, total estimate, hard cap and approval reference before starting. Use enforceable call/token/runtime or existing service limits to keep the entire run within the approved cap; if that cannot be ensured without changing account or billing settings, pause and explain the blocker. Stop before exceeding the approved scope or cap. Afterwards report measured usage and actual cost where available, identify unavailable measurements, and distinguish estimates, calculated costs and provider invoices. This rule grants no authority to change credentials, accounts, billing/settings or safeguards.
<!-- BEGIN:project-context-and-memory -->

## Project scope and host safeguards

_Updated 2026-10-17 — preserved existing project-specific instructions; Documentation owns._

Follow [the current Cloud policy](codex-cloud-environment.md); preserve applicable dependency, provider and selected-environment setup/raw-boundary gates. Use supported account settings for authenticated connectors; never copy secrets into tracked files or bypass setup-only secret boundaries.
<!-- END:project-context-and-memory -->
