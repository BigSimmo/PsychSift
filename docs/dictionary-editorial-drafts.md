# Dictionary editorial drafts

The 2026-09 PsychSift Dictionary + Sources handover added 333 abbreviation senses, 96 reviews of
existing definitions and 58 source records. None of it is published. This document says where it
lives, why it is held back, and what has to happen before any of it reaches a reader.

## Why there are two dictionaries

The published dictionary in `src/lib/dictionary-data.ts` is **term-first**: one entry per concept,
with abbreviations hanging off it as aliases. The handover is **sense-first**: one record per
_meaning_ of a token, so `BD` is two records rather than one entry with an ambiguous alias.

That difference is the reason the two are not merged. `BD` meaning bipolar disorder and `BD` meaning
twice a day are not one thing with two names, and a term-first model cannot hold both without
choosing one — which is exactly the collision the corpus exists to warn about. Folding the drafts
into the published entries would lose the distinction that makes them worth having.

| Layer              | File                                           | State                                                 |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------- |
| Sense drafts       | `src/data/dictionary-sense-drafts.json`        | 333 records, all pending approval                     |
| Definition reviews | `src/data/dictionary-definition-reviews.json`  | 96 verdicts, 28 with proposed wording, none applied   |
| Source outcomes    | `src/data/dictionary-source-dispositions.json` | 58 records: 26 admitted as ledger candidates, 32 held |

The typed readers are in `src/lib/dictionary-editorial/`. Re-import with
`node scripts/import-dictionary-handover.mjs --package <dir>`; `--check` proves the committed files
still match the package.

## Nothing here is clinically approved

Every draft carries `clinicalApproval: "pending"` and `publicationAllowed: false`.
`assertNoDraftIsPublished` throws if that ever stops being true, and
`tests/dictionary-sense-drafts.test.ts` runs it.

Promotion into the published dictionary is a per-record decision by a named clinician. It is not a
data migration and there is no bulk path for it, deliberately.

## What the evidence actually covers

This is the finding that should govern how much weight the corpus carries:

- **206 of 1,881 statements have a source attached.** The other 1,645 are marked `unverified`
  upstream.
- **None of the 292 safety warnings has a source.** They read as authoritative and are not.
- `expansion` is the best-covered field at 146 of 333. `context`, `jurisdiction`, `meaning` and
  `availability` have **no** source coverage at all.
- `name_checked` on a sense means the token and its expansion were checked against the cited source.
  It says nothing about the clinical prose around them.

An empty evidence list is not proof that no source exists — it means nobody has looked. Per-statement
outcomes are in `docs/audit/dictionary-handover-2026-09-16/field-resolutions.jsonl`.

## The ambiguity rule

Nine tokens carry more than one governed meaning: `ACT`, `BD`, `OST`, `OT`, `SA`, `SAD`, `SCI`,
`SSRI`, `SW`.

`dictionarySenseCollisions` computes these over the **whole** corpus, never a filtered view. A reader
who has filtered to "Medicines notation" and sees only `BD — twice a day` must still be told that
`BD` means bipolar disorder elsewhere, because the note they are reading was not written under their
filter. A filter that hides a collision makes an ambiguous abbreviation look settled, which is the
failure mode the whole corpus exists to prevent.

`dictionarySenseDraftIssues` re-derives the groups from the data rather than trusting the handover's
list, so a token that gains a second meaning cannot quietly escape the rule.

## Token normalisation keeps punctuation

`normalizeSenseToken` flattens case and spacing and nothing else. An earlier version stripped
punctuation and merged `K10` with `K10+` — two different Kessler instruments, one with supplementary
questions. `ACE-III` is likewise not `ACEIII`. Reader-facing search may be more forgiving than this;
identity may not.

Numeric-leading tokens (`4AT`, `15L`) file under a single `#` bucket in an A–Z index rather than
per-digit buckets.

## Definition reviews are reconciled, and applied only after owner approval

Each review records the wording it was written against and a SHA-256 of it.
`reconcileDefinitionReviews` compares that hash to the live entry and returns one of five outcomes:

- `actionable` — baseline matches, the proposal is ready for sign-off (28 reviews)
- `no_change_proposed` — a verdict with no rewrite (68 reviews)
- `conflict` — the live wording has changed since the review; a person decides, and the reviewed text
  is **not** restored
- `missing_entry` — the slug moved and the crosswalk needs re-checking
- `applied` — the owner approved the rewrite (`npm run clinical:review -- --kind dictionary-rewrite`)
  and the live wording now equals the approved proposal

A rewrite reaches the live dictionary only through `npm run dictionary:apply-rewrites -- --write`,
and only when its approval is well formed, its sign-off pin is current and its baseline still
matches the live entry. Anything stale, conflicted or ambiguous stops the whole run and changes
nothing. Without `--write` it only reports.

As at 2026-09-16 all 96 baselines matched the live definitions exactly: no conflicts, no missing
entries.

## Sources: registered is not ingested

**Twenty-six of the 58 sources are admitted to `src/data/source-acquisitions.json` as candidates**,
up from two: the initial 18 published and review-dated sources (the WHO AUDIT and ASSIST manuals,
AIHW's 2025 prisons health report, WA Health MP 0155/21 and its consent article, RANZCP PS #74,
PS #116 and PPG #16, NICE NG225 and CG103, Australian Prescriber's movement-disorders article, and
seven Healthdirect articles), three further published guidelines after publisher/edition verification
(APA bipolar guideline, NSW ACI spinal cord injury mental health guide, and NSW ACI mental health
assessment guide), and five continuously maintained pages admitted under the `last_updated` date
model below (AIHW ambulance attendances, AIHW glossary, WA Mental Health Advocacy Service, WA Mental
Health Emergency Response Line, and the WA Chief Psychiatrist's Mental Health Act page). They are
metadata rows, not indexed documents — see exactly what that does and does not mean below.

### These candidates ARE visible at `/sources`

An earlier draft of this document said they had "no deployed catalogue visibility". **That was
wrong**, and a review caught it. `acquisitionProvider` feeds every non-rejected ledger row into
`repositorySourceReferences()`, which `/sources/search` renders with a detail page each. All 26 rows
appear there.

That is the register working as designed — the eight rows already in the ledger before this change
behave identically — and the catalogue labels them honestly: every one renders as **D band,
`unverified`, carrying a `verification_unknown` warning**. A test pins that, so none can drift to a
higher band or an approved status without going red.

What "candidate" does mean is narrower, and is the claim that actually holds:

| Has                                             | Does not have                                            |
| ----------------------------------------------- | -------------------------------------------------------- |
| A catalogue entry, at D band, marked unverified | Full text, or any bytes acquired                         |
| A link to the publisher's page                  | Any index entry or retrieval eligibility                 |
| A dated, attributable register row              | Clinical approval, or any citation from clinical content |

### The handover evidence file is verbatim, and sometimes disagrees with the ledger

`src/data/dictionary-source-candidates.json` is an unaltered import of what the handover recorded,
including claims later judged wrong. Its ASSIST entry states `2010-01-01` at **day** precision; the
ledger records the same source at **year** precision, because WHO gives only 2010.

That disagreement is deliberate. Correcting the evidence file would destroy the record of what the
handover actually claimed, which is what a reviewer needs in order to check the judgement. The
evidence file says what was inherited; the ledger says what was concluded.

Eight receipt stages are tracked per source and only the first two have been attempted:

| Stage                                                                                           | State                        |
| ----------------------------------------------------------------------------------------------- | ---------------------------- |
| staged, catalogued                                                                              | attempted                    |
| bytes acquired, extraction checked, indexed, retrieval verified, clinically approved, activated | not attempted for any source |

`originalBytesSha256`, `documentId` and `jobId` stay null until real receipts exist. Acquiring
original documents needs a separate per-source rights, environment and cost approval.

### The register can now hold a page that is maintained rather than issued

Australia's most-used official clinical web sources publish a **review** date, not a publication
date. Healthdirect stamps `Last reviewed: <Month Year>` on every article; WA Health's consent article
stamps `Last reviewed: 22-05-2026`. The register demanded a publication date, so it could not hold
them at all — blocked not for missing metadata but for having the wrong shape of it.

`SourceDateModel` adds the missing state. A record marked `continuously_updated`:

- **must** carry a real `reviewDate`,
- **must not** carry a `publicationDate`, because there is no publication event to date,
- has its month/year precision rule applied to the review date instead.

This is not a relaxation, and the tests say so: a `published` record with no publication date is
still rejected, a `continuously_updated` record with no review date is rejected, and one claiming
both is rejected. Recording a review date in `publicationDate` remains wrong and remains blocked.

### Dates are recorded as the events they actually are

Thirty-five sources were read from their publishers' own pages on 2026-09-16, each carrying a
`publisherCheck` with the finding and the date checked. Publication, version-release, effective,
updated and review dates are different events and none was substituted for another:

- **MP 0155/21** — 2021-08-09, the policy's stated date of effect.
- **PS #74, PS #116, PPG #16** — month precision. RANZCP states a last-updated month and no
  publication day.
- **ASSIST 2010** — year precision. WHO gives 2010 and no day.
- **NG225** — 2022-09-07; **CG103** — 2010-07-28; **Australian Prescriber** — 2019-04-01.
- **Healthdirect ×7, WA Health consent** — review dates, under the model above.

A page stamped only `Last updated` is recorded under the third date model below, never as a
publication or a review.

### The third date event: `last_updated`

A page stamped only `Last updated` was held until 2026-09-26, and after 35 publisher reads that
turned out to be a larger category than it first looked. The WA Chief Psychiatrist's Mental Health
Act page says `Last updated: 5 December 2025`; the Royal Children's Hospital MSE guideline says
`Last updated December 2024`; AIHW's suicide and self-harm monitoring says `Updated 14 Aug 2026`.

An update is a **third event**. It is not a publication and it is not a review: a page can be updated
for a data refresh, a broken link or a typo without anyone reviewing the clinical content.

**Owner decision, 2026-09-26:** the register may carry a publisher's update stamp for a continuously
maintained page, provided it is only ever shown and recorded as "last updated". The ledger therefore
has a third date model, `last_updated`, with its own field `lastUpdatedDate` (same precision rules:
month precision is the first of the month, year precision the first of January). A `last_updated`
record must leave both `publicationDate` and `reviewDate` null, and `lastUpdatedDate` is refused on
any other date model. The catalogue carries the field through to `/sources`, where it is labelled
"Last updated" and never "Published" or "Reviewed".

The statements stay banked verbatim in `establishedUpdateStatement`. Five sources whose only
obstacle was the stamp (plus, at most, a placeholder version, replaced by the publisher's own update
statement) were admitted as candidates: AIHW's ambulance-attendances and glossary pages, the Mental
Health Advocacy Service, the Mental Health Emergency Response Line and the Chief Psychiatrist's
Mental Health Act page. Three stamped sources stay held on other grounds: the RCH MSE guideline,
the Aboriginal Health Liaison Service page and the PSOLIS page are all on hosts outside
`GOVERNED_SOURCE_HOSTS`.

**A dated edition is different from a maintained hub.** AIHW's 2025 prisons health report carries a
release date (27 Aug 2026) and is admitted; AIHW's monitoring hubs carry only an update stamp and are
not. Where a handover record cites an undated topic landing page whose content actually lives in a
dated edition — `AIHW-AOD-2026` is the case — the fix is to repoint the record at the edition, not to
date the landing page.

### `nice-delirium` was not a conflict

The dictionary cites `.../cg103/chapter/context`; the handover proposed
`.../cg103/chapter/Recommendations`. Two chapters of one guideline, not two sources. The register row
carries the guideline and the dictionary keeps its chapter URL, because pointing at the chapter that
supports the claim is more precise. No second id was minted.

### Publishers the register did not know

Twelve authority entries were added and the Commonwealth department's 2025 name aliased onto its
existing entry: the Mental Health Tribunal WA, Health Support Services WA, NSW ACI, Western Sydney
LHD, Royal Children's Hospital Melbourne, AADPA, AMHOCN, COPE, NACCHO, the American Psychiatric
Association, the Columbia Lighthouse Project and the DIVA Foundation.

All are `catalogueIdentityOnly`, which is the Chief Psychiatrist's own setting: the catalogue can
place the publisher in a jurisdiction — without which a source can never leave D band — while
**runtime retrieval selection is unchanged**. Registering them outright would have changed which
sources retrieval picks, which is a separate decision.

Four publishers were deliberately **not** registered, because the strings are descriptions rather
than agencies: `Government of Western Australia`, `WA Health service providers`,
`Mental Health Commission / WA Health` (two publishers in one field) and `4AT developers`. A
catch-all entry for the Crown would resolve every WA government document to one authority, which is
worse than leaving four records held until their actual publisher is established.

### A trap worth knowing

An **unrecognised `publisherCode` overrides the publisher-name match**. Recording Australian
Prescriber as `Aust Prescr` made the catalogue return `unknown_jurisdiction` and the gate report a
registered publisher as unregistered. Use the register's own code (`AUSPRES`) or leave the code null;
do not invent an abbreviation.

### Why the other 32 are held

The remaining 32 held records in `src/data/dictionary-source-dispositions.json` (`58 total = 26 admitted + 32 held`) partition by primary blocker as follows:

| Count | Primary obstacle                                                                                                                                                                                                                                                                                         | Whose call                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 14    | Host absent from `GOVERNED_SOURCE_HOSTS` (with a registered agency publisher; the three METEOR records moved when `meteor.aihw.gov.au` was added, 2026-09-28)                                                                                                                                            | Owner — widening host policy is never a side effect |
| 5     | Source is an undated live register (`WA-MHDC-2026`, `WA-MHT`, `WA-OCP-AMHP`, `WA-OCP-FORMS`, `WA-OCP-PMP`)                                                                                                                                                                                               | Needs a register/date model or dated snapshot       |
| 4     | Publisher field is a description, not an agency (`4AT-OFFICIAL`, `WA-ABORIGINAL-TITLES-2026`, `WA-AHD-2026`, `WA-MHC-FORM-LIST-2022`; two also have host or dead-URL blockers)                                                                                                                           | Needs the actual publisher                          |
| 3     | Host now governed (`meteor.aihw.gov.au`); needs page read and metadata-register jurisdiction (`AIHW-NOCC-2026`, `AIHW-NOCC-NMDS-2026`, `METEOR-FOC-HISTORIC`)                                                                                                                                            | Needs a page read                                   |
| 6     | Registered publisher on a governed host, but canonical URL 404s (`health-mental-rights`, `nsw-mse-handbook`) or page is an undated landing/hub or has conflicting currency (`AIHW-AOD-2026`, `AUS-HEALTH-ASSIST-2025`, `health-recovery-framework`, `healthdirect-mental-health`, `who-safety-planning`) | Needs repointing or publisher date verification     |

`publisherCheck.checkedOn: null` means nobody has looked, which is weaker than "the publisher states
no date". The two lead to different next actions and are kept apart.

## The link trap

`sourceUsageHref` turns a dictionary `recordId` straight into `/dictionary/<id>`, which resolves only
for term slugs. A sense id like `dict-sense-0045` would produce `/dictionary/dict-sense-0045` — a dead
page and an implied citation at the same time.

No draft emits a source usage, and a test pins both halves of that: the href the helper _would_
build, and the absence of any sense id in the catalogue. Publishing drafts later means giving them a
real route first, not reusing the term-slug helper.
