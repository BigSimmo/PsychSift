import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { DocumentViewerLazy as DocumentViewer } from "@/components/document-viewer-lazy";
import {
  documentDetailQuerySchema,
  loadAuthorizedDocumentDetail,
  sanitizeDocumentDetailError,
} from "@/lib/document-detail";
import type { DocumentDetailPayload } from "@/lib/document-detail-contract";
import { PublicApiError } from "@/lib/http";
import { RecentPageTitle } from "@/components/recent-pages/recent-page-title";

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; chunk?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const parsedPage = Number.parseInt(query.page ?? "", 10);
  const initialPage = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  let initialDetail: DocumentDetailPayload | undefined;
  let initialError: string | undefined;

  try {
    const detailQuery = documentDetailQuerySchema.parse({
      page: initialPage,
      chunk: query.chunk,
      assetScope: "window",
    });
    const requestHeaders = new Headers(await headers());
    const request = new Request(`http://document-detail.local/documents/${encodeURIComponent(id)}`, {
      headers: requestHeaders,
    });
    initialDetail = await loadAuthorizedDocumentDetail({ request, rawId: id, query: detailQuery });
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404) {
      notFound();
    }
    initialError = sanitizeDocumentDetailError(error);
  }

  return (
    <>
      {/* The viewer's tab title does not name the document, so Recent pages is
          handed the title already loaded for the viewer (no extra read). */}
      <RecentPageTitle path={`/documents/${id}`} title={initialDetail?.document.title} />
      <DocumentViewer
        // Key on document identity only — page/chunk updates are handled inside
        // DocumentViewer via URL sync. Remounting on every page flip reloaded the PDF.
        key={id}
        documentId={id}
        initialPage={initialPage}
        chunkId={query.chunk}
        initialDetail={initialDetail}
        initialError={initialError}
      />
    </>
  );
}
