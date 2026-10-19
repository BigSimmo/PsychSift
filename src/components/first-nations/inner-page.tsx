// Server component: an inner First Nations page, one titled module after another under its tabs.
import Link from "next/link";
import { ExampleLine, type Training } from "@/components/first-nations/bedside-home";
import { moduleHasContent, ModuleBody } from "@/components/first-nations/blocks";
import { CrisisBlock, CrisisStrip } from "@/components/first-nations/crisis";
import { FirstNationsNavHeader, type FirstNationsTab } from "@/components/first-nations/first-nations-nav-header";
import { OfflineState } from "@/components/first-nations/offline-state";
import { FirstNationsMenuActions } from "@/components/first-nations/page-menu";
import { firstNationsPageHref } from "@/lib/first-nations/content-schema";
import type { InnerPageModel, SectionView, SourceView } from "@/lib/first-nations/view-model";

/** Sections with something to show. A tab whose modules are all empty is not drawn, so no tab leads nowhere. */
export function visibleSections(model: InnerPageModel): SectionView[] {
  return model.sections.filter((s) => s.modules.some(moduleHasContent));
}

/** Plain labels: tabs never carry counts. */
export function toTabs(model: InnerPageModel): FirstNationsTab[] {
  return visibleSections(model).map((s) => ({
    id: s.id,
    label: s.tab,
    icon: s.modules.find(moduleHasContent)?.icon ?? "book",
  }));
}

export function InnerPageView({
  model,
  training = null,
  mapSource = null,
}: {
  model: InnerPageModel;
  training?: Training;
  mapSource?: SourceView | null;
}) {
  const sections = visibleSections(model);
  return (
    <>
      <FirstNationsNavHeader
        title={model.title}
        sections={toTabs(model)}
        actions={
          <FirstNationsMenuActions
            pageTitle={model.title}
            href={firstNationsPageHref(model.id)}
            reportHref={model.missingNumberHref}
            training={training}
          />
        }
      />
      <div className="mx-auto grid w-full max-w-[48rem] content-start gap-3 px-3 pb-6 pt-3">
        {/* The header draws the title visually; this names the page for screen readers, as Bedside does. */}
        <h1 className="sr-only">{model.title}</h1>
        {model.showExampleLine ? <ExampleLine /> : null}
        <OfflineState />
        <CrisisStrip />
        {sections.map((section) => (
          <section key={section.id} id={section.id} aria-label={section.tab} className="grid scroll-mt-28 gap-3">
            {section.modules.map((m) => (
              <ModuleBody key={m.id} module={m} model={model} mapSource={mapSource} />
            ))}
            {model.id === "contacts" && section.id === "contacts-community" ? (
              <Link
                className="inline-flex min-h-12 items-center px-3 text-sm-minus underline"
                href="/services/search?specialist_groups=aboriginal_torres_strait_islander"
              >
                Find Aboriginal and Torres Strait Islander services
              </Link>
            ) : null}
          </section>
        ))}
        <CrisisBlock />
      </div>
    </>
  );
}
