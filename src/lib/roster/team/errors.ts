import { PublicApiError } from "@/lib/http";

/**
 * The plain message for every error the Roster SQL raises. The database's own
 * text is never echoed: an unknown error becomes 503 `roster_unavailable`.
 */
export const ROSTER_ERRORS: Record<string, { status: number; message: string }> = {
  roster_auth_required: { status: 401, message: "Sign in to open Roster." },
  roster_invalid_request: { status: 400, message: "Check the request and try again." },
  roster_access_denied: { status: 403, message: "You're not in this team." },
  roster_team_not_verified: { status: 403, message: "This team hasn't been confirmed yet." },
  roster_role_denied: { status: 403, message: "Only the team's roster manager can do that." },
  roster_not_found: { status: 404, message: "That shift or request has changed. Refresh and try again." },
  roster_limit: { status: 409, message: "That's more than Roster allows for one team." },
  roster_conflict: { status: 409, message: "The roster changed while you were looking. Refresh and try again." },
  roster_request_exists: { status: 409, message: "There's already a request for this shift." },
  roster_swap_not_eligible: { status: 409, message: "That no longer fits the team roster or grades." },
  roster_swap_rule_warning: {
    status: 409,
    message:
      "Approving this swap introduces roster rule warnings. Review and acknowledge the warnings before approving.",
  },
  roster_open_shift_taken: { status: 409, message: "Someone else took this shift first." },
};

/** Postgres codes for a value the database would not store: a bad request, not an outage. */
const INVALID_INPUT_SQLSTATES = new Set(["22P02", "22007", "22008", "23503", "23514"]);

export type RosterErrorCode = keyof typeof ROSTER_ERRORS | "roster_duplicate" | "roster_unavailable";

export function rosterError(code: keyof typeof ROSTER_ERRORS): PublicApiError {
  const known = ROSTER_ERRORS[code];
  if (!known) return rosterUnavailable();
  return new PublicApiError(known.message, known.status, { code });
}

export function rosterInvalidRequest(message = ROSTER_ERRORS.roster_invalid_request.message): PublicApiError {
  return new PublicApiError(message, 400, { code: "roster_invalid_request" });
}

/** Map a Supabase RPC error to the public error the route returns. */
export function rosterApiError(error: { message?: string | null; code?: string | null }): PublicApiError {
  const known = error.message ? ROSTER_ERRORS[error.message] : undefined;
  if (known) return new PublicApiError(known.message, known.status, { code: error.message! });
  if (error.code === "23505") {
    return new PublicApiError("Another person already uses that roster name.", 409, { code: "roster_duplicate" });
  }
  if (error.code && INVALID_INPUT_SQLSTATES.has(error.code)) return rosterInvalidRequest();
  return new PublicApiError("Roster couldn't be reached. Try again shortly.", 503, { code: "roster_unavailable" });
}

export function rosterUnavailable(): PublicApiError {
  return new PublicApiError("Roster couldn't be reached. Try again shortly.", 503, { code: "roster_unavailable" });
}
