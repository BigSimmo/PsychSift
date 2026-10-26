"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Clock3, Heart, Loader2, ShieldCheck, SlidersHorizontal, type LucideIcon } from "lucide-react";

import { BrandMark } from "@/components/clinical-dashboard/brand";
import {
  AccountTabSwitch,
  accountTabFor,
  EmailAuthForm,
  type EmailMode,
} from "@/components/clinical-dashboard/email-auth-form";
import { ProviderBrandIcon, type SsoProvider } from "@/components/clinical-dashboard/provider-brand-icons";
import { Sheet } from "@/components/ui/sheet";
import { cn, floatingControl, InlineNotice } from "@/components/ui-primitives";
import { ACCOUNT_SETUP_OPEN_ATTRIBUTE } from "@/lib/account-setup-open";
import { useAuthSession, type OAuthProvider } from "@/lib/supabase/client";

const workspaceBenefits = [
  {
    label: "Save favourites",
    mobileLabel: "Favourites sync",
    detail: "Reopen trusted resources on any device.",
    icon: Heart,
  },
  {
    label: "Keep your clinical defaults",
    mobileLabel: "Preferences sync",
    detail: "Your jurisdiction and answer style follow you.",
    icon: SlidersHorizontal,
  },
  {
    label: "Recent searches stay here",
    mobileLabel: "Searches stay here",
    detail: "Browser activity does not sync to your account.",
    icon: Clock3,
  },
] as const;

type WorkspaceBenefit = {
  label: string;
  mobileLabel: string;
  detail: string;
  icon: LucideIcon;
};

function providerId(provider: SsoProvider): OAuthProvider {
  if (provider === "Apple") return "apple";
  return provider === "Google" ? "google" : "azure";
}

export function AccountSetupDialog({
  open,
  onClose,
  intent = "default",
}: {
  open: boolean;
  onClose: () => void;
  /** When opened from Favourites, lead with save-favourites messaging. */
  intent?: "default" | "favourites";
}) {
  const auth = useAuthSession();
  const [pendingProvider, setPendingProvider] = useState<SsoProvider | null>(null);
  const [mode, setMode] = useState<EmailMode>(intent === "favourites" ? "signup" : "signin");
  const tab = accountTabFor(mode);
  const busy = auth.status === "loading";
  const actionBusy = busy || pendingProvider !== null;
  const isFavouritesIntent = intent === "favourites";
  const title = isFavouritesIntent
    ? "Sign up to save favourites"
    : tab === "signup"
      ? "Create your account"
      : "Welcome back";
  const description = isFavouritesIntent
    ? "Sign in or create an account to save favourites and reopen them on any device."
    : tab === "signup"
      ? "Free for health professionals. It takes about a minute."
      : "Sign in to your PsychSift account. You stay signed in on this device until you sign out.";

  // Tells the install notice to stay out of the way while this window is open.
  useEffect(() => {
    if (!open) return;
    document.documentElement.setAttribute(ACCOUNT_SETUP_OPEN_ATTRIBUTE, "");
    return () => document.documentElement.removeAttribute(ACCOUNT_SETUP_OPEN_ATTRIBUTE);
  }, [open]);

  async function chooseProvider(provider: SsoProvider) {
    if (actionBusy) return;
    setPendingProvider(provider);
    try {
      await auth.signInWithOAuth(providerId(provider));
    } finally {
      setPendingProvider(null);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Account setup"
      closeLabel="Close account setup"
      mobileHeaderSafeArea="offset"
      // Phone: the close button gets its own row above the scrolling body, so it never
      // floats over a provider button as the form scrolls. From sm it floats in the corner.
      headerClassName="static z-30 justify-end border-0 bg-[color:var(--clinical-accent-soft)] px-3 pb-0 pt-[max(0.25rem,var(--safe-area-top))] sm:absolute sm:right-4 sm:top-4 sm:w-auto sm:bg-transparent sm:p-0"
      titleClassName="sr-only"
      bodyClassName="bg-[color:var(--surface)] p-0 sm:p-0"
      contentClassName="account-setup-dialog relative max-h-[calc(100dvh-0.5rem)] sm:max-h-[calc(100dvh-2rem)] sm:max-w-[68rem]"
      portal
    >
      <div className="grid min-h-0 lg:grid-cols-[minmax(20rem,0.84fr)_minmax(0,1.36fr)]">
        <AccountOrientationPanel />

        <div className="grid content-start gap-5 bg-[color:var(--surface)] p-5 pt-8 sm:p-8 lg:p-10 lg:pt-12">
          <section aria-labelledby="account-provider-title" className="grid gap-5">
            <AccountTabSwitch
              value={tab}
              onChange={(next) => setMode(next)}
              disabled={actionBusy}
              className="mr-12 max-w-[26rem] sm:mr-10"
            />
            <div className="max-w-[36rem]">
              <h2
                id="account-provider-title"
                className="text-balance text-2xl font-semibold tracking-tight text-[color:var(--text-heading)] sm:text-3xl"
              >
                {title}
              </h2>
              <p className="mt-2 text-sm font-medium leading-6 text-[color:var(--text-muted)] sm:text-base">
                {description}
              </p>
            </div>

            <div data-testid="account-provider-grid" className="grid gap-2.5 sm:grid-cols-3">
              {(["Apple", "Google", "Microsoft"] as const).map((provider) => (
                <ProviderButton
                  key={provider}
                  provider={provider}
                  verb={tab === "signup" ? "Sign up with" : "Continue with"}
                  busy={actionBusy}
                  pending={pendingProvider === provider}
                  onClick={() => void chooseProvider(provider)}
                />
              ))}
            </div>
          </section>

          <div className="flex items-center gap-3 text-xs font-medium text-[color:var(--text-muted)]">
            <span className="h-px flex-1 bg-[color:var(--border)]" />
            <span>{tab === "signup" ? "or sign up with email" : "or with email"}</span>
            <span className="h-px flex-1 bg-[color:var(--border)]" />
          </div>

          <EmailAuthForm disabled={actionBusy} showAuthFeedback={false} mode={mode} onModeChange={setMode} />

          {auth.notice ? <InlineNotice tone="success">{auth.notice}</InlineNotice> : null}
          {auth.error ? <InlineNotice tone="danger">{auth.error}</InlineNotice> : null}

          <PrivacyFooter className="border-t border-[color:var(--border)] pt-4 lg:hidden" />
        </div>
      </div>
    </Sheet>
  );
}

function AccountOrientationPanel() {
  return (
    <section
      aria-labelledby="account-workspace-benefits"
      data-testid="account-storage-summary"
      className="relative isolate flex min-h-0 flex-col overflow-hidden bg-[color:var(--clinical-accent-soft)] px-5 pb-5 pt-1 sm:px-8 sm:py-8 lg:min-h-[36rem] lg:px-10 lg:py-10"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-24 z-0 h-80 w-[34rem] rounded-full border border-[color:var(--border-lux)]/50 bg-[color:var(--surface)]/20 forced-colors:hidden"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-48 -left-12 z-0 h-80 w-[38rem] rounded-full border border-[color:var(--border-lux)]/40 bg-[color:var(--surface)]/15 forced-colors:hidden"
      />

      <div className="relative z-10 pr-12">
        <span
          data-testid="account-workspace-mark"
          className="grid size-tap place-items-center rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface)] shadow-[var(--e2),var(--shadow-inset)]"
        >
          <BrandMark tone="emphasis" optical="chrome" className="h-8 w-8" />
        </span>
        <h3
          id="account-workspace-benefits"
          className="mt-5 max-w-[24rem] text-balance text-2xl font-semibold tracking-tight text-[color:var(--text-heading)] sm:text-3xl lg:mt-7 lg:text-4xl lg:leading-tight"
        >
          Your workspace, wherever you work.
        </h3>
      </div>

      <ul className="relative z-10 mt-5 grid grid-cols-3 gap-2 sm:gap-3 lg:mt-8 lg:grid-cols-1 lg:gap-5">
        {workspaceBenefits.map((benefit) => (
          <WorkspaceBenefitRow key={benefit.label} benefit={benefit} />
        ))}
      </ul>

      <PrivacyFooter className="relative z-10 mt-auto hidden pt-8 lg:flex" />
    </section>
  );
}

function WorkspaceBenefitRow({ benefit }: { benefit: WorkspaceBenefit }) {
  const Icon = benefit.icon;

  return (
    <li className="flex min-w-0 flex-col items-center gap-2 rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface)]/55 p-2.5 text-center shadow-[var(--shadow-inset)] sm:p-3 lg:flex-row lg:items-start lg:gap-3 lg:border-0 lg:bg-transparent lg:p-0 lg:text-left lg:shadow-none">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface)] text-[color:var(--clinical-accent)] shadow-[var(--e2),var(--shadow-inset)] lg:h-10 lg:w-10">
        <Icon aria-hidden="true" className="h-4 w-4 lg:h-[1.125rem] lg:w-[1.125rem]" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold leading-4 text-[color:var(--text-heading)] sm:text-sm lg:hidden">
          {benefit.mobileLabel}
        </span>
        <span className="hidden text-sm font-semibold leading-5 text-[color:var(--text-heading)] lg:block">
          {benefit.label}
        </span>
        <span className="mt-0.5 hidden text-xs font-medium leading-5 text-[color:var(--text-muted)] lg:block">
          {benefit.detail}
        </span>
      </span>
    </li>
  );
}

function PrivacyFooter({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-start gap-2.5 text-xs font-medium leading-5 text-[color:var(--text-muted)]", className)}
    >
      <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" />
      <p>
        <span className="block">Do not enter patient-identifiable information.</span>
        <Link
          href="/privacy"
          className="mt-0.5 inline-flex min-h-tap items-center gap-1 font-semibold text-[color:var(--clinical-accent)] underline decoration-transparent underline-offset-4 transition hover:decoration-current focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none"
        >
          Privacy and data processing
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
        <span className="mt-0.5 flex flex-wrap gap-x-4">
          <Link
            href="/terms"
            className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)] underline decoration-transparent underline-offset-4 transition hover:decoration-current focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none"
          >
            Terms of Use
          </Link>
          <Link
            href="/about"
            className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)] underline decoration-transparent underline-offset-4 transition hover:decoration-current focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none"
          >
            About and intended use
          </Link>
        </span>
      </p>
    </div>
  );
}

function ProviderButton({
  provider,
  verb,
  busy,
  pending,
  onClick,
}: {
  provider: SsoProvider;
  /** Providers make the account on first use, so the create tab says so. */
  verb: "Continue with" | "Sign up with";
  busy: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={`${verb} ${provider}`}
      data-provider={provider.toLowerCase()}
      className={cn(
        floatingControl,
        // Absolute 48px floor wins over rem-based min-h-tap/min-h-12: Interface
        // density can set the root to 15px (3rem → 45px), and ui-smoke asserts
        // these provider controls at a hard 48px bounding box.
        "!min-h-[48px] w-full min-w-0 justify-center gap-2.5 bg-[color:var(--surface-lux)] px-3 shadow-[var(--shadow-inset)]",
      )}
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin motion-reduce:animate-none" />
      ) : (
        <ProviderBrandIcon provider={provider} className="h-5 w-5" />
      )}
      <span className="min-w-0 truncate">
        {pending ? (
          "Connecting…"
        ) : (
          <>
            <span className="sm:hidden">{verb} </span>
            {provider}
          </>
        )}
      </span>
    </button>
  );
}
