"use client";

import { Info } from "lucide-react";
import dynamic from "next/dynamic";

import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { useSignedOutSample } from "@/components/mode-kit/use-signed-out-sample";

import { SignInAction } from "./open-shifts-sign-in";
import { Note } from "./open-shifts-ui";

// Roster's own alert switches: one setting, so Open shifts and Roster never disagree.
const RosterAlertsSection = dynamic(
  () => import("@/components/roster/alerts/roster-alerts-section").then((module) => module.RosterAlertsSection),
  { ssr: false },
);

export function OpenShiftsAlertsPage() {
  const signedOut = useSignedOutSample();
  return (
    <div className="mx-auto w-full max-w-reading pb-10" data-mode-identity="open-shifts">
      <PageTitleUnderBand className="px-3 pt-4 text-xl font-semibold text-[color:var(--text-heading)]">
        Alerts
      </PageTitleUnderBand>
      <p className="px-3 pt-2 text-sm text-[color:var(--text-muted)]">
        New open shifts and decisions on your requests can arrive as Roster alerts. These are the same switches as in
        Roster settings.
      </p>
      {signedOut ? (
        <SignInAction label="Sign in to turn on alerts" />
      ) : (
        <div className="px-3 pt-4">
          <RosterAlertsSection />
        </div>
      )}
      <Note icon={<Info aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />}>
        Alerts for a saved set of filters, quiet hours and your own limits aren&apos;t available yet.
      </Note>
    </div>
  );
}
