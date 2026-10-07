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
              onClick={() => choose(id)}
              testId={`work-roles-pick-${id}`}
            >
              {PREVIEW_ROLE_INFO[id].label}
            </WorkChip>
          ))}
        </WorkChips>

        <WorkCard padded testId="work-roles-current">
          <p className="text-base font-semibold text-[var(--work-ink)]" aria-live="polite">
            {info.label}
          </p>
          <p className="text-sm text-[var(--work-ink-muted)]">{info.sub}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--work-ink-muted)]">
            <WorkTag tone={role === "junior" ? "neutral" : "amber"}>{role === "junior" ? "Data" : "Sample"}</WorkTag>
            {info.data}
          </p>
          {saved ? null : (
            <p className="mt-2 text-sm text-[var(--work-ink-muted)]" data-testid="work-roles-not-saved">
              This browser blocks saving, so the choice lasts until you leave this page.
            </p>
          )}
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
