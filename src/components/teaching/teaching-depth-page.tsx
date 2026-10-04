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
        <h1 className="text-xl font-semibold text-[color:var(--text-heading)]">{title}</h1>
        {demoMode ? <ModeNotice>Made-up demo. Changes stay on this page and are not saved.</ModeNotice> : null}
        {body}
      </div>
    </InformationPageShell>
  );
}
