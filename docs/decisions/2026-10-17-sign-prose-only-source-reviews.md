# Decision: The owner can sign sources reviewed only in prose

- **Status:** decided 2026-10-17
- **Source:** `scripts/lib/signoff-kinds/sources.mjs`, find "The owner may sign it with this tool like a drafted source"
- **Retires:** `clinical-review-signs-only-unverified-sources`

`npm run clinical:review -- --kind source` now also offers a source that is marked `locally_reviewed`, is not
rejected, and has no attestation field at all, because its review was recorded only in prose. Signing it
writes attestedBy, attestedAt and attestedAgainstSha256 and leaves validationStatus as it is. Sources with
any attestation field, approved or rejected sources, and Indigenous content are still not offered this way.
The interactive-terminal requirement and the full-name signer rule are unchanged. The owner approved this
in chat on 17 Oct 2026 so they can sign the two OCP WA standards themselves.

If this summary and the source ever differ, the source wins.
