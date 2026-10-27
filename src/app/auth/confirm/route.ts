import type { EmailOtpType } from "@supabase/supabase-js";
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

// Handles email links that carry `?token_hash=&type=` (sign-up confirmation, email sign-in link,
// password reset, invite, email change). The hash is verified on the server with `verifyOtp`, so,
// unlike the PKCE `?code=` return to /auth/callback, the link works in whichever browser opens it,
// including a mail app's in-app browser. Session cookies are written the same way as the callback.

const EMAIL_OTP_TYPES: ReadonlySet<string> = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function emailOtpType(value: string | null): EmailOtpType | null {
  return value && EMAIL_OTP_TYPES.has(value) ? (value as EmailOtpType) : null;
}

const RESET_PASSWORD_PATH = "/auth/reset-password";
const CALLBACK_PATH = "/auth/callback";

/**
 * Where to land after verifying. The email template passes `next={{ .RedirectTo }}`, which is the
 * full `emailRedirectTo` the app asked for: `https://<this site>/auth/callback?next=<page>`. A bare
 * path is accepted too. Only this site's own origin is honoured; a callback URL is unwrapped to its
 * own `next`, and everything still goes through `sameOriginNext`.
 */
function confirmNext(rawNext: string | null, origin: string): string {
  if (!rawNext || !/^https?:\/\//i.test(rawNext)) return sameOriginNext(rawNext);
  let target: URL;
  try {
    target = new URL(rawNext);
  } catch {
    return "/";
  }
  if (target.origin !== origin) return "/";
  if (target.pathname === CALLBACK_PATH) return sameOriginNext(target.searchParams.get("next"));
  return sameOriginNext(`${target.pathname}${target.search}${target.hash}`);
}

/** Short codes the sign-in window already explains (see `safeCallbackError`). */
function verifyFailureCode(message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";
  if (/\bbanned\b/.test(normalized)) return "account_blocked";
  if (normalized.includes("expired") || normalized.includes("invalid") || normalized.includes("already used")) {
    return "link_expired";
  }
  return "verify_failed";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = callerOrigin(request);
  const tokenHash = searchParams.get("token_hash");
  const type = emailOtpType(searchParams.get("type"));
  // A reset link always lands on the reset page, which is what marks the session as recovery-bound.
  const next = type === "recovery" ? RESET_PASSWORD_PATH : confirmNext(searchParams.get("next"), origin);
  const failure = (reason: string) => authFailureRedirect(next, origin, reason);

  if (!tokenHash || !type) {
    return failure("missing_auth_code");
  }

  const { setAllCookies, withAuthMutations } = createAuthMutationCollector();
  const supabase = await createSupabaseServerClient({ setAllCookies });
  if (!supabase) {
    return failure("auth_unconfigured");
  }

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return withAuthMutations(failure(verifyFailureCode(error.message)));
  }
  const response = NextResponse.redirect(`${origin}${next}`);
  markPasswordRecovery(response, next, origin);
  return withAuthMutations(response);
}
