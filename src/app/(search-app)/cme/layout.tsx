import { Suspense, type ReactNode } from "react";
import { CmePageTabs } from "@/components/cme/cme-page-tabs";
import { CmeOwnerBoundary } from "@/components/cme/cme-owner-boundary";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ModeBand } from "@/components/mode-band/mode-band";

// CPD's own work-mode pieces (copper shades, hours bar, month chart, switch).
import "@/components/cme/cme-work.css";

/** Bind server-rendered private records to the owner verified for this response. */
export default async function CmeLayout({ children }: { children: ReactNode }) {
  const demoMode = isDemoMode();
  let serverOwnerId: string | null = null;
  let serverAuthVerified = false;
  if (!demoMode) {
    try {
      const client = await createSupabaseServerClient();
      const result = client ? await client.auth.getUser() : null;
      if (result && !result.error) {
        serverOwnerId = result.data.user?.id ?? null;
        serverAuthVerified = true;
      } else if (result?.error?.name === "AuthSessionMissingError") {
        serverAuthVerified = true;
      }
    } catch {
      // Fail closed. Client identity must never grant access to stale server children.
    }
  }
  return (
    // The band sits outside the owner boundary: it holds no private record, so it
    // shows signed out, offline and while the session is checked, and the page's
    // status line and counts reach it from inside the boundary.
    // A record, a form, the summary and Customise keep their own back-arrow headers.
    // Each page names its own band (eyebrow: when its records loaded) and puts
    // its own one action in the band (work-mode redesign, owner request 6 Oct 2026).
    <ModeBand modeId="cme" hiddenOn={["/cme/log/", "/cme/new", "/cme/summary", "/cme/customise"]}>
      <CmeOwnerBoundary serverOwnerId={serverOwnerId} serverAuthVerified={serverAuthVerified} demoMode={demoMode}>
        <Suspense fallback={null}>
          <CmePageTabs />
        </Suspense>
        {children}
      </CmeOwnerBoundary>
    </ModeBand>
  );
}
