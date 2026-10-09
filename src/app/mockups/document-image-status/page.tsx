"use client";

import { DocumentImage } from "@/components/document-viewer/source-panels";
import type { ImageRow } from "@/components/document-viewer/types";

const sourceImageOnlyTable: ImageRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  page_number: 2,
  caption: "Synthetic clozapine monitoring table",
  image_type: "clinical_table",
  source_kind: "table_crop",
  labels: ["Clozapine monitoring"],
  width: 1520,
  height: 720,
  clinicalUseClass: "clinical_evidence",
  clinicalUseReason: "Browser fixture for an image-only clinical table.",
  accessibleTableMarkdown: null,
  tableRows: null,
  tableColumns: null,
};

export default function DocumentImageStatusFixturePage() {
  return (
    <main
      data-testid="document-image-status-fixture"
      className="mx-auto min-h-screen w-full max-w-lg bg-[color:var(--background)] px-3 py-6 text-[color:var(--text)]"
    >
      <h1 className="sr-only">Document image status browser fixture</h1>
      <DocumentImage image={sourceImageOnlyTable} activePage={2} onSelectPage={() => undefined} />
    </main>
  );
}
