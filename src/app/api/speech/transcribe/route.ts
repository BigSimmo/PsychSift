import { consumeSubjectApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { requireSignedInClinicalAccess } from "@/lib/clinical-access";
import { clinicalAskEnabled } from "@/lib/clinical-ask/authority-registry";
import { jsonError, PublicApiError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { transcribeClinicalAskAudio } from "@/lib/openai";
import { publicAccessContext } from "@/lib/public-api-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { readBoundedFormData } from "@/lib/validation/body";
import {
  maxClinicalAskAudioBytes,
  validateSpeechTranscriptionForm,
} from "@/lib/validation/speech-transcription-request";

export const runtime = "nodejs";
const transcriptionTimeoutMs = 30_000;
const noStore = (response: Response) => {
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export async function POST(request: Request) {
  try {
    // Dormant by default: when the Clinical Ask master flag is off this route
    // does not exist. Answer before any auth lookup, rate-limiter write, or
    // provider call so `CLINICAL_ASK_ENABLED=false` is a full rollback (M16).
    // `log: false`: a designed 404 is not a server fault, so it must not write
    // the error-level "API request failed" line that Sentry Logs forwards.
    if (!clinicalAskEnabled()) {
      return noStore(jsonError(new PublicApiError("Not found.", 404, { code: "not_found" }), 404, { log: false }));
    }
    const supabase = createAdminClient();
    const access = await publicAccessContext(request, supabase);
    requireSignedInClinicalAccess(access);
    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: access.rateLimitSubject,
      bucket: "speech_transcription",
      allowInMemoryFallbackOnUnavailable: false,
    });
    if (rateLimit.limited)
      return noStore(
        rateLimitJsonResponse("Too many transcription requests. Retry shortly.", rateLimit, {
          bucket: "speech_transcription",
        }),
      );
    if (request.signal.aborted) throw new PublicApiError("Transcription cancelled.", 499, { code: "client_cancelled" });
    const formData = await readBoundedFormData(request, maxClinicalAskAudioBytes, {
      tooLargeMessage: "The audio recording exceeds 10 MiB.",
      tooLargeCode: "audio_too_large",
      invalidFormMessage: "Invalid transcription form data.",
      invalidFormCode: "invalid_form_data",
    });
    const { audio, durationMs } = validateSpeechTranscriptionForm(formData);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(transcriptionTimeoutMs)]);
    const result = await transcribeClinicalAskAudio(audio, signal, transcriptionTimeoutMs);
    return Response.json({ transcript: result.transcript, durationMs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return noStore(unauthorizedResponse(error));
    if (error instanceof PublicApiError) return noStore(jsonError(error, error.status));
    const aborted = request.signal.aborted || (error instanceof Error && error.name === "AbortError");
    logger.warn("Speech transcription failed", { aborted, category: "provider_or_timeout" });
    return noStore(
      jsonError(
        new PublicApiError(
          aborted ? "Transcription was cancelled." : "Transcription is temporarily unavailable.",
          aborted ? 499 : 502,
          { code: aborted ? "client_cancelled" : "transcription_unavailable" },
        ),
        aborted ? 499 : 502,
      ),
    );
  }
}
