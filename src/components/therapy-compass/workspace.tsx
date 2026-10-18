"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ModeHomeVerificationFooter } from "@/components/mode-home-template";
import { InformationPageShell } from "@/components/information-page-shell";
import { cn, pageContainer } from "@/components/ui-primitives";
import { isInformationPage } from "@/lib/information-pages";

import { TcProvider, useTcBindings } from "./bindings";
import { TherapyCompareTray } from "./therapy-compare-tray";

function TherapyCompassFooter() {
  return (
    <div data-therapy-no-print className={cn(pageContainer, "mt-7.5 border-t border-[color:var(--border)] pt-5")}>
      <ModeHomeVerificationFooter
        label="Source-grounded therapy reference"
        body="Source-grounded — review status before clinical use"
      />
    </div>
  );
}

function TherapyCompassDataError() {
  const b = useTcBindings();
  return (
    <section
      role="alert"
      aria-busy={b.loading}
      className="mx-auto my-10 max-w-2xl rounded-xl border border-[color:var(--danger)] bg-[color:var(--danger-soft)] p-6"
    >
      <PageHeader
        title="Therapy could not load"
        description="The therapy catalogue is unavailable. No results are being shown as a substitute."
        actions={
          <Button variant="primary" onClick={b.retryData} busy={b.loading} busyLabel="Retrying…">
            Retry
          </Button>
        }
      />
    </section>
  );
}

function TherapyCompassInformationRoute({ children }: { children: ReactNode }) {
  const b = useTcBindings();
  if (b.error) {
    return (
      <InformationPageShell testId="therapy-information-error">
        <TherapyCompassDataError />
      </InformationPageShell>
    );
  }
  if (b.loading && b.therapies.length === 0) {
    return <InformationPageShell testId="therapy-information-loading">{children}</InformationPageShell>;
  }
  return children;
}

function TherapyCompassMain({
  children,
  showFooter,
  asMain,
}: {
  children: ReactNode;
  showFooter: boolean;
  /** Home renders ModeHomeMain; keep a non-main shell so landmarks are not nested. */
  asMain: boolean;
}) {
  const b = useTcBindings();
  // Home normally leaves <main> to ModeHomeMain. Initial loading and load
  // failure replace that child, so the workspace must own the landmark then.
  const homeNeedsMainLandmark = Boolean(b.error) || (b.loading && b.therapies.length === 0);
  const useMainLandmark = asMain || homeNeedsMainLandmark;
  const Tag = useMainLandmark ? "main" : "div";
  return (
    // Horizontal padding matches `--header-edge-pad` (1rem, 1.5rem from lg) so
    // the body's content edge lands on the same column as the header row and
    // the mode nav's first tab. The cap itself lives on the `<section>` inside,
    // reproducing the header's padding-outside-max-width geometry.
    <Tag className={useMainLandmark ? "min-w-0 px-4 pt-5 pb-8 sm:pt-8 sm:pb-10 lg:px-6" : "min-w-0"}>
      {b.error ? <TherapyCompassDataError /> : children}
      {showFooter ? <TherapyCompassFooter /> : null}
    </Tag>
  );
}

/** Shared Therapy workspace chrome for every `/therapy-compass/*` route. */
export function TherapyCompassWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/therapy-compass";
  const informationPage = isInformationPage(pathname);

  return (
    <TcProvider>
      <div data-therapy-root className="min-h-0 bg-[color:var(--background)] text-[color:var(--text)] sm:grow">
        {informationPage ? (
          <TherapyCompassInformationRoute>{children}</TherapyCompassInformationRoute>
        ) : (
          <TherapyCompassMain showFooter={!isHome} asMain={!isHome}>
            {children}
          </TherapyCompassMain>
        )}
      </div>
      {/* Mounted once for the whole mode. The tray decides for itself whether a
          dock slot exists to portal into, so record routes (which have no phone
          composer) simply get nothing. */}
      <TherapyCompareTray />
    </TcProvider>
  );
}
