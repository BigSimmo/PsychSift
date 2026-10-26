"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextField } from "@/components/ui/text-field";
import { AsyncButton, cn, InlineNotice, commandControl } from "@/components/ui-primitives";
import { PRIVACY_SIGN_IN_NOTE, TERMS_SIGN_IN_NOTE } from "@/lib/front-door-content";
import { forgetRememberedEmail, readRememberedEmail, rememberEmail } from "@/lib/remembered-email";
import { useAuthSession } from "@/lib/supabase/client";

/** "link" is the email-link variant of signing in, not a third destination. */
export type EmailMode = "signin" | "signup" | "link";
export type AccountTab = "signin" | "signup";

export function accountTabFor(mode: EmailMode): AccountTab {
  return mode === "signup" ? "signup" : "signin";
}

const accountTabOptions = [
  { value: "signin", label: "Sign in" },
  { value: "signup", label: "Create account" },
] as const;

/** The one switch between signing in and creating an account. */
export function AccountTabSwitch({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: AccountTab;
  onChange: (tab: AccountTab) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <SegmentedControl
      label="Sign in or create an account"
      layout="equal"
      value={value}
      onChange={onChange}
      options={accountTabOptions.map((option) => ({ ...option, disabled }))}
      className={className}
    />
  );
}

const textLink =
  "inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)] underline decoration-transparent underline-offset-4 transition hover:decoration-current focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] disabled:cursor-not-allowed disabled:text-[color:var(--disabled)] motion-reduce:transition-none";

export function EmailAuthForm({
  disabled = false,
  showAuthFeedback = true,
  mode: controlledMode,
  onModeChange,
}: {
  disabled?: boolean;
  showAuthFeedback?: boolean;
  /** Controlled by AccountSetupDialog, which shows the switch above its providers. */
  mode?: EmailMode;
  onModeChange?: (mode: EmailMode) => void;
}) {
  const auth = useAuthSession();
  const [ownMode, setOwnMode] = useState<EmailMode>("signin");
  const mode = controlledMode ?? ownMode;
  // The form only renders inside the opened account window, never in server HTML.
  const [email, setEmail] = useState(() => (typeof window === "undefined" ? "" : (readRememberedEmail() ?? "")));
  const [remember, setRemember] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const rememberId = useId();
  const busy = pending || disabled || auth.status === "loading";

  function changeMode(next: EmailMode) {
    if (controlledMode === undefined) setOwnMode(next);
    onModeChange?.(next);
    setPassword("");
    setConfirmation("");
    setShowPassword(false);
    setLocalError(null);
    setAttempted(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setLocalError(null);
    const address = email.trim();
    if (!address) {
      setLocalError("Enter your email address.");
      return;
    }
    if (mode !== "link" && !password) {
      setLocalError(mode === "signup" ? "Create a password." : "Enter your password.");
      return;
    }
    if (mode === "signup" && password !== confirmation) {
      setLocalError("The passwords do not match.");
      return;
    }
    if (remember) rememberEmail(address);
    else forgetRememberedEmail();
    setAttempted(true);
    setPending(true);
    try {
      if (mode === "link") await auth.signInWithEmail(address);
      else if (mode === "signup") await auth.signUpWithPassword(address, password);
      else await auth.signInWithPassword(address, password);
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

  const submitLabel = mode === "link" ? "Send sign-in link" : mode === "signup" ? "Create account" : "Sign in";
  const PasswordToggleIcon = showPassword ? EyeOff : Eye;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-3"
      aria-label={mode === "signup" ? "Create an account with email" : "Sign in with email"}
    >
      {controlledMode === undefined ? (
        <AccountTabSwitch value={accountTabFor(mode)} onChange={changeMode} disabled={busy} />
      ) : null}
      <TextField
        data-sheet-autofocus="true"
        label="Email address"
        name="email"
        type="email"
        icon={Mail}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="name@example.com"
        autoComplete={mode === "signup" ? "email" : "username"}
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        disabled={busy}
      />
      <label
        htmlFor={rememberId}
        className="flex min-h-tap cursor-pointer items-center gap-3 text-sm font-medium text-[color:var(--text)]"
      >
        <input
          id={rememberId}
          type="checkbox"
          checked={remember}
          onChange={(event) => {
            setRemember(event.target.checked);
            if (!event.target.checked) forgetRememberedEmail();
          }}
          disabled={busy}
          className="h-5 w-5 shrink-0 accent-[color:var(--clinical-accent)]"
        />
        Remember my email on this device
      </label>
      {mode !== "link" && (
        <div className="grid gap-1">
          <TextField
            label={mode === "signup" ? "Create a password" : "Password"}
            name="password"
            type={showPassword ? "text" : "password"}
            icon={LockKeyhole}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={busy}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={mode === "signup" ? 12 : undefined}
            hint={mode === "signup" ? "At least 12 characters. A unique passphrase works well." : undefined}
          />
          <div className="flex flex-wrap items-center justify-between gap-x-4">
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-pressed={showPassword}
              disabled={busy}
              className={cn(textLink, "gap-1.5 text-sm")}
            >
              <PasswordToggleIcon aria-hidden="true" className="h-4 w-4" />
              Show password
            </button>
            {mode === "signin" && (
              <Link href="/auth/reset-password" prefetch={false} className={cn(textLink, "text-sm")}>
                Forgot password?
              </Link>
            )}
          </div>
        </div>
      )}
      {mode === "signup" && (
        <TextField
          label="Confirm password"
          name="confirm-password"
          type={showPassword ? "text" : "password"}
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
        disabled={busy || !auth.isConfigured}
        className={cn(commandControl, "min-h-12 w-full")}
      >
        {submitLabel}
      </AsyncButton>
      {mode === "link" && (
        <p className="text-sm text-[color:var(--text-muted)]">
          We’ll email you a secure sign-in link. No password needed.
        </p>
      )}
      {mode === "signup" && (
        <p className="rounded-lg bg-[color:var(--clinical-accent-soft)] px-3 py-2.5 text-sm text-[color:var(--text)]">
          We’ll email you a link to confirm your address. It brings you straight back here.
        </p>
      )}
      {localError && <InlineNotice tone="danger">{localError}</InlineNotice>}
      {showAuthFeedback && attempted && auth.error && <InlineNotice tone="danger">{auth.error}</InlineNotice>}
      {showAuthFeedback && attempted && auth.notice && <InlineNotice tone="success">{auth.notice}</InlineNotice>}
      <div className="grid justify-items-center text-sm text-[color:var(--text-muted)]">
        {mode === "signin" && (
          <button type="button" onClick={() => changeMode("link")} disabled={busy} className={textLink}>
            Email me a sign-in link instead
          </button>
        )}
        {mode === "link" && (
          <button type="button" onClick={() => changeMode("signin")} disabled={busy} className={textLink}>
            Sign in with a password instead
          </button>
        )}
        <p className="flex flex-wrap items-center justify-center gap-x-1.5">
          {mode === "signup" ? "Already have an account?" : "New to PsychSift?"}
          <button
            type="button"
            onClick={() => changeMode(mode === "signup" ? "signin" : "signup")}
            disabled={busy}
            className={textLink}
          >
            {mode === "signup" ? "Sign in instead" : "Create an account"}
          </button>
        </p>
      </div>
      <p className="text-xs leading-5 text-[color:var(--text-muted)]" data-testid="email-auth-terms-note">
        {TERMS_SIGN_IN_NOTE}{" "}
        <Link
          href="/terms"
          prefetch={false}
          className="font-semibold text-[color:var(--clinical-accent)] underline underline-offset-4"
        >
          Terms of Use
        </Link>
        . {PRIVACY_SIGN_IN_NOTE}{" "}
        <Link
          href="/privacy"
          prefetch={false}
          className="font-semibold text-[color:var(--clinical-accent)] underline underline-offset-4"
        >
          privacy notice
        </Link>
        .
      </p>
    </form>
  );
}
