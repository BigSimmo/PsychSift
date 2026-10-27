/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { SIGN_IN_LINK_EXPIRED_ERROR, SIGN_IN_LINK_OTHER_BROWSER_ERROR, safeCallbackError } from "@/lib/supabase/client";

// The callback sends a short code; older links in flight may still carry the auth server's sentence.
describe("sign-in return error copy", () => {
  it.each([
    ["link_other_browser", SIGN_IN_LINK_OTHER_BROWSER_ERROR],
    ["PKCE code verifier not found in storage.", SIGN_IN_LINK_OTHER_BROWSER_ERROR],
    ["link_expired", SIGN_IN_LINK_EXPIRED_ERROR],
    ["otp_expired", SIGN_IN_LINK_EXPIRED_ERROR],
    ["invalid flow state, no valid flow state found", SIGN_IN_LINK_EXPIRED_ERROR],
    ["access_denied", "Sign-in was cancelled. You can try again."],
    ["exchange_failed", "Sign-in could not be completed. Please try again."],
  ])("explains %s plainly", (code, message) => {
    expect(safeCallbackError(code)).toBe(message);
  });
});
