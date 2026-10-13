import type { Metadata } from "next";
import { connection } from "next/server";

import { CmeLearningPage } from "@/components/cme/cme-learning-page";
import { cpdYearOf } from "@/lib/cme/cpd-year";
import { DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import { loadLearningDirectory } from "@/lib/cme/learning-directory";
import { fetchOwnerCmeYear } from "@/lib/cme/repository";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Learning | CPD | PsychSift",
  description: "Upcoming Western Australian courses and events, curated and checked monthly.",
};

/** Only the confirmed home label crosses to the client; no owner records do. */
async function learningHomeSource(now: Date): Promise<string | null> {
  if (isDemoMode()) return DEMO_CME_YEAR.confirmedSource;
  try {
    const server = await createSupabaseServerClient();
    if (!server) return null;
    const { data, error } = await server.auth.getUser();
    if (error || !data.user) return null;
    const admin = createAdminClient();
    const currentYear = cpdYearOf(now);
    const current = await fetchOwnerCmeYear(admin, data.user.id, currentYear);
    if (current) return current.confirmedSource;
    const next = await fetchOwnerCmeYear(admin, data.user.id, currentYear + 1);
    return next?.confirmedSource ?? null;
  } catch {
    // A missing session or failed private read leaves public Learning usable at All.
    return null;
  }
}

export default async function CmeLearningRoute({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  // Render per request: the event phases and the owner's confirmed home can change.
  await connection();
  const now = new Date();
  const directory = loadLearningDirectory();
  const [query, homeSource] = await Promise.all([searchParams, learningHomeSource(now)]);
  return (
    <CmeLearningPage
      items={directory.items}
      lastCheckedOn={directory.lastCheckedOn}
      nowIso={now.toISOString()}
      view={query.view === "past" ? "past" : "upcoming"}
      homeSource={homeSource}
      hospitalTeachingHref="/teaching"
    />
  );
}
