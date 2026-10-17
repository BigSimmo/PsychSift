"use client";

import { useEffect, useState, type FormEvent } from "react";

import { TextField } from "@/components/ui/text-field";
import { AsyncButton, cn, InlineNotice, commandControl } from "@/components/ui-primitives";
import { useAuthSession } from "@/lib/supabase/client";
import {
  clearPasswordRecoveryAuthorized,
  markPasswordRecoveryAuthorized,
  readPasswordRecoveryAuthorized,
} from "@/lib/supabase/password-recovery-authorization";

export function PasswordRecoveryForm() {
  const { client, status, session, isConfigured, error: authError } = useAuthSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [recoveryAuthorized, setRecoveryAuthorized] = useState(() => readPasswordRecoveryAuthorized());
  const signedIn = status === "authenticated" && Boolean(session);

  useEffect(() => {
    if (!client) return () => undefined;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event) => {
      if (event !== "PASSWORD_RECOVERY") return;
      markPasswordRecoveryAuthorized();
      setRecoveryAuthorized(true);
    });
    return () => subscription.unsubscribe();
  }, [client]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || busy || status === "loading") return;
    setError(null);
    setNotice(null);
    const canUpdatePassword = signedIn && readPasswordRecoveryAuthorized();
    if (canUpdatePassword && (password.length < 12 || password !== confirmation)) {
      setError(password.length < 12 ? "Use at least 12 characters." : "The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (canUpdatePassword) {
        // Revalidate the stored session before changing credentials. A URL flag
        // or stale browser state alone never permits a password update.
        const verified = await client.auth.getUser();
        if (verified.error || !verified.data.user || verified.data.user.id !== session?.user.id) {
          setError("Your session could not be verified. Open a fresh recovery link and try again.");
          return;
        }
        const result = await client.auth.updateUser({ password });
        if (result.error) {
          setError("The password could not be changed. Use a different password or request a fresh recovery link.");
          return;
        }
        clearPasswordRecoveryAuthorized();
        setRecoveryAuthorized(false);
        setComplete(true);
        setNotice("Your password has been updated.");
      } else {
        // Signed-in without recovery proof never reaches updateUser — that is the
        // shared-workstation takeover gate. Offer a fresh recovery email instead.
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`;
        const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (result.error) {
          setError("We could not send the recovery email. Please try again shortly.");
          return;
        }
        setNotice("If an account exists for this email, a recovery link is on its way. Open it in this browser.");
      }
    } catch {
      setError("We could not connect. Check your connection and try again.");
    } finally {
      setPassword("");
      setConfirmation("");
      setBusy(false);
    }
  }

  if (!isConfigured) return <InlineNotice tone="warning">Password recovery is currently unavailable.</InlineNotice>;
  if (status === "loading") return <p role="status">Checking your session…</p>;

  return (
    <form onSubmit={submit} className="mt-6 grid gap-4" aria-label="Password recovery">
      {!complete && (
        <>
          <p className="text-sm leading-6 text-[color:var(--text-muted)]">
            {signedIn
              ? recoveryAuthorized
                ? `Choose a new password for ${session?.user.email ?? "your signed-in account"}.`
                : "This page only changes a password after you open a recovery link. Request a fresh link below if you need one."
              : "Enter your account email to receive a recovery link."}
          </p>
          {signedIn && recoveryAuthorized ? (
            <>
              <TextField
                label="New password"
                type="password"
                name="new-password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={12}
                disabled={busy}
                hint="Use at least 12 characters."
              />
              <TextField
                label="Confirm new password"
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
                minLength={12}
                disabled={busy}
              />
              <AsyncButton
                type="submit"
                busy={busy}
                busyLabel="Please wait…"
                disabled={busy || !password || !confirmation}
                className={cn(commandControl, "w-full")}
              >
                Update password
              </AsyncButton>
            </>
          ) : (
            <>
              <TextField
                label="Email address"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={busy}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <AsyncButton
                type="submit"
                busy={busy}
                busyLabel="Please wait…"
                disabled={busy || !email.trim()}
                className={cn(commandControl, "w-full")}
              >
                Send recovery link
              </AsyncButton>
            </>
          )}
        </>
      )}
      {notice && <InlineNotice tone="success">{notice}</InlineNotice>}
      {error && <InlineNotice tone="danger">{error}</InlineNotice>}
      {!error && !notice && authError && (
        <InlineNotice tone="danger">
          This sign-in link could not be completed. Request a fresh recovery link.
        </InlineNotice>
      )}
    </form>
  );
}
