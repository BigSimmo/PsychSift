import { cookies } from "next/headers";

import { isDemoMode } from "@/lib/env";
import { exampleDataOn } from "@/lib/example-data/server";
import { TEACHING_SAMPLE_COOKIE } from "@/lib/teaching/sample-paths";

/*
 * The Teaching sample: a signed-out visitor can walk the whole mode on the
 * made-up programme (`demo-programme.ts`) without an account. It is the same
 * switch demo mode flips — every Teaching screen already renders synthetic
 * data and never calls the API when `demoMode` is true — so the sample adds
 * no data path, only a way to turn it on for one browser. The cookie is a
 * display preference, not a credential: the Teaching API never reads it.
 */
export async function teachingSampleOn(): Promise<boolean> {
  return (await cookies()).get(TEACHING_SAMPLE_COOKIE)?.value === "1";
}

/**
 * What every Teaching page passes as `demoMode`: real demo mode, this browser's
 * signed-out sample, or the work-mode example data switch (one switch for every
 * area, `src/lib/example-data/`). All three show the same invented programme
 * and none of them can write.
 */
export async function teachingDemoMode(): Promise<boolean> {
  return isDemoMode() || (await teachingSampleOn()) || (await exampleDataOn("teach"));
}
