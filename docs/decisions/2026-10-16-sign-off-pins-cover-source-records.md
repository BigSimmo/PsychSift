# Decision: Clinical sign-off pins cover the reviewed source record, not the published copy

- **Status:** decided 2026-10-16
- **Source:** `scripts/publish-site-content-first-catalogue.ts`, find "The owner decided the pin covers the reviewed source record, not the published copy."

The owner kept the clinical sign-off content pin covering the record a clinician actually reviewed. For a form, that is its catalogue entry and the guidance rendered from it. For a service, it is the curated service record. The pin does not cover the projected publication row, so existing sign-offs stay valid without re-signing. First publication still refuses any record whose reviewed content has changed since sign-off.

If this summary and the source ever differ, the source wins.
