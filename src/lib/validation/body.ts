import { z } from "zod";
import { PublicApiError } from "@/lib/http";
import { parseSchema } from "@/lib/validation/http";

export const defaultJsonBodyLimitBytes = 256 * 1024;

export async function readBoundedJson(request: Request, maxBytes = defaultJsonBodyLimitBytes): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PublicApiError("Request body is too large.", 413, { code: "payload_too_large" });
  }

  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("payload_too_large");
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
