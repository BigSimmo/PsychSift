# Decision: A medication's TGA Product Information source is the live TGA search, signed with no fixed version

- **Status:** decided 2026-10-22
- **Source:** `src/lib/sources/acquisition-ledger.ts`, find "The owner decided on 2026-10-22"

The TGA eBS site disallows all automated retrieval in its robots.txt, so no agent can read a Product
Information's version or amendment date, and the source protocol forbids inferring one. On 22 Oct
2026 the owner chose, on a decision card in the "Medication source links" project thread, to use the
live TGA search as the source. Each medication's PI record is the TGA eBS Product Information search
for its generic name, filed under `dateModel: "live_product_information"` with no date and the fixed
version text "Current TGA-approved Product Information (live search)". The owner signs each one once.
The search always opens the PI the TGA currently holds, so the link cannot go stale. The accepted
cost is that a later PI amendment is not detected automatically: the weekly source watch never
fetches that host, so it triggers a re-review only when someone records a confirmed source change. The model is confined to TGA records
whose URL is that search. Every other source still needs the date its publisher prints. This builds
on [the default-source decision](2026-09-25-medication-default-sources.md).

If this summary and the source ever differ, the source wins.
