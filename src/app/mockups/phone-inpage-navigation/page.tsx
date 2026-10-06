import { Search } from "lucide-react";
import {
  DropdownNavigator,
  PhoneFrame,
  PriorityDock,
  ProgressNavigator,
  ScrollRail,
} from "./phone-inpage-nav-widgets";

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
