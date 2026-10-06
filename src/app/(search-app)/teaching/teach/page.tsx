import type { Metadata } from "next";
import { TeachingPresenting } from "@/components/teaching/teaching-presenting";
import { teachingDemoMode } from "@/lib/teaching/sample";
export const metadata: Metadata = {
  title: "Presenting | Teaching | PsychSift",
  robots: { index: false, follow: false },
};
export default async function Page({ searchParams }: { searchParams: Promise<{ talk?: string | string[] }> }) {
  const { talk } = await searchParams;
  return <TeachingPresenting demoMode={await teachingDemoMode()} talkId={typeof talk === "string" ? talk : null} />;
}
