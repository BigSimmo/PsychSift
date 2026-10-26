import "server-only";

import { cache } from "react";

import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { TERMS_VERSION } from "@/lib/front-door-content";
import { isBannedNow } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTermsAcceptance } from "@/lib/terms-acceptance";

/**
 * #3738: the server-rendered medicine and differential pages carry record content in their
 * first response, so they check sign-in on the server too (the #3696 / #3728 rule behind
 * `requireSignedInClinicalAccess`). A signed-out request gets the sign-in card and no record.
 * Demo mode keeps its synthetic content open, local no-auth development is allowed through
 * (it can never be on in production). With no Supabase configured outside those two modes the
 * sign-in card shows (N-06, 26 Oct 2026): a missing server client means the sign-in cannot be
 * checked, so the page fails closed, as the APIs do when their admin client cannot be built.
 * A blocked account gets the card too (PP-04), as the APIs refuse it on their live lookups.
 * So does a signed-in account without the health professional declaration on its account
 * record (D26-07, 26 Oct 2026): the declaration moved to first open, before any clinical
 * tool, and the card then offers the Terms instead of Sign in.
 * Wrapped in `cache` so a layout, page and metadata share one auth lookup.
 */
export const clinicalPageSignInRequired = cache(async (): Promise<boolean> => {
  if (isDemoMode() || isLocalNoAuthMode()) return false;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return true;
  const { data } = await supabase.auth.getUser();
  if (!data.user || isBannedNow(data.user)) return true;
  return readTermsAcceptance(data.user.user_metadata)?.version !== TERMS_VERSION;
});
