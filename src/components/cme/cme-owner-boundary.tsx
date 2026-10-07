"use client";
import { LogIn } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { CmeOfflineBanner } from "@/components/cme/cme-offline-banner";
import { CmeSampleContext } from "@/components/cme/cme-sample-context";
import { ModeBandStatus } from "@/components/mode-band/mode-band";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { useExampleData } from "@/lib/example-data/store";
import { useAuthSession } from "@/lib/supabase/client";

/**
 * The signed-out sample: the real CPD screens filled with invented data, downloaded
 * only when a signed-out visitor opens CPD, so it never counts toward anyone's first load.
 */
const CmeSignedOutSample = dynamic(
  () => import("@/components/cme/cme-signed-out-sample").then((module) => module.CmeSignedOutSample),
  { ssr: false, loading: () => <div data-testid="cme-sample-loading" aria-hidden="true" className="min-h-48" /> },
);

/* The sign-in dialog is closed at first paint, so it loads only when first opened. */
const AccountSetupDialog = dynamic(
  () => import("@/components/clinical-dashboard/account-setup-dialog").then((module) => module.AccountSetupDialog),
  { ssr: false },
);

function subscribeConnectivity(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getConnectivitySnapshot() {
  return navigator.onLine;
}

function getServerConnectivitySnapshot() {
  return true;
}

type CmeOwnerBoundaryProps = {
  readonly serverOwnerId: string | null;
  readonly serverAuthVerified: boolean;
  /** Set only by the server's explicit synthetic demo environment. */
  readonly demoMode: boolean;
  readonly children: ReactNode;
};

/** A client auth change does not replace cached Server Component children by itself. */
export function CmeOwnerBoundary({ serverOwnerId, serverAuthVerified, demoMode, children }: CmeOwnerBoundaryProps) {
  const isOnline = useSyncExternalStore(subscribeConnectivity, getConnectivitySnapshot, getServerConnectivitySnapshot);
  const isOffline = !isOnline;
  const auth = useAuthSession();
  const cpdExample = useExampleData("cpd").active;
  const router = useRouter();
  const clientOwnerId = auth.status === "authenticated" ? (auth.session?.user.id ?? null) : null;
  const resolved =
    (auth.status === "authenticated" && clientOwnerId !== null) ||
    auth.status === "signed_out" ||
    auth.status === "expired";
  const previousOwner = useRef(serverOwnerId);
  const lastMismatch = useRef<string | null>(null);

  useEffect(() => {
    if (demoMode || !resolved) return;
    const identityChanged = previousOwner.current !== clientOwnerId;
    previousOwner.current = clientOwnerId;
    const mismatch = !serverAuthVerified || serverOwnerId !== clientOwnerId;
    const pair = JSON.stringify([serverAuthVerified, serverOwnerId, clientOwnerId]);
    // Refresh once per transition/mismatched response, including an old response
    // arriving after another account switch. Never retry endlessly on an outage.
    if (identityChanged || (mismatch && lastMismatch.current !== pair)) {
      lastMismatch.current = mismatch ? pair : null;
      router.refresh();
    } else if (!mismatch) {
      lastMismatch.current = null;
    }
  }, [clientOwnerId, demoMode, resolved, router, serverAuthVerified, serverOwnerId]);

  if (demoMode) return <Fragment key="synthetic-demo">{children}</Fragment>;
  const signedOut = auth.status === "signed_out" || auth.status === "expired";
  // A signed-out visitor sees the sample while the example data switch shows it,
  // else the sign-in state; never server children, so no private record can show.
  if (signedOut) return cpdExample ? <CmeSignedOutSample /> : <CmeSignInRequired />;
  if (serverAuthVerified && resolved && clientOwnerId === serverOwnerId) {
    // The key comes from the verified SERVER identity, never a new client owner
    // applied to old children. Unmounting also discards the previous owner's drafts.
    return (
      <Fragment key={serverOwnerId ?? "signed-out"}>
        <CmeOfflineBanner />
        {/* Signed in with the switch on, the server pages serve the example year;
            the context makes the entry forms keep nothing. */}
        <CmeSampleContext.Provider value={cpdExample}>{children}</CmeSampleContext.Provider>
      </Fragment>
    );
  }

  const unavailable = !serverAuthVerified || auth.status === "error" || auth.status === "unconfigured";
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6" data-testid="cme-owner-boundary">
      {/* The mode band's line: offline, or loading while the session is checked.
          Nothing when the session could not be verified; the line below says so. */}
      <ModeBandStatus value={isOffline ? { kind: "offline" } : unavailable ? null : { kind: "loading" }} />
      <p role="status">
        {isOffline
          ? "You are offline. Connect to view or update your private CPD record."
          : unavailable
            ? "Your session could not be verified. Your private CPD record is hidden."
            : "Checking your CPD session…"}
      </p>
      {isOffline || unavailable ? (
        <button type="button" className="mt-3 min-h-tap underline" onClick={() => window.location.reload()}>
          {isOffline ? "Try again" : "Refresh page"}
        </button>
      ) : auth.status === "authenticated" ? (
        <button type="button" className="mt-3 min-h-tap underline" onClick={() => router.refresh()}>
          Refresh CPD
        </button>
      ) : null}
    </section>
  );
}

/** A signed-out visitor who turned example data off: the plain sign-in state, nothing made up. */
function CmeSignInRequired() {
  const [open, setOpen] = useState(false);
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6" data-testid="cme-signed-out">
      <EmptyState
        icon={LogIn}
        title="Sign in to see your CPD record"
        body="Your activities and hours appear here once you sign in. Nothing is shared."
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            Sign in
          </Button>
        }
      />
      {open ? <AccountSetupDialog open onClose={() => setOpen(false)} /> : null}
    </section>
  );
}
