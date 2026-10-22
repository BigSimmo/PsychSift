# Decision: Adopt the sources the medication pages link to, then sign them again

- **Status:** decided 2026-10-22
- **Source:** `src/data/source-acquisitions.json`, the records whose `dispositionReason` starts "Adopted on 2026-10-22"

A medication page shows a source link only when the source is adopted and carries a current owner
signature. On 22 Oct 2026 the owner signed 75 candidate sources, then chose on a decision card in the
"Medication source links" project thread to make the medication source links visible: adopt the
sources and sign them again. Adopting changes a signed record, which voids its signature, so the
owner signs the adopted batch once more with `clinical:review`.

Adopted: the 71 TGA Product Information search records, the WA Monitored Medicines Prescribing Code
and ScriptCheckWA. Not adopted here: the older lithium, clozapine, mood-disorder and dictionary
sources the pages also cite, whose own notes ask for a separate adoption decision, and the unmapped
WA policy MP 0131/20. This builds on [the live TGA search decision](2026-10-22-tga-pi-live-search-source.md).

If this summary and the source ever differ, the source wins.
