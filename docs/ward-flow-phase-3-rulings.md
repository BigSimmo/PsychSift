# Ward Flow Phase 3 — every decision made on the product owner's behalf

**73 rulings**, made across three sessions while executing the 12-task plan. Each was a judgement
the plan did not settle, made rather than waiting, and recorded with what it costs if wrong.

Full text of every one is in `docs/ward-flow-phase-3-ledger.md` (rulings `P1`–`P3`, `F1`–`F23`,
`R24`–`R67`; those numbered `R34`, `R36a`, `R38`–`R40`, `R44` and `R67` live in the task addenda
under `docs/ward-flow-phase-3-workspace/`). This file is the map: what was decided, why it mattered,
and which ones a clinician should look at.

---

## 1. The eleven that changed what the software says to a clinician

These are the ones worth a product owner's attention. Everything else is engineering.

| #           | Decision                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                             | Cost if wrong                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F15/F23** | Deleted the fabricated Form 3B statutory deadline; kept the four-hour figure, correctly renamed as the **emergency department access target** measured up from `openedAt`.     | Seven surfaces were rendering `examination.at + 240` as statutory timing and counting it as a legal breach. **No such deadline exists in the Mental Health Act.** The clinician confirmed it: "It is just counting how long they have been in ED determining priority. So counting up."                                                                                                                         | If a real post-examination timeframe exists, it returns as an optional field plus one derivation. The readers' absence-handling stays correct either way. |
| **F8**      | The referral control stops advertising an action it cannot perform; the confirmation is derived from the movement's own state; refusals surface with the reducer's own reason. | The screen reported a successful referral while the reducer had refused it — on **nine of eighteen** hand-authored movements. The phase's most consequential defect.                                                                                                                                                                                                                                            | More surface area changed in one round than the finding strictly required.                                                                                |
| **R36**     | The flow diagram now raises the **voluntary-patient-on-a-locked-ward** warning, not just the milder "more restrictive than required".                                          | An earlier ruling claimed all voluntary movements were also open-security, so the diagram was merely less specific. **That claim was never measured and was false** — 4 of 26 are secure, each shortlisting three locked wards. The diagram was **silent** on the sharpest clinical warning in the system for twelve real pairs.                                                                                | The diagram gains a second badge state and one test.                                                                                                      |
| **F9**      | A voluntary patient on a locked ward gets its own, more prominent flag, distinct from "more restrictive than required".                                                        | The product owner's own ruling: a voluntary person who cannot leave a locked ward is detained in fact without an order. It prompts a review of legal status and never blocks placement.                                                                                                                                                                                                                         | The diagram stays blunter than the shortlist on data where the two rarely disagree.                                                                       |
| **R58**     | Six patients recorded at stage `moving` with no collection were given the collection their stage implies.                                                                      | `PATIENT_COLLECTED` is the only producer of stage `moving` and always sets `collectedAt`, so the state was unreachable — and clinically impossible: nobody is in a vehicle that never picked them up. **Six of eight jobs on the transport officer's phone had four dead controls each.** Afterwards: 8 of 8 workable.                                                                                          | Six fixture timestamps shift and derived baselines move with them.                                                                                        |
| **R63/R64** | Five patients recorded "ready for handover" were moved back to a stage their own data supports — **four had never been accepted by any ward.**                                 | Same defect class, found by looking at a screenshot: the ED screen read "Handover ready … transport not yet requested", which the model forbids. Corrected the **stage** rather than inventing acceptances that never happened.                                                                                                                                                                                 | The board's stage distribution shifts; some screens show fewer late-stage patients.                                                                       |
| **R65 (a)** | The emergency-department access target raised from **4 hours to 24**.                                                                                                          | Direct instruction from the clinician. Mental health patients breach four hours so routinely that it stops discriminating; 24 hours separates a bad day from a genuine outlier.                                                                                                                                                                                                                                 | One constant on one screen.                                                                                                                               |
| **R65 (b)** | A patient **confirmed to need a bed** now outranks one nobody has assessed — a 25-point "Bed need confirmed" factor.                                                           | The clinician: "the reality is in ED that a patient needs review before they are referred for a bed as they may not need a bed." Before, an unassessed patient led the queue; now the two examined patients do.                                                                                                                                                                                                 | Examined patients rank slightly too high or low **within their own urgency tier**. One number.                                                            |
| **R65 (c)** | Did **not** gate referral on examination.                                                                                                                                      | Measured: only **2 of 17** referable patients are examined, and **23 more** already past that stage are not. Gating would make most of the fixture unreachable. Also, **21 of 41 open movements are voluntary** and never receive a Mental Health Act examination, so the model cannot evidence their review at all. **Left with the product owner, documented in code as a KNOWN GAP with no invented proxy.** | If the strict rule was meant, the priority change is still correct and additive; the gate lands as a follow-up.                                           |
| **R67**     | The end-to-end journey now **opens with the examination**.                                                                                                                     | Makes the proof demonstrate the clinician's own rule instead of quietly contradicting it, and exercises `RECORD_EXAMINATION` from a real control for the first time.                                                                                                                                                                                                                                            | The journey is one step longer.                                                                                                                           |
| **F5/R17**  | Every Form 3B deadline derives from its own examination rather than being invented; the queue's breach assertion is satisfied by a genuine Form 1A breach.                     | A patient examined by the reducer would have got a derived deadline and a patient examined in the fixture an invented one, and the ED screen would have rendered both as if they meant the same thing.                                                                                                                                                                                                          | Three examined patients' deadlines shift.                                                                                                                 |

**Side effect worth knowing:** the priority change retired a separate concern. The demo used to open on
`WF-303`, a generated patient whose breach came from an index-derived formula rather than from anything
anyone authored. It now opens on a real, deliberately written case.

---

## 2. The recurring defect, and the eight rulings spent on it

One defect class has appeared in **every phase in a different disguise**: _a check that claims more
than it delivers, because it then stops anyone looking harder._

| #   | The overclaim                                                                                                                                                                                                              | How it was found                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| F12 | A clock guard scoped by co-occurrence — helper indirection, namespace imports and any component outside the rule all walked past.                                                                                          | A reviewer added a helper and watched the guard stay green.                                        |
| F18 | The rebuilt guard walked **one directory** while its name claimed the whole rule.                                                                                                                                          | Probed with a file one directory out.                                                              |
| F20 | A hand-rolled scanner with no concept of a regex literal — a quote inside a regex blinded it to the rest of the file. Two real files carried exactly that pattern.                                                         | Appended a plain import to one of them; the guard stayed green.                                    |
| R28 | The access-target quarantine is file-scoped and misses helper indirection, intermediate locals and spreads — **weakest exactly where its one real consumer would exercise it**.                                            | Named honestly and enforcement moved into the brief and review of the task that would exercise it. |
| R50 | A scroll assertion comparing `window.scrollY` before and after — on a screen that is `100dvh` with `overflow: hidden` and **has no scroll range at all**. Zero equals zero, forever.                                       | An implementer disclosed that its own mutation survived.                                           |
| R59 | A horizontal-overflow assertion that cannot fail, because a site-wide `overflow-x: clip` guarantees it.                                                                                                                    | An implementer disclosed it and diagnosed why rather than reformulating.                           |
| R60 | A vacuity tripwire counting **loop iterations instead of matches** — so its companion assertion ran on zero records and passed regardless.                                                                                 | Found by reading the diff, in a guard written to prevent exactly this.                             |
| R63 | The fixture-coherence invariant was derived from **a list the controller wrote**, not from the reducer's complete set of stage-producing transitions — so it caught the instance and missed the class, for the third time. | A second, larger instance surfaced on a screenshot.                                                |

**The practice that follows, and it earned its place:** mutation-test every test; print the edited
line back from the file before trusting the run; re-run every subagent's gates independently; read
counts rather than the word "passed".

**Nine implementers volunteered a surviving mutation this session.** Two were genuinely untestable
assertions; seven were mistimed mutations correctly diagnosed. _A mistimed mutation and an
untestable assertion look identical from outside — only the diagnosis separates them._

---

## 3. Unmeasured claims — six, three of them the controller's own

R37, sharpened twice, exists because fixture claims kept being asserted without measurement:

- **F9** — "all six voluntary movements are open-security". There are 26, and 4 are secure.
- The Task 6A implementer's report asserted a ranking it had never computed.
- **The controller's** `index % 7` mis-attribution of a generated patient's breach.
- **The controller's** recommendation of `WF-009` as the journey subject — referable, and already
  declined by all five secure units, so unreferrable for a second reason. Caught by an agent.
- **The controller's** escort-required count: the probe filtered on _the field existing_, not on what
  it said. 5 true, 3 false — and the error was made while writing the document that records the rule
  against it.
- WF-308 as a diagram-fix subject — qualified on the raw count, but older-adult with no eligible
  secure candidate. Caught by an agent.

**The rule, in its final form:** measure every property the claim depends on, not the one that
prompted it — and read the probe back to check what it actually filtered on.

---

## 4. Process and environment — decided, not asked

- **R31/R32/R33** — a hand-written fix to the push guard was **written and then reverted**, because a
  mutation reintroducing the supposed bug failed no test. The mechanism was unproven and the fix was
  untestable against it. Shipping it would have been a guard that claims more than it delivers,
  committed in the same session that documented the rule against them.
- **R35** — `origin/main` merges **after** the phase. 568 commits behind, 33 conflicting files, mostly
  a squash-merge artefact of this branch's own earlier work. The user's decision.
- **R43/R47** — a second session was found live in this worktree. Not interfered with; collision
  defences adopted instead. This repo's memory records a cleanup sweep destroying an in-use worktree
  twice.
- **R55** — **no Ward Flow browser spec has ever run in CI's Production UI lane.** The shard script
  holds its own copy of the spec pattern with no ward alternation, and the test whose job is to catch
  that drift has been failing rather than being fixed. Pre-existing on `main`; surfaced, not fixed,
  because correcting it needs hosted timing measurements unavailable from this machine.
- **R61** — the dev server is reaped when the shell that launched it exits. The symptom is a
  Playwright guard failing with a Node connection error **while `curl` to the same URL succeeds** —
  which reads exactly like an IPv6 mismatch and is not one.
- **R54** — a push succeeded with its own static gate **not run**, under lock contention from another
  worktree. Accepted, because the property was independently satisfied minutes earlier — but recorded,
  because reading the exit code would have called it green.

---

## 5. Still open with the product owner

1. **Is 24 hours right?** Now implemented on his instruction, replacing four.
2. **Does the Form 1A countdown stay a countdown?** His answer was scoped to the post-examination
   case; the pre-examination window is still modelled as a deadline.
3. **Should referral be _gated_ on review, not merely weighted?** Measured cost above. Needs a general
   notion of "reviewed" that covers voluntary patients, which the model does not have.
4. **Voluntary patients cannot evidence review at all** — the KNOWN GAP left in the code. Closing it
   is the same work as question 3.
