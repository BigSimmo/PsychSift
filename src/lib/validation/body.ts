import { z } from "zod";
import { PublicApiError } from "@/lib/http";
import { parseSchema } from "@/lib/validation/http";

export const defaultJsonBodyLimitBytes = 256 * 1024;

export async function readBoundedJson(request: Request, maxBytes = defaultJsonBodyLimitBytes): Promise<unknown> {
  const rawLength = request.headers.get("content-length");
  const declaredLength = rawLength === null || rawLength.trim() === "" ? Number.NaN : Number(rawLength);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PublicApiError("Request body is too large.", 413, { code: "payload_too_large" });
  }

  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (cause) {
        throw new PublicApiError("Invalid request body.", 400, {
          code: "invalid_request_body",
          causeName: cause instanceof Error ? cause.name : null,
          causeMessage: cause instanceof Error ? cause.message : null,
        });
      }
      const { done, value } = readResult;
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("payload_too_large").catch(() => undefined);
        throw new PublicApiError("Request body is too large.", 413, { code: "payload_too_large" });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Reads a multipart body with a hard cap on the total bytes streamed (`maxEnvelopeBytes`), so memory
 * stays bounded. `maxBytes` limits only the combined size of File/Blob parts; ordinary text fields
 * are not counted against it and can use whatever is left of the envelope allowance.
 */
export async function readBoundedFormData(
  request: Request,
  maxBytes: number,
  options?: {
    envelopeBytes?: number;
    tooLargeMessage?: string;
    tooLargeCode?: string;
    invalidFormMessage?: string;
    invalidFormCode?: string;
  },
): Promise<FormData> {
  const envelopeBytes = options?.envelopeBytes ?? 64 * 1024;
  const tooLargeMessage = options?.tooLargeMessage ?? "Request body is too large.";
  const tooLargeCode = options?.tooLargeCode ?? "payload_too_large";
  const invalidFormMessage = options?.invalidFormMessage ?? "Invalid form data.";
  const invalidFormCode = options?.invalidFormCode ?? "invalid_form_data";
  const maxEnvelopeBytes = maxBytes + envelopeBytes;

  const rawLength = request.headers.get("content-length");
  const declaredLength = rawLength === null || rawLength.trim() === "" ? Number.NaN : Number(rawLength);
  if (Number.isFinite(declaredLength) && declaredLength > maxEnvelopeBytes) {
    throw new PublicApiError(tooLargeMessage, 413, { code: tooLargeCode });
  }

  const inspectBlobSizes = (formData: FormData): FormData => {
    let totalBlobBytes = 0;
    for (const [, value] of formData.entries()) {
      if (typeof value === "object" && value !== null && "size" in value && typeof (value as Blob).size === "number") {
        totalBlobBytes += (value as Blob).size;
        if (totalBlobBytes > maxBytes) {
          throw new PublicApiError(tooLargeMessage, 413, { code: tooLargeCode });
        }
      }
    }
    return formData;
  };

  if (request.body === null || Object.prototype.hasOwnProperty.call(request, "formData")) {
    const formData = await request.formData().catch((cause) => {
      throw new PublicApiError(invalidFormMessage, 400, {
        code: invalidFormCode,
        causeName: cause instanceof Error ? cause.name : null,
        causeMessage: cause instanceof Error ? cause.message : null,
      });
    });
    return inspectBlobSizes(formData);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (cause) {
        throw new PublicApiError(invalidFormMessage, 400, {
          code: invalidFormCode,
          causeName: cause instanceof Error ? cause.name : null,
          causeMessage: cause instanceof Error ? cause.message : null,
        });
      }
      const { done, value } = readResult;
      if (done) break;
      total += value.byteLength;
      if (total > maxEnvelopeBytes) {
        await reader.cancel("payload_too_large").catch(() => undefined);
        throw new PublicApiError(tooLargeMessage, 413, { code: tooLargeCode });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bodyBlob = new Blob(chunks as BlobPart[]);
  chunks.length = 0;

  const formData = await new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bodyBlob,
  })
    .formData()
    .catch((cause) => {
      throw new PublicApiError(invalidFormMessage, 400, {
        code: invalidFormCode,
        causeName: cause instanceof Error ? cause.name : null,
        causeMessage: cause instanceof Error ? cause.message : null,
      });
    });

  return inspectBlobSizes(formData);
}

export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  message = "Invalid request body.",
): Promise<z.infer<TSchema>> {
  const body = await readBoundedJson(request);
  return parseSchema(schema, body, message, "invalid_body");
}

export async function parseJsonBodyOrDefault<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  fallback: z.infer<TSchema>,
): Promise<z.infer<TSchema>> {
  const body = await readBoundedJson(request).catch((error) => {
    if (error instanceof PublicApiError) throw error;
    return undefined;
  });
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : fallback;
}
