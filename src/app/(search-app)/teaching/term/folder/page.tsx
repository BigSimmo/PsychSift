import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { TermFolderPage } from "@/components/teaching/term-folder/term-folder-page";
import { teachingDemoMode } from "@/lib/teaching/sample";

export const metadata: Metadata = {
  title: "Evidence folder | Teaching | PsychSift",
  description: "An earlier term in one folder: attendance, supervision and assessment dates, ready to export.",
  robots: { index: false, follow: false },
};

type TermFolderRouteProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/*
 * The current term's folder is now part of the Term page (owner-approved mock-up, 11 Oct 2026), so the
 * bare address forwards there; the proxy normally answers first. `?term=` still opens an earlier term's
 * folder here, from the Term page's Other terms list, so a finished term can be exported.
 */
export default async function TeachingTermFolderRoute({ searchParams }: TermFolderRouteProps) {
  const query = await searchParams;
  const term = typeof query.term === "string" && /^[\w-]{1,40}$/.test(query.term) ? query.term : null;
  if (!term) permanentRedirect("/teaching/term");
  return <TermFolderPage demoMode={await teachingDemoMode()} termId={term} />;
}
