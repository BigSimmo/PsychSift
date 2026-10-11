"use client";

import { ClipboardCheck, ShieldCheck, Stethoscope, UsersRound, type LucideIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import {
  WorkBody,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
} from "@/components/mode-kit/work";
import { announce } from "@/components/ui/live-announcer";
import { useExampleData } from "@/lib/example-data/store";
import {
  PREVIEW_ROLES,
  PREVIEW_ROLE_INFO,
  PREVIEW_ROLE_SCREENS,
  type PreviewRole,
  readPreviewRole,
  writePreviewRole,
} from "@/lib/preview-role/preview-role";

const ROLE_ICON: Record<PreviewRole, LucideIcon> = {
  junior: Stethoscope,
  supervisor: ClipboardCheck,
  admin: UsersRound,
};

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const ROLE_EVENT = "psychsift:preview-role-change";

function subscribe(onChange: () => void) {
  window.addEventListener(ROLE_EVENT, onChange);
  return () => window.removeEventListener(ROLE_EVENT, onChange);
}

const readStoredRole = () => readPreviewRole(sessionStore());
const serverRole = (): PreviewRole => "junior";

/**
 * Preview only: pick a role, then open that role's screens. Changes what this
 * device shows, never what anyone is allowed to do.
 */
export function WorkRolesPage() {
  // The stored role, read after hydration so the server render and first client render match.
  const storedRole = useSyncExternalStore(subscribe, readStoredRole, serverRole);
  // Holds the choice when storage is blocked, so the page still follows the tap.
  const [unsavedRole, setUnsavedRole] = useState<PreviewRole | null>(null);
  const role = unsavedRole ?? storedRole;

  const choose = (next: PreviewRole) => {
    if (writePreviewRole(sessionStore(), next)) {
      setUnsavedRole(null);
      window.dispatchEvent(new Event(ROLE_EVENT));
    } else {
      setUnsavedRole(next);
    }
  };
  const saved = unsavedRole === null;
  // The one example data switch. Reviewer and admin screens only make sense with it on.
  const example = useExampleData();
  const chooseRole = (next: PreviewRole) => {
    choose(next);
    announce(PREVIEW_ROLE_INFO[next].label);
    if (next !== "junior" && example.mode !== "on") example.turnOn();
  };

  const info = PREVIEW_ROLE_INFO[role];
  const screens = PREVIEW_ROLE_SCREENS[role];

  return (
    <main
      data-work-frame=""
      data-mode-identity="teaching"
      className="min-h-dvh bg-[var(--work-wash)] pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
    >
      <WorkBody testId="work-roles">
        <header className="px-1 pb-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--work-ink-muted)]">Preview only</p>
          <h1 className="text-2xl font-semibold text-[var(--work-ink)]">View work mode as</h1>
        </header>

        <WorkCard padded testId="work-roles-notice">
          <p className="flex items-start gap-2 text-sm text-[var(--work-ink)]">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              This changes what this device shows while testing. It never changes what anyone can see or do. The real
              app checks every role on the server, and this page does not exist there.
            </span>
          </p>
        </WorkCard>

        <WorkSectionLabel id="work-roles-pick">Role</WorkSectionLabel>
        <WorkChips label="Role">
          {PREVIEW_ROLES.map((id) => (
            <WorkChip
              key={id}
              icon={ROLE_ICON[id]}
              selected={role === id}
              onClick={() => chooseRole(id)}
              testId={`work-roles-pick-${id}`}
            >
              {PREVIEW_ROLE_INFO[id].label}
            </WorkChip>
          ))}
        </WorkChips>

        <WorkCard padded testId="work-roles-current">
          <p className="text-base font-semibold text-[var(--work-ink)]">{info.label}</p>
          <p className="text-sm text-[var(--work-ink-muted)]">{info.sub}</p>
          <p className="mt-2 text-sm text-[var(--work-ink-muted)]">{info.data}</p>
          {saved ? null : (
            <p className="mt-2 text-sm text-[var(--work-ink-muted)]" data-testid="work-roles-not-saved">
              This browser blocks saving, so the choice lasts until you leave this page.
            </p>
          )}
        </WorkCard>

        <WorkSectionLabel>Example data</WorkSectionLabel>
        <WorkCard padded testId="work-roles-example">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-sm text-[var(--work-ink)]">
              {example.mode === "on"
                ? "On. Every area shows example records, and nothing can be sent or exported."
                : "Off. Areas show only your own records."}
            </p>
            <WorkChip
              selected={example.mode === "on"}
              onClick={example.mode === "on" ? example.turnOff : example.turnOn}
              testId="work-roles-example-toggle"
            >
              {example.mode === "on" ? "Turn off" : "Turn on"}
            </WorkChip>
          </div>
        </WorkCard>

        <WorkSectionLabel count={screens.length}>Screens</WorkSectionLabel>
        <WorkCard as="ul" aria-label={`${info.label} screens`} testId="work-roles-screens">
          {screens.map((screen) => (
            <li key={screen.href}>
              {screen.ready ? (
                <WorkIconRow icon={ROLE_ICON[role]} title={screen.label} sub={screen.sub} href={screen.href} />
              ) : (
                <WorkIconRow
                  icon={ROLE_ICON[role]}
                  tone="neutral"
                  title={screen.label}
                  sub={screen.sub}
                  end={<WorkTag tone="neutral">Soon</WorkTag>}
                />
              )}
            </li>
          ))}
        </WorkCard>
      </WorkBody>
    </main>
  );
}
