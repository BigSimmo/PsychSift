"use client";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { FormField } from "@/components/ui/form-field";
import { fieldControlPlain } from "@/components/ui-primitives";
import { serviceCoverGrades, type ServiceContent } from "@/lib/on-call/service-model";

type Step = NonNullable<ServiceContent["steps"]>[number];
type Cover = NonNullable<ServiceContent["cover"]>;
export const emptyCover: Cover = { grade: "other", window: { start: "", end: "" } };

export function ServiceStructuredFields({
  section,
  steps,
  cover,
  onSteps,
  onCover,
}: {
  section: ServiceContent["section"];
  steps: Step[];
  cover: Cover;
  onSteps: (steps: Step[]) => void;
  onCover: (cover: Cover) => void;
}) {
  if (section === "cover")
    return (
      <fieldset className="grid gap-3" data-testid="service-cover-editor">
        <legend>Staff, role and cover times</legend>
        <p className="text-sm text-[color:var(--text-muted)]">
          Add a staff name only when approved for your service, or leave it blank for role-only cover. These times
          repeat daily until the entry is changed or withdrawn. Times use the hospital’s Perth clock. An end before the
          start means overnight.
        </p>
        <TextField
          id="service-cover-staff-name"
          label="Staff name (optional)"
          value={cover.staffName ?? ""}
          autoComplete="off"
          maxLength={80}
          onChange={(event) =>
            onCover({ ...cover, staffName: event.target.value.trim() ? event.target.value : undefined })
          }
        />
        <FormField label="Grade" id="service-cover-grade">
          {(field) => (
            <select
              id={field.id}
              className={fieldControlPlain}
              value={cover.grade}
              onChange={(event) => onCover({ ...cover, grade: event.target.value as Cover["grade"] })}
            >
              {serviceCoverGrades.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <TextField
          id="service-cover-team"
          label="Team"
          value={cover.team ?? ""}
          maxLength={80}
          onChange={(event) => onCover({ ...cover, team: event.target.value || undefined })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {(["start", "end"] as const).map((key) => (
            <TextField
              key={key}
              id={`service-cover-${key}`}
              label={key === "start" ? "Cover starts" : "Cover ends"}
              type="time"
              required
              value={cover.window[key]}
              onChange={(event) => onCover({ ...cover, window: { ...cover.window, [key]: event.target.value } })}
            />
          ))}
        </div>
      </fieldset>
    );
  if (section !== "playbook") return null;
  const change = (index: number, patch: Partial<Step>) =>
    onSteps(steps.map((step, position) => (position === index ? { ...step, ...patch } : step)));
  return (
    <fieldset className="grid gap-3" data-testid="service-ladder-editor">
      <legend>Who to call, in order</legend>
      <p className="text-sm text-[color:var(--text-muted)]">
        Enter the hospital’s roles, numbers and timing only. Do not add treatment advice. Leave the wait blank unless
        the hospital specifies one.
      </p>
      {steps.map((step, index) => (
        <fieldset key={index} className="grid gap-3 rounded-lg border border-[color:var(--border)] p-3">
          <legend>Step {index + 1}</legend>
          <TextField
            id={`ladder-role-${index}`}
            label={`Step ${index + 1} role`}
            value={step.whoToCall}
            required
            maxLength={160}
            onChange={(event) => change(index, { whoToCall: event.target.value })}
          />
          <TextField
            id={`ladder-when-${index}`}
            label={`Step ${index + 1} when to call`}
            value={step.when}
            required
            maxLength={160}
            onChange={(event) => change(index, { when: event.target.value })}
          />
          <TextField
            id={`ladder-phone-${index}`}
            label={`Step ${index + 1} phone or extension`}
            value={step.phone ?? ""}
            maxLength={80}
            onChange={(event) => change(index, { phone: event.target.value || undefined })}
          />
          <FormField label={`Step ${index + 1} hours`} id={`ladder-hours-${index}`}>
            {(field) => (
              <select
                id={field.id}
                className={fieldControlPlain}
                value={step.hours ?? "any"}
                onChange={(event) => change(index, { hours: event.target.value as Step["hours"] })}
              >
                <option value="any">Any time</option>
                <option value="in-hours">In hours</option>
                <option value="after-hours">After hours</option>
              </select>
            )}
          </FormField>
          <TextField
            id={`ladder-wait-${index}`}
            label={`Step ${index + 1} hospital-set wait (minutes)`}
            type="number"
            min={1}
            max={120}
            value={step.waitMinutes ?? ""}
            onChange={(event) =>
              change(index, { waitMinutes: event.target.value ? Number(event.target.value) : undefined })
            }
          />
          <Button
            variant="ghost"
            onClick={() =>
              onSteps(
                steps
                  .filter((_, position) => position !== index)
                  .map((value, position) => ({ ...value, order: position + 1 })),
              )
            }
          >
            Remove step {index + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        variant="secondary"
        disabled={steps.length >= 20}
        onClick={() => onSteps([...steps, { order: steps.length + 1, whoToCall: "", when: "" }])}
      >
        Add ladder step
      </Button>
    </fieldset>
  );
}
