"use client";

import { type FormEvent, useState, useSyncExternalStore } from "react";
import {
  ChevronRight,
  Clock3,
  Heart,
  Loader2,
  LogOut,
  Mail,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";

import { ProviderBrandIcon, type SsoProvider } from "@/components/clinical-dashboard/provider-brand-icons";
import { AUTH_EMAIL_STORAGE_KEY, type OAuthProvider, useAuthSession } from "@/lib/supabase/client";
import {
  controlDisabled,
  AsyncButton,
  cn,
  fieldControlWithIcon,
  fieldIcon,
  fieldLabel,
  floatingControl,
  InlineNotice,
  panelSubtle,
  commandControl,
  textMuted,
} from "@/components/ui-primitives";

/** Pragmatic email shape check for inline feedback; the server remains the source of truth. */
function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function providerId(provider: SsoProvider): OAuthProvider {
  if (provider === "Apple") return "apple";
  return provider === "Google" ? "google" : "azure";
}

const authEmailChangeEvent = "clinical-kb-auth-email-change";

function getAuthEmailSnapshot() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(AUTH_EMAIL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function getServerAuthEmailSnapshot() {
  return "";
}

function subscribeAuthEmail(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const notify = () => onStoreChange();

  window.addEventListener("storage", notify);
  window.addEventListener(authEmailChangeEvent, notify);

  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(authEmailChangeEvent, notify);
  };
}

export function AuthPanel() {
  const { status, error, notice, isConfigured, signInWithEmail, signInWithOAuth, signOut, session } = useAuthSession();
  const savedEmail = useSyncExternalStore(subscribeAuthEmail, getAuthEmailSnapshot, getServerAuthEmailSnapshot);
  const [draftEmail, setDraftEmail] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<SsoProvider | null>(null);
  const email = draftEmail ?? savedEmail;
  const busy = status === "loading";
  const actionBusy = busy || pendingProvider !== null;
  const isExpired = status === "expired";
  const emailInputId = "auth-email";
  const emailErrorId = "auth-email-error";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionBusy) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError("Enter your email address to continue.");
      return;
    }
    if (!isLikelyEmail(trimmed)) {
      setEmailError("Enter a valid email address, e.g. you@clinic.example.");
      return;
    }
    setEmailError(null);
    setPendingProvider(null);
    await signInWithEmail(trimmed);
  }

  async function chooseProvider(provider: SsoProvider) {
    if (actionBusy) return;
    setPendingProvider(provider);
    try {
      await signInWithOAuth(providerId(provider));
    } finally {
      setPendingProvider(null);
    }
  }

  if (!isConfigured) {
    return (
      <div className={cn(panelSubtle, "p-3")}>
        <div className="flex items-start gap-3">
          <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--warning)]" />
          <div>
            <p className="text-sm font-semibold text-[color:var(--text)]">Real-data sign-in unavailable</p>
            <p className={cn("mt-1 text-base-minus leading-6", textMuted)}>
              Configure the Supabase public URL and publishable key before using private documents.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "authenticated") {
    return (
      <div className={cn(panelSubtle, "p-3.5")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[color:var(--text)]">Signed in for private documents</p>
              <p className={cn("mt-1 text-xs leading-5", textMuted)}>
                {session?.user.email ?? "Authenticated session"}
              </p>
            </div>
          </div>
          <button type="button" onClick={signOut} className={cn(floatingControl, "px-3 text-xs")}>
            <LogOut aria-hidden="true" className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="overflow-hidden rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] shadow-[var(--e2)]"
    >
      <div className="border-b border-[color:var(--border)]/70 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-tap w-tap shrink-0 place-items-center rounded-full bg-[color:var(--surface-inset)] text-[color:var(--text-muted)] ring-1 ring-[color:var(--border)]">
            <UserRound aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-base-minus font-semibold leading-5 text-[color:var(--text-heading)]">
              {isExpired ? "Sign-in link expired" : "Create your PsychSift account"}
            </p>
            <p className={cn("mt-1 text-sm leading-5", textMuted)}>
              {isExpired
                ? "Send a fresh link if this one failed or timed out."
                : "Save favourites and clinical defaults across signed-in devices. Do not enter PHI."}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4 sm:p-5">
        <label className="block" htmlFor={emailInputId}>
          <span className={fieldLabel}>Email address</span>
          <div className="relative">
            <Mail aria-hidden="true" className={fieldIcon} />
            <input
              id={emailInputId}
              type="email"
              name="email"
              value={email}
              onChange={(event) => {
                setDraftEmail(event.target.value);
                if (emailError) setEmailError(null);
              }}
              onBlur={(event) => {
                const value = event.target.value.trim();
                setEmailError(
                  !value || isLikelyEmail(value) ? null : "Enter a valid email address, e.g. you@clinic.example.",
                );
              }}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? emailErrorId : undefined}
              placeholder="you@clinic.example"
              // Mobile-keyboard + autofill polish: email keyboard, no
              // auto-capitalisation/spellcheck of addresses, browser autofill,
              // and an explicit "go" action key that submits the magic-link form.
              autoComplete="email"
              inputMode="email"
              enterKeyHint="go"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={fieldControlWithIcon}
            />
          </div>
          {emailError && (
            <span
              id={emailErrorId}
              role="alert"
              className="mt-1.5 block text-xs font-medium leading-5 text-[color:var(--danger)]"
            >
              {emailError}
            </span>
          )}
        </label>
        <AsyncButton
          type="submit"
          busy={busy && pendingProvider === null}
          busyLabel={isExpired ? "Sending fresh link…" : "Sending link…"}
          disabled={actionBusy || !email.trim()}
          idleIcon={<Mail aria-hidden="true" className="h-4 w-4" />}
          className={cn(commandControl, "w-full")}
        >
          {isExpired ? "Send fresh link" : "Continue with email"}
        </AsyncButton>

        <div className="flex items-center gap-3 py-1 text-xs font-medium text-[color:var(--text-muted)]">
          <span className="h-px flex-1 bg-[color:var(--border)]" />
          <span>or continue with</span>
          <span className="h-px flex-1 bg-[color:var(--border)]" />
        </div>

        <div className="grid gap-2">
          {(["Apple", "Google", "Microsoft"] as const).map((provider) => (
            <ProviderButton
              key={provider}
              provider={provider}
              busy={actionBusy}
              pending={pendingProvider === provider}
              onClick={() => void chooseProvider(provider)}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-subtle)] p-2 shadow-[var(--shadow-inset)]">
          <AuthBenefit icon={SlidersHorizontal} label="Clinical defaults" />
          <AuthBenefit icon={Heart} label="Saved favourites" />
          <AuthBenefit icon={Clock3} label="Local recents" />
        </div>

        <p className="flex items-start gap-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--clinical-accent)]" />
          Accounts save favourites and preferences. Recent searches stay in this browser session. No PHI is required.
        </p>

        {notice && <InlineNotice tone="success">{notice}</InlineNotice>}
        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
      </div>
    </form>
  );
}

function ProviderButton({
  provider,
  onClick,
  busy,
  pending,
}: {
  provider: SsoProvider;
  onClick: () => void;
  busy: boolean;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        controlDisabled,
        "flex min-h-tap w-full items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-lux)] px-3 text-left text-sm font-semibold text-[color:var(--text-heading)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] disabled:cursor-wait disabled:hover:border-[color:var(--border)] disabled:hover:bg-[color:var(--surface-lux)]",
      )}
    >
      {pending ? (
        <span className="grid h-7 w-7 shrink-0 place-items-center">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        </span>
      ) : (
        <ProviderMark provider={provider} />
      )}
      <span className="min-w-0 flex-1 truncate">{pending ? "Connecting…" : `Continue with ${provider}`}</span>
      {pending ? null : (
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)]" />
      )}
    </button>
  );
}

function ProviderMark({ provider }: { provider: "Apple" | "Google" | "Microsoft" }) {
  return (
    <span
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--shadow-inset)]",
        provider === "Apple" ? "text-[color:var(--text-heading)]" : undefined,
      )}
    >
      <ProviderBrandIcon provider={provider} className="h-4 w-4" />
    </span>
  );
}

function AuthBenefit({ icon: Icon, label }: { icon: typeof SlidersHorizontal; label: string }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-1 text-center text-2xs font-semibold leading-4 text-[color:var(--text-muted)]">
      <Icon aria-hidden="true" className="h-4 w-4 text-[color:var(--clinical-accent)]" />
      <span>{label}</span>
    </span>
  );
}
