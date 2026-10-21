"use client";

import { Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { WorkButton, WorkTag } from "@/components/mode-kit/work";
import { AssessNote, AssessTextField } from "@/components/teaching/assessments/assess-kit";
import { ApiClientError } from "@/lib/api-client-error";
import { useExampleData } from "@/lib/example-data/store";
import { teachingErrorMessage, teachingGet, teachingPost } from "@/lib/teaching/client";
import type { EpaNumber } from "@/lib/teaching/assessments/content";
import { checkEpaClinicianName } from "@/lib/teaching/assessments/magic-link";
import type { EpaMagicLinkSummary } from "@/lib/teaching/assessments/magic-link-repository";
import { GUEST_KINDS, type GuestKind } from "@/lib/teaching/assessments/model";

/*
 * The visiting-supervisor link (#MAAXAX). The doctor names themselves and the
 * supervisor, the server makes a single-use link that expires in 14 days, and
 * the doctor copies it. Their own links are listed underneath, where a waiting
 * one can be cancelled. Only the signed-in doctor sees these links.
 */

const API = "/api/teaching/assessments/magic-links";

const dateFormat = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Perth" });

function statusLine(link: EpaMagicLinkSummary): string {
  if (link.status === "completed") return `Feedback received ${dateFormat.format(new Date(link.completedAt!))}`;
  if (link.status === "revoked") return "Cancelled";
  if (link.status === "expired") return `Expired ${dateFormat.format(new Date(link.expiresAt))}, not used`;
  return `Waiting · expires ${dateFormat.format(new Date(link.expiresAt))}`;
}

function errorText(error: unknown): string {
  if (error instanceof ApiClientError && error.code === "demo_mode_unavailable")
    return "Supervisor links need a signed-in account.";
  if (error instanceof ApiClientError && error.message) return error.message;
  return teachingErrorMessage(error);
}

export function SupervisorLinkPanel({
  epa,
  guest,
  defaultTraineeName,
}: {
  readonly epa: EpaNumber;
  readonly guest: GuestKind | null;
  /** The example story's doctor; a real account starts blank and types its own name. */
  readonly defaultTraineeName: string;
}) {
  const { active: example } = useExampleData("assess");
  const [traineeName, setTraineeName] = useState(example ? defaultTraineeName : "");
  const [supervisorName, setSupervisorName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<readonly EpaMagicLinkSummary[] | null>(null);

  // Bumped after each create or cancel, so the list reloads from the server.
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    teachingGet<{ links: EpaMagicLinkSummary[] }>(API).then(
      (data) => {
        if (alive) setLinks(data.links);
      },
      () => {
        if (alive) setLinks(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [version]);

  const nameProblem = checkEpaClinicianName(supervisorName) ?? checkEpaClinicianName(traineeName);

  async function copyLink() {
    if (!guest || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const made = await teachingPost<{ urlPath: string; link: EpaMagicLinkSummary }>(API, {
        epaCode: epa,
        traineeName: traineeName.trim(),
        supervisorName:
          supervisorName.trim() || GUEST_KINDS.find((kind) => kind.id === guest)?.name || "External supervisor",
        supervisorRole: guest,
      });
      const fullUrl = `${window.location.origin}${made.urlPath}`;
      let copied = false;
      try {
        await navigator.clipboard.writeText(fullUrl);
        copied = true;
      } catch {
        copied = false;
      }
      const expires = dateFormat.format(new Date(made.link.expiresAt));
      setStatus(
        copied
          ? `Link copied. Send it to them yourself. It works once and expires ${expires}.`
          : `Copy this link and send it to them: ${fullUrl} It works once and expires ${expires}.`,
      );
      refresh();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    try {
      const response = await fetch(`${API}/${encodeURIComponent(id)}`, { method: "DELETE", cache: "no-store" });
      setStatus(response.ok ? "Link cancelled. It no longer opens." : "That link could not be cancelled.");
    } catch {
      setStatus("That link could not be cancelled.");
    }
    refresh();
  }

  return (
    <div className="grid gap-3" data-testid="epa-supervisor-link-panel">
      <AssessTextField
        id="assess-request-trainee-name"
        label="Your name, as they will see it"
        value={traineeName}
        onChange={setTraineeName}
        single
      />
      <AssessTextField
        id="assess-request-guest-name"
        label="Assessor name (optional)"
        value={supervisorName}
        onChange={setSupervisorName}
        single
      />
      <AssessNote>
        They need no account. The link works once and expires in 14 days. What they send is feedback for you to copy
        into CLA. It is not an official RANZCP sign-off. No patient details.
      </AssessNote>
      <WorkButton
        variant="secondary"
        icon={Copy}
        size="wide"
        testId="epa-magic-link-copy"
        disabled={!guest || busy || !traineeName.trim() || nameProblem !== null}
        onClick={() => void copyLink()}
      >
        Copy supervisor link
      </WorkButton>
      {status ? (
        <p role="status" className="assess-note" data-center="">
          <span>{status}</span>
        </p>
      ) : null}
      {links && links.length > 0 ? (
        <section aria-labelledby="epa-sent-links-heading" className="grid gap-1.5">
          <h3 id="epa-sent-links-heading" className="work-label m-0">
            Links you have sent
          </h3>
          <ul role="list" className="work-card work-rows m-0 grid min-w-0 p-0" data-testid="epa-sent-links">
            {links.map((link) => (
              <li key={link.id} className="work-row min-w-0 list-none items-center">
                <div className="work-row__text">
                  <span className="work-row__title">
                    {link.epaCode} · {link.supervisorName}
                  </span>
                  <span className="work-row__sub">{statusLine(link)}</span>
                  {link.submission ? (
                    <span className="work-row__sub break-words">
                      {link.submission.strengths ? `Went well: ${link.submission.strengths} ` : ""}
                      {link.submission.improvements ? `Work on: ${link.submission.improvements}` : ""}
                    </span>
                  ) : null}
                </div>
                {link.status === "pending" ? (
                  <WorkButton variant="secondary" onClick={() => void cancel(link.id)}>
                    Cancel link
                  </WorkButton>
                ) : link.status === "completed" ? (
                  <WorkTag tone="green">Received</WorkTag>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="work-row__sub m-0">Only you see your links and what comes back.</p>
        </section>
      ) : null}
    </div>
  );
}
