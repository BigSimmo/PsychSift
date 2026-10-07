import type { Metadata } from "next";

import { TermFolderPage } from "@/components/teaching/term-folder/term-folder-page";
import { teachingDemoMode } from "@/lib/teaching/sample";

export const metadata: Metadata = {
  title: "Evidence folder | Teaching | PsychSift",
  description: "Your term in one folder: attendance, supervision and assessment dates, ready to export.",
  robots: { index: false, follow: false },
};

type TermFolderRouteProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/* Demo mode is read on the server; the term itself is kept on this device. `?term=` opens an earlier term. */
export default async function TeachingTermFolderRoute({ searchParams }: TermFolderRouteProps) {
  const query = await searchParams;
  const term = typeof query.term === "string" && /^[\w-]{1,40}$/.test(query.term) ? query.term : null;
  return <TermFolderPage demoMode={await teachingDemoMode()} termId={term} />;
}
