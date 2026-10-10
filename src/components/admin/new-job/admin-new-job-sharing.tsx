"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AdminSection, AdminSkeleton, adminStyles } from "@/components/admin/admin-kit";
import { focusRing } from "@/components/card-recipes";
import { WorkButton, WorkCard } from "@/components/mode-kit/work";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { cn } from "@/components/ui-primitives";
import { fetchStarterSharing, saveStarterSharing } from "@/lib/work-roles/hospital-starters-client";

/** The switch's own words, and exactly what Medical Workforce sees once it is on. */
export const SHARE_WITH_WORKFORCE_LABEL = "Share my progress with Medical Workforce";
const WHAT_THEY_SEE =
  "Medical Workforce at the hospital your team belongs to, and the site administrator, will see your name, team, start date, how many items are done, and the titles of items still to do.";
const WHAT_STAYS_YOURS = "Personal items are never shared, not even in the count. You can turn this off any time.";

type Read =
  | { readonly status: "loading" }
  | { readonly status: "ok"; readonly share: boolean }
  | { readonly status: "failed"; readonly offline: boolean; readonly message: string | null };

/**
 * New job's opt-in (owner request 10 Oct 2026): "Share my progress with
 * Medical Workforce". Off until the doctor turns it on, and the switch only
 * ever shows what the server holds: while the choice is being read it shows a
 * skeleton, and when the read fails it says so, never "off". Turning it off is
 * one save, and Workforce's next read no longer includes this doctor. Nothing
 * is kept on the device.
 */
export function AdminNewJobSharing() {
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ readonly key: number; readonly value: Read } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchStarterSharing({ signal: controller.signal }).then(
      (outcome) =>
        setRead({
          key: attempt,
          value:
            outcome.status === "ok"
              ? { status: "ok", share: outcome.share }
              : {
                  status: "failed",
                  offline: outcome.status === "offline",
                  message: outcome.status === "error" ? outcome.message : null,
                },
        }),
      () => {
        // Aborted: a newer read replaced this one.
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setSaveError(null);
    setAttempt((n) => n + 1);
  }, []);

  const state: Read = read?.key === attempt ? read.value : { status: "loading" };

  async function toggle(next: boolean) {
    setSaving(true);
    setSaveError(null);
    const outcome = await saveStarterSharing(next);
    setSaving(false);
    if (outcome.status === "ok") {
      setRead({ key: attempt, value: { status: "ok", share: outcome.share } });
      return;
    }
    const stillOn = !next;
    setSaveError(
      outcome.status === "offline"
        ? `You're offline. ${stillOn ? "Sharing is still on." : "Nothing was shared."} Try again when you're back online.`
        : `That didn't save. ${stillOn ? "Sharing is still on." : "Nothing was shared."} Try again.`,
    );
  }

  return (
    <AdminSection as="h3" label="Medical Workforce" testId="admin-new-job-sharing">
      {state.status === "loading" ? (
        <div data-testid="admin-new-job-sharing-loading" aria-busy="true">
          <span className="sr-only">Checking your sharing choice</span>
          <AdminSkeleton className="h-16" />
        </div>
      ) : state.status === "failed" ? (
        <WorkCard padded testId="admin-new-job-sharing-failed">
          <p className="work-row__sub m-0">
            {state.offline
              ? "You're offline, so your sharing choice can't be checked."
              : (state.message ?? "Your sharing choice couldn't be checked.")}
          </p>
          <div className="mt-2 grid grid-cols-1">
            <WorkButton variant="secondary" icon={RotateCcw} onClick={retry} testId="admin-new-job-sharing-retry">
              Try again
            </WorkButton>
          </div>
        </WorkCard>
      ) : (
        <WorkCard as="ul">
          <li>
            {/* The whole row is the switch, so the tap target is the full width. */}
            <button
              type="button"
              role="switch"
              aria-checked={state.share}
              aria-label={SHARE_WITH_WORKFORCE_LABEL}
              aria-describedby="admin-new-job-sharing-what"
              disabled={saving}
              onClick={() => void toggle(!state.share)}
              className={cn(focusRing, "work-row w-full text-left")}
              data-testid="admin-new-job-sharing-switch"
            >
              <span className="work-row__text">
                <span className="work-row__title">{SHARE_WITH_WORKFORCE_LABEL}</span>
                <span className="work-row__sub" data-testid="admin-new-job-sharing-state">
                  {saving ? "Saving" : state.share ? "On. Medical Workforce can see your progress." : "Off"}
                </span>
              </span>
              <ToggleSwitch enabled={state.share} />
            </button>
          </li>
        </WorkCard>
      )}

      {saveError ? (
        <WorkCard padded>
          <p role="alert" className="work-row__sub m-0" data-testid="admin-new-job-sharing-error">
            {saveError}
          </p>
        </WorkCard>
      ) : null}

      <p id="admin-new-job-sharing-what" className={adminStyles.note} data-testid="admin-new-job-sharing-what">
        <span>
          {WHAT_THEY_SEE} {WHAT_STAYS_YOURS}
        </span>
      </p>
    </AdminSection>
  );
}
