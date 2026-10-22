# Decision: Library document text needs sign-in

- **Status:** decided 2026-10-22
- **Source:** `src/lib/document-detail.ts`, find "Signed-out visitors get the document's title and source details only"

On 22 Oct 2026 the owner chose "Require sign-in for document text" when asked whether library
document text should need sign-in like search and answers. A signed-out visitor who opens a library
document now sees its title and source details and one sign-in card. The server returns none of the
document's indexed text, figures, tables or summary to them and refuses in-document search, so the
whole library sits behind sign-in with Answer, library search and the originals.

If this summary and the source ever differ, the source wins.
