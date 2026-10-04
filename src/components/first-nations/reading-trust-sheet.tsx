"use client";
// Ephemeral only: open state is React memory. Nothing about a patient or a reading
// choice is written to URL, storage, or the network.
import { useEffect, useState } from "react";
import { FnButton } from "@/components/first-nations/kit";
import { Sheet } from "@/components/ui/sheet";

export const READING_TRUST_EVENT = "first-nations:open-reading-trust";

/** Opens the reading-trust sheet from any First Nations surface that mounts it (the mode layout). */
export function openReadingTrustSheet(): void {
  window.dispatchEvent(new Event(READING_TRUST_EVENT));
}

/**
 * Plain “what am I reading?” statuses — modeled on the Primer About sheet.
 * Wording stays source-checked / awaiting language; never clinical sign-off.
 */
export function ReadingTrustSheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(READING_TRUST_EVENT, reopen);
    return () => window.removeEventListener(READING_TRUST_EVENT, reopen);
  }, []);

  const close = () => setOpen(false);

  return (
    <Sheet open={open} onClose={close} title="What am I reading?">
      <p className="text-sm-minus text-[color:var(--text-muted)]">
        How to read trust status in this mode. This is a reference tool, not clinical decision support, and nothing here
        is a clinical sign-off.
      </p>
      <ul className="mt-2 grid gap-2 text-sm-minus text-[color:var(--text)]">
        <li>
          <span className="font-medium text-[color:var(--text-heading)]">Awaiting</span>
          {" — "}
          Cultural wording still waiting on your service&apos;s Aboriginal health team. Treat it as example only.
        </li>
        <li>
          <span className="font-medium text-[color:var(--text-heading)]">Statewide tips</span>
          {" — "}
          Short tips credited to published Aboriginal-led or official guides, each with a source line. Source-checked
          reference, not hospital endorsement.
        </li>
        <li>
          <span className="font-medium text-[color:var(--text-heading)]">PsychSift templates</span>
          {" — "}
          Note templates appear only after that section has service approval. Unapproved templates stay hidden.
        </li>
        <li>
          <span className="font-medium text-[color:var(--text-heading)]">EMHS off</span>
          {" — "}
          The East Metropolitan hospital layer is not enabled yet. Statewide numbers and tips still work; no local
          hospital endorsement is shown.
        </li>
      </ul>
      <div className="mt-3">
        <FnButton filled label="Got it" onClick={close} />
      </div>
    </Sheet>
  );
}
