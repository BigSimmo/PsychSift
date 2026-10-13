import { ChevronDown, ExternalLink } from "lucide-react";

import {
  InformationPageBreadcrumbs,
  InformationPageHeader,
  InformationPageShell,
} from "@/components/information-page-shell";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { ActTopicList } from "@/components/forms/act-topic-list";
import { ClinicalSplit } from "@/components/work-frame/work-desktop-layout";
import { signOffDisplay } from "@/lib/sign-off-label";
import type {
  ActReferenceGroup,
  ActReferenceSection,
  ChiefPsychiatristStandard,
} from "@/components/forms/act-and-standards-content";

type ActMetadata = { actVersion: string; actAsAt: string; sourceUrl: string };

const detailsCard =
  "group overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] open:border-[color:var(--border-strong)]";
const summaryRow =
  "flex min-h-12 cursor-pointer list-none items-center gap-3 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] [&::-webkit-details-marker]:hidden";
const reviewBadge =
  "shrink-0 rounded-full bg-[color:var(--warning-soft)] px-2 py-0.5 text-2xs font-bold text-[color:var(--warning)]";
const externalLink =
  "inline-flex min-h-12 items-center gap-1.5 text-sm font-semibold text-[color:var(--clinical-accent)] underline underline-offset-2";

/** The reader-facing caveat for any unreviewed item; kept identical to the form section sheet. */
const AWAITING_REVIEW = "Awaiting clinical review";

function ActSectionItem({ entry }: { entry: ActReferenceSection }) {
  const drafted = entry.status !== "reviewed";
  const written = Boolean(entry.summary?.trim()) && entry.status !== "pending";
  return (
    <li>
      <details className={detailsCard} data-testid={`act-section-${entry.section}`}>
        <summary className={summaryRow}>
          <span className="shrink-0 text-sm font-extrabold tabular-nums text-[color:var(--text-heading)]">
            {`s ${entry.section}`}
          </span>
          <span className="min-w-0 flex-1 text-sm leading-5 text-[color:var(--text)]">{entry.title}</span>
          {drafted ? <span className={reviewBadge}>{AWAITING_REVIEW}</span> : null}
          <ChevronDown
            className="h-4 w-4 shrink-0 text-[color:var(--text-muted)] transition group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="grid gap-2 border-t border-[color:var(--border)] px-3 py-3">
          {written ? (
            <p className="text-sm leading-6 text-[color:var(--text)]">{entry.summary}</p>
          ) : (
            <p className="text-sm leading-6 text-[color:var(--text)]">
              A plain-English summary of this section has not been written yet. Read it in the Act.
            </p>
          )}
          {drafted && written ? (
            <p className={cn("text-xs leading-5", textMuted)}>
              Drafted from the Act text and awaiting clinical review.
            </p>
          ) : null}
        </div>
      </details>
    </li>
  );
}

/** Where the desktop topic list jumps to. `scroll-mt-24` on each keeps it clear of the app header. */
const groupAnchorId = (groupId: string) => `act-group-${groupId}`;
const standardAnchorId = (standardId: string) => `act-standard-${standardId}`;
const STANDARD_TITLE_LEAD_IN = /^Chief Psychiatrist's Standard for Clinical Care:\s*/;

function ActGroup({ group }: { group: ActReferenceGroup }) {
  const headingId = groupAnchorId(group.id);
  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <h3 id={headingId} className="scroll-mt-24 text-sm font-extrabold text-[color:var(--text-heading)]">
        {group.title}
      </h3>
      <ul className="grid gap-2">
        {group.sections.map((entry) => (
          <ActSectionItem key={entry.section} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

function StandardItem({ standard }: { standard: ChiefPsychiatristStandard }) {
  // Signed off only for a named person and a date; a product attribution keeps "awaiting".
  const signOff = standard.reviewed
    ? signOffDisplay(standard.reviewedBy, standard.reviewedAt)
    : { signedOff: false as const, text: "" };
  return (
    <li>
      <details
        id={standardAnchorId(standard.id)}
        className={cn(detailsCard, "scroll-mt-24")}
        data-testid={`cp-standard-${standard.id}`}
      >
        <summary className={summaryRow}>
          <span className="min-w-0 flex-1 text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
            {standard.title}
          </span>
          {signOff.signedOff ? null : <span className={reviewBadge}>{AWAITING_REVIEW}</span>}
          <ChevronDown
            className="h-4 w-4 shrink-0 text-[color:var(--text-muted)] transition group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="grid gap-2 border-t border-[color:var(--border)] px-3 py-3">
          <p className="text-sm leading-6 text-[color:var(--text)]">{standard.summary}</p>
          {signOff.signedOff ? (
            <p className={cn("text-xs leading-5", textMuted)} data-testid={`cp-standard-reviewed-${standard.id}`}>
              {`Drafted from the Office of the Chief Psychiatrist's published standard. ${signOff.text}.`}
            </p>
          ) : (
            <p className={cn("text-xs leading-5", textMuted)}>
              Drafted from the Office of the Chief Psychiatrist&apos;s published standard and awaiting clinical review.
            </p>
          )}
          {standard.sourceUrl ? (
            <a className={externalLink} href={standard.sourceUrl} target="_blank" rel="noopener noreferrer">
              Read the standard
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          ) : null}
        </div>
      </details>
    </li>
  );
}

export function ActAndStandardsPage({
  act,
  groups,
  standards,
  backHref,
}: {
  act: ActMetadata;
  groups: readonly ActReferenceGroup[];
  /** `null` when the Standards data is not available; the section is then omitted. */
  standards: readonly ChiefPsychiatristStandard[] | null;
  backHref: string;
}) {
  const sectionCount = groups.reduce((total, group) => total + group.sections.length, 0);
  return (
    <InformationPageShell testId="forms-act-and-standards" width="narrow">
      <InformationPageBreadcrumbs home={{ label: "Forms", href: backHref }} current="Act and Standards" />
      <InformationPageHeader
        eyebrow="Clinical Forms"
        title="Act and Standards"
        subtitle="Plain-English summaries of the Mental Health Act 2014 (WA) and the Chief Psychiatrist's Standards for Clinical Care."
      />

      <p
        role="note"
        className="rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2 text-sm leading-6 text-[color:var(--text)]"
      >
        These are condensed reference summaries, not the law or the standard itself. Anything marked &ldquo;
        {AWAITING_REVIEW.toLowerCase()}&rdquo; has not been checked by a clinician yet. Confirm against the Act and your
        service&apos;s procedure before clinical or legal use.
      </p>

      {/* From 1024px the topic list sits beside the text; below it the list is
          not drawn and the two sections stay the phone column they were. */}
      <ClinicalSplit
        listLabel="Act and Standards topics"
        testId="act-and-standards-split"
        list={
          <ActTopicList
            actTopics={groups.map((group) => ({
              targetId: groupAnchorId(group.id),
              title: group.title,
              count: group.sections.length,
            }))}
            standardTopics={(standards ?? []).map((standard) => ({
              targetId: standardAnchorId(standard.id),
              // The list's own heading already says "Chief Psychiatrist's
              // Standards", so each row drops that shared lead-in; the page
              // keeps every standard's full title.
              title: standard.title.replace(STANDARD_TITLE_LEAD_IN, "") || standard.title,
            }))}
          />
        }
        detail={
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:gap-6">
            <section aria-labelledby="act-heading" className="grid gap-4">
              <div className="grid gap-1">
                <h2 id="act-heading" className="text-base font-extrabold text-[color:var(--text-heading)]">
                  Mental Health Act 2014 (WA)
                </h2>
                <p className={cn("text-xs leading-5", textMuted)}>
                  {`${sectionCount} sections, written from version ${act.actVersion} as at ${act.actAsAt}.`}
                </p>
                <a className={externalLink} href={act.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Read the Act on the WA legislation website
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
              </div>
              {groups.map((group) => (
                <ActGroup key={group.id} group={group} />
              ))}
            </section>

            {standards?.length ? (
              <section aria-labelledby="standards-heading" className="grid gap-3">
                <div className="grid gap-1">
                  <p className={eyebrowText}>Office of the Chief Psychiatrist WA</p>
                  <h2 id="standards-heading" className="text-base font-extrabold text-[color:var(--text-heading)]">
                    Chief Psychiatrist&apos;s Standards for Clinical Care
                  </h2>
                </div>
                <ul className="grid gap-2">
                  {standards.map((standard) => (
                    <StandardItem key={standard.id} standard={standard} />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        }
      />
    </InformationPageShell>
  );
}
