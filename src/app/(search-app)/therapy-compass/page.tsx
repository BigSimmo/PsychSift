import { redirect } from "next/navigation";

import { appModeSelectionHref } from "@/lib/app-modes";
import { consolidatedModeHomeTargetForSearchParams } from "@/lib/consolidated-mode-home-redirect";

/**
 * `Therapy` has no home page of its own any more.
 *
 * Every mode shares one lightweight home at `/?mode=<id>`, whose per-mode copy
 * lives in `sharedHomePresentation` (src/lib/ui-copy.ts). This path stays so
 * bookmarks and external deep links keep resolving, and forwards to that shared
 * home. Submitted searches render at `/therapy-compass/search`; the proxy carries
 * the query across, so a deep link never lands here without one.
 *
 * The rest of the Therapy workspace is untouched — search, compare, recommend,
 * pathways and every record route still render themselves. Only the detailed
 * home retired.
 *
 * Consolidating this mode was blocked while it was `devOnly`: the shared home
 * hides devOnly modes in production, so `/?mode=therapy-compass` came back as
 * mode Answer. PR #2150 shipped Therapy in production with its review state
 * disclosed, which lifted that gate.
 */
type TherapyCompassHomeRouteProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TherapyCompassHomeRoute({ searchParams }: TherapyCompassHomeRouteProps) {
  // Resolved through the same helper the proxy uses (as Forms does), so a request
  // that reaches this backstop lands where the proxy would have sent it — a
  // submitted `?q=…&run=1` goes on to /therapy-compass/search instead of arriving
  // at the home with its query dropped.
  const params = searchParams ? await searchParams : {};
  redirect(
    consolidatedModeHomeTargetForSearchParams("/therapy-compass", params) ?? appModeSelectionHref("therapy-compass"),
  );
}
