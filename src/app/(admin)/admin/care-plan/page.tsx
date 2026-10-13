import type { Metadata } from "next";

import { CarePlanRoutePage } from "./route-page";

export const metadata: Metadata = {
  title: "Care Plan prototype · PsychSift",
  description: "A fully synthetic, memory-only prototype for continuity planning in recurrent emergency care.",
};

export default function CarePlanHomePage() {
  return <CarePlanRoutePage />;
}
