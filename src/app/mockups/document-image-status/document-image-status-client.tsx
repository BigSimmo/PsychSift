"use client";

import { DocumentImage } from "@/components/document-viewer/source-panels";
import type { ImageRow } from "@/components/document-viewer/types";

export function DocumentImageStatusClient({ image }: { image: ImageRow }) {
  return <DocumentImage image={image} activePage={2} onSelectPage={() => undefined} />;
}
