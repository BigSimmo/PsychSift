"use client";

import { type FormEvent, useState } from "react";
import { KeyRound, Loader2, LockKeyhole, Mail, ShieldAlert } from "lucide-react";

import { controlDisabled, cn, floatingControl, InlineNotice, commandControl } from "@/components/ui-primitives";
import { ProviderBrandMark, type SsoProvider } from "@/components/clinical-dashboard/provider-brand-icons";
import { TextField } from "@/components/ui/text-field";
import { type OAuthProvider, useAuthSession } from "@/lib/supabase/client";
import type { DeveloperAccessState } from "@/lib/developer-area/access";
import { developerKeyUnlockUrl } from "@/lib/developer-area/link-access-shared";

/** Rendered by `DeveloperAreaGate` instead of the page whenever the visitor is
 *  not a signed-in administrator. `next` is the exact path they asked for
 *  (development hub or a specific Caring Contact route), so sign-in returns
 *  them to it rather than always landing on the hub root. */
export function DeveloperGateScreen({
  state,
  next,
  email,
  keyEntryEnabled = false,
  keyRejected = false,
}: {
  state: Exclude<DeveloperAccessState, "authorized">;
  next: string;
  email: string | null;
  /** Whether this deployment has a `DEVELOPER_AREA_ACCESS_KEY` configured at
   *  sufficient strength. A boolean, resolved on the server and never the key
   *  itself. Offering a field that cannot possibly succeed is worse than
   *  offering none, so an unconfigured deployment shows the sign-in alone. */
  keyEntryEnabled?: boolean;
  /** Whether the previous attempt's key was refused, per the marker `src/proxy.ts`
   *  puts on the redirect. The server owns this verdict because only the server
   *  holds the key. */
  keyRejected?: boolean;
}) {
  const auth = useAuthSession();
  const [formEmail, setFormEmail] = useState("");
  const [developerKey, setDeveloperKey] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  // The server's verdict stands until the value it judged actually changes.
  // Leaving it up while the field is being corrected would keep asserting a
  // failure about a key that is no longer on screen.
  const [rejectionDismissed, setRejectionDismissed] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<SsoProvider | null>(null);
  // Two separate busy states, and the separation runs BOTH ways.
  //
  // `busy` belongs to the Supabase sign-in and includes `auth.status ===
  // "loading"`, which is where an AuthProvider sits from mount until its
  // client-side getUser()/getSession() resolves. The developer key must not wait
  // on that: its whole reason for existing is that it needs no provider round
  // trip, so sharing the flag would disable the alternate credential exactly
  // when Supabase is slow, stalled or unreachable — the situation it answers.
  //
  // `unlocking` is likewise kept OUT of `busy`. It has no reset path in the
  // ordinary case because the page navigates away, so folding it into `busy`
  // meant that an unlock which did not navigate — offline, or a blocked
  // navigation — left the whole screen dead: key field, email and SSO alike,
  // until a manual reload. A stuck unlock must not take the sign-in down with
  // it.
  const busy = auth.status === "loading" || pendingProvider !== null;
  const keyBusy = unlocking;

  /**
   * Submits the typed key through the same `?devkey=` exchange a bookmarked link
   * uses — `src/proxy.ts` verifies it in constant time, sets the signed cookie,
   * and redirects with the parameter stripped.
   *
   * A full document navigation (`location.replace`), not `router.replace`: the
   * cookie is set by the Proxy on a redirect response, and only a real
   * navigation is guaranteed to commit that `Set-Cookie` and then re-run the
   * gate against it. `replace` rather than `assign` so the URL that briefly
   * carries the secret never becomes a history entry the back button — or a
   * shared screen — can return to.
   */
  function submitDeveloperKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = developerKey.trim();
    if (!key || keyBusy) return;
    setUnlocking(true);
    try {
      window.location.replace(developerKeyUnlockUrl(next, key));
    } catch {
      // A refused navigation must not leave the button spinning forever with no
      // way back other than a reload.
      setUnlocking(false);
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formEmail.trim() || busy) return;
    await auth.signInWithEmail(formEmail.trim(), next);
  }

  async function chooseProvider(provider: SsoProvider) {
    if (busy) return;
    setPendingProvider(provider);
    const providerId: OAuthProvider = provider === "Apple" ? "apple" : provider === "Google" ? "google" : "azure";
    try {
      await auth.signInWithOAuth(providerId, next);
    } finally {
      setPendingProvider(null);
    }
  }

  return (
    <main
      className="mx-auto grid w-full max-w-md gap-6 px-4 py-16 sm:px-6"
      data-testid="developer-gate-screen"
      data-developer-gate-state={state}
    >
      <header className="grid gap-2 text-center">
        <p className="inline-flex items-center justify-center gap-2 text-xs font-extrabold uppercase tracking-wide text-[color:var(--clinical-accent)]">
          {state === "unauthorized" ? (
            <ShieldAlert aria-hidden="true" className="size-icon-sm" />
          ) : (
            <LockKeyhole aria-hidden="true" className="size-icon-sm" />
          )}
          Development
        </p>
        <h1 className="text-2xl font-extrabold text-[color:var(--text-heading)]">
          {state === "unauthorized" ? "This account doesn't have developer access" : "Sign in to continue"}
        </h1>
        <p className="text-sm leading-6 text-[color:var(--text-muted)]">
          {state === "unauthorized"
            ? `Signed in as ${email ?? "this account"}. Only an authorised developer account can open this page.`
            : keyEntryEnabled
              ? "Enter the developer key, or sign in with a developer account."
              : "This page is only reachable to a signed-in developer account."}
        </p>
      </header>

      {/* Offered above the sign-in, and in the `unauthorized` state too: a
          signed-in account without the administrator claim is exactly the
          visitor for whom the key is the shorter way in, and hiding it there
          would leave a "sign out" button as the only thing on the page. */}
      {keyEntryEnabled ? (
        <form
          onSubmit={submitDeveloperKey}
          data-testid="developer-gate-key-form"
          className="grid gap-2 rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-4 shadow-[var(--shadow-inset)]"
        >
          <TextField
            label="Developer key"
            icon={KeyRound}
            type="password"
            autoComplete="current-password"
            enterKeyHint="go"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={developerKey}
            onChange={(event) => {
              setDeveloperKey(event.target.value);
              setRejectionDismissed(true);
            }}
            error={keyRejected && !rejectionDismissed ? "That key wasn't accepted. Check it and try again." : undefined}
            hint="Opens this area on this device and stays signed in for a year."
            data-testid="developer-gate-key-input"
          />
          <button
            type="submit"
            disabled={keyBusy || !developerKey.trim()}
            data-testid="developer-gate-key-submit"
            className={cn(commandControl, "w-full")}
          >
            {unlocking ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <KeyRound aria-hidden="true" className="h-4 w-4" />
            )}
            Unlock
          </button>
        </form>
      ) : null}

      {state === "unauthorized" ? (
        <button
          type="button"
          onClick={() => void auth.signOut()}
          data-testid="developer-gate-sign-out"
          className={cn(floatingControl, "min-h-12 w-full justify-center gap-2 text-sm")}
        >
          Sign out
        </button>
      ) : (
        <div className="grid gap-3 rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-4 shadow-[var(--shadow-inset)]">
          <form onSubmit={submitEmail} className="grid gap-2">
            <TextField
              label="Email address"
              icon={Mail}
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="go"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={formEmail}
              onChange={(event) => setFormEmail(event.target.value)}
              placeholder="you@clinic.example"
            />
            <button
              type="submit"
              disabled={busy || !formEmail.trim() || !auth.isConfigured}
              data-testid="developer-gate-email-submit"
              className={cn(commandControl, "w-full")}
            >
              {auth.status === "loading" ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Mail aria-hidden="true" className="h-4 w-4" />
              )}
              Continue with email
            </button>
          </form>

          <div className="flex items-center gap-3 text-xs font-medium text-[color:var(--text-muted)]">
            <span className="h-px flex-1 bg-[color:var(--border)]" />
            <span>or continue with</span>
            <span className="h-px flex-1 bg-[color:var(--border)]" />
          </div>

          <div className="grid gap-2">
            {(["Apple", "Google", "Microsoft"] as const).map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => void chooseProvider(provider)}
                disabled={busy}
                aria-label={`Continue with ${provider}`}
                className={cn(
                  controlDisabled,
                  "flex min-h-12 w-full items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-left text-sm font-semibold text-[color:var(--text-heading)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] disabled:cursor-wait",
                )}
              >
                {pendingProvider === provider ? (
                  <span className="grid h-7 w-7 shrink-0 place-items-center">
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  </span>
                ) : (
                  <ProviderBrandMark provider={provider} />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {pendingProvider === provider ? "Connecting…" : `Continue with ${provider}`}
                </span>
              </button>
            ))}
          </div>

          {auth.notice ? <InlineNotice tone="success">{auth.notice}</InlineNotice> : null}
          {auth.error ? <InlineNotice tone="danger">{auth.error}</InlineNotice> : null}
          {!auth.isConfigured ? (
            <InlineNotice tone="neutral">Sign-in is not configured for this deployment.</InlineNotice>
          ) : null}
        </div>
      )}
    </main>
  );
}
