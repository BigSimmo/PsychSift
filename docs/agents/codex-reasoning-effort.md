# Codex Reasoning Effort Calibration

<!-- BEGIN:reasoning-effort-calibration -->

# Reasoning effort calibration

**Picker ownership.** Model and reasoning effort are user/task choices. Do not set `model` or
`model_reasoning_effort` in the repository `.codex/config.toml`: repository defaults override the
Desktop picker and make new tasks snap back after an update. Use the model and effort selected for
the task. For child-agent model and effort choices, apply
[smart agent allocation](smart-agent-allocation.md) automatically whenever agents are used.
Its routes are starting points; the risk calibration and required effort floors below still apply.
It does not change the running main-chat model or reasoning effort.

**Cloud reasoning effort and plain-language confirmation.** A running Cloud task cannot inspect or
raise its own reasoning effort at runtime, and `.codex/config.toml` intentionally does not force a
model or reasoning setting.
The former Cloud prompt-marker and prompt-resubmission gate was retired on 2026-10-16:
there is no special token requirement for ordinary or high-risk chat requests, and agents must no longer ask the user to resubmit a prompt with a confirmation tag.
When a request touches the high-consequence surfaces in the table below (architecture, Supabase
migrations/RLS, RAG ranking surfaces, auth/privacy, or ingestion contracts), `xhigh` remains the
recommended planning effort. Plain-language confirmation from the user (or an explicit instruction
to proceed) suffices; accept it at face value without repeating a gate prompt or claiming to verify
the runtime picker. Only if a high-consequence Cloud planning task starts with no indication of
reasoning preference and material uncertainty remains, mention the `xhigh` recommendation once and
accept a plain-language reply.

Reasoning effort is a budget in the same way verification is a budget, and it is misspent the same
way — by defaulting to the maximum instead of matching the spend to the risk. **Scale effort to how
expensive the mistake is to undo (irreversibility × branching factor), never to the phase label.**
"Plan high, build lower" is a good default, not a rule; it is wrong often enough that it must be
chosen deliberately rather than assumed.

**Why it is a good default.** Planning errors compound and implementation errors stay local: a wrong
approach throws away the build, a wrong identifier is one edit. A plan is also a few thousand output
tokens against a build's many long turns, so effort is cheapest exactly where it has the most leverage.

**The mechanism that makes it work — do not skip this part.** A lower-effort build only succeeds
against a plan concrete enough to execute: named files, named symbols, ordered steps, and the gate
that will prove it. Downgrading the build against a vague plan does not save effort, it relocates the
thinking into the expensive phase. If the plan cannot name those things, the build is not eligible for
the downgrade.

| Situation                                                                                      | Plan        | Build       |
| ---------------------------------------------------------------------------------------------- | ----------- | ----------- |
| Architecture, Supabase migrations/RLS, RAG ranking surfaces, auth/privacy, ingestion contracts | xhigh       | high        |
| Ordinary feature or UI work with a clear shape                                                 | high        | medium–high |
| Mechanical and fully specified — ledger append, docs edit, rename (not dependency maintenance) | low or skip | medium      |
| Debugging an unknown failure                                                                   | low         | high        |

**Where the default inverts and the build needs more than the plan.** These are plan-light and
execution-heavy; treating them as plan-heavy spends the budget in the wrong place:

- **Debugging.** The plan is "find why X fails." The real reasoning is hypothesis-forming over local
  runtime, logs, and repro state during the build — hosted providers still need explicit confirmation.
- **Constraint-dense implementation.** A one-sentence plan whose edit must simultaneously satisfy
  button wiring, design tokens, the one-composer rule, unlayered CSS, and the tap-target and
  phone-chrome contracts. Holding all of it at once is the hard part, not deciding what to do.
- **Areas where training data is stale.** Next 16 is the standing case. Effort does not repair a wrong
  prior — reading `node_modules/next/dist/docs/` does. Raising effort instead of reading is itself the
  failure mode.

**Constrain xhigh planning output, not just its effort.** Extra-high planning over-produces:
alternatives, contingency branches, and surveys that are never used, paid for twice — once generating
and once reading. Ask for the chosen approach, the files, and the gate, not a survey.

**State the split before non-trivial planning work.** One line before starting: plan effort, build
effort, and the risk that justifies them. It is cheap, it makes a wrong allocation visible while it is
still free to change, and it stops the blanket default from being applied silently.

<!-- END:reasoning-effort-calibration -->
