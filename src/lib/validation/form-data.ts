import { z } from "zod";
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
