import type { Metadata } from "next";
import { TeachingSupervision } from "@/components/teaching/teaching-supervision";
import { teachingDemoMode } from "@/lib/teaching/sample";
export const metadata: Metadata = {
  title: "Registrar supervision | Teaching | PsychSift",
  robots: { index: false, follow: false },
};
export default async function Page() {
  return <TeachingSupervision demoMode={await teachingDemoMode()} />;
}
