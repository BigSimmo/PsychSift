# Source acquisition protocol

_Updated 2026-10-24 — structured rights evidence and its approval boundaries; Documentation owns._

How a clinical source gets found, judged, recorded and indexed in PsychSift.

Run this whenever new information is added to the knowledge base, whether it arrives from a
search, an upload, or a request to write new content. The protocol is deliberately the same
in all three cases, because the failure it prevents is the same: a claim that no one can
trace back to a source anyone has vouched for.

The rules live in `src/lib/sources/acquisition-ledger.ts` and are enforced by
`npm run check:source-acquisitions`. The register itself is `src/data/source-acquisitions.json`,
and every record in it appears at `/sources` alongside the sources that clinical content
already cites.

## 1. Search in locality order

Search the rungs in order. Do not start at rung 5 because it is easier to search.

| Rung | Scope                  | What belongs here                                                                                                               |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1    | WA local               | Hospital and health service guidelines: CAHS, WACHS, EMHS, NMHS, SMHS, RPBG, FSFHG, KEMH, PCH, Armadale Kalamunda, Peel         |
| 2    | WA state               | WA Health, Office of the Chief Psychiatrist, HealthyWA, Mental Health Act 2014 and its subordinate instruments                  |
| 3    | Australian national    | RANZCP, RACGP, NHMRC, TGA, PBS, ACSQHC, Australian Government Department of Health and Aged Care                                |
| 4    | Other Australian state | NSW Health, Queensland Health, SA Health, Victorian Department of Health, ACT Health, NT Health, Tasmanian Department of Health |
| 5    | International          | NICE, BMJ Best Practice, WHO                                                                                                    |

The rung is not a free choice. `check:source-acquisitions` derives the jurisdiction
independently from the publisher, using the authority register, and rejects any record whose
declared rung disagrees. A source cannot be filed as local because it would be convenient.

### The stopping rule

A clinical claim is adequately sourced once it has a **current** source from rung 1, 2 or 3.

Go to rungs 4 and 5 only when the first three do not cover the claim. When you do, say so in
the record's `notes`, so a reader can see that an overseas or interstate source is being
relied on because no Australian equivalent was found, not because nobody looked.

Capture what you rejected as well as what you kept. A rejection with a reason is the only
thing that stops the same ground being searched again next month.

## 2. Capture every source you pull

One record per source, whether or not you end up using it.

| Field                                         | Why it is required                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `title`, `publisher`, `jurisdiction`          | Identity. Without these the source cannot be recognised or placed.                |
| `publisherCode`                               | Resolves the publisher against the authority register.                            |
| `canonicalUrl`                                | Must sit on a governed host. Optional, but a source without one cannot be opened. |
| `version`, `publicationDate`, `datePrecision` | Currency. `datePrecision` records that a 2020 guideline is dated to the year.     |
| `evidenceType`                                | Guideline, standard, legislation, systematic review, and so on. Never unknown.    |
| `rung`, `capturedAt`, `capturedFor`           | Why this search happened and what it was looking for.                             |
| `disposition`, `dispositionReason`            | What you decided and why.                                                         |

Record dates exactly as the publisher prints them. Where only a year or month is published,
record the first of January or the first of the month and set `datePrecision` accordingly, so
`2020-01-01` is never mistaken for a real publication day. **Never infer a date.** A source
whose date cannot be established is a rejection with a reason, not a guess. The one exception is the
TGA Product Information search, which carries no date by design under
`dateModel: "live_product_information"` ([owner decision, 2026-10-22](decisions/2026-10-22-tga-pi-live-search-source.md)).

### Rights and licence status

A record may carry an optional `rights` object saying whether the publisher lets us show the
source publicly and use it with AI (regulatory audit finding R-07). Leaving it out means the
rights position is unknown, which is where every record started. `status` is one of `unknown`,
`open_licence` (name it in `licence`), `publisher_terms_allow`, `permission_granted` or
`restricted`; `publicDisplay` and `aiUse` are each `unknown`, `allowed` or `not_allowed`. Any
status other than `unknown` must also record `recordedBy`, `checkedAt` and an `evidenceUrl` or
`note`. The rules are in `src/lib/sources/source-rights.ts`, and
`npm run check:source-acquisitions` prints how many records are still unknown without failing.

Whether a publisher's terms allow a use is a legal judgement for the owner and their lawyer, so
an agent never records a status other than `unknown` from its own research. The field is
record-keeping only: nothing readers see and nothing the answer engine uses reads it. It is
covered by `attestedAgainstSha256` like any other field, so adding it to a signed-off record
makes that sign-off stale until it is re-attested.

### Dispositions

- **`adopted`** — clinical content cites this source. It must be reviewed first.
- **`candidate`** — captured and awaiting review. This is the normal state of a fresh pull.
- **`rejected`** — considered and not used. Kept on purpose. Enters the catalogue as excluded,
  and needs only enough identity to be recognised again, because metadata that could not be
  established is frequently the reason for the rejection.

## 3. How trustworthiness is judged

Two independent judgements, and they must not be collapsed into one.

**Provenance** is an issuer-identity signal only: Official, Trusted or Unclassified. It comes
from registered publisher codes and compatible jurisdiction metadata, never from a title or
from text inside the document. The full taxonomy is in
[`clinical-governance.md`](clinical-governance.md#source-provenance-taxonomy). `Official ·
Outdated` and `Trusted · Unverified` are both valid states and stay visible as separate
caveats.

**Quality** is a score out of 100 across six weighted dimensions, computed in
`src/lib/sources/catalogue-core.ts`:

| Dimension                | Weight | What lifts it                                                      |
| ------------------------ | ------ | ------------------------------------------------------------------ |
| Accuracy assurance       | 25     | Local review, then local approval                                  |
| Reliability              | 20     | A registered authority, Official scoring above Trusted             |
| Evidence quality         | 20     | Guidelines, standards, legislation and regulatory material highest |
| Currency                 | 15     | Current, then review due. Past its expiry date scores zero.        |
| Australian applicability | 15     | WA 15, national 13, other state 11, international 6                |
| Traceability             | 5      | Stable identity, version, date, a location, a recorded usage       |

Bands are A at 85 and above, B at 70, C at 50, D below that. Any material uncertainty forces
D regardless of score.

### An unreviewed source is not a defective source

A freshly captured source has not been reviewed by anyone here, so it scores zero for accuracy
assurance and sits at D. That is correct and expected. It is a queue, not a fault.

What the gate refuses is a genuine metadata defect: a missing publisher, version, date,
jurisdiction or evidence type, a malformed date, an ungoverned URL, or contradictory identity.
Those defects, not unreviewed status, are what put 712 of the first 764 catalogued sources into
the bottom band.

The practical consequence: the seeded Chief Psychiatrist guidelines sit at D scoring 76 until
they are signed off, and reach A at 91 the moment `validationStatus` becomes `locally_reviewed`,
with nothing else changed.

## 4. Sign-off

Only a reviewed source may be adopted into clinical content. Set `validationStatus` to
`locally_reviewed` once you have read the source and confirmed it says what the content claims,
or to `approved` where local governance has formally approved it. `npm run check:source-acquisitions`
prints the outstanding queue, most local first.

### Recording the attestation itself

A record may also carry `attestedBy`, `attestedAt` and `attestedAgainstSha256`. All three are
optional, and all three are the owner's to write; an agent never records a sign-off on the owner's
behalf. The owner writes them with `npm run clinical:review -- --kind source` (one at a time with
`--walk`, or a whole review pack with `--pack` then `--write --batch`), which sets
`validationStatus` to `locally_reviewed` and computes the digest. The tool also offers a source
already marked `locally_reviewed` whose review lives only in prose, meaning it has no
attestation field at all; signing it records the three fields and leaves `validationStatus` as
it is ([owner decision, 2026-10-17](decisions/2026-10-17-sign-prose-only-source-reviews.md)). A record with any attestation field, complete or partial,
is not offered this way. Signing a source does not adopt
it: `disposition` stays as it is until a separate adoption decision. Sources with Aboriginal,
Torres Strait Islander or other Indigenous content are never offered (owner rule 2026-09-26).

`attestedAgainstSha256` is a digest of everything in the record except the attestation fields, so
it pins exactly what was signed off. Compute it with `acquisitionAttestedContentSha256` from
`src/lib/sources/acquisition-ledger.ts`. If any other field is later corrected, the digest no
longer matches and `npm run check:source-acquisitions` reports the record as
`attestedAgainstSha256 is stale; content changed after sign-off` instead of leaving it quietly
`locally_reviewed`.

That is the gap this closes. On 2026-09-16 a batch of metadata corrections invalidated six earlier
owner sign-offs, and because sign-off lived only in prose in `dispositionReason` and `notes`,
nothing read it and nothing noticed. The pattern is the Therapy catalogue's
`therapyReviewedContentSha256`, which has held that line for the therapy records.

## 5. What happens automatically

- Every capture appears at `/sources` with its band, score, jurisdiction and warnings.
- A capture carries no `sourceId`, so it merges with any clinical content that cites the same
  URL. The merged entry lists every place the source is used, down to the record and field.
- Merging is conservative. Where the ledger and a content reference disagree, the catalogue
  takes the weaker value, so a careless content reference cannot inflate a source's band.
- `/sources` filters by band, jurisdiction, topic and the mode that uses the source.

## 6. Gates

| Command                                                  | What it proves                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run check:source-acquisitions`                      | The register is complete, correctly filed, and nothing unreviewed is adopted |
| `npm run check:source-catalogue`                         | Every content area still feeds the catalogue and the register merges cleanly |
| `npx vitest run tests/source-acquisition-ledger.test.ts` | The rules themselves still hold                                              |

## 7. Known limits

The register can carry optional structured `rights`: `status` (`unknown`, `restricted` or
`documented`), `licence`, `termsUrl`, `checkedAt` and `notes`. Omission means unknown.
Recorded restrictions and documented terms require an HTTPS evidence link and a real check
date; documented terms also require the licence or permission wording. This records evidence
only. It does not authorize ingestion, copying, public promotion or clinical use, and it does
not change source ranking, clinical review or access controls. Existing source records are
not backfilled with assumed permissions. Adding or changing rights on a signed record makes
its content signature stale and requires the normal owner review.

- **An unregistered publisher cannot leave D band.** The catalogue derives jurisdiction solely
  from `src/lib/source-authority-registry.ts`, so a source from a publisher that is not
  registered has no jurisdiction and is forced to D. Therapeutic Guidelines, the Australian
  Medicines Handbook, Australian Prescriber, RACP, Cochrane, AIHW, Healthdirect Australia,
  HealthyWA and the Mental Health Commission WA were registered on 2026-09-07. Beyond Blue,
  the NSW Agency for Clinical Innovation and Western Sydney Local Health District are examples
  that remain unregistered. The gate detects this and names the publisher rather than failing
  obscurely.

  Registering a publisher changes `classifySourceAuthority`, which retrieval selection uses to
  tier results. That makes it a retrieval behaviour change under the RAG ranking protection
  rules in `AGENTS.md`, so it needs the owner's decision and an eval canary. Do not add a
  register entry as a side effect of an acquisition pass.

- **Governed hosts are an exact allowlist.** `GOVERNED_SOURCE_HOSTS` in
  `src/lib/sources/source-url-policy.ts` is pinned to equal the set of hosts actually emitted,
  so adding a source on a new host means adding the host and updating the pinned count in
  `tests/source-catalogue-providers.test.ts`. The gate names the host and the remedy.

- **Some publishers block automated retrieval.** NICE returns 403 to automated fetches, so its
  metadata has to be read by hand. Do not record a date you could not read.
