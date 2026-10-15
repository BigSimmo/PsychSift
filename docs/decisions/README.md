# Decisions

_Updated 2026-10-15 — chat-given decisions, Retires links and link checks added; Knowledge owns._

This folder is the one place to look for what the owner has decided. Each decision gets one short
file that says what was decided, when, and exactly where the repository records it.

**This is an index, not a new home for the text.** Every entry points at its source and quotes a
phrase to find it by; the source stays where it is and stays the authority. That is deliberate:
several `AGENTS.md` sections are read word for word by gates, the issue ledger's rows may only
change through its own reconcile step, and code comments sit beside the code they govern. Moving
any of that text here would break a check or separate a rule from what it controls. So every
entry ends with the same sentence: _If this summary and the source ever differ, the source wins._

## What is in here

- **Index entries**, one per decision, named `YYYY-MM-DD-<slug>.md`. The date comes first so the
  folder lists in time order, and there are no sequence numbers, so two pull requests adding
  decisions at the same time never collide.
- **Full decision records** that carry their own analysis, kept under their own names, such as
  [`ccz4hb-review-coverage.md`](ccz4hb-review-coverage.md). An index entry points at the rule
  such a record produced; the record keeps the reasoning.

Decisions are indexed once they are written down in this repository, or when the owner gives them in
chat (see "A decision given in chat" below). The written sources are the rules layer, the docs, the
issue ledger and its inbox, and code comments. Three kinds are left out on purpose:

- one-off approvals of a single action, such as one provider run or one migration apply (the older
  ones are in [`../archive/operator-decisions-2026-07-04.md`](../archive/operator-decisions-2026-07-04.md)
  and [`../archive/operator-decisions-2026-07-06.md`](../archive/operator-decisions-2026-07-06.md));
- questions still waiting for a decision, which live in [`../outstanding-issues.md`](../outstanding-issues.md)
  until the owner answers;
- Ward Flow and Caring Contacts, which were retired and removed from the project (see
  [`2026-09-26-remove-ward-flow-and-caring-contacts.md`](2026-09-26-remove-ward-flow-and-caring-contacts.md)).

Related records that are not owner rulings: architecture decision records in [`../adr/`](../adr/),
and the design-engineering log in [`../redesign/03-decision-log.md`](../redesign/03-decision-log.md).

## The entry format

```markdown
# Decision: <what was decided, as a short title>

- **Status:** decided YYYY-MM-DD
- **Source:** `<repository-relative path>`, find "<a short phrase copied exactly from the source>"

<The decision in one or two plain sentences.>

If this summary and the source ever differ, the source wins.
```

- **Date.** The date the decision was made. When the source gives none, use the date it was first
  written into the repository and add `(the source gives no date; this is when it was first recorded)`
  after the date. The date in the file name and the Status line must match.
- **Source.** A path from the repository root, and a phrase copied from that file. Pick a phrase
  that sits on one line of the source, with no double quotes or backticks in it. A pending issue
  inbox request may be cited by its pending path; it is found automatically once reconciled into
  `applied/`.
- **Summary.** Plain words, for a reader who has not seen the source. Say "the owner", as the rest of
  the repository does. Leave out anything the source does not support.
- **A decision given in chat.** When the owner decided in a conversation and no repository file
  records it yet, write `- **Source:** the owner, in chat` instead of a path and phrase. The entry
  is then the only record, so keep the summary to what the owner actually said. Point it at the real
  source in the pull request that does the work.
- **Retires** (optional). When the decision drops or reverses a rule, add
  ``- **Retires:** `<rule id>` `` naming its entry in
  [`../organisation/retired-rules.json`](../organisation/retired-rules.json), and give that rule a
  `decision` field pointing back at this entry.

## Adding or changing a decision

The whole procedure, including finding and fixing every other file that still states the old rule,
is in [When the owner makes a decision](../agents/native-startup/recording-decisions.md). In short:

1. Record the decision where it belongs first: the rule, doc, ledger row or code it governs.
2. Fix or link every other live copy of the old wording, and add a retired rule when one is dropped.
3. Add one file here in the format above, named for the decision's date and a short slug.
4. Run `npm run check:decisions` and `npm run check:instructions`. The first prints `0 errors` when
   every entry is well formed and its links resolve, warns when a source has moved or its phrase is
   no longer found, and lists the entries still cited from chat.
5. When a decision is replaced, add a new entry for the new decision, and append
   `; superseded by <new file name>` to the old entry's Status line. Do not delete the old entry.

## What the check does and does not do

`node scripts/organisation/decisions.mjs` (tested by `tests/organisation-decisions.test.ts`) fails
only when an entry is malformed (a bad file name, a missing field, or a date that disagrees with
its name) or a link is broken (a `superseded by` file, a `Retires` id, or a retired rule's
`decision` that does not exist). A source that has moved, or a phrase that is no longer found, is a **warning**, never a
failure, because the sources are ordinary documents other work edits and moves. Fix a warning by
re-reading the source and updating the entry.

It never checks that a summary is right. A passing check means each entry is well formed and, where
there are no warnings, that its phrase can still be found. It is not a review of the decision.
