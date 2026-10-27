"use client";

import type { ReactNode } from "react";

import { useSignedOutSample } from "@/components/mode-kit/use-signed-out-sample";
import type { WorkAreaId } from "@/lib/work-frame/areas";

/**
 * For a server page that already knows the visitor is signed out: the page's
 * example while the example data switch shows examples in `area`, else the
 * page's own sign-in notice. Only one of the two is ever mounted.
 */
export function SignedOutExampleSwitch({
  area,
  example,
  notice,
}: {
  readonly area: WorkAreaId;
  readonly example: ReactNode;
  readonly notice: ReactNode;
}) {
  return useSignedOutSample(area) ? example : notice;
}
