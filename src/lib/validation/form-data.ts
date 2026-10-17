import { z } from "zod";
import { PublicApiError } from "@/lib/http";
import { parseSchema } from "@/lib/validation/http";

export function optionalFormText(maxLength: number) {
  return z
    .preprocess(
      (value) => {
        if (value === undefined || value === null) return null;
        // Non-string form parts (e.g. a File posted under a text field name)
        // pass through UNCHANGED so the union below rejects them: the API
        // contract (tests/api-validation-contract.test.ts) requires invalid
        // multipart metadata to fail with 400 BEFORE any storage upload or
        // database write, never to be silently discarded. (Audit L5: this
        // replaces a no-op ternary that obscured the deliberate rejection.)
        return value;
      },
      z.union([z.string().trim().max(maxLength), z.null()]),
    )
    .transform((value) => (value ? value : null));
}

export function parseFormDataFields<TSchema extends z.ZodType>(
  formData: FormData,
  schema: TSchema,
  fields: string[],
  message = "Invalid form data.",
): z.infer<TSchema> {
  const values = Object.fromEntries(fields.map((field) => [field, formData.get(field)]));
  return parseSchema(schema, values, message, "invalid_form_data");
}

export async function readBoundedFormData(request: Request, maxBytes: number): Promise<FormData | null> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PublicApiError("Request body is too large.", 413, { code: "payload_too_large" });
  }

  if (!request.body || Object.prototype.hasOwnProperty.call(request, "formData")) {
    try {
      return await request.formData();
    } catch (error) {
      if (error instanceof PublicApiError) throw error;
      return null;
    }
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel("payload_too_large").catch(() => undefined);
        throw new PublicApiError("Request body is too large.", 413, { code: "payload_too_large" });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const contentType = request.headers.get("content-type") ?? "";
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: contentType ? { "Content-Type": contentType } : {},
    }).formData();
  } catch {
    return null;
  }
}
