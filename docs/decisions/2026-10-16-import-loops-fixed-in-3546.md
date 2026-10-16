# Decision: The two import loops added by PR 3546 are fixed inside PR 3546

- **Status:** decided 2026-10-16
- **Source:** `src/lib/extractors/xlsx-source-model.ts`, find "Kept separate so neither of those modules imports the other"

The owner first chose to fix the import loops in a separate PR, then chose to fix them inside PR 3546 once it was clear the full test suite could not pass otherwise. The shared XLSX source-fact shapes and classifiers moved into their own module, and the worker candidate-chunks module no longer re-exports the scoped projection. No behaviour changed.

If this summary and the source ever differ, the source wins.
