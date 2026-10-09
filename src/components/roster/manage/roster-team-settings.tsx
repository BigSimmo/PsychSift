"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { postRosterAction } from "@/components/roster/use-roster-team";
import { rosterRulesSchema, type RosterOverview, type RosterRules } from "@/lib/roster/team/model";

const rules: readonly [keyof RosterRules, string][] = [
  ["minBreakHours", "Minimum break (hours)"],
  ["maxNightsInRow", "Maximum nights in a row"],
  ["maxDaysInRow", "Maximum days in a row"],
  ["maxHours7d", "Maximum hours in 7 days"],
  ["maxHours14d", "Maximum hours in 14 days"],
];
export function RosterTeamSettings({ serviceId, overview }: { serviceId: string; overview: RosterOverview }) {
  const [approval, setApproval] = useState(overview.settings.swapApproval);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(overview.settings.rules).map(([key, value]) => [key, String(value)])),
  );
  const [source, setSource] = useState(overview.settings.rulesSource ?? "");
  const [anchor, setAnchor] = useState(overview.settings.payFortnightAnchor ?? "");
  const [cutoff, setCutoff] = useState(overview.nextCutoffOn ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = rosterRulesSchema.safeParse(
      Object.fromEntries(
        Object.entries(values)
          .filter(([, value]) => value !== "")
          .map(([key, value]) => [key, Number(value)]),
      ),
    );
    if (!parsed.success) {
      setMessage("Check the rule values before saving.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await postRosterAction(serviceId, {
      action: "settings.set",
      swapApproval: approval,
      rules: parsed.data,
      rulesSource: source.trim() || null,
      payFortnightAnchor: anchor || null,
    });
    if (!result.ok) {
      setMessage(result.message);
      setBusy(false);
      return;
    }
    if ("nextCutoffOn" in overview && cutoff !== (overview.nextCutoffOn ?? "")) {
      try {
        const response = await fetch(`/api/roster/team/${encodeURIComponent(serviceId)}/cutoff`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cutoffOn: cutoff || null }),
        });
        if (!response.ok) {
          setMessage("Team settings saved. The cut-off could not be saved. Try again.");
          setBusy(false);
          return;
        }
      } catch {
        setMessage("Team settings saved. The cut-off could not be saved. Check your connection.");
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setMessage("Saved");
  }
  return (
    <form onSubmit={save} className="grid gap-3">
      <h2 className="text-base font-normal">Team settings</h2>
      <label className="grid gap-1 text-sm">
        Swap approval
        <select
          className="min-h-12 w-full min-w-0 rounded border border-[color:var(--border)] bg-background p-2"
          value={approval}
          onChange={(event) => setApproval(event.target.value as typeof approval)}
        >
          <option value="auto_same_grade">Clean same-grade swaps approve themselves</option>
          <option value="manager">I approve every swap</option>
        </select>
      </label>
      {rules.map(([key, label]) => (
        <TextField
          key={key}
          label={label}
          type="number"
          min={0}
          step="any"
          value={values[key] ?? ""}
          onChange={(event) => setValues({ ...values, [key]: event.target.value })}
        />
      ))}
      <TextField
        label="Where the rules come from"
        value={source}
        maxLength={200}
        onChange={(event) => setSource(event.target.value)}
      />
      <TextField
        label="Pay fortnight starts"
        type="date"
        value={anchor}
        onChange={(event) => setAnchor(event.target.value)}
      />
      {"nextCutoffOn" in overview ? (
        <TextField
          label="Next roster closes"
          type="date"
          value={cutoff}
          onChange={(event) => setCutoff(event.target.value)}
        />
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <Button type="submit" disabled={busy}>
        Save team settings
      </Button>
    </form>
  );
}
