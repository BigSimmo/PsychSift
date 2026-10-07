"use client";

import { usePathname } from "next/navigation";
import { ModeNotice } from "@/components/mode-kit/notice";
import { TEACHING_SAMPLE_PATH } from "@/lib/teaching/sample-paths";

/** Shown above every Teaching page while this browser is in the sample, with the one way out. */
export function TeachingSampleBanner() {
  const pathname = usePathname();
  if (!pathname || /^\/teaching\/c(?:\/|$)/.test(pathname)) return null;
  return (
    <div className="mx-auto w-full max-w-reading px-3 pt-4 sm:px-5 lg:px-7" data-testid="teaching-sample-banner">
      <ModeNotice>
        Sample: made-up sessions and people, so you can look around without signing in. Nothing is saved.{" "}
        <a
          href={`${TEACHING_SAMPLE_PATH}?leave=1`}
          className="font-medium text-[color:var(--mode-identity)] underline"
          data-testid="teaching-sample-leave"
        >
          Leave the sample
        </a>
      </ModeNotice>
    </div>
  );
}
