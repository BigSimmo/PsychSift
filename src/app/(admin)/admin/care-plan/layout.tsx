import type { ReactNode } from "react";

import { CarePlanErrorBoundary } from "@/components/care-plan/mockups/care-plan-error-boundary";
import { CarePlanPrototypeProvider } from "@/components/care-plan/mockups/prototype-provider";
import { DeveloperAreaGate } from "@/components/developer-area/developer-area-gate";

/**
 * One provider for the whole route family, so every route reads the same
 * in-memory record instead of a copy of its own.
 *
 * The order matters. `DeveloperAreaGate` is outermost, so an unauthorised
 * visitor meets the sign-in screen and never reaches prototype content. The
 * error boundary sits between the gate and the provider because the provider is
 * where a broken invariant throws, and a boundary cannot catch a throw from a
 * component it does not wrap.
 */
export default function CarePlanMockupLayout({ children }: { children: ReactNode }) {
  return (
    <DeveloperAreaGate>
      <CarePlanErrorBoundary>
        <CarePlanPrototypeProvider>{children}</CarePlanPrototypeProvider>
      </CarePlanErrorBoundary>
    </DeveloperAreaGate>
  );
}
