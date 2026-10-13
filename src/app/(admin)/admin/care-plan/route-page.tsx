import { Suspense } from "react";

import { CarePlanRoutableSuite } from "@/components/care-plan/mockups/routable-suite";

/**
 * Every Care Plan page renders this. The suite reads the URL to decide what to
 * show, so one component serves all twenty-one routes and each page file stays a
 * thin registration with no duplicated identifiers.
 */
function CarePlanRouteFallback() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading the synthetic Care Plan prototype"
      className="min-h-dvh bg-[color:var(--background)] p-5 text-[color:var(--text)]"
    >
      <div className="mx-auto grid max-w-[74rem] gap-4">
        <div className="h-12 w-56 animate-pulse rounded-[var(--radius-md)] bg-[color:var(--surface-inset)] motion-reduce:animate-none" />
        <div className="h-72 animate-pulse rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface)] motion-reduce:animate-none" />
      </div>
    </main>
  );
}

export function CarePlanRoutePage() {
  return (
    <Suspense fallback={<CarePlanRouteFallback />}>
      <CarePlanRoutableSuite />
    </Suspense>
  );
}
