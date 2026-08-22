import type { ReactNode } from "react";

import { WardFlowProvider } from "@/components/ward-management/ward-flow-provider";

/**
 * Holds the shared reducer state and clock above every ward route. No screen wires this
 * itself: a route rendered without this layout in its path must throw via `useWardFlow`
 * rather than render a substituted empty world.
 */
export default function WardManagementLayout({ children }: { children: ReactNode }) {
  return <WardFlowProvider>{children}</WardFlowProvider>;
}
