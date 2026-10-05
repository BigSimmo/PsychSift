import type { Metadata } from "next";
import { TeachingPresenting } from "@/components/teaching/teaching-presenting";
import { teachingDemoMode } from "@/lib/teaching/sample";
export const metadata: Metadata = {
  title: "Presenting | Teaching | PsychSift",
  robots: { index: false, follow: false },
};
export default async function Page() {
  return <TeachingPresenting demoMode={await teachingDemoMode()} />;
}
