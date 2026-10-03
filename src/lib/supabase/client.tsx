"use client";

import { createBrowserClient } from "@supabase/ssr";
import { isAuthRetryableFetchError, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { clearAccountScopedBrowserStorage } from "@/lib/account-scoped-browser-state";
import { clearAdminPins } from "@/lib/admin/pin-storage-keys";
import { clearPersistedAnswerThread } from "@/lib/answer-thread-storage";
import { authSessionFingerprint, createAuthRequestLifecycle } from "@/lib/auth-request-lifecycle";
import { clearOnCallEntryCache } from "@/lib/on-call/entry-cache-keys";
import { clearOnCallChecklists } from "@/lib/on-call/checklist-storage-keys";
import { clearOnCallDeviceState } from "@/lib/on-call/device-state-keys";
import { clearOnCallRecent } from "@/lib/on-call/recent-storage-keys";
import { clearPatientLabels, watchPatientLabelExpiry } from "@/lib/patient-label-storage";
import { clearPatientProfile } from "@/lib/patient-profile-storage";
import { clearRecentQueries } from "@/lib/recent-query-storage";
import { clearSignedUrlCache } from "@/lib/signed-url-cache";
import { checkSupabaseProjectConfig, formatSupabaseProjectCheck } from "@/lib/supabase/project";

export { authorizationIdentity } from "@/lib/authorization-header";

type AuthStatus = "unconfigured" | "loading" | "signed_out" | "authenticated" | "expired" | "error";
export type OAuthProvider = "apple" | "google" | "azure";

type AuthContextValue = {
  client: SupabaseClient | null;
  session: Session | null;
  status: AuthStatus;
  error: string | null;
  /** Non-error confirmation (e.g. "check your email"); rendered as a success status, not an alert. */
  notice: string | null;
  isConfigured: boolean;
  authorizationHeader: Record<string, string>;
  authEpoch: number;
  registerAuthRequest: (controller: AbortController) => { epoch: number; release: () => void };
  isAuthEpochCurrent: (epoch: number) => boolean;
  signInWithEmail: (email: string, next?: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  signInWithOAuth: (provider: OAuthProvider, next?: string) => Promise<void>;
  signOut: () => Promise<void>;
  markSessionExpired: () => void;
};

export const AUTH_EMAIL_STORAGE_KEY = "clinical.dashboard.lastAuthEmail";
const AUTH_CALLBACK_PATH = "/auth/callback";
const GENERIC_AUTH_ERROR = "Sign-in could not be completed. Please try again.";

function safeCallbackError(value: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "access_denied" || normalized?.includes("access denied")) {
    return "Sign-in was cancelled. You can try again.";
  }
  if (normalized === "provider_disabled" || normalized?.includes("provider is not enabled")) {
    return "This sign-in provider is unavailable. Try email sign-in or try again later.";
  }
  return GENERIC_AUTH_ERROR;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Account-transition boundary: sign-out, session expiry, and a change of the
 * signed-in user in the same tab. On a shared workstation the next person must
 * not inherit the previous person's clinical context, so every identity-bound
 * or patient-specific browser store is cleared here, in one place — adding a
 * store means adding it to this list, not to one of the three call sites.
 *
 * Deliberately NOT the initial signed-out boot path: that must keep the guest
 * answer-thread snapshot (see `initializeSession`).
 */
function clearAccountScopedBrowserState() {
  clearPersistedAnswerThread();
  clearRecentQueries();
  clearSignedUrlCache();
  // Patient physiology + medication list behind the prescribing alerts (audit M4).
  clearPatientProfile();
  // Bed numbers and initials (timers, call notes, handover drafts). They also
  // expire at the end of the shift; see the watcher in AuthProvider.
  clearPatientLabels("account-transition");
  // On Call entries are the owner's own ward numbers, escalation contacts and
  // personal lines (added on main while this branch was open). A shared ward
  // computer switches accounts without ever signing out, so without this the
  // previous user's private entries render for the next one.
  clearOnCallEntryCache();
  // The same shift, from the other direction: Recent is what the last person
  // looked up and rang. It carries no digits of its own, but it names the
  // entries — including personal ones — so it goes with the cache rather than
  // outliving it on a shared ward phone.
  clearOnCallRecent();
  // Admin's pinned numbers: row ids only, but they name what this person rings.
  clearAdminPins();
  // And the orientation ticks, for the same shared-computer reason from a
  // third direction: a tick says "I have collected the on-call phone", which
  // is true of a person and not of the next one to sit down.
  clearOnCallChecklists();
  // Hospital choice, report and call marks, team, shift pick, offline copy.
  clearOnCallDeviceState();
  // Component-owned stores this lib module may not import (tests/lib-layering):
  // the unscoped favourites pins / last-opened keys (audit L2) and the legacy
  // plan draft left by the retired Caring Contacts prototype (audit L6).
  // The raw keys are removed here, synchronously, whether or not those modules
  // are loaded in this page; the stores drop their caches on the event it fires.
  clearAccountScopedBrowserStorage();
}
let browserSupabaseClient: SupabaseClient | null | undefined;
let browserSupabaseClientConfig: string | null = null;

export function isUsableBrowserSupabaseKey(key: string | null | undefined): key is string {
  const value = key?.trim();
  if (!value) return false;
  return !/<[^>]+>|^your-|replace-with|placeholder/i.test(value);
}

function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !isUsableBrowserSupabaseKey(key)) {
    browserSupabaseClient = null;
    browserSupabaseClientConfig = null;
    return null;
  }

  const projectCheck = checkSupabaseProjectConfig({
    NEXT_PUBLIC_SUPABASE_URL: url,
    // The ref and name are non-secret identity metadata. Staging must declare
    // them publicly because this guard runs in the browser; the server-only
    // SUPABASE_STAGING_* values are intentionally unavailable here.
    SUPABASE_STAGING_PROJECT_REF: process.env.NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_REF,
    SUPABASE_STAGING_PROJECT_NAME: process.env.NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_NAME,
  });
  if (projectCheck.status === "mismatch") {
    console.error(formatSupabaseProjectCheck(projectCheck));
    browserSupabaseClient = null;
    browserSupabaseClientConfig = null;
    return null;
  }

  const publishableKey: string = key;
  const configKey = `${url}:${publishableKey}`;
  if (browserSupabaseClientConfig === configKey) {
    return browserSupabaseClient ?? null;
  }

  browserSupabaseClientConfig = configKey;
  // @supabase/ssr browser client persists the session in cookies shared with the
  // server (proxy + route handlers), so logins survive refreshes and the API can
  // read the session. PKCE code flow returns via /auth/callback.
  browserSupabaseClient = createBrowserClient(url, publishableKey);
  return browserSupabaseClient;
}

export function authorizationHeadersForAccessToken(accessToken: string | null | undefined): Record<string, string> {
  if (!accessToken) return {};
  return { authorization: `Bearer ${accessToken}` };
}

/**
 * Decide the trusted initial auth state from a server-verifying `getUser()` and a
 * storage-only `getSession()`. `getSession()` reads the token from local storage
 * WITHOUT validating it; `getUser()` re-validates it against the Supabase auth server.
 * The stored session (and its access token) is trusted only when the auth server
 * confirmed a user whose id matches that session, so a stale, tampered, or expired
 * local token resolves to signed-out instead of presenting as authenticated. Data
 * access is already safe — every API route re-validates the bearer token server-side
 * ([auth.ts](src/lib/supabase/auth.ts)) — so this is defense-in-depth for the client UI.
 *
 * `verificationUnavailable` covers the case where `getUser()` could not reach the
 * auth server at all (offline load, flaky network). That is not evidence the token
 * is bad, so the stored session keeps the signed-in UI instead of silently
 * presenting as signed out; the server still rejects the token on every data call
 * if it truly is invalid.
 */
export type InitialAuthResolution =
  { status: "authenticated"; session: Session } | { status: "signed_out"; session: null };

export function resolveInitialAuthState(args: {
  verifiedUserId: string | null;
  session: Session | null;
  verificationUnavailable?: boolean;
}): InitialAuthResolution {
  const { verifiedUserId, session, verificationUnavailable } = args;
  if (verifiedUserId && session && session.user.id === verifiedUserId) {
    return { status: "authenticated", session };
  }
  if (verificationUnavailable && session) {
    return { status: "authenticated", session };
  }
  return { status: "signed_out", session: null };
}

/** Only explicit token/session rejection is evidence that local user data should be cleared. */
export function isDefinitiveAuthValidationError(error: unknown) {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  const status = typeof candidate?.status === "number" ? candidate.status : null;
  if (status === 400 || status === 401 || status === 403) return true;
  const code = typeof candidate?.code === "string" ? candidate.code.toLowerCase() : "";
  if (/^(?:bad_jwt|session_not_found|refresh_token_not_found|refresh_token_already_used)$/.test(code)) return true;
  const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
  return /(?:invalid|expired|missing) (?:jwt|token)|session (?:not found|expired)|refresh token (?:not found|invalid)/.test(
    message,
  );
}

/** Recognize both Supabase's wrapped retryable error and browser-native fetch failures. */
export function isRetryableInitialAuthVerificationError(error: unknown) {
  if (isAuthRetryableFetchError(error)) return true;
  const candidate = error as { name?: unknown; message?: unknown } | null;
  const isTypeError = error instanceof TypeError || candidate?.name === "TypeError";
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  return isTypeError && /failed to fetch|fetch failed|network request failed|networkerror|load failed/i.test(message);
}

/** Transient fetch failures preserve a stored session; other indeterminate failures surface an error. */
export function shouldFailInitialAuthVerification(error: unknown) {
  return Boolean(error) && !isDefinitiveAuthValidationError(error) && !isRetryableInitialAuthVerificationError(error);
}

/** `next` must be a same-origin relative path; /auth/callback re-validates it
 *  regardless (open-redirect defense-in-depth), so a bad value here just falls
 *  back to "/" rather than being a security boundary in itself. */
function authCallbackRedirect(next?: string) {
  if (typeof window === "undefined") return undefined;
  const base = `${window.location.origin}${AUTH_CALLBACK_PATH}`;
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

/** Consume route errors and Supabase's direct provider-error fragments without exposing diagnostics. */
function consumeAuthErrorParam(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const hasProviderError = fragment.has("error") || fragment.has("error_code");
  const authError = params.get("auth_error");
  if (!authError && !hasProviderError) return null;
  params.delete("auth_error");
  const query = params.toString();
  // OAuth fragments can contain provider diagnostics and state. Remove the
  // entire fragment instead of carrying those values into another URL.
  const hash = hasProviderError ? "" : window.location.hash;
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${hash}`);
  return safeCallbackError(authError ?? fragment.get("error_code") ?? fragment.get("error"));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => createBrowserSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(client ? "loading" : "unconfigured");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const callbackErrorRef = useRef<string | null | undefined>(undefined);
  const authRequestsRef = useRef(createAuthRequestLifecycle());
  const authFingerprintRef = useRef<string | null>(null);
  // Tracks the user id last published into context so onAuthStateChange can
  // clear identity-bound caches *before* setSession on account switch.
  const publishedUserIdRef = useRef<string | null>(null);
  // Whether `initializeSession` has decided the initial state yet. Until it has,
  // `publishedUserIdRef` is still null even in a signed-in tab, so a boot-time
  // SIGNED_IN replay would read as null -> user, i.e. an account switch. See the
  // guard in onAuthStateChange below.
  const initialSessionPublishedRef = useRef(false);
  const [authEpoch, setAuthEpoch] = useState(0);

  const invalidateAuthRequests = useCallback(() => {
    setAuthEpoch(authRequestsRef.current.invalidate());
  }, []);
  const registerAuthRequest = useCallback((controller: AbortController) => {
    return authRequestsRef.current.register(controller);
  }, []);
  const isAuthEpochCurrent = useCallback((epoch: number) => authRequestsRef.current.isCurrent(epoch), []);

  // Patient labels expire at the end of the shift whether or not anyone signs
  // out, so the check runs on every page, signed in or not, auth configured or not.
  useEffect(() => watchPatientLabelExpiry(), []);

  useEffect(() => {
    if (!client) return () => undefined;
    let active = true;

    // Clear the URL param synchronously (no React state here — that would trip
    // react-hooks/set-state-in-effect); surface it after the async load below.
    // Keep the consumed message across Strict Mode's effect setup/cleanup replay.
    if (callbackErrorRef.current === undefined) callbackErrorRef.current = consumeAuthErrorParam();
    const callbackError = callbackErrorRef.current;

    const initializeSession = async () => {
      try {
        // Validate the stored token against the auth server before trusting it.
        // getSession() only reads the token from storage; getUser() re-validates it
        // with Supabase auth, so a stale/tampered/expired local session cannot present
        // as authenticated (or send a bad bearer token) on load.
        const [userResult, sessionResult] = await Promise.all([client.auth.getUser(), client.auth.getSession()]);
        if (!active) return;
        if (shouldFailInitialAuthVerification(userResult.error)) {
          // Nothing is published, so `publishedUserIdRef` stays null and a later
          // SIGNED_IN still clears — the conservative pre-existing behaviour for
          // a boot that could not be verified.
          initialSessionPublishedRef.current = true;
          setSession(null);
          setStatus("error");
          setNotice(null);
          setError("Session could not be verified. Check your connection and retry.");
          return;
        }
        const verifiedUserId = userResult.error ? null : (userResult.data.user?.id ?? null);
        // A retryable fetch error means the auth server was unreachable, not that
        // the token was rejected — don't drop a valid stored session for that.
        const verificationUnavailable = isRetryableInitialAuthVerificationError(userResult.error);
        const resolved = resolveInitialAuthState({
          verifiedUserId,
          session: sessionResult.data.session,
          verificationUnavailable,
        });
        publishedUserIdRef.current = resolved.session?.user?.id ?? null;
        initialSessionPublishedRef.current = true;
        setSession(resolved.session);
        setStatus(resolved.status);
        if (resolved.status === "authenticated") {
          setError(callbackError);
          setNotice(null);
        } else {
          // Initial signed-out must not wipe the guest answer-thread snapshot:
          // auth boots as `loading`, then resolves here before the dashboard
          // adopts `guest-tab-session` and restores. Account transitions still
          // clear via sign-out / user-id change / expiry handlers below.
          clearRecentQueries();
          clearSignedUrlCache();
          // A stored session the auth server rejected on boot is a session that
          // expired while the page was closed. Patient labels must not outlive it,
          // even before the shift ends; the guest stores above are kept as before.
          if (sessionResult.data.session && !resolved.session) clearPatientLabels("account-transition");
          if (callbackError) {
            setError(callbackError);
            setNotice(null);
          }
        }
      } catch {
        if (!active) return;
        initialSessionPublishedRef.current = true;
        setStatus("error");
        setError("Session could not be loaded.");
      }
    };

    void initializeSession();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, nextSession) => {
      // initializeSession() owns the initial state and validates it via getUser();
      // the INITIAL_SESSION replay re-reads the *unverified* stored session, so skip it
      // here to avoid a stale token presenting as authenticated after validation.
      // Later events (SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT, …) come from real auth
      // transitions and are trusted. Supabase warns against awaiting other auth calls
      // inside this callback, so validation stays in initializeSession, not here.
      if (event === "INITIAL_SESSION") return;
      const nextUserId = nextSession?.user?.id ?? null;
      // Clear identity-bound caches before publishing the new session. Child
      // effects run before the parent fingerprint effect; without this, an
      // account-switch SIGNED_IN can let mounted signed-image hooks re-paint
      // the previous user's still-cached URL via requestAnimationFrame.
      //
      // A PAGE RELOAD IS NOT AN ACCOUNT TRANSITION. auth-js emits SIGNED_IN for
      // a valid *stored* session while recovering it during boot
      // (`_recoverAndRefresh`), and `initialize()` flushes that queued event to
      // subscribers as soon as `initializePromise` settles — before this
      // provider's own `getUser()` round-trip returns, so `publishedUserIdRef`
      // is still null and the event would read as null -> user. Clearing there
      // destroys exactly the stores whose contract is to survive a refresh (the
      // patient profile, the favourites keys), and
      // whether it happened at all depended on when React registered this
      // listener, so the loss was intermittent. Wait until `initializeSession`
      // has published the initial state before treating a difference as a
      // switch; sign-out and expiry null the ref themselves, so a later sign-in
      // as a different user still clears.
      if (initialSessionPublishedRef.current && publishedUserIdRef.current !== nextUserId) {
        clearAccountScopedBrowserState();
      }
      publishedUserIdRef.current = nextUserId;
      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "signed_out");
      if (nextSession) {
        setError(null);
        setNotice(null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  const requireClient = useCallback(() => {
    if (client) return client;
    setStatus("unconfigured");
    setNotice(null);
    setError("Supabase browser authentication is not configured.");
    return null;
  }, [client]);

  const signInWithEmail = useCallback(
    async (email: string, next?: string) => {
      const active = requireClient();
      if (!active) return;
      setStatus("loading");
      setError(null);
      setNotice(null);
      const { error: signInError } = await active.auth
        .signInWithOtp({
          email,
          options: { emailRedirectTo: authCallbackRedirect(next) },
        })
        .catch(() => ({ error: { message: "network_error" } }));
      if (signInError) {
        setStatus("error");
        setError("Sign-in email could not be sent.");
        return;
      }
      setStatus("signed_out");
      setNotice("Check your email for the sign-in link.");
    },
    [requireClient],
  );

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      const active = requireClient();
      if (!active) return;
      setStatus("loading");
      setError(null);
      setNotice(null);
      const { error: signInError } = await active.auth
        .signInWithPassword({ email, password })
        .catch(() => ({ error: { message: "network_error" } }));
      if (signInError) {
        setStatus("error");
        setError("Sign-in failed. Check your email and password, or confirm your email address.");
        return;
      }
      // onAuthStateChange flips status to "authenticated" on success.
    },
    [requireClient],
  );

  const signUpWithPassword = useCallback(
    async (email: string, password: string) => {
      const active = requireClient();
      if (!active) return;
      setStatus("loading");
      setError(null);
      setNotice(null);
      const { data, error: signUpError } = await active.auth
        .signUp({
          email,
          password,
          options: { emailRedirectTo: authCallbackRedirect() },
        })
        .catch(() => ({ data: { session: null }, error: { message: "network_error" } }));
      if (signUpError) {
        setStatus("error");
        setError("Account creation could not be completed. Try signing in or request a recovery link.");
        return;
      }
      // With "Confirm email" ON, no session is returned until confirmation.
      if (!data.session) {
        setStatus("signed_out");
        setNotice("Check your email to confirm your account, then sign in.");
      }
    },
    [requireClient],
  );

  const signInWithOAuth = useCallback(
    async (provider: OAuthProvider, next?: string) => {
      const active = requireClient();
      if (!active) return;
      setStatus("loading");
      setError(null);
      setNotice(null);
      const { error: oauthError } = await active.auth
        .signInWithOAuth({
          provider,
          options: {
            redirectTo: authCallbackRedirect(next),
            ...(provider === "azure" ? { scopes: "email" } : {}),
          },
        })
        .catch(() => ({ error: { message: "network_error" } }));
      if (oauthError) {
        setStatus("error");
        setError("This sign-in provider is unavailable. Try email sign-in or try again later.");
        return;
      }
      // On success the browser is redirected to the provider.
    },
    [requireClient],
  );

  const signOut = useCallback(async () => {
    if (!client) return;
    invalidateAuthRequests();
    let remoteSignOutFailed = false;
    try {
      const result = await client.auth.signOut();
      if (result?.error) remoteSignOutFailed = true;
    } catch {
      remoteSignOutFailed = true;
    }
    // A failed global sign-out can leave the persisted session in place; drop it locally so a reload is signed out.
    if (remoteSignOutFailed) await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    clearAccountScopedBrowserState();
    publishedUserIdRef.current = null;
    setSession(null);
    setStatus("signed_out");
    if (remoteSignOutFailed) {
      setNotice("Signed out on this device. Reconnect to complete server sign-out.");
    } else {
      setError(null);
      setNotice(null);
    }
  }, [client, invalidateAuthRequests]);

  const markSessionExpired = useCallback(() => {
    invalidateAuthRequests();
    // Also wipes an in-progress patient context when a transient refresh
    // failure is reported as expiry — accepted: a stale profile surviving to the
    // next sign-in is the worse failure on a shared workstation.
    clearAccountScopedBrowserState();
    publishedUserIdRef.current = null;
    setSession(null);
    setStatus("expired");
    setNotice(null);
    setError("Your session expired. Sign in again to use account features.");
  }, [invalidateAuthRequests]);

  const accessToken = session?.access_token ?? null;
  const authorizationHeader = useMemo(() => authorizationHeadersForAccessToken(accessToken), [accessToken]);

  useEffect(() => {
    // Same-user access-token rotation is not an auth-owner change. Aborting
    // uploads or answer streams during routine refresh leaves valid work stale.
    const fingerprint = authSessionFingerprint(status, session?.user.id);
    if (authFingerprintRef.current === null) {
      authFingerprintRef.current = fingerprint;
      return;
    }
    if (authFingerprintRef.current === fingerprint) return;
    authFingerprintRef.current = fingerprint;
    invalidateAuthRequests();
    // Account switch / sign-in / sign-out: drop bearer signed-image URLs bound to
    // the previous identity so they cannot paint from the module LRU cache.
    clearSignedUrlCache();
  }, [invalidateAuthRequests, session?.user.id, status]);

  const value = useMemo<AuthContextValue>(
    () => ({
      client,
      session,
      status,
      error,
      notice,
      isConfigured: Boolean(client),
      authorizationHeader,
      authEpoch,
      registerAuthRequest,
      isAuthEpochCurrent,
      signInWithEmail,
      signInWithPassword,
      signUpWithPassword,
      signInWithOAuth,
      signOut,
      markSessionExpired,
    }),
    [
      client,
      session,
      status,
      error,
      notice,
      authorizationHeader,
      authEpoch,
      registerAuthRequest,
      isAuthEpochCurrent,
      signInWithEmail,
      signInWithPassword,
      signUpWithPassword,
      signInWithOAuth,
      signOut,
      markSessionExpired,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSession() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthProvider.");
  }
  return context;
}
