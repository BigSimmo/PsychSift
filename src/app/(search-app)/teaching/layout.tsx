import type { ReactNode } from "react";

import { TeachingSampleChrome } from "@/components/teaching/teaching-sample-notice";
import { teachingSampleOn } from "@/lib/teaching/sample";

/**
 * Every Teaching page starts with the sample notice for a visitor who is not signed in (decided in the
 * browser), or the older sample banner while this browser still holds the sample cookie.
 */
export default async function TeachingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TeachingSampleChrome cookieSample={await teachingSampleOn()} />
      {children}
    </>
  );
}
