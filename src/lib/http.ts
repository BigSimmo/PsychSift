import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";
import { safeErrorLogDetails } from "@/lib/privacy";
import { uploadSizeLimitMessage } from "@/lib/upload-limits";
import { apiErrorPayloadSchema } from "@/lib/api-error-payload";

export class PublicApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly details?: {
      code?: string;
      requestId?: string | null;
      causeName?: string | null;
      causeMessage?: string | null;
      sqlState?: string | null;
    },
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

function publicErrorMessage(error: unknown, status: number) {
  if (error instanceof PublicApiError) return error.message;
  if (error instanceof ZodError) return "Invalid request.";
  if (status === 401) return "Authentication required.";
  if (status === 404) return "Not found.";
  if (status >= 500) return "Request failed.";
  return "Request could not be completed.";
}

function publicErrorCode(error: unknown, status: number) {
  if (error instanceof PublicApiError && error.details?.code) {
    // Only return the code if it matches a stable lowercase snake_case identifier
    const code = error.details.code;
    if (/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(code)) {
      return code;
    }
  }
  if (error instanceof ZodError) return "invalid_request";
  if (status === 401) return "authentication_required";
  if (status === 404) return "not_found";
  if (status >= 500) return "internal_error";
  return "request_failed";
}

function logSafeError(error: unknown, status: number) {
  const details = error instanceof PublicApiError ? error.details : undefined;
  logger.error("API request failed", {
    status,
    ...safeErrorLogDetails(error),
    ...(details?.code ? { code: details.code } : {}),
    ...(details?.requestId ? { requestId: details.requestId } : {}),
    ...(details?.causeName ? { causeName: details.causeName } : {}),
    ...(details?.sqlState ? { sqlState: details.sqlState } : {}),
  });
}

export function jsonError(error: unknown, status = 500, options?: { log?: boolean }) {
  const responseStatus = error instanceof PublicApiError ? error.status : status;
  const message = publicErrorMessage(error, responseStatus);
  const code = publicErrorCode(error, responseStatus);
  const requestId = error instanceof PublicApiError ? error.details?.requestId : undefined;
  // Expected client-auth failures (e.g. an unauthenticated request) can opt out of the
  // error-level log so a routine 401 does not read as a server fault in the logs.
  if (options?.log ?? true) logSafeError(error, responseStatus);
  const payload = apiErrorPayloadSchema.parse({
    error: message,
    message,
    code,
    ...(requestId ? { requestId } : {}),
  });
  return NextResponse.json(payload, {
    status: responseStatus,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function publicErrorResponse(
  message: string,
  status = 400,
  options?: { code?: string; requestId?: string | null; log?: boolean },
) {
  return jsonError(
    new PublicApiError(message, status, {
      code: options?.code,
      requestId: options?.requestId,
    }),
    status,
    { log: options?.log ?? false },
  );
}

export function assertAllowedFile(file: File, maxUploadMb: number) {
  const allowed = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
  ]);

  if (!allowed.has(file.type)) {
    throw new PublicApiError(`Unsupported file type: ${file.type || "unknown"}. Use PDF, DOCX, XLSX, or TXT.`);
  }

  const maxBytes = maxUploadMb * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new PublicApiError(uploadSizeLimitMessage(maxUploadMb), 413, { code: "payload_too_large" });
  }
}

// OOXML documents (DOCX/XLSX) are ZIP archives; a local-file-header begins "PK\x03\x04",
// and the empty/spanned variants begin "PK\x05\x06" / "PK\x07\x08".
function hasZipSignature(head: Uint8Array) {
  return (
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07) &&
    (head[3] === 0x04 || head[3] === 0x06 || head[3] === 0x08)
  );
}

const fileContentSignatures: Record<string, (head: Uint8Array) => boolean> = {
  // PDFs start with "%PDF-".
  "application/pdf": (head) => head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": hasZipSignature,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": hasZipSignature,
  // text/plain has no reliable magic number and is intentionally not signature-checked.
};

// The browser-supplied MIME type (file.type) is trivially spoofable, so for the binary
// formats we accept we also verify the actual byte signature before persisting the file.
// This rejects polyglot/mislabeled uploads (e.g. an executable renamed to .pdf) at the
// ingestion boundary of a clinical document store.
export function assertFileContentSignature(fileType: string, content: Uint8Array) {
  const check = fileContentSignatures[fileType];
  if (!check) return;
  if (!check(content.subarray(0, 8))) {
    throw new PublicApiError(
      `File content does not match its declared type (${fileType}). The file may be corrupt or mislabeled.`,
    );
  }
}
