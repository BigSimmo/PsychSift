import type { WorkTone } from "@/components/mode-kit/work";
import type { PillTone } from "@/lib/teaching/assessments/model";

/** The sample model's pill tones as work-kit tag tones, so a status keeps its word and its colour. */
export const PILL_TO_WORK_TONE: Record<PillTone, WorkTone> = {
  ok: "green",
  warm: "amber",
  accent: "mode",
  neutral: "neutral",
  bad: "red",
};
