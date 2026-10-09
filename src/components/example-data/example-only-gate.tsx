"use client";

import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";

import { WorkButton, WorkCard, WorkEmpty } from "@/components/mode-kit/work";
import { useExampleData } from "@/lib/example-data/store";
import type { WorkAreaId } from "@/lib/work-frame/areas";

/**
 * For a screen that has no real data source yet (it needs the hospital's side,
 * which waits on database work): it only ever shows example data, so a real
 * user must never land on it and read made-up figures as theirs. With the
 * area's example data on it renders the screen; otherwise it says plainly
 * that the screen is not connected and offers to look at it with example data.
 * Back navigation stays with the frame, so it is never a dead end.
 */
export function ExampleOnlyGate({
  area,
  what,
  children,
}: {
  readonly area: WorkAreaId;
  /** What the screen is, for the sentence: "Workforce", "Your trainee's record". */
  readonly what: string;
  readonly children: ReactNode;
}) {
  const { active, turnOn } = useExampleData(area);
  const router = useRouter();
  const lookAround = useCallback(() => {
    turnOn();
    router.refresh();
  }, [router, turnOn]);

  if (active) return <>{children}</>;
  return (
    <WorkCard testId="example-only-gate">
      <WorkEmpty
        icon={Building2}
        title={
          <span role="heading" aria-level={2}>
            {what} is not connected yet
          </span>
        }
        body="It needs your hospital's side, which is still being built. You can see how it works with example data."
        action={
          <WorkButton size="wide" onClick={lookAround} testId="example-only-gate-look">
            Look around with example data
          </WorkButton>
        }
      />
    </WorkCard>
  );
}
