/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_BLOCKED_ERROR,
  isBlockedAccountError,
  SIGN_IN_LINK_EXPIRED_ERROR,
  SIGN_IN_LINK_OTHER_BROWSER_ERROR,
  safeCallbackError,
} from "@/lib/supabase/client";

// The callback sends a short code; older links in flight may still carry the auth server's sentence.
describe("sign-in return error copy", () => {
  it.each([
    ["link_other_browser", SIGN_IN_LINK_OTHER_BROWSER_ERROR],
    ["PKCE code verifier not found in storage.", SIGN_IN_LINK_OTHER_BROWSER_ERROR],
    ["link_expired", SIGN_IN_LINK_EXPIRED_ERROR],
    ["otp_expired", SIGN_IN_LINK_EXPIRED_ERROR],
    ["invalid flow state, no valid flow state found", SIGN_IN_LINK_EXPIRED_ERROR],
    ["account_blocked", ACCOUNT_BLOCKED_ERROR],
    ["User is banned", ACCOUNT_BLOCKED_ERROR],
    ["access_denied", "Sign-in was cancelled. You can try again."],
    ["exchange_failed", "Sign-in could not be completed. Please try again."],
  ])("explains %s plainly", (code, message) => {
    expect(safeCallbackError(code)).toBe(message);
  });
});

describe("blocked account", () => {
  it("is recognised by the auth server's code or its sentence, and nothing else", () => {
    expect(isBlockedAccountError({ code: "user_banned", message: "anything" })).toBe(true);
    expect(isBlockedAccountError({ message: "User is banned" })).toBe(true);
    expect(isBlockedAccountError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(false);
    expect(isBlockedAccountError({ message: "network_error" })).toBe(false);
    expect(isBlockedAccountError(null)).toBe(false);
  });
});
