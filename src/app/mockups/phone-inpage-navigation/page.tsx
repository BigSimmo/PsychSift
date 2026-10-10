"use client";

import {
  Activity,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Compass,
  FileText,
  HeartPulse,
  Home,
  Menu,
  MoreHorizontal,
  Search,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

const sections = [
  { label: "Overview", icon: Home },
  { label: "Why matched", icon: Sparkles },
  { label: "Safety", icon: HeartPulse },
  { label: "Best fit", icon: Compass },
  { label: "Protocol", icon: Activity },
  { label: "Patient sheet", icon: FileText },
] as const;

type SectionLabel = (typeof sections)[number]["label"];

function PhoneHeader() {
  return (
    <>
      <div className="flex h-11 items-center justify-between bg-[#07090a] px-6 text-sm-minus font-semibold text-white">
        <span>11:41</span>
        <span className="flex items-center gap-1.5 text-2xs">
          <span>▮▮▮</span>
          <span>◒</span>
          <span className="rounded bg-white px-1 text-[#07090a]">77</span>
        </span>
      </div>
      <header className="flex h-[72px] items-center gap-3 border-b border-white/5 bg-[#111516] px-4">
        <button
          type="button"
          aria-label="Open menu"
          className="grid size-11 place-items-center rounded-full text-[#aab3b1]"
          onClick={() => undefined}
        >
          <Menu className="size-5" />
        </button>
        <button
          type="button"
          className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full border border-[#2b3234] bg-[#15191a] px-3 text-left shadow-lg"
          onClick={() => undefined}
        >
          <span className="grid size-8 place-items-center rounded-full bg-[#55d5d9] text-[#082e32]">
            <Compass className="size-4" />
          </span>
          <span className="flex-1 text-base-minus font-bold text-white">Therapy</span>
          <ChevronDown className="size-4 text-[#8b9694]" />
        </button>
        <button
          type="button"
          aria-label="New clinical note"
          className="grid size-11 place-items-center rounded-full border border-[#2b3234] text-[#aab3b1]"
          onClick={() => undefined}
        >
          <Bookmark className="size-4" />
        </button>
      </header>
    </>
  );
}

function ClinicalContent({ active }: { active: SectionLabel }) {
  const contentMap: Record<
    SectionLabel,
    Array<{ icon: typeof Sparkles; label: string; copy: string; variant: "default" | "warning" | "muted" }>
  > = {
    Overview: [
      {
        icon: Sparkles,
        label: "Why matched",
        copy: "Best for adults receiving continuing support after an episode, with a clear focus on triggers and practical problem-solving.",
        variant: "default",
      },
      {
        icon: HeartPulse,
        label: "Safety first",
        copy: "Assess immediate risk, capacity, safeguarding, psychosis, mania and current supports before continuing.",
        variant: "warning",
      },
      {
        icon: Clock3,
        label: "Best fit",
        copy: "Self-harm urges, emotional dysregulation, hopelessness and identifiable high-risk moments.",
        variant: "muted",
      },
    ],
    "Why matched": [
      {
        icon: Compass,
        label: "Evidence base",
        copy: "CBT shows strong outcomes in relapse prevention for adults with recurrent depression, particularly when combined with medication.",
        variant: "default",
      },
      {
        icon: Activity,
        label: "Key features",
        copy: "Structured sessions targeting negative thought patterns, behavioral activation, and practical skills for managing early warning signs.",
        variant: "warning",
      },
      {
        icon: Check,
        label: "Match criteria",
        copy: "Patient history indicates recurrent episodes, willingness to engage in homework, and capacity for collaborative goal-setting.",
        variant: "muted",
      },
    ],
    Safety: [
      {
        icon: HeartPulse,
        label: "Risk assessment",
        copy: "Check for active suicidal ideation, self-harm urges, acute psychosis, and safeguarding concerns before proceeding.",
        variant: "default",
      },
      {
        icon: Activity,
        label: "Capacity check",
        copy: "Confirm patient can consent to treatment, understands the approach, and has support systems in place.",
        variant: "warning",
      },
      {
        icon: Bookmark,
        label: "Crisis plan",
        copy: "Ensure patient has access to emergency contacts, crisis services, and knows when to seek immediate help.",
        variant: "muted",
      },
    ],
    "Best fit": [
      {
        icon: Compass,
        label: "Core targets",
        copy: "Rumination, avoidance behaviors, disrupted routines, social withdrawal, and negative thought cycles.",
        variant: "default",
      },
      {
        icon: Sparkles,
        label: "Strengths needed",
        copy: "Ability to identify thoughts, willingness to try new behaviors, and capacity to engage between sessions.",
        variant: "warning",
      },
      {
        icon: Clock3,
        label: "Typical duration",
        copy: "12-16 sessions over 3-4 months, with possible booster sessions for relapse prevention.",
        variant: "muted",
      },
    ],
    Protocol: [
      {
        icon: Activity,
        label: "Session structure",
        copy: "Weekly 50-minute sessions: agenda setting, homework review, new skill teaching, and between-session task planning.",
        variant: "default",
      },
      {
        icon: FileText,
        label: "Core components",
        copy: "Psychoeducation, thought records, behavioral experiments, activity scheduling, and relapse prevention planning.",
        variant: "warning",
      },
      {
        icon: Check,
        label: "Progress tracking",
        copy: "Regular monitoring with validated measures (PHQ-9, GAD-7) and collaborative review of therapy goals.",
        variant: "muted",
      },
    ],
    "Patient sheet": [
      {
        icon: FileText,
        label: "What to expect",
        copy: "Active collaboration, homework between sessions, focus on current problems, and learning practical skills you can use long-term.",
        variant: "default",
      },
      {
        icon: Home,
        label: "Your role",
        copy: "Bring specific examples, try new strategies between sessions, give feedback on what works, and practice skills regularly.",
        variant: "warning",
      },
      {
        icon: Bookmark,
        label: "Resources",
        copy: "Session handouts, thought record templates, activity logs, and a personalized relapse prevention plan.",
        variant: "muted",
      },
    ],
  };

  const blocks = contentMap[active];

  return (
    <div className="space-y-3 px-4 pb-24 pt-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-3xs font-bold uppercase tracking-[0.18em] text-[#55d5d9]">CBT · clinical guide</p>
          <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-white">{active}</h3>
        </div>
        <span className="rounded-full border border-[#304043] bg-[#152225] px-2.5 py-1 text-3xs font-semibold text-[#8ce3e5]">
          8 min
        </span>
      </div>
      <section className="overflow-hidden rounded-[22px] border border-[#283033] bg-[#131718]">
        <div className="border-b border-[#283033] p-4">
          <p className="flex items-center gap-2 text-2xs font-bold uppercase tracking-[0.1em] text-[#64d9dc]">
            {(() => {
              const Icon = blocks[0].icon;
              return <Icon aria-hidden="true" className="size-3.5" />;
            })()}{" "}
            {blocks[0].label}
          </p>
          <p className="mt-2 text-sm-minus leading-5 text-[#b6bfbd]">{blocks[0].copy}</p>
        </div>
        <div className="bg-[#342b16] p-4">
          <p className="flex items-center gap-2 text-2xs font-bold uppercase tracking-[0.1em] text-[#f0c65d]">
            {(() => {
              const Icon = blocks[1].icon;
              return <Icon aria-hidden="true" className="size-3.5" />;
            })()}{" "}
            {blocks[1].label}
          </p>
          <p className="mt-2 text-sm-minus leading-5 text-[#e1ca91]">{blocks[1].copy}</p>
        </div>
        <div className="border-t border-[#41371d] p-4">
          <p className="flex items-center gap-2 text-2xs font-bold uppercase tracking-[0.1em] text-[#a7b0ae]">
            {(() => {
              const Icon = blocks[2].icon;
              return <Icon aria-hidden="true" className="size-3.5" />;
            })()}{" "}
            {blocks[2].label}
          </p>
          <p className="mt-2 text-sm-minus leading-5 text-[#b6bfbd]">{blocks[2].copy}</p>
        </div>
      </section>
      <button
        type="button"
        onClick={() => undefined}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#55d5d9] text-sm font-bold text-[#073438]"
      >
        Open clinical record <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

function PhoneFrame({ children, title, kicker }: { children: React.ReactNode; title: string; kicker: string }) {
  return (
    <article className="space-y-3">
      <div className="px-1">
        <p className="text-3xs font-bold uppercase tracking-[0.18em] text-[#55d5d9]">{kicker}</p>
        <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
      </div>
      <div className="mx-auto flex h-[690px] w-full max-w-[390px] flex-col overflow-hidden rounded-[34px] border border-[#343b3d] bg-[#0b0e0f] shadow-[0_30px_80px_rgba(0,0,0,.45)] ring-4 ring-[#171b1c]">
        <PhoneHeader />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </article>
  );
}

function ScrollRail() {
  const [active, setActive] = useState<SectionLabel>("Why matched");
  return (
    <>
      <nav aria-label="Concept one sections" className="relative border-b border-[#252c2e] bg-[#0e1213] px-3 py-2.5">
        <div className="flex snap-x gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => setActive(label)}
              aria-current={active === label ? "page" : undefined}
              className={`flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full px-3.5 text-xs font-semibold transition ${active === label ? "bg-[#173b3e] text-[#6de1e4] ring-1 ring-[#34787d]" : "text-[#9ca6a4]"}`}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#0e1213]" />
      </nav>
      <ClinicalContent active={active} />
    </>
  );
}

function DropdownNavigator() {
  const [active, setActive] = useState<SectionLabel>("Safety");
  const [open, setOpen] = useState(true);
  const ActiveIcon = sections.find((item) => item.label === active)?.icon ?? Home;
  return (
    <>
      <div className="relative border-b border-[#252c2e] bg-[#0e1213] p-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-[#335053] bg-[#152224] px-3 text-left"
        >
          <span className="grid size-8 place-items-center rounded-xl bg-[#55d5d9] text-[#073438]">
            <ActiveIcon aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-3xs font-bold uppercase tracking-[0.14em] text-[#82908e]">Jump to section</span>
            <span className="block truncate text-sm font-semibold text-white">{active}</span>
          </span>
          <ChevronDown aria-hidden="true" className={`size-4 text-[#8ce3e5] transition ${open ? "rotate-180" : ""}`} />
        </button>
        {open ? (
          <div className="absolute left-3 right-3 top-[68px] z-20 overflow-hidden rounded-[22px] border border-[#354044] bg-[#171c1d]/95 p-2 shadow-2xl backdrop-blur-xl">
            <p className="px-2 pb-2 pt-1 text-3xs font-bold uppercase tracking-[0.16em] text-[#7f8b89]">On this page</p>
            <div className="grid grid-cols-2 gap-1">
              {sections.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setActive(label);
                    setOpen(false);
                  }}
                  className={`flex min-h-12 items-center gap-2 rounded-xl px-2.5 text-left text-xs font-semibold ${active === label ? "bg-[#173b3e] text-[#6de1e4]" : "text-[#b3bcba] hover:bg-white/5"}`}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  <span className="flex-1">{label}</span>
                  {active === label ? <Check aria-hidden="true" className="size-3.5" /> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <ClinicalContent active={active} />
    </>
  );
}

function PriorityDock() {
  const [active, setActive] = useState<SectionLabel>("Overview");
  const [more, setMore] = useState(false);
  const primary = sections.slice(0, 4);
  const overflow = sections.slice(4);
  const overflowActive = overflow.some(({ label }) => label === active);
  return (
    <>
      <nav
        aria-label="Concept three sections"
        className="relative grid grid-cols-5 border-b border-[#252c2e] bg-[#0e1213] px-2 py-2"
      >
        {primary.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setActive(label);
              setMore(false);
            }}
            aria-current={active === label ? "page" : undefined}
            className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-3xs font-semibold ${active === label ? "bg-[#173b3e] text-[#6de1e4]" : "text-[#8f9997]"}`}
          >
            <Icon aria-hidden="true" className="size-[18px]" />
            {label === "Why matched" ? "Matched" : label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMore((value) => !value)}
          aria-expanded={more}
          aria-current={overflowActive ? "page" : undefined}
          className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-3xs font-semibold ${more || overflowActive ? "bg-[#173b3e] text-[#6de1e4]" : "text-[#8f9997]"}`}
        >
          <MoreHorizontal aria-hidden="true" className="size-[18px]" />
          More
        </button>
        {more ? (
          <div className="absolute right-2 top-[66px] z-20 w-52 rounded-2xl border border-[#354044] bg-[#171c1d] p-1.5 shadow-2xl">
            {overflow.map(({ label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setActive(label);
                  setMore(false);
                }}
                aria-current={active === label ? "page" : undefined}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-xs font-semibold ${active === label ? "bg-[#173b3e] text-[#6de1e4]" : "text-[#c0c8c6] hover:bg-white/5"}`}
              >
                <Icon aria-hidden="true" className="size-4 text-[#64d9dc]" />
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </nav>
      <ClinicalContent active={active} />
    </>
  );
}

function ProgressNavigator() {
  const [index, setIndex] = useState(1);
  const active = sections[index];
  const ActiveIcon = active.icon;
  return (
    <>
      <nav aria-label="Concept four sections" className="border-b border-[#252c2e] bg-[#0e1213] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
            disabled={index === 0}
            aria-label="Previous section"
            className="grid size-11 shrink-0 place-items-center rounded-full border border-[#30393b] text-[#9aa5a3] disabled:opacity-30"
          >
            <ChevronRight aria-hidden="true" className="size-4 rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => setIndex((value) => Math.min(sections.length - 1, value + 1))}
            disabled={index === sections.length - 1}
            className="min-w-0 flex-1 text-left disabled:opacity-50"
          >
            <span className="flex items-center justify-between text-3xs font-bold uppercase tracking-[0.15em] text-[#7f8b89]">
              <span>
                Section {index + 1} of {sections.length}
              </span>
              <span className="text-[#55d5d9]">{Math.round(((index + 1) / sections.length) * 100)}%</span>
            </span>
            <span className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
              <ActiveIcon aria-hidden="true" className="size-4 text-[#62dadd]" />
              {active.label}
            </span>
            <span className="mt-2 flex gap-1">
              {sections.map((section, itemIndex) => (
                <span
                  key={section.label}
                  className={`h-1 flex-1 rounded-full ${itemIndex <= index ? "bg-[#55d5d9]" : "bg-[#293133]"}`}
                />
              ))}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setIndex((value) => Math.min(sections.length - 1, value + 1))}
            disabled={index === sections.length - 1}
            aria-label="Next section"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-[#55d5d9] text-[#073438] disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </nav>
      <ClinicalContent active={active.label} />
    </>
  );
}

export default function PhoneInPageNavigationMockup() {
  return (
    <main className="min-h-screen bg-[#090c0d] px-4 py-8 text-white sm:px-6 lg:px-10">
      <header className="mx-auto max-w-6xl border-b border-[#283033] pb-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#55d5d9]">
          Mobile navigation study · 04 directions
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">
          In-page navigation, refined for one thumb.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#9fa9a7]">
          Four anchored treatments shown in realistic context. Each sits immediately below the Therapy header, preserves
          content width and uses a minimum 44px interaction target.
        </p>
      </header>
      <section className="mx-auto mt-8 grid max-w-6xl gap-x-8 gap-y-12 md:grid-cols-2">
        <PhoneFrame kicker="01 · Fastest scanning" title="Momentum rail">
          <ScrollRail />
        </PhoneFrame>
        <PhoneFrame kicker="02 · Most compact" title="Section dropdown">
          <DropdownNavigator />
        </PhoneFrame>
        <PhoneFrame kicker="03 · Best discoverability" title="Priority dock + More">
          <PriorityDock />
        </PhoneFrame>
        <PhoneFrame kicker="04 · Best for guided reading" title="Progress navigator">
          <ProgressNavigator />
        </PhoneFrame>
      </section>
      <footer className="mx-auto mt-12 flex max-w-6xl items-center justify-between border-t border-[#283033] py-6 text-xs text-[#7f8b89]">
        <span>PsychSift · design exploration</span>
        <span className="flex items-center gap-2">
          <Search className="size-3.5" /> Phone-first, 390px canvas
        </span>
      </footer>
    </main>
  );
}
