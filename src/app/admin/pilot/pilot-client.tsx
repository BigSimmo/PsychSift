"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { browserSupabaseClientFor } from "@/lib/supabase/browser-client";

type ApprovedSourceKind = "txt" | "pdf";

const approvedSources = {
  txt: {
    label: "Approved NHMRC summary TXT",
    fileLabel: "Approved summary TXT",
    fileHint: "Choose the approved 7,437-byte NHMRC summary TXT.",
    accept: ".txt,text/plain",
    mimeType: "text/plain",
    byteLength: 7437,
    sha256: "22f4c1ab15dc61769461e3d27ec9427343d95878799e35896feb3cf9288f4e11",
    title: "NHMRC Australian alcohol guidelines — approved summary TXT",
    description: "Licensed NHMRC summary; controlled owner-private administrator TXT pilot.",
    explanation: "NHMRC summary, 7,437 bytes, CC BY 4.0 evidence. Text only; owner-private administrator ingestion and embedding. Publication needs a separate decision.",
  },
  pdf: {
    label: "Reviewed NHMRC four-page native PDF",
    fileLabel: "Reviewed four-page native PDF",
    fileHint: "Choose selected-original-pages-9-10-11-62.pdf (2,211,561 bytes).",
    fileName: "selected-original-pages-9-10-11-62.pdf",
    accept: ".pdf,application/pdf",
    mimeType: "application/pdf",
    byteLength: 2211561,
    sha256: "abbc8107a09582e18f36bf4905c75f1fc78af70cd516851b89bff8919ca5bece",
    title: "NHMRC Australian alcohol guidelines — selected four-page native PDF",
    description: "Four-page derivative of NHMRC Australian Guidelines to Reduce Health Risks from Drinking Alcohol (DS14, 2020): child pages 1–4 map to original physical pages 9, 10, 11, 62 (printed 4, 5, 6, 57). CC BY 4.0 NHMRC-owned content only; Commonwealth Coat of Arms, NHMRC logo, identified third-party content and separately copyrighted images are excluded. Controlled owner-private administrator PDF pilot; no clinical or publication approval.",
    explanation: "Selected original PDF pages only: physical 9, 10, 11 and 62 (printed 4, 5, 6 and 57). Four-page derivative, 2,211,561 bytes. Owner-private ingestion only; no whole-document, OCR, clinical or publication approval. The CC BY 4.0 licence excludes the Coat of Arms, NHMRC logo, identified third-party material and separately copyrighted images.",
  },
} as const;
const authority = {
  version: 1, sourceRole: "clinical_guideline", authorityBasis: "administrator_template",
  licencePolicy: "public_index_permitted",
  rightsEvidenceRef: "summary-source-evidence.json#sha256:cc270f77bb29eb684ac52080a8cb261c50027a43689e1696470373ef354582c0",
  publisher: "National Health and Medical Research Council", jurisdiction: "Australia",
  publicationDate: null, effectiveDate: null, reviewDate: null, expiryDate: null,
  currentness: "current", supersedesDocumentId: null, purpose: "clinical_retrieval",
  supportedFeatures: ["text"], providerProcessing: "permitted",
};
const pdfAuthority = {
  ...authority,
  rightsEvidenceRef: "pdfLicenceEvidence.json#sha256:59a7b03820d50bce6060aac1b76b352fd68a26643064be0e06c89788969fcfea",
};

export default function AdminPilot({ url, publishableKey }: { url: string; publishableKey: string }) {
  const client = useMemo(() => browserSupabaseClientFor(url, publishableKey), [url, publishableKey]);
  const [factors, setFactors] = useState<{ id: string; name: string }[]>([]);
  const [factorId, setFactorId] = useState("");
  const [factorsReadState, setFactorsReadState] = useState<"pending" | "success" | "error">("pending");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [verifiedAt, setVerifiedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sourceKind, setSourceKind] = useState<ApprovedSourceKind>("pdf");
  const [admitted, setAdmitted] = useState<Record<ApprovedSourceKind, boolean>>({ txt: false, pdf: false });
  const correlation = useRef<Partial<Record<ApprovedSourceKind, string>>>({});

  useEffect(() => {
    let active = true;
    void client.auth.mfa.listFactors().then(({ data, error }) => {
      if (!active) return;
      if (error) { setFactorsReadState("error"); setMessage("Authenticator factors could not be read. Sign in again."); return; }
      const verified = data.totp.filter(f => f.status === "verified").map(f => ({ id: f.id, name: f.friendly_name || "Authenticator" }));
      setFactors(verified); setFactorId(verified[0]?.id ?? ""); setFactorsReadState("success");
    }).catch(() => { if (active) { setFactorsReadState("error"); setMessage("Authenticator factors could not be read. Sign in again."); } });
    return () => { active = false; };
  }, [client]);

  async function enroll() {
    if (busy || factorsReadState !== "success") return;
    setBusy(true);
    try {
      const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Administrator pilot authenticator" });
      if (error || !data) { setMessage("Authenticator enrollment failed. No upload was attempted."); return; }
      setFactorId(data.id); setQr(data.totp.qr_code); setVerifiedAt(0);
      setMessage("Scan this QR code in your own authenticator app. Do not share or screenshot it. Then enter the six-digit code.");
    } catch { setMessage("Authenticator enrollment could not complete."); }
    finally { setBusy(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || factorsReadState !== "success" || !factorId || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    try {
      const challenge = await client.auth.mfa.challenge({ factorId });
      if (challenge.error || !challenge.data) { setMessage("Authenticator challenge failed. Try again manually."); return; }
      const result = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
      if (result.error) { setMessage("Code not accepted. Enter a current code from your authenticator."); return; }
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data?.currentLevel !== "aal2") { setMessage("Your session has not reached the required assurance level."); return; }
      setQr(""); setVerifiedAt(Date.now());
      setMessage("Authenticator verified. This may sign out other sessions. The upload server checks actual assurance and recent authentication again.");
    } catch { setMessage("Authenticator verification could not complete."); }
    finally { setCode(""); setBusy(false); }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || admitted[sourceKind]) return;
    const fields = new FormData(event.currentTarget);
    const source = approvedSources[sourceKind];
    setBusy(true);
    try {
      if (!verifiedAt || Date.now() - verifiedAt > 15 * 60_000) { setVerifiedAt(0); setMessage("Verify your authenticator again before uploading."); return; }
      const file = fields.get("file");
      if (!(file instanceof File) || file.size !== source.byteLength ||
          (sourceKind === "txt" ? !file.name.toLowerCase().endsWith(".txt") : file.name !== approvedSources.pdf.fileName)) {
        setMessage(source.fileHint); return;
      }
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map(b => b.toString(16).padStart(2, "0")).join("");
      if (hash !== source.sha256) { setMessage("The file differs from the approved source. Upload stopped."); return; }
      if (fields.get("decision") !== "confirmed") { setMessage("Confirm the operator-approved authority and owner-private pilot purpose."); return; }
      const { data, error } = await client.auth.getSession();
      if (error || !data.session) { setMessage("Sign in and verify again."); return; }
      const payload = new FormData();
      payload.set("file", new File([file], file.name, { type: source.mimeType }));
      payload.set("title", source.title);
      payload.set("description", source.description);
      payload.set("authority", JSON.stringify(sourceKind === "pdf" ? pdfAuthority : authority));
      const correlationId = correlation.current[sourceKind] ?? crypto.randomUUID();
      correlation.current[sourceKind] = correlationId;
      const response = await fetch("/api/upload", { method: "POST", credentials: "same-origin", headers: { Authorization: `Bearer ${data.session.access_token}`, "Idempotency-Key": correlationId }, body: payload });
      const result = await response.json().catch(() => null);
      if (!response.ok) { setMessage(`Upload refused (HTTP ${response.status}). Worker activation stays stopped; confirm the operator decision and session before retrying.`); return; }
      if (result?.duplicate) {
        setAdmitted(current => ({ ...current, [sourceKind]: true }));
        setMessage("This exact source is already stored for this owner; no new job was queued. Ask the operator to read back its existing state.");
        return;
      }
      if (!result?.document?.id || !result?.job?.id) { setMessage("No new job confirmed. Ask the operator to read back the admission before worker activation."); return; }
      setAdmitted(current => ({ ...current, [sourceKind]: true }));
      setMessage(`Admitted document ${result.document.id}; job ${result.job.id}. Operator readback and finite permission are still required before running the worker once.`);
    } catch { setMessage("Upload outcome uncertain. Ask the operator to read back this admission before retrying or starting the worker."); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <section aria-labelledby="mfa-heading" className="space-y-3">
      <h2 id="mfa-heading" className="text-lg font-semibold">1. Verify your authenticator</h2>
      {factors.length > 0 && <label className="block">Authenticator<select className="block border p-2" value={factorId} disabled={busy} onChange={e => { setFactorId(e.target.value); setVerifiedAt(0); }}>{factors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      {factors.length === 0 && !factorId && <button className="rounded border p-2" type="button" disabled={busy || factorsReadState !== "success"} onClick={() => void enroll()}>Set up an authenticator</button>}
      {qr && <img src={qr} alt="Private authenticator enrollment QR code" width={240} height={240} />}
      <form onSubmit={verify} className="space-y-3"><label className="block">Six-digit authenticator code<input className="block border p-2" type="password" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy || factorsReadState !== "success" || !factorId} onChange={e => setCode(e.target.value)} /></label><button className="rounded border p-2" disabled={busy || factorsReadState !== "success" || !factorId}>Verify code</button></form>
    </section>
    <section aria-labelledby="upload-heading" className="space-y-3">
      <h2 id="upload-heading" className="text-lg font-semibold">2. Admit one approved pilot source</h2>
      <p>{approvedSources[sourceKind].explanation}</p>
      <form onSubmit={upload} className="space-y-3">
        <label className="block">Approved pilot source
          <select className="block border p-2" value={sourceKind} disabled={busy} onChange={event => {
            if (event.target.value !== "txt" && event.target.value !== "pdf") return;
            setSourceKind(event.target.value);
            setMessage("");
          }}>
            <option value="pdf">{approvedSources.pdf.label}</option>
            <option value="txt">{approvedSources.txt.label}</option>
          </select>
        </label>
        <label className="block">{approvedSources[sourceKind].fileLabel}<input key={sourceKind} className="block" name="file" type="file" accept={approvedSources[sourceKind].accept} required disabled={busy || admitted[sourceKind]} /></label>
        <label className="block"><input type="checkbox" name="decision" value="confirmed" required disabled={busy || admitted[sourceKind]} /> I confirm the operator-approved source authority, licence evidence and controlled owner-private ingestion/embedding purpose.</label>
        <button className="rounded border p-2" disabled={busy || admitted[sourceKind] || !verifiedAt}>Admit this {sourceKind === "pdf" ? "PDF" : "TXT"}</button>
      </form>
    </section>
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
