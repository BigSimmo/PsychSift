import { Suspense, type ReactNode } from "react";
import { CmePageTabs } from "@/components/cme/cme-page-tabs";
import { CmeOwnerBoundary } from "@/components/cme/cme-owner-boundary";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ModeBand } from "@/components/mode-band/mode-band";

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
    <CmeOwnerBoundary serverOwnerId={serverOwnerId} serverAuthVerified={serverAuthVerified} demoMode={demoMode}>
      {/* A record, a form and the summary keep their own back-arrow headers. */}
      <ModeBand
        modeId="cme"
        customiseHref="/cme/customise"
        statusSlot={["/cme"]}
        hiddenOn={["/cme/log/", "/cme/new", "/cme/summary"]}
      >
        <Suspense fallback={null}>
          <CmePageTabs />
        </Suspense>
        {children}
      </ModeBand>
    </CmeOwnerBoundary>
  );
}
