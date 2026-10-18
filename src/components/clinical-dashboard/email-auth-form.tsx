"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { LockKeyhole, Mail } from "lucide-react";

import { TextField } from "@/components/ui/text-field";
import { AsyncButton, cn, floatingControl, InlineNotice, commandControl } from "@/components/ui-primitives";
import { useAuthSession } from "@/lib/supabase/client";

type EmailMode = "signin" | "signup" | "link";

export function EmailAuthForm({
  disabled = false,
  showAuthFeedback = true,
}: {
  disabled?: boolean;
  showAuthFeedback?: boolean;
}) {
  const auth = useAuthSession();
  const [mode, setMode] = useState<EmailMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const busy = pending || disabled || auth.status === "loading";

  function changeMode(next: EmailMode) {
    setMode(next);
    setPassword("");
    setConfirmation("");
    setLocalError(null);
    setAttempted(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setLocalError(null);
    if (mode === "signup" && password !== confirmation) {
      setLocalError("The passwords do not match.");
      return;
    }
    setAttempted(true);
    setPending(true);
    try {
      if (mode === "link") await auth.signInWithEmail(email.trim());
      else if (mode === "signup") await auth.signUpWithPassword(email.trim(), password);
      else await auth.signInWithPassword(email.trim(), password);
    } catch {
      setLocalError("We could not connect. Please try again.");
    } finally {
      setPassword("");
      setConfirmation("");
      setPending(false);
    }
  }

  if (auth.status === "authenticated") {
    return <InlineNotice tone="success">You’re signed in to PsychSift.</InlineNotice>;
  }

  return (
    <form onSubmit={submit} className="grid gap-3" aria-label="Email sign-in">
      <div className="flex flex-wrap gap-2" aria-label="Email sign-in method">
        {(
          [
            ["signin", "Sign in"],
            ["signup", "Create account"],
            ["link", "Email link"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => changeMode(value)}
            disabled={busy}
            aria-pressed={mode === value}
            className={cn(floatingControl, "px-3 text-sm")}
          >
            {label}
          </button>
        ))}
      </div>
      <TextField
        data-sheet-autofocus="true"
        label="Email address"
        name="email"
        type="email"
        icon={Mail}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        disabled={busy}
      />
      {mode !== "link" && (
        <TextField
          label="Password"
          name="password"
          type="password"
          icon={LockKeyhole}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          disabled={busy}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? 12 : undefined}
          hint={mode === "signup" ? "Use at least 12 characters. A unique passphrase works well." : undefined}
        />
      )}
      {mode === "signup" && (
        <TextField
          label="Confirm password"
          name="confirm-password"
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          disabled={busy}
          autoComplete="new-password"
          minLength={12}
        />
      )}
      <AsyncButton
        type="submit"
        busy={pending}
        busyLabel={mode === "link" ? "Sending link…" : "Please wait…"}
        disabled={busy || !auth.isConfigured || !email.trim() || (mode !== "link" && !password)}
        className={cn(commandControl, "min-h-12 w-full")}
      >
        {mode === "link" ? "Send sign-in link" : mode === "signup" ? "Create account with email" : "Sign in with email"}
      </AsyncButton>
      {mode === "link" && (
        <p className="text-sm text-[color:var(--text-muted)]">
          We’ll email you a secure sign-in link. No password needed.
        </p>
      )}
      {mode === "signup" && (
        <p className="text-sm text-[color:var(--text-muted)]">Confirm your email address before signing in.</p>
      )}
      <Link href="/auth/reset-password" prefetch={false} className={cn(floatingControl, "justify-center text-sm")}>
        Forgot password?
      </Link>
      {localError && <InlineNotice tone="danger">{localError}</InlineNotice>}
      {showAuthFeedback && attempted && auth.error && <InlineNotice tone="danger">{auth.error}</InlineNotice>}
      {showAuthFeedback && attempted && auth.notice && <InlineNotice tone="success">{auth.notice}</InlineNotice>}
    </form>
  );
}
