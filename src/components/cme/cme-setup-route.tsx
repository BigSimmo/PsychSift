"use client";

import { useRouter } from "next/navigation";

import { CmeProgrammePage } from "@/components/cme/cme-programme-page";
import { CmeSetupPage } from "@/components/cme/cme-setup-page";
import type { CmeRequirementSet } from "@/lib/cme/types";

export function CmeSetupRoute({
  year,
  set,
  demoMode,
  editInitially = false,
  returnHref = null,
}: {
  readonly year: number;
  readonly set: CmeRequirementSet | null;
  readonly demoMode: boolean;
  readonly editInitially?: boolean;
  /** Where to go once confirmed, already checked on the server: back to the plan a carry started from. */
  readonly returnHref?: string | null;
}) {
  const router = useRouter();
  if (set && !editInitially) {
    return <CmeProgrammePage set={set} title="Set up" />;
  }
  return (
    <CmeSetupPage
      year={year}
      set={set}
      demoMode={demoMode}
      onConfirm={async (requirementSet) => {
        if (demoMode)
          throw new Error("These are example records. Sign in to confirm requirements for your private record.");
        const response = await fetch("/api/cme/year", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requirementSet),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
          const message =
            typeof payload?.message === "string"
              ? payload.message
              : typeof payload?.error === "string"
                ? payload.error
                : `Could not confirm requirements (${response.status}).`;
          throw new Error(message);
        }
        router.push(returnHref ?? `/cme/setup?year=${year}`);
        router.refresh();
      }}
    />
  );
}
