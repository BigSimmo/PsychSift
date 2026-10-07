"use client";

import { Pin } from "lucide-react";
import { useState } from "react";

import { AdminCallButton, AdminRow, AdminSection } from "@/components/admin/admin-kit";
import { pinnedHelpItems } from "@/components/admin/admin-pinned-numbers";
import { ADMIN_PAGE_HREFS } from "@/components/admin/admin-page-sections";
import { ModeDialSheet } from "@/components/mode-kit/dial-sheet";
import { WorkCard, WorkIconCircle } from "@/components/mode-kit/work";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import type { AdminHelpItem } from "@/lib/admin/help-items";
import { displayPhoneNumber } from "@/lib/admin/phone-display";
import { useAdminPins } from "@/lib/admin/pins";
import { onCallTelHref } from "@/lib/on-call/home-modules";

/**
 * "Pinned" on Today (work-mode redesign, owner request 6 Oct 2026): the
 * numbers pinned on Help, which My Day shows too. A row with a number opens
 * the dial sheet (call, copy, the number in full) from its round call button
 * or the row itself; a row without one opens its entry on Help. Renders
 * nothing until something is pinned. Pinning and unpinning stay on Help.
 */
export function TodayStarred({ items, testId }: { readonly items: readonly AdminHelpItem[]; readonly testId: string }) {
  const pinned = pinnedHelpItems(useAdminPins(), items);
  const [dialing, setDialing] = useState<AdminHelpItem | null>(null);
  if (pinned.length === 0) return null;
  const dialNumber = dialing?.phone
    ? { display: displayPhoneNumber(dialing.phone, "own-list"), tel: onCallTelHref(dialing.phone) ?? null }
    : null;
  return (
    <AdminSection label="Pinned" count="Also on My Day" testId={testId}>
      <WorkCard as="ul">
        {pinned.map((item) => {
          const id = item.entry?.id as string;
          const tel = onCallTelHref(item.phone ?? undefined);
          if (item.phone && tel) {
            const display = displayPhoneNumber(item.phone, "own-list");
            return (
              <AdminRow
                key={item.key}
                lead={<WorkIconCircle icon={Pin} />}
                title={item.title}
                sub={<span className="tabular-nums">{item.detail ? `${display} · ${item.detail}` : display}</span>}
                onClick={() => setDialing(item)}
                chevron={false}
                testId={`${testId}-${item.key}`}
                action={
                  <AdminCallButton
                    label={`Call ${item.title}`}
                    onClick={() => setDialing(item)}
                    testId={`${testId}-${item.key}-call`}
                  />
                }
              />
            );
          }
          return (
            <AdminRow
              key={item.key}
              lead={<WorkIconCircle icon={Pin} />}
              title={item.title}
              sub={item.detail ?? undefined}
              href={`${ADMIN_PAGE_HREFS.help}#${onCallEntryAnchorId(id)}`}
              testId={`${testId}-${item.key}`}
            />
          );
        })}
      </WorkCard>
      {dialing && dialNumber ? (
        <ModeDialSheet
          open
          onClose={() => setDialing(null)}
          label={dialing.title}
          context={dialing.detail}
          number={dialNumber}
          testId={`${testId}-dial`}
        />
      ) : null}
    </AdminSection>
  );
}
