import { onCallChecklistItemKey } from "@/lib/on-call/checklist-storage";

/**
 * First night's three stages and their prompts, shared by the First night page
 * and Handbook's First night panel so both count the same ticks.
 *
 * Every prompt is ADMINISTRATIVE: where things are, who to ring, how to get
 * in. Nothing is clinical advice.
 */
export type OnCallFirstNightStage = {
  readonly id: "before" | "night" | "wrong";
  readonly title: string;
  /** The short name on Handbook's stage switch. */
  readonly shortTitle: string;
  readonly intro: string;
  readonly prompts: readonly { readonly text: string; readonly note?: string }[];
};

export const ON_CALL_FIRST_NIGHT_STAGES: readonly OnCallFirstNightStage[] = [
  {
    id: "before",
    title: "Before your first shift",
    shortTitle: "Before",
    intro: "Sort these in daylight, so the night is only about the work.",
    prompts: [
      { text: "Know where you park after hours, and how you get in once the main doors lock" },
      { text: "Have your ID badge, swipe access and any keys you need" },
      { text: "Log in to every system you will need, and check your passwords work" },
      { text: "Know where the on-call room, the phone charger and food are" },
      { text: "Know how handover works: where, when and who you hand over to" },
      { text: "Print or save your pocket card" },
    ],
  },
  {
    id: "night",
    title: "Your first night",
    shortTitle: "First night",
    intro: "The numbers you will need are one tap away.",
    prompts: [
      { text: "Check the switchboard number and your consultant's number before you need them" },
      { text: "Know which wards and emergency departments you cover tonight" },
      { text: "Know where the forms and the Mental Health Act paperwork are kept" },
      { text: "Agree with the nurse in charge how they will reach you" },
    ],
  },
  {
    id: "wrong",
    title: "If something goes wrong",
    shortTitle: "Problems",
    intro: "You are never expected to manage alone. These are the routes, not the decisions.",
    prompts: [
      { text: "Know that you can always ring the consultant on call, at any hour" },
      { text: "Know how to reach security and the emergency response team" },
      { text: "Know where the incident reporting system is, and log in to it once" },
      { text: "Know who supports you the morning after a hard night" },
    ],
  },
];

/** The checklist id a stage's ticks are stored under. */
export function onCallFirstNightEntryId(stageId: OnCallFirstNightStage["id"]): string {
  return `first-night-${stageId}`;
}

/** Ticked and total prompts, per stage and overall, from the stored tick keys. */
export function onCallFirstNightProgress(ticked: ReadonlySet<string>): {
  readonly done: number;
  readonly total: number;
  readonly stages: readonly {
    readonly id: OnCallFirstNightStage["id"];
    readonly done: number;
    readonly total: number;
  }[];
} {
  const stages = ON_CALL_FIRST_NIGHT_STAGES.map((stage) => {
    const entryId = onCallFirstNightEntryId(stage.id);
    const done = stage.prompts.filter((prompt) => ticked.has(onCallChecklistItemKey(entryId, prompt.text))).length;
    return { id: stage.id, done, total: stage.prompts.length };
  });
  return {
    done: stages.reduce((sum, stage) => sum + stage.done, 0),
    total: stages.reduce((sum, stage) => sum + stage.total, 0),
    stages,
  };
}
