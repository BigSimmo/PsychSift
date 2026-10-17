import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, PublicApiError, publicErrorResponse } from "@/lib/http";
import { readRosterPdf } from "@/lib/roster/import/read-pdf";
import { readRosterXlsx } from "@/lib/roster/import/read-xlsx";
import { RosterReadError } from "@/lib/roster/import/table";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { readBoundedFormData } from "@/lib/validation/form-data";

/**
 * Reads an uploaded Excel or PDF roster into one grid shape, on the server,
 * in memory only. The file is never written to Storage or disk, and never
 * logged: only the grid it produces goes back to the doctor's phone.
 */

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };
const MAX_FILE_BYTES = 2 * 1024 * 1024;
// A little slack over the declared file limit for multipart boundary/header overhead.
const MAX_CONTENT_LENGTH = MAX_FILE_BYTES + 64 * 1024;

function tooLarge() {
  return publicErrorResponse("That file is too large. The largest roster file is 2 MB.", 413, {
    code: "payload_too_large",
  });
}

function demoRefusal() {
  return publicErrorResponse("Demo mode cannot read a roster file. Sign in to import yours.", 400, {
    code: "demo_mode_unavailable",
  });
}

/** OOXML (`.xlsx`) files are ZIP archives, `PK\x03\x04`; a PDF starts `%PDF-`. The declared file name and MIME type are never trusted on their own. */
function signatureOf(bytes: Uint8Array): "xlsx" | "pdf" | null {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "xlsx";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  return null;
}

export async function POST(request: Request) {
  try {
    if (isDemoMode()) return demoRefusal();
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);
    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "roster",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);

    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTENT_LENGTH) return tooLarge();

    let form: FormData | null;
    try {
      form = await readBoundedFormData(request, MAX_CONTENT_LENGTH);
    } catch (error) {
      if (error instanceof PublicApiError && error.status === 413) return tooLarge();
      throw error;
    }
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return publicErrorResponse("Choose a roster file to import.", 400, { code: "invalid_form_data" });
    }
    if (file.size > MAX_FILE_BYTES) return tooLarge();

    const buffer = Buffer.from(await file.arrayBuffer());
    const signature = signatureOf(buffer);
    if (!signature) {
      return publicErrorResponse("That file isn't an Excel or PDF roster.", 415, { code: "unsupported_file_type" });
    }

    const today = perthDateOf(new Date());
    try {
      const grid = signature === "xlsx" ? await readRosterXlsx(buffer, today) : await readRosterPdf(buffer, today);
      return NextResponse.json({ grid }, { headers: noStore });
    } catch (error) {
      if (error instanceof RosterReadError) {
        return publicErrorResponse("That roster could not be read.", 422, { code: error.reason });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
