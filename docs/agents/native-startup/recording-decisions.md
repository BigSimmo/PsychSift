# When the owner makes a decision

_Updated 2026-10-15 — first version: one procedure so a decision reaches every tool and no file keeps the old wording; Knowledge owns._

The owner decides things in many places: a chat with any AI tool, a pull request comment, an issue,
a project thread. Only the repository reaches every tool (Claude, Codex, Cursor, Antigravity, Gemini
and the review bots). A decision that lives only in a chat, or in one tool's memory, is invisible to
the others, and the files that still state the old rule keep steering them. So a decision is not
recorded until it is in the repository, and it is not finished until no live file still says the
opposite.

## The procedure

Do this in the same pull request as the work the decision changes. When there is no work yet, open
a small pull request that only records the decision.

1. **Change the one place that governs it.** Every rule has one home: a section of `AGENTS.md`, a
   file under `docs/agents/`, a doc, a ledger row, or the code itself. Find it through the existing
   [decisions index](../../decisions/README.md) entry or the [organisation map](../../organisation/README.md).
   Do not add a second copy anywhere. Other files link to the home; they never restate it.
2. **Find and fix every other copy of the old wording.** Search for the old phrase across the
   repository, for example `git grep -n -i "<old phrase>"`, and either correct each live hit or
   replace it with a link to the home. Leave dated history alone (`docs/archive/`, `docs/audit/`,
   `docs/investigations/`, branch review records, and older decision entries): it records what was
   true then.
3. **Retire a dropped or reversed rule.** Add an entry to
   [`docs/organisation/retired-rules.json`](../../organisation/retired-rules.json) with a `pattern`
   for the old wording, an `allowedContext` for wording that records the retirement, and a
   `decision` pointing at the new decisions entry. From then on `npm run check:instructions` fails
   any pull request that adds the old rule back to an instruction file or orientation doc, in every
   tool's files at once.
4. **Add the decisions index entry** in the format the [decisions README](../../decisions/README.md)
   gives. Two additions:
   - When the owner gave the decision in chat and no repository file records it yet, cite
     `- **Source:** the owner, in chat`. The entry is then the record until the work lands; point it
     at the real source in the pull request that does the work.
   - When it retires a rule, add ``- **Retires:** `<rule id>` ``. When it replaces an earlier decision,
     append `; superseded by <new file name>` to the old entry's Status line.
5. **Run the checks:** `npm run check:decisions` and `npm run check:instructions`. Both are offline
   and both run in CI.

## Memory is not the record

Tool memories (Claude project memory, Codex memory, Supermemory, chat history) may repeat a decision
for convenience, but they reach only the tool that holds them. The repository entry is the
authority. When a memory and the repository differ, the repository wins and the memory should be
corrected. Before acting on something you remember the owner deciding, look for its entry under
`docs/decisions/`. If there is none, the decision is unrecorded: record it with the owner's words, or
ask when you are not sure of them.

## Limits

- Recording a decision never authorises an action the rules still gate. A migration, a ranking file,
  `sw.js` or a provider call still needs the owner's named yes, whatever the decision says.
- The retired-rules check matches wording, not meaning. A paraphrase of a dropped rule passes it, so
  step 2 is still a real search, not a formality.
- The decisions check proves that entries are well formed and that their links resolve. It never
  proves a summary is right.
