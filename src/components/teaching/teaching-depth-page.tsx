"use client";

import type { ComponentType, ReactNode } from "react";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import type { TeachingResource } from "@/components/teaching/use-teaching-resource";
import { useTeachingDemoMode } from "@/components/teaching/use-teaching-sample";
import { useAuthSession } from "@/lib/supabase/client";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";

/**
 * Page names the band already shows, so a depth page with one of these titles
 * keeps its h1 for screen readers only. Written out rather than read from the
 * mode pill's registry: since the work-mode redesign (owner request 6 Oct 2026)
 * that registry lists only the frame's three pinned tabs, while the band still
 * names these pages.
 */
const TAB_LABELS: ReadonlySet<string> = new Set([
  "Today",
  "Week",
  "Logbook",
  "This week",
  "Presenting",
  "Assessments",
  "My record",
  "Resources",
  "Organise",
]);

/**
 * A depth page's submit, held at the bottom of the screen inside the page's own flow (not fixed chrome),
 * so a long list never pushes it out of thumb reach. It paints the page background and adds no padding.
 */
export const teachingStickySubmit =
  "sticky bottom-0 z-[var(--z-raised)] -mx-3 grid gap-2 border-t border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2";

/** Account changes also clear unsaved choices and mutation results, not just fetched records. */
export function TeachingAccountPage({
  component: Component,
  demoMode,
}: {
  component: ComponentType<{ demoMode: boolean }>;
  demoMode: boolean;
}) {
  const auth = useAuthSession();
  const demo = useTeachingDemoMode(demoMode);
  return <Component key={`${auth.authEpoch}:${demo}`} demoMode={demo} />;
}

export function TeachingDepthPage<T>({
  title,
  demoMode,
  resource,
  ready,
  children,
}: {
  title: string;
  demoMode: boolean;
  resource: TeachingResource<T>;
  ready: boolean;
  children: ReactNode;
}) {
  let body = children;
  if (!demoMode && resource.status === "signed-out") body = <TeachingSignInNotice />;
  else if (!demoMode && ["offline", "error", "setup"].includes(resource.status))
    body = <TeachingStateNotice state={resource.status as "offline" | "error" | "setup"} onRetry={resource.retry} />;
  else if (!ready) body = <ModeModuleSkeleton rows={3} />;
  return (
    <InformationPageShell width="narrow" gap={false}>
      <div className="grid gap-4">
        {/* A page named by its own band tab (Teach, Supervision) leaves the name
            to the band; a child page (Weekly CPD review, Import) keeps it in view. */}
        {TAB_LABELS.has(title) ? (
          <PageTitleUnderBand className="text-xl font-semibold text-[color:var(--text-heading)]">
            {title}
          </PageTitleUnderBand>
        ) : (
          <h1 className="text-xl font-semibold text-[color:var(--text-heading)]">{title}</h1>
        )}
        {demoMode ? <ModeNotice>Made-up demo. Changes stay on this page and are not saved.</ModeNotice> : null}
        {body}
      </div>
    </InformationPageShell>
  );
}
