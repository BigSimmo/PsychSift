import "server-only";

import { cache } from "react";

import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * #3738: the server-rendered medicine and differential pages carry record content in their
 * first response, so they check sign-in on the server too (the #3696 / #3728 rule behind
 * `requireSignedInClinicalAccess`). A signed-out request gets the sign-in card and no record.
 * Demo mode keeps its synthetic content open, local no-auth development is allowed through
 * (it can never be on in production), and with no Supabase configured the pages behave as
 * the APIs do. Wrapped in `cache` so a layout, page and metadata share one auth lookup.
 */
export const clinicalPageSignInRequired = cache(async (): Promise<boolean> => {
  if (isDemoMode() || isLocalNoAuthMode()) return false;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return false;
  const { data } = await supabase.auth.getUser();
  return !data.user;
});
