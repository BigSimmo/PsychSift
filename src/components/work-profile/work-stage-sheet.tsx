"use client";

import { RadioGroup } from "@/components/ui/choice";
import { Sheet } from "@/components/ui/sheet";
import type { WorkProfilePreferences } from "@/components/work-profile/use-work-profile-data";
import { WorkProfileFoot } from "@/components/work-profile/work-profile-list";
import {
  RANZCP_STAGE_OPTIONS,
  WORK_STAGE_OPTIONS,
  type RanzcpStagePreference,
  type WorkStagePreference,
} from "@/lib/account-preferences";

/**
 * "Your stage": the doctor's own description of where they are. Each choice
 * saves at once to the account (no Save button), and a registrar then picks
 * a RANZCP stage. It is self-reported and changes nothing a manager set.
 */
export default function WorkStageSheet({
  open,
  onClose,
  prefs: { preferences, setPreference },
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly prefs: WorkProfilePreferences;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Your stage">
      <div className="grid gap-5" data-testid="work-profile-stage-sheet">
        <RadioGroup
          label="Your stage"
          hideLabel
          name="work-stage"
          value={preferences.workStage ?? ""}
          onChange={(value) => setPreference("workStage", value as WorkStagePreference)}
          options={WORK_STAGE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            description: option.description || undefined,
          }))}
        />
        {preferences.workStage === "registrar" ? (
          <RadioGroup
            label="RANZCP stage"
            name="ranzcp-stage"
            value={preferences.ranzcpStage ? String(preferences.ranzcpStage) : ""}
            onChange={(value) => setPreference("ranzcpStage", Number(value) as RanzcpStagePreference)}
            options={RANZCP_STAGE_OPTIONS.map((stage) => ({ value: String(stage), label: `Stage ${stage}` }))}
          />
        ) : null}
        <WorkProfileFoot>
          Tailors your training rows. Your roster team’s grade is set by its manager and shows separately.
        </WorkProfileFoot>
      </div>
    </Sheet>
  );
}
