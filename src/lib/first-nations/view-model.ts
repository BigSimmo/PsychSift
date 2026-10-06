import {
  approvalState,
  blockApprovalState,
  sectionApprovalState,
  situationApprovalState,
} from "@/lib/first-nations/approval";
import {
  firstNationsPageHref,
  FIRST_NATIONS_PAGE_TITLES,
  type Approval,
  type Block,
  type ContactBlock,
  type FirstNationsContent,
  type FirstNationsPageId,
  type ModuleIcon,
  type ModuleLayout,
  type Page,
  type ServiceProfile,
  type SituationId,
  type Section,
  type Source,
  type WaMap,
} from "@/lib/first-nations/content-schema";
import { buildReviewStamp } from "@/lib/first-nations/review-stamp";
import type { ReviewStamp } from "@/lib/first-nations/review-stamp-text";
import type { SearchEntry } from "@/lib/first-nations/search";

export type ModelInputs = {
  content: FirstNationsContent;
  approvals: readonly Approval[];
  profile: ServiceProfile | null;
  sources: Readonly<Record<string, Source>>;
  map: WaMap;
};

export type SourceView = { title: string; url: string };
export type ContactView = {
  id: string;
  name: string;
  detail: string;
  number: string;
  hours: NonNullable<ContactBlock["hours"]> | null;
  checkedAt: string;
  source: SourceView;
  reportHref: string | null;
};
export type StepView = {
  id: string;
  title: string;
  detail: string;
  contact: ContactView | null;
  awaiting: boolean;
  checkedAt: string;
  source: SourceView;
  review?: ReviewStamp;
};
export type PhraseView = { say: string; why: string; checkedAt: string; source: SourceView };
export type SituationView = {
  id: SituationId;
  label: string;
  icon: ModuleIcon;
  phrases: PhraseView[];
  firstStep: StepView;
  plan: StepView[];
  riskLine: string | null;
  awaiting: boolean;
};
export type HospitalView = { id: string; name: string; liaison: ContactView; switchboard: ContactView };
export type RegionView = {
  id: string;
  label: string;
  services: ContactView[];
  languages: string[];
  checkedAt: string;
  source: SourceView;
};
export type AvoidView = {
  id: string;
  avoid: string;
  instead: string;
  checkedAt: string;
  source: SourceView;
  review?: ReviewStamp;
};
export type BlockView = { block: Block; source: SourceView; contact: ContactView | null; review?: ReviewStamp };
export type ModuleView = { id: string; title: string; icon: ModuleIcon; layout: ModuleLayout; blocks: BlockView[] };
export type SectionView = { id: string; tab: string; awaiting: boolean; modules: ModuleView[] };

export type BedsideModel = {
  showExampleLine: boolean;
  hospitals: HospitalView[];
  situations: SituationView[];
  beforeYouGoIn: StepView[];
  regions: RegionView[];
  interpreter: ContactView | null;
  map: WaMap;
  acknowledgement: string | null;
  topMistakes: AvoidView[];
  missingNumberHref: string | null;
  search: SearchEntry[];
};

export type InnerPageModel = {
  id: FirstNationsPageId;
  title: string;
  showExampleLine: boolean;
  sections: SectionView[];
  serviceContacts: ContactView[];
  regions: RegionView[];
  interpreter: ContactView | null;
  map: WaMap;
  missingNumberHref: string | null;
  search: SearchEntry[];
};

function sourceView(inputs: ModelInputs, id: string): SourceView {
  const source = inputs.sources[id];
  if (!source) throw new Error(`Unknown First Nations source ${id}`);
  return { title: source.title, url: source.url };
}

function reportEmail(inputs: ModelInputs): string | undefined {
  return inputs.profile?.enabled && inputs.profile.reportEmail
    ? inputs.profile.reportEmail
    : inputs.content.reportEmail;
}

function mailto(address: string | undefined, subject: string, body: string): string | null {
  if (!address) return null;
  const params = new URLSearchParams({ subject, body }).toString().replace(/\+/g, "%20");
  return `mailto:${address}?${params}`;
}

function contactView(c: ContactBlock, inputs: ModelInputs): ContactView {
  return {
    id: c.id,
    name: c.name,
    detail: c.detail ?? "",
    number: c.number,
    hours: c.hours ?? null,
    checkedAt: c.checkedAt,
    source: sourceView(inputs, c.sourceId),
    reportHref: mailto(
      reportEmail(inputs),
      `Wrong number: ${c.name}`,
      `Public contact correction only. Do not include patient details, staff names or personal numbers.\n\nThe number shown for ${c.name} is ${c.number}.\nOfficial source: ${inputs.sources[c.sourceId]?.url ?? ""}\nCorrection and official source: `,
    ),
  };
}

type Indexed = { block: Block; awaiting: boolean; section: Section | null };

function reviewOf(inputs: ModelInputs, block: Block, section: Section | null): ReviewStamp {
  const subjects: { subjectId: string; content: unknown }[] = [{ subjectId: block.id, content: block }];
  if (section) subjects.push({ subjectId: section.id, content: section });
  return buildReviewStamp(sourceView(inputs, block.sourceId).title, inputs.approvals, subjects);
}

function indexBlocks(inputs: ModelInputs): Map<string, Indexed> {
  const index = new Map<string, Indexed>();
  for (const page of inputs.content.pages)
    for (const section of page.sections) {
      const awaiting = sectionApprovalState(section, inputs.approvals) !== "approved";
      for (const mod of section.modules)
        for (const block of mod.blocks) index.set(block.id, { block, awaiting, section });
    }
  for (const c of inputs.content.statewideContacts) index.set(c.id, { block: c, awaiting: false, section: null });
  return index;
}

function stepView(ref: string, index: Map<string, Indexed>, inputs: ModelInputs): StepView {
  const hit = index.get(ref);
  if (!hit) throw new Error(`Unknown First Nations step ${ref}`);
  const { block, awaiting, section } = hit;
  const source = sourceView(inputs, block.sourceId);
  const { checkedAt } = block;
  const review = reviewOf(inputs, block, section);
  switch (block.kind) {
    case "tip":
      return { id: block.id, title: block.do, detail: block.why, contact: null, awaiting, checkedAt, source, review };
    case "note":
      return {
        id: block.id,
        title: block.heading,
        detail: block.text,
        contact: null,
        awaiting,
        checkedAt,
        source,
        review,
      };
    case "contact":
      return {
        id: block.id,
        title: `Call ${block.name}`,
        detail: block.detail ?? "",
        contact: contactView(block, inputs),
        awaiting,
        checkedAt,
        source,
        review,
      };
    default:
      throw new Error(`Step ${ref} is a ${block.kind}; steps name a tip, note or contact`);
  }
}

function page(inputs: ModelInputs, id: FirstNationsPageId): Page {
  const found = inputs.content.pages.find((p) => p.id === id);
  if (!found) throw new Error(`Missing First Nations page ${id}`);
  return found;
}

export function situationViews(inputs: ModelInputs): SituationView[] {
  const index = indexBlocks(inputs);
  return inputs.content.situations.map((s) => {
    const plan = s.plan.map((ref) => stepView(ref, index, inputs));
    const firstStep = stepView(s.firstStepRef, index, inputs);
    const risk = s.riskLineRef ? inputs.content.riskLines.find((r) => r.id === s.riskLineRef) : undefined;
    const riskLine = risk && blockApprovalState(risk, inputs.approvals) === "approved" ? risk.text : null;
    return {
      id: s.id,
      label: s.label,
      icon: s.icon,
      phrases: s.phrases.map((p) => ({
        say: p.say,
        why: p.why,
        checkedAt: p.checkedAt,
        source: sourceView(inputs, p.sourceId),
      })),
      firstStep,
      plan,
      riskLine,
      awaiting:
        situationApprovalState(s, inputs.approvals) !== "approved" ||
        firstStep.awaiting ||
        plan.some((p) => p.awaiting),
    };
  });
}

export function hospitalViews(inputs: ModelInputs): HospitalView[] {
  const profile = inputs.profile;
  if (!profile?.enabled) return [];
  const byId = new Map(profile.contacts.map((c) => [c.id, c]));
  return profile.hospitals.flatMap((h) => {
    const liaison = byId.get(h.liaisonContactId);
    const switchboard = byId.get(h.switchboardContactId);
    return liaison && switchboard
      ? [
          {
            id: h.id,
            name: h.name,
            liaison: contactView(liaison, inputs),
            switchboard: contactView(switchboard, inputs),
          },
        ]
      : [];
  });
}

function statewideById(inputs: ModelInputs): Map<string, ContactBlock> {
  return new Map(inputs.content.statewideContacts.map((c) => [c.id, c]));
}

function regionViews(inputs: ModelInputs): RegionView[] {
  const byId = statewideById(inputs);
  return inputs.content.regions.map((r) => ({
    id: r.id,
    label: r.label,
    services: r.serviceContactIds.flatMap((id) => {
      const c = byId.get(id);
      return c ? [contactView(c, inputs)] : [];
    }),
    languages: r.languages,
    checkedAt: r.checkedAt,
    source: sourceView(inputs, r.sourceId),
  }));
}

function interpreterView(inputs: ModelInputs): ContactView | null {
  const c = statewideById(inputs).get(inputs.content.interpreterContactId);
  return c ? contactView(c, inputs) : null;
}

function sectionViews(p: Page, inputs: ModelInputs): SectionView[] {
  return p.sections.map((section) => {
    const awaiting = sectionApprovalState(section, inputs.approvals) !== "approved";
    return {
      id: section.id,
      tab: section.tab,
      awaiting,
      modules: section.modules.map((m) => ({
        id: m.id,
        title: m.title,
        icon: m.icon,
        layout: m.layout,
        // Our own wording never renders before approval (spec §4).
        blocks: m.blocks
          .filter((b) => !(b.kind === "noteWording" && awaiting))
          .map((b) => ({
            block: b,
            source: sourceView(inputs, b.sourceId),
            contact: b.kind === "contact" ? contactView(b, inputs) : null,
            review: reviewOf(inputs, b, section),
          })),
      })),
    };
  });
}

function searchText(block: Block): { title: string; detail: string } {
  switch (block.kind) {
    case "tip":
      return { title: block.do, detail: [block.why, block.say].filter(Boolean).join(" · ") };
    case "avoid":
      return { title: block.avoid, detail: block.instead };
    case "contact":
      return { title: block.name, detail: block.detail ?? "" };
    case "quote":
    case "note":
      return { title: block.heading, detail: block.text };
    case "steps":
      return { title: block.heading, detail: block.items.map((i) => i.title).join(" · ") };
    case "linkList":
      return { title: block.heading, detail: block.items.map((i) => i.label).join(" · ") };
    case "noteWording":
      return { title: block.heading, detail: block.template };
  }
}

export function buildSearchIndex(inputs: ModelInputs): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const p of inputs.content.pages)
    for (const section of sectionViews(p, inputs))
      for (const m of section.modules)
        for (const { block } of m.blocks) {
          const text = searchText(block);
          entries.push({
            id: block.id,
            ...text,
            href: `${firstNationsPageHref(p.id)}#${section.id}`,
            ...(block.kind === "contact" ? { number: block.number } : {}),
          });
        }
  // Page contacts are indexed above with their visible section. Region-only
  // contacts stay in Where is home until search can reveal that selection.
  for (const h of hospitalViews(inputs))
    for (const c of [h.liaison, h.switchboard])
      entries.push({
        id: c.id,
        title: c.name,
        detail: h.name,
        href: firstNationsPageHref("contacts"),
        number: c.number,
      });
  for (const s of inputs.content.situations)
    entries.push({
      id: `situation-${s.id}`,
      title: s.label,
      detail: "Situation",
      href: firstNationsPageHref("bedside"),
    });
  return entries;
}

function acknowledgementFor(inputs: ModelInputs): string | null {
  const profile = inputs.profile;
  if (!profile?.enabled || !profile.acknowledgement) return null;
  return approvalState(`acknowledgement:${profile.id}`, profile.acknowledgement, inputs.approvals) === "approved"
    ? profile.acknowledgement
    : null;
}

export function buildBedsideModel(inputs: ModelInputs): BedsideModel {
  const index = indexBlocks(inputs);
  const situations = situationViews(inputs);
  const checks = page(inputs, "bedside")
    .sections.flatMap((s) => s.modules)
    .find((m) => m.id === "before-you-go-in");
  const beforeYouGoIn = (checks?.blocks ?? []).map((b) => stepView(b.id, index, inputs));
  const liftedMistakes = page(inputs, "mistakes")
    .sections.flatMap((s) => s.modules.flatMap((m) => m.blocks))
    .flatMap((b) => (b.kind === "avoid" ? [b] : []))
    .slice(0, 3);
  // Lifted mistakes keep their own section's approval state, so Bedside stays marked while they await it.
  const mistakesAwaiting = liftedMistakes.some((b) => index.get(b.id)?.awaiting !== false);
  const topMistakes = liftedMistakes.map((b) => ({
    id: b.id,
    avoid: b.avoid,
    instead: b.instead,
    checkedAt: b.checkedAt,
    source: sourceView(inputs, b.sourceId),
    review: reviewOf(inputs, b, index.get(b.id)?.section ?? null),
  }));
  return {
    showExampleLine: situations.some((s) => s.awaiting) || beforeYouGoIn.some((s) => s.awaiting) || mistakesAwaiting,
    hospitals: hospitalViews(inputs),
    situations,
    beforeYouGoIn,
    regions: regionViews(inputs),
    interpreter: interpreterView(inputs),
    map: inputs.map,
    acknowledgement: acknowledgementFor(inputs),
    topMistakes,
    missingNumberHref: mailto(
      reportEmail(inputs),
      "Missing number",
      "Public contact correction only. Do not include patient details, staff names or personal numbers.\n\nMissing public service number and official source: ",
    ),
    search: buildSearchIndex(inputs),
  };
}

export function buildInnerPageModel(inputs: ModelInputs, id: Exclude<FirstNationsPageId, "bedside">): InnerPageModel {
  const sections = sectionViews(page(inputs, id), inputs);
  return {
    id,
    title: FIRST_NATIONS_PAGE_TITLES[id],
    showExampleLine: sections.some((s) => s.awaiting),
    sections,
    serviceContacts: inputs.profile?.enabled ? inputs.profile.contacts.map((c) => contactView(c, inputs)) : [],
    regions: regionViews(inputs),
    interpreter: interpreterView(inputs),
    map: inputs.map,
    missingNumberHref: mailto(
      reportEmail(inputs),
      "Missing number",
      "Public contact correction only. Do not include patient details, staff names or personal numbers.\n\nMissing public service number and official source: ",
    ),
    search: buildSearchIndex(inputs),
  };
}
