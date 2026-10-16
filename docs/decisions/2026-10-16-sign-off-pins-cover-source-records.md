# Decision: Clinical sign-off pins cover the reviewed source record, not the published copy

- **Status:** decided 2026-10-16
- **Source:** `scripts/publish-site-content-first-catalogue.ts`, find "The owner decided the pin covers the reviewed source record, not the published copy."

The owner kept the clinical sign-off content pin covering the record a clinician actually reviewed. For a form, that is the review record with its sign-off fields removed, the catalogue entry fields, and the guidance rendered from them. For a service, it is the curated service record. The pin does not cover the projected publication row, so existing sign-offs stay valid without re-signing. Metadata added only at projection, such as aliases, search terms and risk level, is not attested by the pin. First publication still refuses any record whose reviewed content has changed since sign-off.

If this summary and the source ever differ, the source wins.
