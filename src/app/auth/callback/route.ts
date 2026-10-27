import { NextResponse } from "next/server";

import {
  authFailureRedirect,
  callerOrigin,
  createAuthMutationCollector,
  markPasswordRecovery,
  sameOriginNext,
} from "@/lib/supabase/auth-return";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Handles the PKCE code return for OAuth (Apple/Google/Microsoft), email-confirmation,
// and magic-link sign-in. Exchanges `?code=` for a session, writing the session
// cookies via the cookie-aware server client, then redirects into the app.
// Email links that carry `?token_hash=` instead return to /auth/confirm.
// Redirect origin, `next` validation and cookie handling live in `@/lib/supabase/auth-return`.

/**
 * A short code for a failed code exchange, in place of the auth server's own sentence, which is
 * long, technical and would otherwise sit in the address bar and history. The two failures people
 * actually meet get their own code so the page can say what to do (see `safeCallbackError`).
 */
function exchangeFailureCode(message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";
  if (/\bbanned\b/.test(normalized)) return "account_blocked";
  if (normalized.includes("code verifier")) return "link_other_browser";
  if (normalized.includes("expired") || normalized.includes("flow state") || normalized.includes("already used")) {
    return "link_expired";
  }
  return "exchange_failed";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = callerOrigin(request);
  const code = searchParams.get("code");
  const errorDescription = searchParams.get("error_description") ?? searchParams.get("error");
  const next = sameOriginNext(searchParams.get("next"));
  const failure = (reason: string) => authFailureRedirect(next, origin, reason);

  if (errorDescription) {
    return failure(errorDescription);
  }
  if (!code) {
    return failure("missing_auth_code");
  }

  const { setAllCookies, withAuthMutations } = createAuthMutationCollector();
  const supabase = await createSupabaseServerClient({ setAllCookies });
  if (!supabase) {
    return failure("auth_unconfigured");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return withAuthMutations(failure(exchangeFailureCode(error.message)));
  }
  const response = NextResponse.redirect(`${origin}${next}`);
  markPasswordRecovery(response, next, origin);
  return withAuthMutations(response);
}
