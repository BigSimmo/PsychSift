"use client";

import { useMemo } from "react";

import { InformationPageFooter, InformationPageShell } from "@/components/information-page-shell";
import { RecordBody, RecordIntro } from "@/components/clinical-record-panels";
import { DesktopSplitList, type DesktopSplitGroup } from "@/components/work-frame/desktop-split-list";
import { ClinicalSplit } from "@/components/work-frame/work-desktop-layout";
import { therapyRecordHref, therapyScreenHref } from "@/lib/therapy-compass-navigation";

import { useTcBindings } from "../bindings";
import { cardPreviewText } from "../data/select";
import { TherapyKeyFacts } from "../record/key-facts";
import { RelatedTherapies } from "../record/related-therapies";
import { TherapyCompareAction } from "../record/compare-action";
import { TherapySaveNotice } from "../record/save-notice";
import { TherapyRecordSections, TherapySafetySection } from "../record/record-sections";
import { TherapySourceProvenance } from "../record/source-provenance";
import { TherapyRecordNavHeader } from "../therapy-record-nav-header";
import { LoadingState, StatusBadge, TagRow } from "../ui";
import { useTherapyFavourite } from "../use-therapy-favourite";

/**
 * One therapy record.
 *
 * The page is a single reading column at every width. It used to be a two-column
 * grid whose right rail carried "At a glance" and the provenance card: on a
 * phone that rail stacked underneath everything, so the highest-yield facts on
 * the record landed below the fold and below four buttons. Those facts are now
 * the strip directly under the title, the navigation is in the header, and what
 * is left in the column is the record itself, in reading order.
 *
 * From 1024px the list of therapies sits in a column beside that reading
 * column (`ClinicalSplit`); below 1024px it is not drawn at all.
 */
export function DetailScreen() {
  const b = useTcBindings();
  const t = b.selectedTherapy;
  const favourite = useTherapyFavourite(t?.slug ?? null);
  const currentSlug = t?.slug ?? null;
  const { therapies, workspaceHref } = b;
  // The desktop list beside the record (from 1024px; not drawn below it): every
  // therapy by category, A to Z inside each. Links keep the workspace's
  // shareable state, the same way the record's own back link does.
  const splitGroups = useMemo<DesktopSplitGroup[]>(() => {
    const byCategory = new Map<string, typeof therapies>();
    for (const therapy of therapies) {
      const bucket = byCategory.get(therapy.category);
      if (bucket) bucket.push(therapy);
      else byCategory.set(therapy.category, [therapy]);
    }
    const byName = (left: string, right: string) => left.localeCompare(right, "en", { sensitivity: "base" });
    return [...byCategory.entries()]
      .sort(([left], [right]) => byName(left, right))
      .map(([category, items]) => ({
        key: category,
        label: category,
        items: [...items]
          .sort((left, right) => byName(left.name, right.name))
          .map((therapy) => ({
            key: therapy.slug,
            href: workspaceHref(therapyRecordHref(therapy.slug)),
            title: therapy.name,
            current: therapy.slug === currentSlug,
          })),
      }));
  }, [therapies, workspaceHref, currentSlug]);
  if (!t) return <LoadingState />;

  const { notice, saved, toggleFavourite } = favourite;
  const summary = cardPreviewText(t.clinicalSummary, { exclude: t.name, maxSentences: 3 }) || t.clinicalSummary;

  return (
    <>
      <TherapyRecordNavHeader
        therapy={t}
        active="overview"
        backHref={b.workspaceHref(therapyScreenHref("search"))}
        backLabel="Therapy search"
        testIdPrefix="therapy-detail"
        saved={saved}
        onToggleSave={() => void toggleFavourite()}
      />
      <InformationPageShell testId="therapy-detail-page" gap={false}>
        <ClinicalSplit
          listLabel="Therapies"
          testId="therapy-detail-split"
          // The record's pinned header carries its tabs (about 8.25rem), so
          // the list sticks below that rather than at the default 5rem.
          className="[--clinical-split-top:9.25rem]"
          list={<DesktopSplitList heading="Therapies by category" groups={splitGroups} />}
          detail={
            <>
              <section data-screen-label="Detail">
                <RecordBody>
                  <TherapySaveNotice notice={notice} />
                  <RecordIntro
                    // The category always leads. It used to be replaced by "Also
                    // known as …" for any record carrying an alias, which quietly
                    // cost every one of those records the one line that says what
                    // family of therapy this is. The aliases keep their place, one
                    // line further down.
                    eyebrow={t.category}
                    title={t.name}
                    line={summary}
                    meta={
                      t.aliases.length ? (
                        <p className="m-0 text-xs text-[color:var(--text-muted)]">
                          Also known as {t.aliases.join(", ")}
                        </p>
                      ) : null
                    }
                    tags={
                      <>
                        <StatusBadge status={t.reviewStatus} />
                        <TagRow tags={t.tags.length ? t.tags : [t.category]} max={4} />
                      </>
                    }
                    actions={<TherapyCompareAction therapy={t} />}
                  />
                  <TherapyKeyFacts therapy={t} />
                  <TherapySafetySection therapy={t} />
                  <TherapyRecordSections therapy={t} />
                  <RelatedTherapies related={b.relatedForSelected} onOpen={(slug) => b.open(slug)} />
                  <TherapySourceProvenance therapy={t} />
                </RecordBody>
              </section>
              <InformationPageFooter className="mt-4">
                {/* Therapy records name their sources but do not link to them yet (ledger #05WXHX). */}
                Source-grounded therapy reference — verify the record against the sources named under Source &amp;
                review status before clinical use.
              </InformationPageFooter>
            </>
          }
        />
      </InformationPageShell>
    </>
  );
}
