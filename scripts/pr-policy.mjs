#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const requiredClinicalGovernanceItems = [
  "Source-backed claims still require linked source verification before clinical use",
  "No patient-identifiable document workflow was introduced or expanded without explicit governance approval",
  "Supabase target remains `PsychSift Production` (`sjrfecxgysukkwxsowpy`)",
  "Service-role keys and private document access remain server-only",
  "Demo/synthetic content remains clearly separated from real clinical sources",
  "Source metadata, review status, and outdated/unknown-source behavior remain conservative",
  "Deployment classification/TGA SaMD impact was checked when clinical decision-support behavior changed",
];

// Legacy PR checklist phrasing predates the canonical governance list above.
// Each item maps to one or more matcher groups; a group is satisfied only when
// every regex in that group matches at least one checked checklist entry.
const legacyClinicalGovernanceEvidence = new Map([
  [
    requiredClinicalGovernanceItems[0],
    [
      [
        /\bcitation requirements?\b/i,
        /\bsource verification\b/i,
        /\bprovenance\b/i,
        /\bclinical-content governance\b/i,
      ],
      [/\blinked-source verification\b/i, /\bclinical use\b/i],
    ],
  ],
  [
    requiredClinicalGovernanceItems[1],
    [[/\bpatient-data handling\b/i, /\bprivacy controls?\b/i, /\bdocument-access behavior\b/i]],
  ],
  [requiredClinicalGovernanceItems[2], [[/\bconfigured supabase project\/target\b/i]]],
  [requiredClinicalGovernanceItems[3], [[/\bservice-role credentials?\b/i, /\bserver-side only\b/i]]],
  [
    requiredClinicalGovernanceItems[4],
    [[/\b(?:demo|synthetic)\b/i, /\b(?:separat(?:ed|ion)|real|production|clinical sources?)\b/i]],
  ],
  [
    requiredClinicalGovernanceItems[5],
    [[/\b(?:source metadata|review status|reviewed|outdated|unknown[- ]source|conservative)\b/i]],
  ],
  [requiredClinicalGovernanceItems[6], [[/\bsamd\/tga assessment\b/i]]],
]);

const clinicalRiskPatterns = [
  /^supabase\//,
  /^src\/app\/api\//,
  // Library-layer behavior carries the clinical logic (retrieval, ranking,
  // answer generation, ingestion, source governance, privacy, mode gating,
  // unreviewed content reachability, clinical content policy) so it keeps the
  // full token set.
  /^src\/lib\/.*(?:auth|permission|privacy|security|rag|retriev|rank|search|answer|clinical|citation|source|document|upload|download|therap|mode|review|policy|content|unreviewed|medication)/i,
  // Owner ruling 2026-09-17, after a clinical-governance review of the list above: patient
  // addresses, referral intake and retention lived in caring-contacts (whose surviving
  // clock.ts still times the Mental Health Act timeline); the database clients
  // hold the service-role key; on-call/repository.ts hides personal entries from other users.
  // None of those names matched the token set, so these changes could merge without review.
  /^src\/lib\/caring-contacts\//,
  /^src\/lib\/supabase\//,
  /^src\/lib\/on-call\/repository\.ts$/,
  // Same gap, same shape, found on 2026-09-17 while verifying an external audit:
  // public-api-access.ts holds `withOwnerReadScope`, the single definition of what an
  // unauthenticated caller may read. It requires BOTH a null owner and the `public_corpus`
  // publication marker, and the document list and every signed-URL route read through it.
  // Weakening that one predicate republishes the corpus. The path matched no token in the
  // set above -- not auth, not privacy, not document -- so a change to it could merge with
  // no clinical governance preflight at all.
  /^src\/lib\/public-api-access\.ts$/,
  // Presentation surfaces (pages + components) are clinical-risk only when they
  // touch access control, privacy, patient data, or document upload/download —
  // NOT merely because a UI file lives under a clinically-named directory (the
  // whole src/components/clinical-dashboard tree) or is named after a
  // search/answer/source feature whose logic actually lives in src/lib.
  /^src\/(?:app|components)\/.*(?:auth|permission|privacy|security|upload|download|patient)/i,
  /^scripts\/.*(?:ingest|reindex|migration|governance|production|drift|supabase)/i,
  // Clinical reference datasets shipped straight to clinicians. Each record
  // carries recommendation prose (`bestUsedFor`, `clinicalSummary`,
  // `indications`) plus labels rendered as curated fact, so editing one changes
  // clinical output with no code diff at all. PR #1489 shipped 205 therapy
  // records — including a `modality` that labelled ECT as "ACT" — and this
  // classifier returned `clinicalRisk: false`, so no governance preflight was
  // ever required. Generators live in scripts/ and are matched above.
  /^(?:src\/data|data|public\/therapy-compass-data)\//,
  // Hand-authored clinical datasets that live under `src/lib/` as `.ts` rather than under
  // `data/` as JSON, so neither the token set above nor the `data/` rule reaches them. Each
  // holds authored clinical prose a clinician reads as fact — definitions, factsheet copy,
  // specifier guidance, the differential overlay's `doNow` steps and `contentNote` — so
  // editing one changes clinical output with no code diff at all. That is the `data/` rule's
  // own rationale, applied where the file extension put the content out of its reach.
  //
  // Added 2026-09-17 after PR #2838 rewrote four asserted clinical thresholds and withheld a
  // contaminated record in `differential-curated.ts`, and this classifier returned
  // `clinicalRisk: false` — the same miss PR #1489 made with the 205 therapy records, in a
  // different directory.
  //
  // DELIBERATELY DISJOINT from the differential family. `differential-curated.ts` is the file
  // that exposed this, but the owner ruling of the same day covers it, and every other
  // `src/lib/differential*.ts`, in PR #2847. Naming it here too would be a second edit to the
  // same array for no added coverage, so this rule takes only the three authored datasets no
  // rule reaches: dictionary senses, patient factsheet copy and specifier guidance.
  //
  // EXACT paths, deliberately, for the reason `nonClinicalGeneratedDataPaths` states in
  // reverse: 129 of the 268 modules under `src/lib/` match no clinical token today and nearly
  // all of them are code, so a directory-wide sweep would demand a governance preflight for
  // diffs holding no clinical content — and a reflexively ticked preflight erodes the gate it
  // is meant to enforce. Add the next authored dataset here by name when it lands.
  //
  // NOT settled here: a code module under `src/lib/` can carry clinical logic and still match
  // no token (`differentials.ts` holds the withhold-and-scope projection and matches none).
  // That is a wider question about the token list itself, deliberately left for the owner.
  /^src\/lib\/(?:dictionary-data|factsheets-data|specifiers)\.ts$/,
  // Tests that act as clinical safety guards / prohibited wording chokepoints
  // (e.g. clinical safety checks).
  // Weakening or altering them is the clinical evasion route (#97W4FD).
  /^tests\/calculator-mockup-clinical-safety\.test\.ts$/,
  // Owner ruling 2026-09-17, after the clinical review of #2838: that PR withheld a
  // contaminated generated differential body (differential-curated.ts,
  // differential-detail.ts) and applied it at four separate call sites
  // (differential-fixtures.ts, differentials.ts, registry-corpus.ts, the page). None of
  // "differential-curated", "differential-detail", "differential-fixtures", "differentials"
  // or "differential-detail-page" contain a token from the set above, so a differential-only
  // change to any of them — including a future withholding fix like this one — could merge
  // without review. The token set does already match differential-search-composition.ts (via
  // "search"), differential-stream-model.ts (via "mode", inside "model") and
  // differentials-search-request.ts (via "search"); the three patterns below are additive,
  // not a replacement for the token set.
  /^src\/lib\/differential[^/]*\.ts$/,
  /^src\/components\/differentials\//,
  /^scripts\/build-cross-mode-differentials-index\.mjs$/,
  // Owner ruling 2026-09-19 (#86E34T), closing an inconsistency inside one family. Three
  // sibling modules do the same job — each exports `rowGovernance`, which decides whether a
  // stored clinical record is presented to a clinician as current, review-due or outdated. Two
  // were already covered and one was not, for reasons that are purely lexical rather than
  // clinical: `differential-records.ts` matches the differential rule directly above, and
  // `medication-records.ts` matches the token set via "medication". `registry-records.ts`
  // carries no token in the set and no other rule reaches it, so a change that (for example)
  // stopped an outdated service record from being marked outdated could merge with no clinical
  // governance preflight at all.
  //
  // EXACT path, for the reason the dictionary/factsheets/specifiers rule above states at
  // length: a `src/lib/*records*.ts` sweep would also take `use-registry-records.ts`, a React
  // data-fetching hook holding no governance decision, and a reflexively ticked preflight
  // erodes the gate it enforces. Verified against the whole tracked tree: this entry adds
  // exactly one file to the clinical-risk set.
  /^src\/lib\/registry-records\.ts$/,
];

/**
 * Exact paths that live under `data/` but hold no clinical content at all.
 *
 * `clinicalRiskPatterns`' `data/` rule exists for clinical reference datasets
 * shipped straight to clinicians — see its comment above. These two are
 * generated REPOSITORY-METADATA exports for the developer hub: route and
 * document inventories, the review-record corpus, and the outstanding-issues
 * ledger. Nothing in either reaches a clinician.
 *
 * Sweeping them in had a cost worth stating, because it is the reason this list
 * exists rather than the mere tidiness of a correct label: every ledger PR that
 * regenerated one was blocked until its body carried a complete
 * `## Clinical Governance Preflight` for a file holding no clinical data
 * (`#Y090R5`, measured on PR #2299). Ticking clinical governance boxes
 * reflexively on changes with no clinical output is precisely the habit that
 * section exists to prevent, so a false positive here actively erodes the gate.
 *
 * EXACT paths, deliberately — never a prefix, and never a directory. A
 * `data/`-wide carve-out would silently exempt the next clinical dataset added
 * beside them, which is the failure direction this classifier must never take.
 * Anything else under `data/` stays clinical-risk.
 */
const nonClinicalGeneratedDataPaths = new Set([
  "data/repo-awareness-snapshot.json",
  "data/outstanding-issues-snapshot.json",
]);

const operationalRiskPatterns = [
  /^\.github\/(?:actions|workflows)\//,
  /^(?:package|package-lock)\.json$/,
  /^(?:next|playwright|vitest)(?:\..+)?\.config\.[cm]?[jt]s$/,
  /^(?:Dockerfile(?:\.worker)?|railway(?:\.[^.]+)?\.json|nixpacks\.toml)$/,
];

// Supabase migrations auto-apply to the live clinical database on merge to main:
// the Supabase GitHub integration has "Deploy to production" enabled with production
// branch `main`, measured at 34 s from merge in docs/audit/live-drift-forensics-2026-08.md
// §3.7. There is no separate deploy step and no window to hold one back in, so PR
// metadata promising a deferred deploy describes a control this repository does not
// have. PR #2502 merged carrying "AWAITING DEPLOY WINDOW" in its own title and reached
// live within minutes; the post-merge live-drift run caught it as pending-apply drift.
// Choosing WHEN TO MERGE is the real control (AGENTS.md "Supabase project safety");
// claiming the deploy is later than the merge is not.
const migrationPatterns = [/^supabase\/migrations\//];

// Deliberately narrow: only phrases asserting that deployment is separate from — or
// later than — the merge. "Merge inside the approved deploy window" is legitimate and
// required, and a truthful "applies to live on merge" is the wording this gate steers
// authors toward; neither may match. `appl(?:y|ies|ied|ication)` rather than a bare
// `appl` prefix so "pending clinical governance approval" — an approval sought BEFORE
// merge, which is the sanctioned control — is not mistaken for a deferred apply.
const DEPLOY_WORD = String.raw`(?:deploy(?:ment|s|ed|ing)?|appl(?:y|ies|ied|ying|ication)s?)`;

const deployDeferralPatterns = [
  // "awaiting deploy window", "pending application"
  new RegExp(String.raw`\b(?:await(?:s|ing|ed)?|pending)\b[^\n]{0,32}?\b${DEPLOY_WORD}`, "i"),
  // ...and the same claim with the words reversed: "deployment is pending operator approval".
  new RegExp(String.raw`\b${DEPLOY_WORD}\b[^\n]{0,60}?\b(?:pending|deferred|awaiting|on hold|held back)\b`, "i"),
  // Out-of-band application: "deployed manually", "applied separately", "applied later".
  new RegExp(String.raw`\b${DEPLOY_WORD}\b[^\n]{0,32}?\b(?:manually|by hand|out of band|separately|later)\b`, "i"),
  // Explicitly sequenced after the merge, in either word order.
  new RegExp(String.raw`\b${DEPLOY_WORD}\b[^\n]{0,32}?\b(?:after|post|following|once)[\s-]*(?:the\s+)?merg`, "i"),
  new RegExp(String.raw`\b(?:after|post|following|once)[\s-]*(?:the\s+)?merg\w*\b[^\n]{0,32}?\b${DEPLOY_WORD}`, "i"),
  // Outright denial.
  /\b(?:do not|don'?t|must not|will not|won'?t|not for|never)\s+(?:be\s+)?deploy/i,
  /\bnot yet\s+(?:applied|deployed|live|in production)\b/i,
  new RegExp(String.raw`\bdefer(?:red|ring|s)?\b[^\n]{0,32}?\b${DEPLOY_WORD}`, "i"),
];

// A deferral is only false when it is about the migration. A PR may legitimately carry a
// migration AND a real operational constraint on something merging does not do — "do not
// deploy the staging worker until its image passes smoke tests" makes no claim about when
// the migration applies, so body statements must name the database subject to be in scope.
const migrationSubjectPattern =
  /\b(?:migration|schema|database|supabase|postgres|ddl|sql|table|index|constraint|foreign key|rls)\b/i;

// RAG-ranking protected surfaces (docs/rag-behaviour/safeguards.md). Narrower than
// clinicalRiskPatterns: these files change (or re-measure) retrieval/ranking ORDERING
// behaviour, which is live-validated — offline-green plus review-approved was proven
// insufficient here on 2026-07-20 (Phase C regression, canary #55). A PR touching any of
// them must carry an explicit `RAG impact:` declaration (see evaluatePullRequestPolicy).
const ragRankingPatterns = [
  /^src\/lib\/rag\//,
  /^src\/lib\/(?:clinical-search|retrieval-selection|released-search-order|ranking-config|evidence|result-sort|answer-ranking|evidence-relevance|semantic-rerank|eval-document-matching)\.ts$/,
  // Source authority feeds ordering too, one step further back: classifySourceAuthority tiers a
  // result, australianSourceTier reads that tier, and selectAustralianClinicalContext orders and
  // trims the model's context by it. Registering a publisher is therefore a retrieval behaviour
  // change even though neither file computes a score. Added 2026-09-07 after PR #2711 registered
  // nine Australian publishers and had to declare its RAG impact voluntarily, because this gate
  // did not ask.
  /^src\/lib\/(?:source-authority-registry|australian-source-priority)\.ts$/,
  // Ingestion decides the TEXT that becomes chunks, embeddings and cited evidence, so it
  // moves retrieval outcomes one step further back than ranking does. None of these files
  // matched any pattern here -- src/lib/chunking.ts classified as neither ragRanking nor
  // clinicalRisk -- and the AGENTS.md "Flag it" list did not name them either, so nothing
  // asked at either end. Added 2026-09-16 after PR #2810 changed PDF table extraction,
  // altering the text served as clinical evidence, and had to declare its RAG impact
  // voluntarily because this gate did not ask. Same remedy, and same reason, as the
  // 2026-09-07 source-authority addition above; AGENTS.md was corrected in the same change.
  /^src\/lib\/chunking\.ts$/,
  /^src\/lib\/extractors\//,
  /^worker\/python\/extract_pdf_assets\.py$/,
  // The other producer of retrieval inputs, missed by src/lib/rag/** only because these three
  // sit one directory up. searchIndexUnitCandidates queries match_document_index_units_hybrid_v2
  // unconditionally in the candidate fan-out, so the index units built and embedded here --
  // tables, workflows, algorithms, aliases, typed signals -- decide what that branch can surface.
  // deep-memory.ts also exports applyMemoryCardBoosts, which rescores SearchResult[] in that same
  // path, so it is a ranking surface outright. Added 2026-09-16 on Codex review of PR #2832.
  /^src\/lib\/(?:document-index-units|model-index-extraction|deep-memory)\.ts$/,
  // Inputs to retrieval and ordering that sat outside every pattern above. retrieval-rpc-rollout
  // picks which RPC version the candidate fan-out calls; clinical-evidence-haystack feeds
  // clinical-search scoring; cross-document-synthesis is read by retrieval-selection and the
  // context pack; corpus-grounding decides the classifier fallback's grounding verdict;
  // keyword-query builds the lexical query and stop-word set. document-enrichment,
  // visual-intelligence and image-filtering produce enrichment and image-caption rows the
  // retrieval RPCs query, and the three worker modules build embedding fields, table facts and
  // assertion tags. worker/main.ts stays out: it orchestrates these producers rather than
  // deciding their content. Added 2026-09-25 after a codebase survey found them unprotected.
  /^src\/lib\/(?:retrieval-rpc-rollout|clinical-evidence-haystack|cross-document-synthesis|corpus-grounding|keyword-query)\.ts$/,
  /^src\/lib\/(?:document-enrichment|visual-intelligence|image-filtering)\.ts$/,
  /^worker\/(?:embedding-fields|table-facts|assertion-tagging)\.ts$/,
  /^scripts\/(?:eval-retrieval|build-ranking-snapshot|tune-search-weights)\.ts$/,
  /^scripts\/lib\/(?:clinical-aliases|ranking-tuning|ranking-snapshot-builder)\.ts$/,
  /^scripts\/fixtures\/(?:rag-retrieval-golden|rag-ranking-candidate-snapshot\.v1)\.json$/,
  // The contract-pinning tests are protected too: weakening them is the evasion route.
  /^tests\/(?:rag-fast-path-ordering|ranking-tuning|retrieval-selection|rag-second-stage-ranking|eval-retrieval|rag-imputation-contract)\.test\.ts$/,
];
export const safetyPathLists = Object.freeze({
  ragRanking: Object.freeze(ragRankingPatterns.map((p) => new RegExp(p.source, p.flags))),
  clinicalRisk: Object.freeze(clinicalRiskPatterns.map((p) => new RegExp(p.source, p.flags))),
});

const uiPatterns = [
  /^src\/app\/(?!api\/)/,
  /^src\/(?:components|styles)\//,
  /^src\/lib\/(?:app-modes|app-mode-icons|search-route-ownership|ui-copy|mode-home-composer|mode-secondary-navigation|category-identity(?:-icons)?|brand-mark|brand-image|search-command-surface|search-navigation-context|search-scope-filter-chips|search-shell-props|document-flow-routes|document-viewer-navigation|differentials-navigation|therapy-compass-navigation|therapies)\.tsx?$/,
  /^public\//,
  /^tests\/ui-.*\.spec\.ts$/,
  /^playwright(?:\..*)?\.config\.ts$/,
];

function normalizePath(filePath) {
  return String(filePath ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
}

function normalizeSectionHeading(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+#+\s*$/, "")
    .trim()
    .toLowerCase();
}

export function section(body, heading) {
  const source = String(body ?? "");
  const headings = [...source.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*$/gim)];
  const targetHeading = normalizeSectionHeading(heading);
  // Collect content from ALL matching sections and join them. This handles
  // accidental duplicate headings (e.g. a prose rationale block and a separate
  // checklist block under the same heading) by combining their content rather
  // than silently returning only the first occurrence and missing the checklist.
  const parts = [];
  headings.forEach((match, matchIndex) => {
    if (normalizeSectionHeading(match[2]) !== targetHeading) return;
    const start = (match.index ?? 0) + match[0].length;
    // Markdown outline semantics: the section runs until the next heading of the
    // same or shallower level. Deeper headings (### under ##) are sub-structure
    // and stay inside the section, so checklist evidence after them still counts.
    const level = match[1].length;
    const next = headings.slice(matchIndex + 1).find((m) => m[1].length <= level);
    const end = next?.index ?? source.length;
    const content = source.slice(start, end).trim();
    if (content) parts.push(content);
  });
  return parts.join("\n\n");
}

function meaningfulText(value) {
  const normalized = String(value ?? "")
    .replace(/<!--[^]*?-->/g, "")
    // Sub-headings kept inside a section by the outline-aware boundary are
    // structure, not content — a section holding only headings is still empty.
    .replace(/^\s*#{1,6}[ \t]+\S.*$/gm, "")
    .replace(/^\s*[-*]\s*/gm, "")
    .trim();
  return Boolean(normalized && !/^(?:-|n\/?a|none|todo|tbd)$/i.test(normalized));
}

function checkedCommand(value, command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The command must end at a token boundary so a checked entry such as
  // `npm run verify:ui-disabled` does not satisfy a check for `npm run verify:ui`.
  return checkedChecklistEntries(value).some((entry) => new RegExp(`${escaped}(?![\\w:-])`, "i").test(entry));
}

function explicitNotRun(value, scope = "verification") {
  const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutComments = String(value ?? "").replace(/<!--[^]*?-->/g, "");
  return new RegExp(`${escaped}[^\\n]{0,40}not run\\s*:\\s*\\S.{5,}`, "i").test(withoutComments);
}

function branchLikeTitle(title, headRef) {
  const value = String(title ?? "").trim();
  const normalized = (input) =>
    String(input ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return (
    /^(?:codex|claude|copilot)(?:\b|[-_:])/i.test(value) ||
    (normalized(value) && normalized(value) === normalized(headRef))
  );
}

function checkedChecklistEntries(value) {
  return [...String(value ?? "").matchAll(/^\s*[-*+]\s*\[[xX]\]\s*(.+?)\s*$/gm)].map((match) => match[1].trim());
}

function uncheckedChecklistEntries(value) {
  return [...String(value ?? "").matchAll(/^\s*[-*+]\s*\[\s\]\s*(.+?)\s*$/gm)].map((match) => match[1].trim());
}

function governanceMatcherGroupSatisfied(group, checkedEntries) {
  return group.every((matcher) => checkedEntries.some((entry) => matcher.test(entry)));
}

function governanceItemSatisfied(checkedEntries, item) {
  if (checkedEntries.some((entry) => entry === item)) return true;
  const matcherGroups = legacyClinicalGovernanceEvidence.get(item);
  if (!matcherGroups || matcherGroups.length === 0) return false;
  return matcherGroups.some((group) => governanceMatcherGroupSatisfied(group, checkedEntries));
}

// Used by ci.yml to detect which governance items an existing PR body already
// satisfies (including legacy phrasing) before syncing the checklist.
export function collectSatisfiedGovernanceItems(value) {
  const checkedEntries = checkedChecklistEntries(value);
  return requiredClinicalGovernanceItems.filter((item) => governanceItemSatisfied(checkedEntries, item));
}

function fieldValue(value, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    String(value ?? "")
      .match(new RegExp(`^\\s*-?\\s*${escaped}\\s*:\\s*(.+?)\\s*$`, "im"))?.[1]
      ?.trim() ?? ""
  );
}

function substantiveRisk(value) {
  return value.length >= 12 && !/^(?:low|medium|high)[.!]?$/i.test(value);
}

function substantiveRollback(value) {
  return value.length >= 12 && !/^(?:none|n\/?a|not applicable|no rollback|no-?op)\b/i.test(value);
}

export function classifyPullRequestFiles(files) {
  const normalized = [...new Set((files ?? []).map(normalizePath).filter(Boolean))];
  return {
    files: normalized,
    clinicalRisk: normalized.some(
      (file) => !nonClinicalGeneratedDataPaths.has(file) && clinicalRiskPatterns.some((pattern) => pattern.test(file)),
    ),
    operationalRisk: normalized.some((file) => operationalRiskPatterns.some((pattern) => pattern.test(file))),
    ragRanking: normalized.some((file) => ragRankingPatterns.some((pattern) => pattern.test(file))),
    migration: normalized.some((file) => migrationPatterns.some((pattern) => pattern.test(file))),
    ui: normalized.some((file) => uiPatterns.some((pattern) => pattern.test(file))),
  };
}

// PR_POLICY_BODY.md is a transport file: ci.yml's `sync-pr-policy-body` job pastes it into
// the description of any PR whose OWN diff adds or modifies it (see `## Apply PR_POLICY_BODY.md
// to pull request description`), then leaves the file itself sitting on the branch. Nothing
// deletes it before merge unless someone remembers to, so it has landed on `main` repeatedly —
// ~35 add/remove churn commits by 2026-09-16 — where it is stale, fully-checked prose with no
// `<!-- GOVERNANCE_PREFLIGHT -->` placeholder for the sync job to fill in. Blocking any PR that
// still carries it (added, modified, or merely present unremoved) forces it out of the branch
// before merge, so it can never accumulate on `main` again while the sync mechanism stays usable
// for whichever environment drops the file in to seed a description.
const PR_POLICY_BODY_FILENAME = "PR_POLICY_BODY.md";

/**
 * True when the PR's diff leaves `PR_POLICY_BODY.md` present (added, modified, renamed in, or
 * simply listed as an unchanged file in a `files`-only call). A `removed` status — the only way
 * to satisfy this gate — returns false. Prefers `fileStatuses` (authoritative on rename/removal);
 * falls back to a plain `files` list when `fileStatuses` is not supplied.
 */
export function prPolicyBodyTransportViolation({ fileStatuses, files }) {
  if (Array.isArray(fileStatuses)) {
    return fileStatuses.some(
      (file) =>
        normalizePath(file?.filename) === PR_POLICY_BODY_FILENAME &&
        String(file?.status ?? "").toLowerCase() !== "removed",
    );
  }
  return (files ?? []).some((file) => normalizePath(file) === PR_POLICY_BODY_FILENAME);
}

// The retrieval RPCs are ranking surfaces too, but they live in SQL, so no path pattern above can
// see them: a new migration that rewrites match_document_chunks_hybrid is as much a ranking change
// as an edit to src/lib/rag/, and before 2026-09-26 it drew no `RAG impact:` nudge. Applied
// migrations are immutable, so every such change arrives as an ADDED migration, and the policy
// already receives those files' text as addedMigrationContents. Matched by name family so a
// future _v4 is covered without an edit here. search_schema_health is deliberately absent: it
// reports on the indexes, it does not rank anything.
const retrievalFunctionNamePattern =
  /(?:match_document_chunks|match_documents_for_query|match_document_lookup_chunks_text|match_document_table_facts_text|match_document_embedding_fields_|match_document_index_units_hybrid|match_document_memory_cards_hybrid|match_governed_candidate_chunks|search_document_chunks|retrieval_owner_matches|correct_clinical_query_terms|corpus_topic_term_stats)\w*/;
const retrievalFunctionStatementPattern = new RegExp(
  String.raw`\b(?:create\s+(?:or\s+replace\s+)?|alter\s+|drop\s+)function\s+(?:if\s+exists\s+)?(?:"?public"?\s*\.\s*)?"?` +
    retrievalFunctionNamePattern.source +
    String.raw`(?!\w)`,
  "i",
);
// The other way a migration has rewritten one: read its definition, patch the text, and execute the
// result (20260628000000 did this to match_document_chunks), so no CREATE statement names it.
const retrievalFunctionDefinitionReadPattern = new RegExp(
  String.raw`\bpg_get_functiondef\s*\(\s*'(?:public\.)?` + retrievalFunctionNamePattern.source + String.raw`(?!\w)`,
  "i",
);
const executeVariablePattern = /\bexecute\s+[a-z_]\w*\s*;/i;

/**
 * Added migrations that create, alter, drop or patch a retrieval function, from the path -> SQL map the
 * workflow reads at the PR head. Comments are stripped first, so a migration that only mentions
 * one of these functions in a comment is not flagged. Missing contents yield no paths: the nudge
 * is advisory, so it degrades to the path patterns rather than failing closed.
 */
export function retrievalFunctionMigrationPaths(addedMigrationContents) {
  if (!addedMigrationContents || typeof addedMigrationContents !== "object") return [];
  return Object.entries(addedMigrationContents)
    .filter(([, sql]) => {
      const executable = String(sql ?? "")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/--[^\n]*/g, " ");
      return (
        retrievalFunctionStatementPattern.test(executable) ||
        (retrievalFunctionDefinitionReadPattern.test(executable) && executeVariablePattern.test(executable))
      );
    })
    .map(([path]) => normalizePath(path))
    .sort();
}

// The `RAG impact:` declaration a ragRanking PR must carry: either an explicit
// no-behaviour-change statement (with a reason) or a canary-pair reference. Matched anywhere
// in the body, list-marker tolerant, case-insensitive.
export function ragImpactDeclared(body) {
  const match = String(body ?? "").match(/^[\s>*-]*\*{0,2}RAG impact\*{0,2}:\s*(\S[^\n]*)/im);
  if (!match) return { declared: false, satisfied: false };
  const detail = match[1].trim();
  const noChange = /no\s+(?:retrieval\s+|ranking\s+)?behaviou?r\s+change/i.test(detail);
  const canary = /canar/i.test(detail);
  return { declared: true, satisfied: (noChange || canary) && detail.length >= 12 };
}

// Returns the first deferred-deploy claim found, so the error message can quote the
// author's own words back rather than making them guess which phrase tripped the gate.
function deferralInSegment(segment) {
  for (const pattern of deployDeferralPatterns) {
    const match = segment.match(pattern);
    if (match) return match[0].trim();
  }
  return "";
}

export function deployDeferralClaim(title, body) {
  // The title describes the whole PR, and this gate only runs on a PR that carries a
  // migration, so a deferral claim there is necessarily a claim about the migration.
  const titleClaim = deferralInSegment(String(title ?? ""));
  if (titleClaim) return { claimed: true, phrase: titleClaim };
  // Body statements are scoped per sentence/clause so an unrelated deployment
  // constraint elsewhere in the same PR cannot trip the gate.
  for (const segment of String(body ?? "").split(/[.;\n]+/)) {
    if (!migrationSubjectPattern.test(segment)) continue;
    const claim = deferralInSegment(segment);
    if (claim) return { claimed: true, phrase: claim };
  }
  return { claimed: false, phrase: "" };
}

// ---------------------------------------------------------------------------
// Migration history guard (C0, 2026-09-17).
//
// Agents acting as the owner's GitHub identity repeatedly merged clinical and database
// PRs, and PRs #2814 and #2821 MODIFIED already-applied migrations (20260824122000,
// 20260824123000, 20260830121000). Supabase records each version once and never re-runs
// it, so the edits reached the repository but never the live database, and live drifted.
// The mechanical control evaluated inside the required `PR policy` check:
//
//   migrationHistoryViolations — an applied migration is immutable history. Editing,
//      removing or renaming one, or adding a migration dated at or before the newest one
//      already on main, is a blocking error. The only override is a body line
//      `Migration history edit approved: <reason>` together with an accompanying
//      fail-fast validation guard migration in the same change.
// ---------------------------------------------------------------------------

// Supabase CLI reads top-level `<version>_<name>.sql` files only. This repository's
// versions are 14-digit UTC timestamps, and every file on main follows that shape.
const migrationDirectoryPrefix = "supabase/migrations/";
const migrationEntryPattern = /^(\d{14})_[^/]+\.sql$/;

function topLevelMigrationEntry(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized.startsWith(migrationDirectoryPrefix)) return null;
  const entry = normalized.slice(migrationDirectoryPrefix.length);
  return entry && !entry.includes("/") ? entry : null;
}

/** The 14-digit version of a `supabase/migrations/<version>_<name>.sql` path, else null. */
export function migrationVersion(filePath) {
  const entry = topLevelMigrationEntry(filePath);
  return entry?.match(migrationEntryPattern)?.[1] ?? null;
}

/** Versions from bare directory entries, as `fs.readdirSync("supabase/migrations")` returns them. */
export function migrationVersionsFromEntries(entries) {
  return [
    ...new Set((entries ?? []).map((entry) => String(entry).match(migrationEntryPattern)?.[1]).filter(Boolean)),
  ].sort();
}

const appliedHistoryRule =
  "Applied migrations never re-run on live: Supabase records each version once, so an edit here reaches the repository but never the live clinical database, and live drifts.";

function newMigrationAdvice(newestBase) {
  return newestBase
    ? `Ship the change as a NEW migration whose version is newer than ${newestBase}.`
    : "Ship the change as a NEW newest-dated migration.";
}

/**
 * Blocking migration-history violations for a PR's changed files.
 *
 * `files` are GitHub `pulls.listFiles` entries: `{ filename, status, previous_filename }`,
 * status one of added, modified, removed, renamed, copied, changed, unchanged.
 * `baseMigrationVersions` are the versions present on the trusted base checkout.
 *
 * Unknown or missing statuses are treated as a modification (fail closed).
 * `now` is injectable for tests; it defaults to the run's current time.
 */
export function migrationHistoryViolations({ files, baseMigrationVersions, now = new Date() }) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const base = new Set((baseMigrationVersions ?? []).map(String));
  // Fixed-width digit strings sort lexically in numeric order.
  const newestBase = [...base].sort().at(-1) ?? null;
  const violations = [];
  const addedByVersion = new Map();

  const recordAdded = (path) => {
    const entry = topLevelMigrationEntry(path);
    if (!entry || !entry.endsWith(".sql")) return;
    const version = migrationVersion(path);
    if (!version) {
      violations.push({
        kind: "unversioned",
        path,
        version: null,
        message: `${path} is a new migration without a 14-digit version prefix (\`YYYYMMDDHHMMSS_name.sql\`), so its order against applied history cannot be checked. ${newMigrationAdvice(newestBase)}`,
      });
      return;
    }
    addedByVersion.set(version, [...(addedByVersion.get(version) ?? []), path]);
  };

  for (const file of files ?? []) {
    const path = normalizePath(file?.filename);
    const previousPath = file?.previous_filename ? normalizePath(file.previous_filename) : "";
    const status = String(file?.status ?? "").toLowerCase();
    if (!path || status === "unchanged") continue;

    if (status === "added" || status === "copied") {
      recordAdded(path);
      continue;
    }

    if (status === "renamed") {
      const previousVersion = migrationVersion(previousPath);
      if (previousVersion && base.has(previousVersion)) {
        violations.push({
          kind: "renamed",
          path: previousPath,
          version: previousVersion,
          message: `${previousPath} (version ${previousVersion}) is already applied on main and this PR renames it to ${path}. ${appliedHistoryRule} Restore the original file. ${newMigrationAdvice(newestBase)}`,
        });
      } else {
        // Moved in from elsewhere (or from a never-applied name): the new path is a new migration.
        recordAdded(path);
      }
      continue;
    }

    // modified, changed, removed, and anything unrecognised.
    const version = migrationVersion(path);
    if (!version || !base.has(version)) continue;
    const verb = status === "removed" ? "deletes" : "modifies";
    violations.push({
      kind: status === "removed" ? "removed" : "modified",
      path,
      version,
      message: `${path} (version ${version}) is already applied on main and this PR ${verb} it. ${appliedHistoryRule} Revert the change to this file. ${newMigrationAdvice(newestBase)}`,
    });
  }

  for (const [version, paths] of [...addedByVersion.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const path of paths) {
      if (base.has(version) || paths.length > 1) {
        violations.push({
          kind: "duplicate-version",
          path,
          version,
          message: `${path} reuses migration version ${version}, which ${base.has(version) ? "already exists on main" : "another migration in this PR also uses"}. ${appliedHistoryRule} ${newMigrationAdvice(newestBase)}`,
        });
      } else if (newestBase && version < newestBase) {
        violations.push({
          kind: "out-of-order",
          path,
          version,
          message: `${path} (version ${version}) is dated before ${newestBase}, the newest migration already on main, so live would treat it as out-of-order history. ${appliedHistoryRule} Rename it with a version newer than ${newestBase}.`,
        });
      }
      // Independent of ordering: a version far in the future becomes the newest applied
      // version on merge, and every later migration would then have to be dated after it.
      const versionMs = migrationVersionTime(version);
      if (!Number.isFinite(nowMs) || !Number.isFinite(versionMs) || versionMs - nowMs > futureMigrationToleranceMs) {
        violations.push({
          kind: "future-dated",
          path,
          version,
          message: `${path} (version ${version}) is dated more than 2 days after the current UTC time${Number.isFinite(nowMs) ? ` (${new Date(nowMs).toISOString()})` : ""}. A future-dated migration would force every later migration after it. Rename it with a version at the current UTC time (\`YYYYMMDDHHMMSS\`).`,
        });
      }
    }
  }
  return violations;
}

const futureMigrationToleranceMs = 2 * 24 * 60 * 60 * 1000;

/** UTC epoch milliseconds for a 14-digit `YYYYMMDDHHMMSS` version, else NaN. */
function migrationVersionTime(version) {
  const match = String(version ?? "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return Number.NaN;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** Strip SQL comments and single-quoted literals so CREATE INDEX inside pin strings is ignored. */
function stripSqlCommentsAndStrings(sql) {
  return String(sql ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * Fail-fast validation guard predicate (AGENTS.md guard-migration contract /
 * 20260804110240 pattern): raises, scopes timeouts with SET LOCAL, never builds indexes.
 */
export function isValidationGuardSql(sql) {
  const text = String(sql ?? "");
  if (!/raise\s+exception/i.test(text)) return false;
  if (!/set\s+local\b/i.test(text)) return false;
  const executable = stripSqlCommentsAndStrings(text);
  if (/\bcreate\s+(?:unique\s+)?index\b/i.test(executable)) return false;
  return true;
}

/**
 * Migration-history override additionally requires an accompanying fail-fast validation
 * guard migration in the same change (AGENTS.md L287–L296). `addedMigrationContents` maps
 * path → file text for every added/copied migration; missing contents fail closed.
 */
export function migrationHistoryOverrideGuard({ fileStatuses, addedMigrationContents }) {
  const added = [];
  for (const file of fileStatuses ?? []) {
    const status = String(file?.status ?? "").toLowerCase();
    if (status !== "added" && status !== "copied") continue;
    const path = normalizePath(file?.filename);
    if (!migrationVersion(path)) continue;
    added.push(path);
  }
  if (added.length === 0) {
    return {
      satisfied: false,
      guardPaths: [],
      reason:
        "Migration history edit approved requires an accompanying fail-fast validation guard migration in the same change (AGENTS.md guard-migration contract).",
    };
  }
  if (!addedMigrationContents || typeof addedMigrationContents !== "object") {
    return {
      satisfied: false,
      guardPaths: [],
      reason:
        "Migration history edit approved cannot be verified because added migration contents were not supplied; the policy fails closed until it can validate the guard.",
    };
  }
  const guardPaths = added.filter((path) => isValidationGuardSql(addedMigrationContents[path] ?? ""));
  if (guardPaths.length === 0) {
    return {
      satisfied: false,
      guardPaths: [],
      reason:
        "Migration history edit approved requires at least one added migration that is a fail-fast validation guard (raise exception, set local timeouts, never builds indexes), following 20260804110240.",
    };
  }
  return { satisfied: true, guardPaths, reason: "" };
}

/**
 * The only override for a migration-history violation: a body line
 * `Migration history edit approved: <reason>` together with an accompanying fail-fast
 * validation guard migration in the same change. The body line alone is not enough.
 */
export function migrationHistoryEditApproval(body) {
  const withoutComments = String(body ?? "").replace(/<!--[^]*?-->/g, "");
  const match = withoutComments.match(/^[\s>*-]*\*{0,2}Migration history edit approved\*{0,2}:\s*(\S[^\n]*)$/im);
  if (!match) return { declared: false, satisfied: false, reason: "" };
  const reason = match[1].trim();
  const placeholder = /^<[^>]*>$|^(?:n\/?a|none|todo|tbd|-)$/i.test(reason);
  return { declared: true, satisfied: !placeholder && reason.length >= 12, reason };
}

/**
 * The migration-history gate on its own: violations against `baseMigrationVersions`, with the
 * one override (the approval body line plus a fail-fast validation guard migration) applied.
 * `evaluatePullRequestPolicy` uses it for PR events; the merge queue calls it directly, because
 * a queued PR is re-based onto whatever merged ahead of it and is never re-synced, so the
 * ordering it was checked against at PR time can be stale by the time it lands.
 */
export function migrationHistoryVerdict({
  fileStatuses,
  baseMigrationVersions,
  body = "",
  addedMigrationContents = {},
  now = new Date(),
}) {
  const errors = [];
  const warnings = [];
  const violations = migrationHistoryViolations({ files: fileStatuses, baseMigrationVersions, now });
  if (violations.length > 0) {
    const override = migrationHistoryEditApproval(body);
    if (override.satisfied) {
      const guard = migrationHistoryOverrideGuard({ fileStatuses, addedMigrationContents });
      if (guard.satisfied) {
        warnings.push(
          `Migration history edit approved (${override.reason}); validation guard ${guard.guardPaths.join(", ")}; ${violations.length} violation(s) accepted: ${violations.map((violation) => violation.path).join(", ")}.`,
        );
      } else {
        for (const violation of violations) errors.push(violation.message);
        errors.push(guard.reason);
      }
    } else {
      for (const violation of violations) errors.push(violation.message);
      if (override.declared && !override.satisfied) {
        errors.push(
          "`Migration history edit approved:` needs a specific reason (at least 12 characters, not a placeholder).",
        );
      }
    }
  }
  return { violations, errors, warnings };
}

/**
 * The PR number a merge-queue entry was built from, read from its temporary branch
 * (`refs/heads/gh-readonly-queue/<base>/pr-<number>-<sha>`), or null when it cannot be read.
 */
export function mergeGroupPullRequestNumber(headRef) {
  const match = String(headRef ?? "").match(/(?:^|\/)gh-readonly-queue\/.+\/pr-(\d+)-[0-9a-f]{7,40}$/);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Required-check forgery tripwire.
//
// Every required context here is pinned to GitHub Actions (integration 15368). ANY workflow
// that runs PR-controlled code with a GITHUB_TOKEN is also GitHub Actions: a same-repository
// branch can add a job named `PR policy` to a `pull_request` workflow, or grant itself
// `statuses: write` and post a forged success, and both are attributed to the same
// integration as the real check. The integration pin excludes a personal access token; it does
// not exclude this. This tripwire fails `PR policy` when a changed workflow that can execute
// branch code names a protected context or can write commit statuses. It is a TRIPWIRE, not a
// boundary: an expression-built name (`${{ format(...) }}`) or a check that the forger posts
// later still gets past it. The boundary needs a live setting — see pull-request-workflow.md.
// ---------------------------------------------------------------------------

export const PROTECTED_REQUIRED_CONTEXTS = ["PR policy"];

// Triggers whose workflow definition is always read from the default branch, so a PR's edit
// to the file cannot run before it merges. Anything else — or a file whose triggers cannot be
// read — is treated as able to run the branch's own copy.
const DEFAULT_BRANCH_ONLY_TRIGGERS = new Set([
  "pull_request_target",
  "merge_group",
  "workflow_run",
  "schedule",
  "issues",
  "issue_comment",
  "repository_dispatch",
]);

function isWorkflowSurface(filePath) {
  const file = normalizePath(filePath);
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(file) || /^\.github\/actions\//i.test(file);
}

/** Trigger names from a workflow's `on:` key, or null when they cannot be read reliably. */
export function workflowTriggers(content) {
  const lines = String(content ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^(?:on|"on"|'on'|true)\s*:/.test(line));
  if (start < 0) return null;
  const inline = lines[start]
    .replace(/^(?:on|"on"|'on'|true)\s*:/, "")
    .replace(/\s+#.*$/, "")
    .trim();
  if (inline) {
    const listed = inline.replace(/^\[|\]$/g, "");
    const names = listed
      .split(",")
      .map((name) => name.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    return names.length > 0 && names.every((name) => /^[a-z_]+$/.test(name)) ? names : null;
  }
  const triggers = [];
  let childIndent = null;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) break;
    if (childIndent === null) childIndent = indent;
    if (indent !== childIndent) continue;
    const key = line.trim().match(/^["']?([a-z_]+)["']?\s*:/);
    if (!key) return null;
    triggers.push(key[1]);
  }
  return triggers.length > 0 ? triggers : null;
}

function canRunBranchCode(filePath, content) {
  if (/^\.github\/actions\//i.test(normalizePath(filePath))) return true;
  const triggers = workflowTriggers(content);
  return !triggers || triggers.some((trigger) => !DEFAULT_BRANCH_ONLY_TRIGGERS.has(trigger));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Findings for changed workflow surfaces that could post a protected required context.
 * `workflowContents` maps each changed workflow/action path to its content at the PR head.
 * A changed workflow path with no supplied content is itself a finding (fail closed).
 */
export function requiredCheckForgeryFindings({ files, workflowContents }) {
  const findings = [];
  const contents = workflowContents ?? {};
  const names = PROTECTED_REQUIRED_CONTEXTS.map(escapeRegExp).join("|");
  const protectedName = new RegExp(
    `(?:\\bname|\\bcontext)\\s*:\\s*["'\`]?\\s*(?:${names})\\s*["'\`]?\\s*(?:,|\\}|#|$)`,
    "im",
  );
  const statusWriter =
    /\bstatuses\s*:\s*write\b|\bwrite-all\b|\bcreateCommitStatus\b|\/statuses\/|repos\.createStatus\b/i;
  for (const filePath of [...new Set((files ?? []).map(normalizePath))]) {
    if (!isWorkflowSurface(filePath)) continue;
    if (!Object.hasOwn(contents, filePath)) {
      findings.push(
        `${filePath} changed, but its content at the PR head could not be read, so the policy cannot confirm it does not post a required check. Rerun the check.`,
      );
      continue;
    }
    const content = String(contents[filePath] ?? "");
    if (!canRunBranchCode(filePath, content)) continue;
    const nameHit = protectedName.test(content);
    const writerHit = statusWriter.test(content);
    if (nameHit || writerHit) {
      findings.push(
        `${filePath} can run this branch's own code and ${nameHit ? `names a required check (${PROTECTED_REQUIRED_CONTEXTS.join(" / ")})` : "can write commit statuses"}. A branch workflow could report a required check as passed; move that step to a pull_request_target workflow or remove it.`,
      );
    }
  }
  return findings;
}

export function evaluatePullRequestPolicy({
  title,
  body,
  headRef,
  files,
  fileStatuses,
  baseMigrationVersions,
  addedMigrationContents,
  changedWorkflowContents,
  // true for the PR policy workflow (and other enforcing callers): fail closed when a
  // migration-touching PR cannot supply the inputs needed to verify applied-migration history.
  enforceMigrationHistory = false,
  now = new Date(),
}) {
  // Three conditions block the PR (hard failure): a clinical-risk diff without a
  // complete Clinical Governance Preflight, a RAG-ranking-surface diff without an
  // explicit `RAG impact:` declaration, and a Supabase-migration diff whose metadata
  // claims a deferred deploy that merging does not honour. Intermittent automated
  // review (usage limits / eligibility) is explicitly not a gate (owner decision
  // 2026-08-22 / #CCZ4HB; correction 2026-09-02 — decision stands until revisited).
  // Every other metadata expectation (title, summary, verification, UI, risk and
  // rollout) is advisory: it is surfaced as a warning so authors still get the nudge,
  // but it never fails the check or blocks a merge.
  const errors = [];
  const warnings = [];
  // A rename's previous path is part of the change too: moving a file OUT of a protected
  // tree must classify exactly like editing it in place.
  const renamedFromPaths = Array.isArray(fileStatuses)
    ? fileStatuses.map((file) => file?.previous_filename).filter(Boolean)
    : [];
  const classification = classifyPullRequestFiles([...(files ?? []), ...renamedFromPaths]);
  const retrievalMigrationPaths = retrievalFunctionMigrationPaths(addedMigrationContents);
  if (retrievalMigrationPaths.length > 0) classification.ragRanking = true;

  // Blocking gate: PR_POLICY_BODY.md must never land on main — see the comment above
  // prPolicyBodyTransportViolation for why a lingering copy is dangerous.
  if (prPolicyBodyTransportViolation({ fileStatuses, files })) {
    errors.push(
      "PR_POLICY_BODY.md is a transport file: CI has synced it into this PR's description; delete it from the branch before merge so it never lands on main.",
    );
  }

  const summary = section(body, "Summary");
  // The summary must be its own prose: content nested under a sub-heading
  // (e.g. a mis-levelled `### Verification`) belongs to that sub-topic and
  // cannot stand in for the required outcome summary.
  // The `Areas touched:` and `RAG impact:` lines that `npm run pr:areas` prints go under Summary
  // too, but they are metadata, not the outcome: pasting them must not hide an empty Summary.
  const summaryDirect = summary
    .replace(/^[ \t]*#{1,6}[ \t]+\S[^]*$/m, "")
    .replace(/^[ \t]*(?:[-*+][ \t]+)?(?:Areas touched|RAG impact):.*$/gim, "");
  const verification = section(body, "Verification");
  const riskAndRollout = section(body, "Risk and rollout");
  const governance = section(body, "Clinical Governance Preflight");

  if (String(title ?? "").trim().length < 12)
    warnings.push("Use a specific, outcome-focused PR title (at least 12 characters).");
  if (branchLikeTitle(title, headRef))
    warnings.push("Replace the branch-style PR title with an outcome-focused title.");
  if (!meaningfulText(summaryDirect))
    warnings.push("Complete the `## Summary` section with the outcome and affected area.");
  if (!meaningfulText(verification)) {
    warnings.push("Complete the `## Verification` section with exact results or a reason checks were not run.");
  } else if (checkedChecklistEntries(verification).length === 0 && !explicitNotRun(verification)) {
    warnings.push(
      "Verification should contain a checked result or an explicit `Verification not run: <reason>` entry.",
    );
  }

  if (
    classification.ui &&
    !checkedCommand(verification, "npm run verify:ui") &&
    !explicitNotRun(verification, "UI verification")
  ) {
    warnings.push(
      "UI changes should include checked `npm run verify:ui` evidence or `UI verification not run: <reason>`.",
    );
  }

  // Blocking gate: a PR touching RAG-ranking protected surfaces must declare its impact
  // explicitly (docs/rag-behaviour/safeguards.md — layer 1). Ordering behaviour is
  // live-validated; the declaration forces every session/task to consciously state either
  // "no behaviour change" (with a reason) or the canary pair covering the change.
  if (classification.ragRanking) {
    const ragImpact = ragImpactDeclared(body);
    if (!ragImpact.declared) {
      warnings.push(
        "This PR touches RAG-ranking protected surfaces" +
          (retrievalMigrationPaths.length > 0
            ? ` (${retrievalMigrationPaths.join(", ")} changes a retrieval function)`
            : "") +
          ". Consider adding a `RAG impact:` line to the body — either `RAG impact: no retrieval behaviour change — <reason>` or `RAG impact: behaviour change — canary pair <baseline> -> <post>` (see docs/rag-behaviour/safeguards.md).",
      );
    } else if (!ragImpact.satisfied) {
      warnings.push(
        "The `RAG impact:` line should state `no retrieval behaviour change — <reason>` or reference the validating canary pair (see docs/rag-behaviour/safeguards.md).",
      );
    }
  }

  // Blocking gate: a PR adding or editing a Supabase migration must not claim its
  // deployment is deferred, because merging IS the deploy. The claim is dangerous
  // precisely when it is believed: it invites a reviewer to merge a change they think
  // is still parked.
  if (classification.migration) {
    const deferral = deployDeferralClaim(title, body);
    if (deferral.claimed) {
      errors.push(
        `Merging this PR applies its migration to the live clinical database within seconds — there is no separate deploy step to wait for, so ${JSON.stringify(deferral.phrase)} promises a control this repository does not have. Remove the deferral wording, or leave the PR unmerged until the approved window (AGENTS.md "Supabase project safety").`,
      );
    }
  }

  // Advisory since 2026-09-17 (owner decision): the Clinical Governance Preflight was a
  // seven-item checklist that HARD-BLOCKED the merge of any clinical-risk PR until every
  // box was pasted in verbatim and ticked. It never inspected a single line of code — it
  // verified that the author had typed the right sentences — while `clinicalRiskPatterns`
  // classified nearly every meaningful path in the repo, so the block fired on almost all
  // real work. The friction was the whole cost and the assurance was theatre: the actual
  // clinical safeguards are the owner-scope, privacy, migration-history and required-check
  // gates, all of which still fail closed and are untouched by this change.
  //
  // The nudge survives as a warning so authors still get prompted on a clinical-risk diff;
  // it simply no longer stands between a finished change and `main`.
  if (classification.clinicalRisk) {
    if (!meaningfulText(governance)) {
      warnings.push(
        "Clinical-risk paths: consider a `## Clinical Governance Preflight` note covering source verification, patient-data handling, and service-role confinement.",
      );
    } else {
      const satisfiedItems = collectSatisfiedGovernanceItems(governance);
      const uncheckedItems = uncheckedChecklistEntries(governance);
      const hasUncheckedRequiredItem = requiredClinicalGovernanceItems.some((item) =>
        uncheckedItems.some((uncheckedItem) => uncheckedItem === item),
      );
      if (satisfiedItems.length < requiredClinicalGovernanceItems.length || hasUncheckedRequiredItem) {
        warnings.push(
          `Clinical Governance Preflight is incomplete (${satisfiedItems.length}/${requiredClinicalGovernanceItems.length} items evidenced). Advisory only — it no longer blocks the merge.`,
        );
      }
    }
  }

  if (classification.clinicalRisk || classification.operationalRisk) {
    if (!meaningfulText(riskAndRollout)) {
      warnings.push("High-risk changes should include the `## Risk and rollout` section.");
    } else {
      if (!substantiveRisk(fieldValue(riskAndRollout, "Risk"))) {
        warnings.push("Risk and rollout should include `Risk: <low|medium|high and rationale>`.");
      }
      if (!substantiveRollback(fieldValue(riskAndRollout, "Rollback"))) {
        warnings.push("Risk and rollout should include a concrete `Rollback: <plan>`.");
      }
    }
  }

  if (classification.operationalRisk && (classification.clinicalRisk || classification.ui)) {
    const mixedClasses = [classification.clinicalRisk ? "clinical" : null, classification.ui ? "UI" : null]
      .filter(Boolean)
      .join(" and ");
    warnings.push(
      `Operational-risk changes are bundled with ${mixedClasses} changes. Split the PR where practical so each risk class remains independently revertible.`,
    );
  }

  // Blocking gate: applied migrations are immutable history. The only override is the
  // body line together with an accompanying fail-fast validation guard migration.
  let historyViolations = [];
  const migrationInputsSupplied =
    Array.isArray(fileStatuses) && Array.isArray(baseMigrationVersions) && baseMigrationVersions.length > 0;
  if (migrationInputsSupplied) {
    const verdict = migrationHistoryVerdict({
      fileStatuses,
      baseMigrationVersions,
      body,
      addedMigrationContents,
      now,
    });
    historyViolations = verdict.violations;
    errors.push(...verdict.errors);
    warnings.push(...verdict.warnings);
  } else if (enforceMigrationHistory && classification.migration) {
    errors.push(
      "This PR touches supabase/migrations, but migration history could not be verified (file statuses or the trusted base migration versions were not supplied). Rerun the check; the policy fails closed until it can verify history.",
    );
  }

  // Blocking gate (opt-in by supplying changedWorkflowContents): a changed workflow that can
  // run branch code must not name or post a required check. Callers that do not read workflow
  // contents (the batch runner) skip it rather than fail on missing inputs.
  if (changedWorkflowContents !== undefined) {
    // A removed file no longer exists at the head, so it cannot run there.
    const removed = new Set(
      (fileStatuses ?? [])
        .filter((entry) => String(entry?.status ?? "").toLowerCase() === "removed")
        .map((entry) => entry.filename),
    );
    for (const finding of requiredCheckForgeryFindings({
      files: (files ?? []).filter((file) => !removed.has(file)),
      workflowContents: changedWorkflowContents,
    }))
      errors.push(finding);
  }

  return {
    classification,
    errors,
    warnings,
    ok: errors.length === 0,
    migrationHistoryViolations: historyViolations,
  };
}

function selfTest() {
  const completeGovernance = requiredClinicalGovernanceItems.map((item) => `- [x] ${item}`).join("\n");
  const completeBody = `## Summary\n\n- Add a trusted PR policy.\n\nRAG impact: no retrieval behaviour change — metadata-only validation.\n\n## Verification\n\n- [x] \`npm run verify:pr-local\`\n- [x] \`npm run verify:ui\`\n\n## Risk and rollout\n\n- Risk: low; metadata-only validation.\n- Rollback: revert the workflow commit.\n\n## Clinical Governance Preflight\n\n${completeGovernance}`;
  assert.equal(
    evaluatePullRequestPolicy({
      title: "ci: enforce pull request evidence",
      body: completeBody,
      headRef: "codex/pr-policy",
      files: [".github/workflows/pr-policy.yml"],
    }).ok,
    true,
  );
  // Advisory metadata issues are surfaced as warnings and NEVER block the check.
  const branchStyle = evaluatePullRequestPolicy({
    title: "Codex/pr-policy",
    body: "",
    headRef: "codex/pr-policy",
    files: [],
  });
  assert.match(branchStyle.warnings.join(" "), /branch-style/);
  assert.equal(branchStyle.ok, true, "advisory-only issues must not fail the check");
  assert.match(
    evaluatePullRequestPolicy({
      title: "fix: update search behavior",
      body: completeBody.replace("- [x] `npm run verify:ui`\n", ""),
      headRef: "codex/search-fix",
      files: ["src/components/search.tsx"],
    }).warnings.join(" "),
    /verify:ui/,
  );
  // Command-token boundary: a checked `npm run verify:ui-disabled` entry must not
  // satisfy the `npm run verify:ui` requirement for UI-classified PRs.
  assert.match(
    evaluatePullRequestPolicy({
      title: "fix: update search behavior",
      body: completeBody.replace("- [x] `npm run verify:ui`\n", "- [x] `npm run verify:ui-disabled`\n"),
      headRef: "codex/search-fix",
      files: ["src/components/search.tsx"],
    }).warnings.join(" "),
    /verify:ui/,
  );
  // Marker tolerance: `*` and `+` checklist markers satisfy the generic
  // verification check, not just `-`.
  assert.doesNotMatch(
    evaluatePullRequestPolicy({
      title: "docs: explain the review process",
      body: "## Summary\n\n- Useful documentation.\n\n## Verification\n\n* [x] `npm run verify:pr-local`\n+ [x] `npm run typecheck`\n",
      headRef: "codex/review-docs",
      files: ["docs/process-hardening.md"],
    }).warnings.join(" "),
    /checked result/,
  );
  // Outline semantics: a ### sub-heading inside a required section must not
  // truncate it — checklist evidence after the sub-heading still counts.
  assert.equal(
    evaluatePullRequestPolicy({
      title: "ci: enforce pull request evidence",
      body: completeBody.replace("## Verification\n\n", "## Verification\n\n### Unit tests\n\n"),
      headRef: "codex/pr-policy",
      files: [".github/workflows/pr-policy.yml"],
    }).ok,
    true,
  );
  // A section whose only content is a nested sub-heading is still empty: the
  // outline-aware boundary must not let heading lines satisfy meaningfulText.
  assert.match(
    evaluatePullRequestPolicy({
      title: "fix: something meaningful here",
      body: "## Summary\n\n### Verification\n\n- [x] `npm run verify:pr-local`\n",
      headRef: "codex/x",
      files: ["docs/a.md"],
    }).warnings.join(" "),
    /## Summary/,
  );
  // ...but a level-1 heading is shallower than ## and DOES end the section, so
  // evidence stranded after it must not count toward the preceding section.
  assert.match(
    evaluatePullRequestPolicy({
      title: "fix: update search behavior",
      body: completeBody.replace("- [x] `npm run verify:ui`\n", "# Appendix\n\n- [x] `npm run verify:ui`\n"),
      headRef: "codex/search-fix",
      files: ["src/components/search.tsx"],
    }).warnings.join(" "),
    /verify:ui/,
  );
  // Tolerant governance: a lightly reworded but still-checked item passes — the
  // check no longer demands the exact required wording.
  assert.equal(
    evaluatePullRequestPolicy({
      title: "fix: update clinical search",
      body: completeBody.replace(
        `- [x] ${requiredClinicalGovernanceItems[0]}`,
        "- [x] Reviewed: linked-source verification for clinical use is unchanged",
      ),
      headRef: "codex/search-fix",
      files: ["src/lib/clinical-search.ts"],
    }).ok,
    true,
  );
  // ...and an unchecked governance box WARNS a clinical-risk PR without blocking it
  // (advisory since 2026-09-17 — the checklist inspected prose, never code).
  const uncheckedGovernance = evaluatePullRequestPolicy({
    title: "fix: update clinical search",
    body: completeBody.replace(
      `- [x] ${requiredClinicalGovernanceItems[0]}`,
      `- [ ] ${requiredClinicalGovernanceItems[0]}`,
    ),
    headRef: "codex/search-fix",
    files: ["src/lib/clinical-search.ts"],
  });
  assert.equal(uncheckedGovernance.ok, true, "an unchecked governance box must not block the merge");
  assert.match(uncheckedGovernance.warnings.join(" "), /Clinical Governance Preflight/);
  // ...and so does dropping an item below the required count.
  const droppedGovernance = evaluatePullRequestPolicy({
    title: "fix: update clinical search",
    body: completeBody.replace(`- [x] ${requiredClinicalGovernanceItems[0]}\n`, ""),
    headRef: "codex/search-fix",
    files: ["src/lib/clinical-search.ts"],
  });
  assert.equal(droppedGovernance.ok, true, "a short governance checklist must not block the merge");
  assert.match(droppedGovernance.warnings.join(" "), /Clinical Governance Preflight/);
  assert.equal(
    evaluatePullRequestPolicy({
      title: "fix: handle /api/search failures",
      body: completeBody,
      headRef: "codex/api-search-failures",
      files: ["docs/process-hardening.md"],
    }).ok,
    true,
  );
  assert.match(
    evaluatePullRequestPolicy({
      title: "ci: enforce pull request evidence",
      body: completeBody.replace("Risk: low; metadata-only validation.", "Risk: low"),
      headRef: "codex/pr-policy",
      files: [".github/workflows/pr-policy.yml"],
    }).warnings.join(" "),
    /Risk and rollout should include/,
  );
  assert.match(
    evaluatePullRequestPolicy({
      title: "ci: enforce pull request evidence",
      body: completeBody.replace("Rollback: revert the workflow commit.", "Rollback: none because this is small"),
      headRef: "codex/pr-policy",
      files: [".github/workflows/pr-policy.yml"],
    }).warnings.join(" "),
    /concrete `Rollback/,
  );
  assert.match(
    evaluatePullRequestPolicy({
      title: "docs: explain the review process",
      body: "## Summary\n\n- Useful documentation.\n\n## Verification\n\n- [ ] `npm run verify:pr-local`\n<!-- Use `Verification not run: <reason>` when blocked. -->",
      headRef: "codex/review-docs",
      files: ["docs/process-hardening.md"],
    }).warnings.join(" "),
    /checked result/,
  );
  assert.deepEqual(classifyPullRequestFiles(["src/app/api/search/route.ts"]), {
    files: ["src/app/api/search/route.ts"],
    clinicalRisk: true,
    operationalRisk: false,
    ragRanking: false,
    migration: false,
    ui: false,
  });
  // Narrowed classification: presentation-only UI under the clinically-named
  // component tree is a UI change, not a clinical-governance change, so it no
  // longer auto-demands the preflight.
  assert.deepEqual(classifyPullRequestFiles(["src/components/clinical-dashboard/settings-dialog.tsx"]), {
    files: ["src/components/clinical-dashboard/settings-dialog.tsx"],
    clinicalRisk: false,
    operationalRisk: false,
    ragRanking: false,
    migration: false,
    ui: true,
  });
  // RAG-ranking protected surfaces (docs/rag-behaviour/safeguards.md): a PR touching them
  // without a `RAG impact:` declaration is WARNED, not blocked (advisory since 2026-09-17).
  // The live-eval canary remains the real safeguard for ordering behaviour; this line only
  // ever checked that a sentence was present, and blocking on it stalled ordinary work.
  const ragUndeclared = evaluatePullRequestPolicy({
    title: "fix: adjust release ordering tie-break",
    body: completeBody.replace(/^RAG impact:.*\n\n/m, ""),
    headRef: "codex/ordering-fix",
    files: ["src/lib/released-search-order.ts"],
  });
  assert.equal(ragUndeclared.ok, true, "a missing RAG impact line must not block the merge");
  assert.match(ragUndeclared.warnings.join(" "), /RAG impact/);
  // ...a vague declaration (neither no-change nor canary) also warns without blocking...
  const ragVague = evaluatePullRequestPolicy({
    title: "fix: adjust release ordering tie-break",
    body: completeBody.replace(/^RAG impact:.*$/m, "RAG impact: probably fine"),
    headRef: "codex/ordering-fix",
    files: ["src/lib/released-search-order.ts"],
  });
  assert.equal(ragVague.ok, true, "a vague RAG impact line must not block the merge");
  assert.match(ragVague.warnings.join(" "), /RAG impact/);
  // ...an explicit no-behaviour-change declaration passes (with governance complete)...
  assert.equal(
    evaluatePullRequestPolicy({
      title: "docs: clarify release-order comments",
      body: completeBody,
      headRef: "codex/ordering-docs",
      files: ["src/lib/released-search-order.ts"],
    }).ok,
    true,
    "a declared no-behaviour-change RAG PR must pass",
  );
  // ...and a canary-pair declaration passes for behaviour changes.
  assert.equal(
    evaluatePullRequestPolicy({
      title: "feat: retrieval ordering change",
      body: completeBody.replace(
        /^RAG impact:.*$/m,
        "RAG impact: behaviour change — canary pair run 54 -> post-merge dispatch planned",
      ),
      headRef: "codex/ordering-change",
      files: ["src/lib/rag/rag-candidate-sources.ts", "tests/rag-fast-path-ordering.test.ts"],
    }).ok,
    true,
    "a canary-pair-declared RAG behaviour change must pass",
  );
  // The golden fixture and contract tests are protected surfaces too.
  assert.equal(classifyPullRequestFiles(["scripts/fixtures/rag-retrieval-golden.json"]).ragRanking, true);
  assert.equal(classifyPullRequestFiles(["tests/ranking-tuning.test.ts"]).ragRanking, true);
  assert.equal(classifyPullRequestFiles(["src/lib/source-authority-registry.ts"]).ragRanking, true);
  assert.equal(classifyPullRequestFiles(["src/lib/australian-source-priority.ts"]).ragRanking, true);
  // Ingestion text surfaces: what gets chunked is a retrieval input, so these must ask for a
  // RAG impact declaration. PR #2810 changed the first of these and the gate stayed silent.
  assert.equal(classifyPullRequestFiles(["src/lib/chunking.ts"]).ragRanking, true);
  assert.equal(classifyPullRequestFiles(["worker/python/extract_pdf_assets.py"]).ragRanking, true);
  assert.equal(classifyPullRequestFiles(["src/lib/extractors/document.ts"]).ragRanking, true);
  assert.equal(classifyPullRequestFiles(["src/lib/extractors/pdf-extraction-budget.ts"]).ragRanking, true);
  // Structured-evidence producers: index units are queried directly by the candidate fan-out,
  // and deep-memory.ts rescores results outright via applyMemoryCardBoosts.
  assert.equal(classifyPullRequestFiles(["src/lib/document-index-units.ts"]).ragRanking, true);
  assert.equal(classifyPullRequestFiles(["src/lib/model-index-extraction.ts"]).ragRanking, true);
  assert.equal(classifyPullRequestFiles(["src/lib/deep-memory.ts"]).ragRanking, true);
  // Retrieval inputs added 2026-09-25: RPC version choice, scoring helpers, and the producers
  // of enrichment, image-caption, embedding-field, table-fact and assertion rows.
  for (const file of [
    "src/lib/retrieval-rpc-rollout.ts",
    "src/lib/clinical-evidence-haystack.ts",
    "src/lib/cross-document-synthesis.ts",
    "src/lib/corpus-grounding.ts",
    "src/lib/keyword-query.ts",
    "src/lib/document-enrichment.ts",
    "src/lib/visual-intelligence.ts",
    "src/lib/image-filtering.ts",
    "worker/embedding-fields.ts",
    "worker/table-facts.ts",
    "worker/assertion-tagging.ts",
  ]) {
    assert.equal(classifyPullRequestFiles([file]).ragRanking, true, file);
  }
  // The worker loop orchestrates producers; it is not itself one.
  assert.equal(classifyPullRequestFiles(["worker/main.ts"]).ragRanking, false);
  // Still narrow: adjacent ingestion machinery that does not decide chunk TEXT, index-unit
  // content, or a score stays out. Orchestration that only calls the producers is not itself
  // a producer.
  assert.equal(classifyPullRequestFiles(["src/lib/ingestion-audit.ts"]).ragRanking, false);
  assert.equal(classifyPullRequestFiles(["src/lib/reindex-pipeline.ts"]).ragRanking, false);
  // Answer synthesis is clinical-risk but NOT rag-ranking (retrieval ordering is the
  // protected axis here; generation keeps the governance gate only).
  assert.equal(classifyPullRequestFiles(["src/lib/answer-synthesis.ts"]).ragRanking, false);
  const mixedOperationalRisk = evaluatePullRequestPolicy({
    title: "ci: update clinical deployment policy",
    body: completeBody,
    headRef: "codex/clinical-ci-policy",
    files: [
      ".github/workflows/ci.yml",
      "src/lib/answer-synthesis.ts",
      "src/components/search.tsx",
      "Dockerfile.worker",
    ],
  });
  assert.equal(mixedOperationalRisk.ok, true, "mixed-risk signaling is advisory, not a new hard block");
  assert.match(mixedOperationalRisk.warnings.join(" "), /Operational-risk changes are bundled with clinical and UI/);
  assert.doesNotMatch(
    evaluatePullRequestPolicy({
      title: "ci: update deployment policy",
      body: completeBody,
      headRef: "codex/ci-policy",
      files: [".github/workflows/ci.yml"],
    }).warnings.join(" "),
    /Operational-risk changes are bundled/,
  );
  // ...but privacy/access-control UI surfaces stay gated.
  assert.equal(classifyPullRequestFiles(["src/components/privacy-input-notice.tsx"]).clinicalRisk, true);
  // ...and clinical behavior in the library layer stays gated.
  assert.equal(classifyPullRequestFiles(["src/lib/clinical-search.ts"]).clinicalRisk, true);
  // Clinical reference datasets are clinical output even with no code diff. PR
  // #1489 shipped 205 therapy records past this classifier as non-clinical.
  assert.equal(classifyPullRequestFiles(["src/data/therapies-index.json"]).clinicalRisk, true);
  assert.equal(classifyPullRequestFiles(["public/therapy-compass-data/pathways.json"]).clinicalRisk, true);
  assert.equal(classifyPullRequestFiles(["data/clinical-snapshot.json"]).clinicalRisk, true);
  // Generated developer-hub metadata under `data/`: not clinical, so no
  // governance preflight. Pinned per file, and paired with the assertion above
  // proving the surrounding `data/` rule still bites for everything else.
  assert.equal(classifyPullRequestFiles(["data/repo-awareness-snapshot.json"]).clinicalRisk, false);
  assert.equal(classifyPullRequestFiles(["data/outstanding-issues-snapshot.json"]).clinicalRisk, false);
  // The carve-out is per file, not a prefix: a neighbour keeps its risk, and a
  // mixed PR is still clinical-risk because of the other file.
  assert.equal(classifyPullRequestFiles(["data/repo-awareness-snapshot.json.bak"]).clinicalRisk, true);
  assert.equal(
    classifyPullRequestFiles(["data/repo-awareness-snapshot.json", "data/medications-snapshot.json"]).clinicalRisk,
    true,
  );
  // Unreviewed clinical content switches and mode reachability in src/lib (#P5542X).
  assert.equal(classifyPullRequestFiles(["src/lib/clinical-content-policy.ts"]).clinicalRisk, true);
  assert.equal(classifyPullRequestFiles(["src/lib/app-modes.ts"]).clinicalRisk, true);
  // Owner ruling 2026-09-17: patient-address, referral and database-key code is clinical-risk
  // even though no file name carries a clinical token.
  assert.equal(classifyPullRequestFiles(["src/lib/caring-contacts/clock.ts"]).clinicalRisk, true);
  assert.equal(classifyPullRequestFiles(["src/lib/supabase/admin.ts"]).clinicalRisk, true);
  assert.equal(classifyPullRequestFiles(["src/lib/on-call/repository.ts"]).clinicalRisk, true);
  // Still narrow: the rest of on-call is not swept in by the repository entry.
  assert.equal(classifyPullRequestFiles(["src/lib/on-call/api-schemas.ts"]).clinicalRisk, false);
  assert.equal(classifyPullRequestFiles(["src/lib/therapies.ts"]).clinicalRisk, true);
  // Owner ruling 2026-09-17, after the clinical review of #2838: differential-diagnosis code and
  // content are clinical-risk even though most of these file names carry no clinical token.
  assert.equal(classifyPullRequestFiles(["src/lib/differential-detail.ts"]).clinicalRisk, true);
  assert.equal(
    classifyPullRequestFiles(["src/components/differentials/differential-detail-page.tsx"]).clinicalRisk,
    true,
  );
  assert.equal(classifyPullRequestFiles(["scripts/build-cross-mode-differentials-index.mjs"]).clinicalRisk, true);
  // Owner ruling 2026-09-19 (#86E34T): all three `rowGovernance` siblings are clinical-risk.
  // Each decides whether a stored record reaches a clinician labelled current or outdated, and
  // they reach this verdict by three different rules, so all three are pinned together — the
  // inconsistency this closes was that `registry-records.ts` alone matched none of them.
  assert.equal(classifyPullRequestFiles(["src/lib/differential-records.ts"]).clinicalRisk, true);
  assert.equal(classifyPullRequestFiles(["src/lib/medication-records.ts"]).clinicalRisk, true);
  assert.equal(classifyPullRequestFiles(["src/lib/registry-records.ts"]).clinicalRisk, true);
  // Still narrow: the registry entry is an exact path, so the client-side hook next to it —
  // which holds no governance decision — is not swept in, and neither is the rest of the family.
  assert.equal(classifyPullRequestFiles(["src/lib/use-registry-records.ts"]).clinicalRisk, false);
  assert.equal(classifyPullRequestFiles(["src/lib/registry-client-contract.ts"]).clinicalRisk, false);
  // Near miss: an unrelated UI component is not swept in by the differential patterns.
  assert.equal(classifyPullRequestFiles(["src/components/ui/button.tsx"]).clinicalRisk, false);
  // Mode configuration, search routing, and UI copy modules are recognized as UI (#0HFDWD).
  assert.equal(classifyPullRequestFiles(["src/lib/app-modes.ts"]).ui, true);
  assert.equal(classifyPullRequestFiles(["src/lib/search-route-ownership.ts"]).ui, true);
  assert.equal(classifyPullRequestFiles(["src/lib/ui-copy.ts"]).ui, true);
  // ...but an unrelated public asset is not clinical output.
  assert.equal(classifyPullRequestFiles(["public/favicon.ico"]).clinicalRisk, false);
  // End-to-end: a dashboard UI PR with Summary + UI verification + risk but no
  // Clinical Governance Preflight now passes (previously it failed on the
  // clinically-named path alone).
  assert.equal(
    evaluatePullRequestPolicy({
      title: "fix: tidy home page spacing",
      body: "## Summary\n\n- Remove the redundant quick-actions row and tidy spacing.\n\n## Verification\n\n- [x] `npm run verify:ui`\n\n## Risk and rollout\n\n- Risk: low; presentation-only removal of a duplicate action row.\n- Rollback: revert this commit.",
      headRef: "claude/home-page-spacing",
      files: ["src/components/clinical-dashboard/answer-empty-state.tsx", "src/app/globals.css"],
    }).ok,
    true,
  );
  // Block-only contract: a completely bare body on non-clinical files raises
  // several advisory warnings but never blocks the check.
  const bare = evaluatePullRequestPolicy({
    title: "x",
    body: "",
    headRef: "codex/whatever",
    files: ["src/components/ui/button.tsx"],
  });
  assert.equal(bare.ok, true, "non-clinical PRs must never be blocked by advisory metadata gaps");
  assert.ok(bare.warnings.length > 0, "advisory gaps should still be surfaced as warnings");
  // ...and a clinical-risk PR with no governance section is advisory too, since 2026-09-17.
  // Nothing about PR-body prose blocks a merge any more; the gates that still fail closed
  // are migration history, required-check forgery, and the PR_POLICY_BODY transport check.
  const clinicalBare = evaluatePullRequestPolicy({
    title: "fix: adjust answer synthesis grounding",
    body: "## Summary\n\n- Tweak synthesis.",
    headRef: "codex/answer-fix",
    files: ["src/lib/answer-synthesis.ts"],
  });
  assert.equal(clinicalBare.ok, true, "a missing governance section must not block the merge");
  assert.match(clinicalBare.warnings.join(" "), /Clinical Governance Preflight/);
  // The pr:areas lines are metadata: a Summary holding only them is still empty...
  const summaryWarning = "Complete the `## Summary` section with the outcome and affected area.";
  const areasOnly = evaluatePullRequestPolicy({
    title: "docs: tidy the organisation map wording",
    body: "## Summary\n\nAreas touched: Knowledge and records\n- RAG impact: ???\n\n## Verification\n\n- [x] `npm run verify:pr-local`",
    headRef: "claude/map-wording",
    files: ["docs/organisation/README.md"],
  });
  assert.ok(areasOnly.warnings.includes(summaryWarning), "pr:areas lines alone must not satisfy the Summary");
  // ...and alongside real outcome prose they change nothing.
  const areasWithProse = evaluatePullRequestPolicy({
    title: "docs: tidy the organisation map wording",
    body: "## Summary\n\n- Clarify how areas are named.\n\nAreas touched: Knowledge and records\n\n## Verification\n\n- [x] `npm run verify:pr-local`",
    headRef: "claude/map-wording",
    files: ["docs/organisation/README.md"],
  });
  assert.ok(!areasWithProse.warnings.includes(summaryWarning), "outcome prose beside pr:areas lines is a Summary");
  assert.equal(
    section("### Summary ###\n\n- concise summary\n\n### Verification\n\n- [x] `npm run verify:pr-local`\n", "Summary"),
    "- concise summary",
  );
  // Duplicate section headings: content from all occurrences must be combined
  // so that a prose block followed by a checklist block (same heading) is
  // treated as a single section for checklist matching purposes.
  assert.equal(
    evaluatePullRequestPolicy({
      title: "ci: enforce pull request evidence",
      body:
        "## Summary\n\n- Add a trusted PR policy.\n\n## Verification\n\n- [x] `npm run verify:pr-local`\n- [x] `npm run verify:ui`\n\n## Risk and rollout\n\n- Risk: low; metadata-only validation.\n- Rollback: revert the workflow commit.\n\n## Clinical Governance Preflight\n\nProse rationale for the change.\n\n## Clinical Governance Preflight\n\n" +
        completeGovernance,
      headRef: "codex/pr-policy",
      files: [".github/workflows/pr-policy.yml"],
    }).ok,
    true,
    "duplicate section headings should combine content for checklist matching",
  );
  assert.deepEqual(
    collectSatisfiedGovernanceItems(`- [x] This change does not alter citation requirements, source verification, provenance, or clinical-content governance.
- [x] This change does not alter privacy controls, patient-data handling, authentication, authorization, or document-access behavior.
- [x] Any Supabase service-role credentials used by the migration-history diagnostic remain CI/server-side only and are not exposed to clients.
- [x] This change does not alter the configured Supabase project/target or perform a production database migration.
- [x] This change does not alter demo/synthetic content separation from real clinical sources.
- [x] This change does not alter source metadata, review status, or how outdated/unknown sources are handled.
- [x] No SaMD/TGA assessment is required because this change has no clinical decision-support impact.`),
    requiredClinicalGovernanceItems,
    "legacy governance attestations should map onto required checklist coverage",
  );
  assert.doesNotMatch(
    collectSatisfiedGovernanceItems(
      "- [x] This change does not alter citation requirements, source verification, or clinical-content governance.",
    ).join("\n"),
    new RegExp(requiredClinicalGovernanceItems[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "legacy coverage should fail when a required signal (provenance) is missing",
  );
  assert.deepEqual(
    collectSatisfiedGovernanceItems(`- [x] ${requiredClinicalGovernanceItems[2]}
- [x] This change does not alter citation requirements, source verification, provenance, or clinical-content governance.
- [x] This change does not alter privacy controls, patient-data handling, authentication, authorization, or document-access behavior.
- [x] Any Supabase service-role credentials used by the migration-history diagnostic remain CI/server-side only and are not exposed to clients.
- [x] This change does not alter demo/synthetic content separation from real clinical sources.
- [x] This change does not alter source metadata, review status, or how outdated/unknown sources are handled.
- [x] No SaMD/TGA assessment is required because this change has no clinical decision-support impact.`),
    requiredClinicalGovernanceItems,
    "mixed canonical + legacy governance attestations should satisfy all required items",
  );
  assert.deepEqual(
    collectSatisfiedGovernanceItems(
      "- [x] This change does not alter citation requirements, source verification, provenance, or clinical-content governance.",
    ),
    [requiredClinicalGovernanceItems[0]],
    "generic legacy phrasing must satisfy only the source-backed-claims item, not demo/synthetic or source-metadata items",
  );
  assert.equal(
    collectSatisfiedGovernanceItems("- [x] Legacy governance text without the expected policy keywords.").length,
    0,
    "malformed legacy attestations must not satisfy governance coverage",
  );
  // Deferred-deploy gate. PR #2502 merged with "AWAITING DEPLOY WINDOW" in its title
  // and applied to the live clinical database within minutes, because merging IS the
  // deploy here. The gate blocks the claim; it must not block the legitimate practice
  // of choosing when to merge.
  const migrationFiles = ["supabase/migrations/20260901120000_restrict_owner_delete.sql"];
  const deferredTitle = evaluatePullRequestPolicy({
    title: "fix(db): restrict owner deletion on the four public-visibility tables — AWAITING DEPLOY WINDOW",
    body: completeBody,
    headRef: "codex/migration",
    files: migrationFiles,
  });
  assert.equal(deferredTitle.ok, false, "a migration PR claiming a deferred deploy must be blocked");
  assert.match(deferredTitle.errors.join(" "), /live clinical database within seconds/);
  assert.match(deferredTitle.errors.join(" "), /AWAITING DEPLOY/i, "the error must quote the offending phrase");
  assert.equal(
    evaluatePullRequestPolicy({
      title: "fix(db): restrict owner deletion on the four public-visibility tables",
      body: completeBody,
      headRef: "codex/migration",
      files: migrationFiles,
    }).ok,
    true,
    "the same migration PR without the deferral claim must pass",
  );
  // Choosing the merge moment is the real control and stays sayable.
  assert.equal(
    evaluatePullRequestPolicy({
      title: "fix(db): restrict owner deletion on the four public-visibility tables",
      body: completeBody.replace(
        "- Rollback: revert the workflow commit.",
        "- Rollback: revert in one commit. Merge only inside the approved deploy window; this applies to live on merge.",
      ),
      headRef: "codex/migration",
      files: migrationFiles,
    }).ok,
    true,
    "naming an approved merge window must not trip the deferral gate",
  );
  // A false deferral buried in the body is as misleading as one in the title.
  const deferredBody = evaluatePullRequestPolicy({
    title: "fix(db): restrict owner deletion on the four public-visibility tables",
    body: completeBody.replace(
      "- Rollback: revert the workflow commit.",
      "- Rollback: the migration is not yet applied to production, so there is nothing to roll back.",
    ),
    headRef: "codex/migration",
    files: migrationFiles,
  });
  assert.equal(deferredBody.ok, false, "a deferral claim in the body must block too");
  assert.match(deferredBody.errors.join(" "), /not yet applied/i);
  // Non-migration PRs are untouched: the phrase is only false where merging deploys.
  assert.equal(
    evaluatePullRequestPolicy({
      title: "docs: describe the deploy window — awaiting deploy of the new runbook",
      body: completeBody,
      headRef: "codex/docs",
      files: ["docs/database-drift-detection.md"],
    }).ok,
    true,
    "the deferral gate must apply only to PRs carrying a Supabase migration",
  );
  assert.equal(
    classifyPullRequestFiles(["supabase/schema.sql"]).migration,
    false,
    "schema.sql mirrors the schema and applies nothing; only supabase/migrations/** deploys",
  );
  assert.match(
    deployDeferralClaim("chore: pending deployment of the index", "").phrase.toLowerCase(),
    /^pending deployment/,
    "the detector must return the matched phrase for the error message",
  );
  // Behaviour table pinned in both directions. The `true` rows are claims that merging
  // does not honour; the `false` rows are statements this repository requires authors to
  // be able to make, and each one is a false positive a wider pattern would cause.
  for (const [text, expected, why] of [
    ["This migration will be deployed manually after merge.", true, "manual post-merge apply"],
    ["Deployment of the schema change is pending operator approval.", true, "subject between the words"],
    ["The owner foreign key migration will be applied out of band by the operator.", true, "out of band"],
    ["This migration is deployed after merge by the release owner.", true, "sequenced after the merge"],
    ["The migration is not yet applied to production.", true, "not yet applied"],
    ["Do not deploy the staging worker until its image passes smoke tests.", false, "not about the migration"],
    ["This migration is pending clinical governance approval before merge.", false, "approval sought BEFORE merge"],
    ["This migration applies to the live database within seconds of merge.", false, "the truthful wording"],
    ["Merge this migration only inside the approved deploy window.", false, "choosing when to merge"],
    ["The index was prebuilt by the operator; this migration validates it.", false, "operator prebuild workflow"],
  ]) {
    assert.equal(deployDeferralClaim("", text).claimed, expected, `${why}: ${text}`);
  }
  // Scoping is what makes the false-positive rows above hold at PR level too: a PR may
  // carry a migration AND a real constraint on something merging does not do.
  assert.equal(
    evaluatePullRequestPolicy({
      title: "fix(db): restrict owner deletion on the four public-visibility tables",
      body: completeBody.replace(
        "- Rollback: revert the workflow commit.",
        "- Rollback: revert in one commit.\n- Do not deploy the staging worker until its image passes smoke tests.",
      ),
      headRef: "codex/migration",
      files: migrationFiles,
    }).ok,
    true,
    "an unrelated deployment constraint must not block a migration PR",
  );
  // Hand-authored clinical datasets that live under `src/lib/` as `.ts` rather than under
  // `data/` as JSON. Pinned in both directions. The `true` rows are files whose entire diff
  // is clinical prose a clinician reads as fact, changing clinical output with no code change
  // at all — the `data/` rule's own rationale, applied where that rule cannot reach. The
  // `false` rows are the neighbours a wider `src/lib/` sweep would take with it, and each one
  // is a preflight this repository must not ask for: ticking clinical governance boxes on a
  // module that ships no clinical content is the habit that erodes the gate.
  //
  // `src/lib/differential-curated.ts` is absent on purpose: PR #2847 covers the whole
  // differential family under the owner ruling of 2026-09-17, so pinning it here would make
  // these two changes fight over the same rows.
  for (const [file, expected, why] of [
    ["src/lib/dictionary-data.ts", true, "dictionaryEntries carries authored definitions"],
    ["src/lib/factsheets-data.ts", true, "patient-facing factsheet prose"],
    ["src/lib/specifiers.ts", true, "specifierRecords carries authored specifier guidance"],
    ["src/lib/demo-data.ts", false, "the synthetic corpus, kept separate from real clinical content"],
    ["src/lib/specifier-builder-diagnoses.ts", false, "joins two datasets and authors no prose"],
    ["src/lib/dictionary.ts", false, "the loader beside the dataset: the anchor must not sweep it in"],
  ]) {
    assert.equal(classifyPullRequestFiles([file]).clinicalRisk, expected, `${why}: ${file}`);
  }
  assert.equal(
    classifyPullRequestFiles(["tests/calculator-mockup-clinical-safety.test.ts"]).clinicalRisk,
    true,
    "calculator mockup safety test must require clinical governance preflight (#97W4FD)",
  );
  migrationHistoryAndOwnerMergeSelfTest(completeBody);
  // The PR template no longer has to carry the seven governance items as unchecked boxes.
  // That assertion existed to keep the template in sync with a BLOCKING requirement; since
  // 2026-09-17 the preflight is advisory, so there is nothing left for it to pin — forcing
  // the checklist back into the template would restore exactly the paperwork this change
  // removed. `requiredClinicalGovernanceItems` is still exported and still used, by the
  // advisory warning above and by ci.yml's `sync-pr-policy-body` job.
  const workflow = readFileSync(new URL("../.github/workflows/pr-policy.yml", import.meta.url), "utf8");
  assert.match(
    workflow,
    /ref:\s*\$\{\{\s*github\.workflow_sha\s*\}\}/,
    "PR policy workflow must checkout github.workflow_sha for a deterministic trusted tree.",
  );
  assert.doesNotMatch(
    workflow,
    /ref:\s*\$\{\{\s*github\.base_ref\s*\}\}/,
    "PR policy workflow must not checkout the moving base branch ref.",
  );
  assert.doesNotMatch(
    workflow,
    /ref:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/,
    "PR policy workflow must not checkout a potentially stale pull_request.base.sha.",
  );
  console.error("[pr-policy] self-test passed");
}

// PR #2814's changed files, exactly as `gh api repos/BigSimmo/PsychSift/pulls/2814/files`
// listed them on 2026-09-17 (status, filename). It merged with three applied migrations
// modified in place, which is the incident the history guard exists for.
const pr2814FileStatuses = `modified .gitleaksignore
added docs/outstanding-issues-inbox/2eaa0a92-8764-4d7d-9a3b-6ffa1c4081a7.json
added docs/outstanding-issues-inbox/5366da08-1cf3-4cd3-91dd-d500d8e9b575.json
added docs/outstanding-issues-inbox/a5431811-3418-4ae7-8406-752d41f95bc8.json
added docs/outstanding-issues-inbox/ccf0e1fd-35e6-4f13-bfaa-07a2612a676e.json
added docs/outstanding-issues-inbox/e8065c36-f46c-4275-b67f-4de32a15341e.json
modified docs/scripts-index.md
modified docs/site-map.md
modified package.json
modified scripts/check-site-content-control-plane.mjs
added scripts/refresh-site-content-bootstrap.ts
modified src/data/source-acquisitions.json
modified src/lib/registry-records.ts
modified src/lib/service-governance.ts
added src/lib/services-canonical-data/part-03.ts
added src/lib/services-canonical-data/part-04.ts
added src/lib/services-canonical-data/part-05.ts
added src/lib/services-canonical-data/part-06.ts
added src/lib/services-canonical-data/part-07.ts
modified src/lib/site-content/site-content-health.ts
modified src/lib/sources/source-url-policy.ts
modified supabase/drift-manifest.json
modified supabase/migrations/20260824122000_add_site_content_release_and_outbox.sql
modified supabase/migrations/20260824123000_add_site_content_health_probe.sql
modified supabase/migrations/20260830121000_bind_site_content_release_transitions.sql
modified supabase/schema.sql
modified tests/fixtures/site-content/site-content-control-plane-correction.sql
modified tests/fixtures/site-content/site-content-health-state-machine.sql
modified tests/fixtures/site-content/site-content-legacy-transition-race-seed.sql
modified tests/fixtures/site-content/site-content-transition-backfill-seed.sql
modified tests/rag-answer-fallback.test.ts
modified tests/rag-governed-corpus-retrieval.test.ts
modified tests/rag-governed-entrypoint.test.ts
modified tests/rag-site-content-freshness.test.ts
modified tests/rag-site-content-retrieval.test.ts
modified tests/registry-client-contract.test.ts
modified tests/registry-governance-derivation.test.ts
modified tests/registry-service-facets.test.ts
modified tests/service-facets.test.ts
modified tests/services-catalog.test.ts
modified tests/services-safety-regressions.test.ts
modified tests/services-safety-routing.test.ts
modified tests/services.test.ts
modified tests/site-content-health.test.ts
modified tests/supabase-schema.test.ts`
  .split("\n")
  .map((line) => {
    const [status, filename] = line.trim().split(/\s+/);
    return { filename, status, previous_filename: null };
  });

function migrationHistoryAndOwnerMergeSelfTest(completeBody) {
  const base = ["20260824122000", "20260830121000", "20260916160000"];
  const applied = "supabase/migrations/20260824122000_add_site_content_release_and_outbox.sql";
  const newest = "supabase/migrations/20260916160000_triple_pin_retained_bootstrap_release_ids.sql";
  // A fixed clock keeps every dated case deterministic.
  const clock = new Date("2026-09-17T00:00:00Z");
  const kinds = (fileStatuses, versions = base, now = clock) =>
    migrationHistoryViolations({ files: fileStatuses, baseMigrationVersions: versions, now }).map((v) => v.kind);

  // Parsing: only top-level `<14 digits>_<name>.sql` entries carry a version.
  assert.equal(migrationVersion(applied), "20260824122000");
  assert.equal(migrationVersion("supabase/migrations/nested/20260824122000_x.sql"), null);
  assert.equal(migrationVersion("supabase/schema.sql"), null);
  assert.deepEqual(
    migrationVersionsFromEntries([
      "20260830121000_b.sql",
      "README.md",
      "20260824122000_a.sql",
      "2026082412200_short.sql",
    ]),
    ["20260824122000", "20260830121000"],
  );

  // --- Migration history guard -------------------------------------------------------
  assert.deepEqual(kinds([{ filename: applied, status: "modified" }]), ["modified"], "modified applied → error");
  assert.deepEqual(kinds([{ filename: applied, status: "changed" }]), ["modified"], "changed applied → error");
  assert.deepEqual(kinds([{ filename: applied, status: "removed" }]), ["removed"], "removed applied → error");
  assert.deepEqual(
    kinds([
      { filename: "supabase/migrations/20260917000000_renamed.sql", status: "renamed", previous_filename: applied },
    ]),
    ["renamed"],
    "renamed from an applied migration → error",
  );
  assert.deepEqual(
    kinds([{ filename: "supabase/archive/old.sql", status: "renamed", previous_filename: applied }]),
    ["renamed"],
    "renamed out of the migrations directory → error",
  );
  assert.deepEqual(
    kinds([{ filename: applied, status: "" }]),
    ["modified"],
    "an unknown status on an applied migration fails closed as a modification",
  );
  assert.deepEqual(
    kinds([{ filename: "supabase/migrations/20260901000000_backdated.sql", status: "added" }]),
    ["out-of-order"],
    "added older than the newest base version → error",
  );
  assert.deepEqual(
    kinds([{ filename: "supabase/migrations/20260830121000_same_version_new_name.sql", status: "added" }]),
    ["duplicate-version"],
    "added duplicate of an existing version → error",
  );
  assert.deepEqual(
    kinds([
      { filename: "supabase/migrations/20260917010000_one.sql", status: "added" },
      { filename: "supabase/migrations/20260917010000_two.sql", status: "added" },
    ]),
    ["duplicate-version", "duplicate-version"],
    "two added migrations sharing a version → error",
  );
  assert.deepEqual(
    kinds([{ filename: "supabase/migrations/20260917_short_version.sql", status: "added" }]),
    ["unversioned"],
    "an added migration without a 14-digit version cannot be ordered → error",
  );
  assert.deepEqual(
    kinds([
      { filename: "supabase/migrations/20260801000000_copied.sql", status: "copied", previous_filename: applied },
    ]),
    ["out-of-order"],
    "a copy is a new file and is ordered like one",
  );
  assert.deepEqual(
    kinds([{ filename: "supabase/migrations/20260917020000_newest.sql", status: "added" }]),
    [],
    "added newest migration → no error",
  );
  assert.deepEqual(
    kinds([
      { filename: "supabase/migrations/20260917020000_newest.sql", status: "added" },
      { filename: "supabase/schema.sql", status: "modified" },
      { filename: "supabase/drift-manifest.json", status: "modified" },
      { filename: newest, status: "unchanged" },
    ]),
    [],
    "the ordinary shape of a correct migration PR carries no history violation",
  );
  // Future-dated versions (limit #4): more than 2 days after the injected clock blocks.
  const added = (version) => [{ filename: `supabase/migrations/${version}_future.sql`, status: "added" }];
  assert.deepEqual(kinds(added("20260919000000")), [], "exactly 2 days ahead → allowed (clock skew tolerance)");
  assert.deepEqual(kinds(added("20260919000001")), ["future-dated"], "2 days and 1 second ahead → error");
  assert.deepEqual(kinds(added("29990101000000")), ["future-dated"], "far-future version → error");
  assert.deepEqual(
    kinds(added("20260919000001"), base, new Date("2026-09-18T00:00:00Z")),
    [],
    "the same version is fine once the clock has caught up — the check reads the injected clock",
  );
  assert.deepEqual(
    kinds([
      { filename: "docs/archive/20990101000000_moved.sql", status: "renamed", previous_filename: "docs/x.sql" },
      {
        filename: "supabase/migrations/20990101000000_moved_in.sql",
        status: "renamed",
        previous_filename: "docs/y.sql",
      },
    ]),
    ["future-dated"],
    "a migration renamed into the directory is dated like an added one; paths outside it are not",
  );
  assert.deepEqual(
    kinds(added("20260919000001"), base, new Date("not a date")),
    ["future-dated"],
    "an unusable clock fails closed",
  );
  const futureError = migrationHistoryViolations({
    files: added("29990101000000"),
    baseMigrationVersions: base,
    now: clock,
  })[0].message;
  assert.match(futureError, /future-dated migration would force every later migration after it/);
  assert.match(futureError, /2026-09-17T00:00:00\.000Z/);
  // Through evaluatePullRequestPolicy, with a version that is future ONLY relative to the
  // injected clock (it is in the past by the real clock), so dropping `now` is detectable.
  const clockedPr = (now) =>
    evaluatePullRequestPolicy({
      title: "feat(db): add a new migration",
      body: completeBody,
      headRef: "claude/db",
      files: ["supabase/migrations/20260301000000_future.sql"],
      fileStatuses: added("20260301000000"),
      baseMigrationVersions: ["20251201000000"],
      enforceMigrationHistory: true,
      now,
    });
  assert.equal(
    clockedPr(new Date("2026-01-01T00:00:00Z")).ok,
    false,
    "evaluatePullRequestPolicy threads its clock into the future-date check",
  );
  assert.equal(clockedPr(new Date("2026-03-01T00:00:00Z")).ok, true, "the same PR passes once the clock catches up");

  const historyError = migrationHistoryViolations({
    files: [{ filename: applied, status: "modified" }],
    baseMigrationVersions: base,
  })[0].message;
  assert.match(historyError, /Applied migrations never re-run on live/);
  assert.match(historyError, /NEW migration whose version is newer than 20260916160000/);

  const editApproved = `${completeBody}\n\nMigration history edit approved: repairing a no-statements history row per the guard-migration contract`;
  const guardPath = "supabase/migrations/20260917120000_validate_site_content_repair.sql";
  const guardSql = `set local statement_timeout = '30s';
set local lock_timeout = '5s';
do $migration$
begin
  raise exception 'site content repair objects missing';
end
$migration$;
`;
  const nonGuardSql = `create index if not exists site_content_oops on public.documents(id);`;
  const modifiedApplied = {
    title: "fix(db): adjust site content release outbox",
    headRef: "claude/db-edit",
    files: [applied, guardPath],
    fileStatuses: [
      { filename: applied, status: "modified", previous_filename: null },
      { filename: guardPath, status: "added", previous_filename: null },
    ],
    baseMigrationVersions: base,
    addedMigrationContents: { [guardPath]: guardSql },
    enforceMigrationHistory: true,
  };
  assert.equal(isValidationGuardSql(guardSql), true, "fixture guard SQL matches the validation predicate");
  assert.equal(isValidationGuardSql(nonGuardSql), false, "a CREATE INDEX migration is not a validation guard");
  // The override needs the body line AND a validation guard — no owner-approved label.
  assert.equal(
    evaluatePullRequestPolicy({ ...modifiedApplied, body: editApproved }).ok,
    true,
    "override line + validation guard → no error",
  );
  assert.equal(
    evaluatePullRequestPolicy({
      ...modifiedApplied,
      body: editApproved,
      addedMigrationContents: undefined,
    }).ok,
    false,
    "override without supplied migration contents fails closed",
  );
  assert.equal(
    evaluatePullRequestPolicy({
      ...modifiedApplied,
      body: editApproved,
      addedMigrationContents: { [guardPath]: nonGuardSql },
    }).ok,
    false,
    "override with a non-guard added migration still errors",
  );
  assert.equal(
    evaluatePullRequestPolicy({
      title: modifiedApplied.title,
      headRef: modifiedApplied.headRef,
      files: [applied],
      fileStatuses: [{ filename: applied, status: "modified", previous_filename: null }],
      baseMigrationVersions: base,
      enforceMigrationHistory: true,
      body: editApproved,
      addedMigrationContents: {},
    }).ok,
    false,
    "override without an accompanying added guard migration still errors",
  );
  const noOverride = evaluatePullRequestPolicy({ ...modifiedApplied, body: completeBody });
  assert.equal(noOverride.ok, false, "history edit without the override line → still error");
  assert.match(noOverride.errors.join(" "), /Applied migrations never re-run on live/);
  assert.equal(
    evaluatePullRequestPolicy({
      ...modifiedApplied,
      body: `${completeBody}\n\nMigration history edit approved: <reason>`,
    }).ok,
    false,
    "a placeholder reason does not satisfy the override",
  );
  assert.equal(
    evaluatePullRequestPolicy({
      ...modifiedApplied,
      body: `${completeBody}\n\n<!-- Migration history edit approved: copied from a template comment -->`,
    }).ok,
    false,
    "an override inside an HTML comment does not count",
  );
  // Fail closed: an enforcing caller that cannot supply history inputs is blocked.
  assert.match(
    evaluatePullRequestPolicy({
      ...modifiedApplied,
      body: editApproved,
      fileStatuses: undefined,
    }).errors.join(" "),
    /migration history could not be verified/,
  );
  assert.match(
    evaluatePullRequestPolicy({
      ...modifiedApplied,
      body: editApproved,
      baseMigrationVersions: [],
    }).errors.join(" "),
    /migration history could not be verified/,
  );

  requiredCheckForgerySelfTest(completeBody);

  // --- supabase/ PRs are no longer held for an owner label ---------------------------
  const database = {
    title: "feat(db): add a retrieval health view",
    body: completeBody,
    headRef: "claude/db-view",
    files: ["supabase/schema.sql"],
  };
  assert.equal(
    evaluatePullRequestPolicy({ ...database, enforceMigrationHistory: true }).ok,
    true,
    "database schema PR passes without an owner-approved label",
  );
  const clinical = {
    title: "fix: adjust clinical search tie-break",
    body: completeBody,
    headRef: "claude/clinical-fix",
    files: ["src/lib/answer-synthesis.ts"],
  };
  assert.equal(evaluatePullRequestPolicy({ ...clinical, enforceMigrationHistory: true }).ok, true);
  const docsPr = {
    title: "docs: explain the review process",
    body: completeBody,
    headRef: "claude/docs",
    files: ["docs/process-hardening.md"],
  };
  assert.equal(evaluatePullRequestPolicy({ ...docsPr, enforceMigrationHistory: true }).ok, true);

  // --- Replay: PR #2814 must fail on migration history ----
  const trustedVersions = migrationVersionsFromEntries(
    readdirSync(new URL("../supabase/migrations/", import.meta.url)),
  );
  for (const version of ["20260824122000", "20260824123000", "20260830121000"])
    assert.ok(trustedVersions.includes(version), `replay needs applied version ${version} on this tree`);
  const replay = {
    title: "Site content: services catalogue and control-plane correction",
    body: completeBody,
    headRef: "codex/site-content",
    files: pr2814FileStatuses.map((file) => file.filename),
    fileStatuses: pr2814FileStatuses,
    baseMigrationVersions: trustedVersions,
    enforceMigrationHistory: true,
  };
  const replayResult = evaluatePullRequestPolicy(replay);
  assert.equal(replayResult.ok, false, "PR #2814 replay must fail");
  assert.deepEqual(
    replayResult.migrationHistoryViolations.map((violation) => violation.version),
    ["20260824122000", "20260824123000", "20260830121000"],
  );
  assert.equal(replayResult.errors.filter((error) => /Applied migrations never re-run on live/.test(error)).length, 3);
  assert.doesNotMatch(replayResult.errors.join(" "), /Owner merge required/);

  // --- PR_POLICY_BODY.md must never land on main (transport file, see the comment above
  // prPolicyBodyTransportViolation) --------------------------------------------------------
  const addedPrPolicyBody = evaluatePullRequestPolicy({
    title: "docs: refresh the PR policy template",
    body: completeBody,
    headRef: "codex/pr-policy-body",
    files: ["PR_POLICY_BODY.md"],
    fileStatuses: [{ filename: "PR_POLICY_BODY.md", status: "added", previous_filename: null }],
  });
  assert.equal(addedPrPolicyBody.ok, false, "an added PR_POLICY_BODY.md must block");
  assert.match(addedPrPolicyBody.errors.join(" "), /PR_POLICY_BODY\.md is a transport file/);

  const modifiedPrPolicyBody = evaluatePullRequestPolicy({
    title: "docs: refresh the PR policy template",
    body: completeBody,
    headRef: "codex/pr-policy-body",
    files: ["PR_POLICY_BODY.md"],
    fileStatuses: [{ filename: "PR_POLICY_BODY.md", status: "modified", previous_filename: null }],
  });
  assert.equal(modifiedPrPolicyBody.ok, false, "a modified PR_POLICY_BODY.md must block");
  assert.match(modifiedPrPolicyBody.errors.join(" "), /PR_POLICY_BODY\.md is a transport file/);

  const removedPrPolicyBody = evaluatePullRequestPolicy({
    title: "chore: retire the PR policy transport file",
    body: completeBody,
    headRef: "codex/pr-policy-body",
    files: ["PR_POLICY_BODY.md"],
    fileStatuses: [{ filename: "PR_POLICY_BODY.md", status: "removed", previous_filename: null }],
  });
  assert.equal(removedPrPolicyBody.ok, true, "removing PR_POLICY_BODY.md must never block");
  assert.doesNotMatch(removedPrPolicyBody.errors.join(" "), /PR_POLICY_BODY/);

  const unrelatedPr = evaluatePullRequestPolicy({
    title: "docs: clarify the release checklist",
    body: completeBody,
    headRef: "codex/release-checklist",
    files: ["docs/process-hardening.md"],
    fileStatuses: [{ filename: "docs/process-hardening.md", status: "modified", previous_filename: null }],
  });
  assert.equal(unrelatedPr.ok, true, "a PR that never touches PR_POLICY_BODY.md must be unaffected");

  // Fallback path: fileStatuses absent, only a bare `files` list supplied (e.g. an older caller).
  assert.equal(
    prPolicyBodyTransportViolation({ files: ["PR_POLICY_BODY.md"] }),
    true,
    "the files-only fallback must still catch a present PR_POLICY_BODY.md",
  );
  assert.equal(
    prPolicyBodyTransportViolation({ files: ["docs/process-hardening.md"] }),
    false,
    "the files-only fallback must not flag an unrelated PR",
  );
}

function requiredCheckForgerySelfTest(completeBody) {
  // --- Workflow trigger parsing ------------------------------------------------------
  assert.deepEqual(workflowTriggers("on:\n  pull_request_target:\n    types: [opened]\n  merge_group:\n"), [
    "pull_request_target",
    "merge_group",
  ]);
  assert.deepEqual(workflowTriggers("on: [push, pull_request]\n"), ["push", "pull_request"]);
  assert.deepEqual(workflowTriggers('"on": pull_request_target\n'), ["pull_request_target"]);
  assert.equal(workflowTriggers("name: x\njobs:\n  a:\n"), null, "no on: key → unreadable");

  // --- Required-check forgery tripwire -----------------------------------------------
  const forge = (path, content) =>
    requiredCheckForgeryFindings({ files: [path], workflowContents: { [path]: content } });
  const branchWorkflow = (body) => `name: CI\non:\n  pull_request:\n    branches: [main]\n  push:\njobs:\n${body}`;
  assert.equal(
    forge(".github/workflows/ci.yml", branchWorkflow("  fake:\n    name: PR policy\n    runs-on: ubuntu-24.04\n"))
      .length,
    1,
    "a pull_request job named PR policy is flagged",
  );
  assert.equal(
    forge(".github/workflows/ci.yml", branchWorkflow('  fake:\n    name: "Owner approval"\n')).length,
    0,
    "Owner approval is no longer a protected required context",
  );
  assert.equal(
    forge(
      ".github/workflows/ci.yml",
      branchWorkflow("  s:\n    steps:\n      - run: gh api repos/o/r/statuses/abc -f context='x'\n"),
    ).length,
    1,
    "a statuses API write from branch code is flagged",
  );
  assert.equal(
    forge(".github/workflows/ci.yml", `permissions: write-all\n${branchWorkflow("  a:\n")}`).length,
    1,
    "write-all grants statuses: write and is flagged",
  );
  assert.equal(
    forge(".github/workflows/ci.yml", branchWorkflow("  sync:\n    name: Sync PR policy body\n")).length,
    0,
    "a name that merely contains the words is not a protected context",
  );
  assert.equal(
    forge(
      ".github/workflows/pr-policy.yml",
      "on:\n  pull_request_target:\n  merge_group:\npermissions:\n  contents: read\njobs:\n  policy:\n    name: PR policy\n",
    ).length,
    0,
    "a workflow that only runs the default-branch copy is inert until merged",
  );
  assert.equal(
    forge(
      ".github/workflows/pr-policy.yml",
      "on:\n  pull_request_target:\n  pull_request:\njobs:\n  policy:\n    name: PR policy\n",
    ).length,
    1,
    "adding a branch-executed trigger to pr-policy.yml is flagged",
  );
  assert.equal(
    forge(".github/workflows/odd.yml", "jobs:\n  a:\n    name: PR policy\n").length,
    1,
    "unreadable triggers fail closed to branch-executable",
  );
  assert.equal(
    forge(".github/actions/setup/action.yml", "runs:\n  steps:\n    - run: curl -X POST $API/statuses/$SHA\n").length,
    1,
    "a composite action is always treated as branch code",
  );
  assert.equal(forge("docs/ci.md", "name: PR policy").length, 0, "non-workflow paths are out of scope");
  assert.match(
    requiredCheckForgeryFindings({ files: [".github/workflows/ci.yml"], workflowContents: {} }).join(" "),
    /could not be read/,
    "a changed workflow with unread content fails closed",
  );

  const workflowPr = {
    title: "ci: add a helper job to the pipeline",
    body: completeBody,
    headRef: "claude/ci-helper",
    files: [".github/workflows/ci.yml"],
    fileStatuses: [{ filename: ".github/workflows/ci.yml", status: "modified", previous_filename: null }],
  };
  assert.equal(evaluatePullRequestPolicy(workflowPr).ok, true, "no changedWorkflowContents → tripwire not run");
  const forged = evaluatePullRequestPolicy({
    ...workflowPr,
    changedWorkflowContents: { ".github/workflows/ci.yml": branchWorkflow("  fake:\n    name: PR policy\n") },
  });
  assert.equal(forged.ok, false, "a forging workflow fails PR policy");
  assert.match(forged.errors.join(" "), /names a required check/);
  assert.equal(
    evaluatePullRequestPolicy({
      ...workflowPr,
      fileStatuses: [{ filename: ".github/workflows/ci.yml", status: "removed", previous_filename: null }],
      changedWorkflowContents: {},
    }).ok,
    true,
    "a removed workflow cannot run and needs no content",
  );

  // Merge queue: a PR checked against an older main is re-based onto whatever merged ahead of
  // it and never re-synced. Its migration must be rejected if it is no longer the newest.
  const queued = [{ filename: "supabase/migrations/20260901000000_queued.sql", status: "added" }];
  const queueClock = new Date("2026-09-02T00:00:00Z");
  assert.deepEqual(
    migrationHistoryVerdict({ fileStatuses: queued, baseMigrationVersions: ["20260801000000"], now: queueClock })
      .errors,
    [],
    "a queued migration newer than its base passes",
  );
  const overtaken = migrationHistoryVerdict({
    fileStatuses: queued,
    baseMigrationVersions: ["20260801000000", "20260901120000"],
    now: queueClock,
  });
  assert.deepEqual(
    overtaken.violations.map((violation) => violation.kind),
    ["out-of-order"],
    "a migration that merged ahead in the queue makes the queued one out of order",
  );
  assert.equal(overtaken.errors.length, 1, "an overtaken queued migration blocks the queue entry");
  assert.equal(
    migrationHistoryVerdict({
      fileStatuses: queued,
      baseMigrationVersions: ["20260801000000", "20260901120000"],
      body: "Migration history edit approved: <reason>",
      now: queueClock,
    }).errors.length > 1,
    true,
    "a placeholder approval does not excuse an overtaken queued migration",
  );
  assert.equal(
    mergeGroupPullRequestNumber("refs/heads/gh-readonly-queue/main/pr-3013-9559961465444c0cd72ddbcf199ee41a201eb734"),
    3013,
  );
  assert.equal(mergeGroupPullRequestNumber("gh-readonly-queue/release/2026-09/pr-7-abcdef1"), 7);
  assert.equal(mergeGroupPullRequestNumber("refs/heads/main"), null, "a non-queue ref has no PR number");
  assert.equal(mergeGroupPullRequestNumber(undefined), null);
}

if (isDirectEntrypoint(import.meta.url)) {
  if (process.argv.includes("--self-test")) selfTest();
  else {
    console.error("usage: pr-policy.mjs --self-test");
    process.exitCode = 1;
  }
}
