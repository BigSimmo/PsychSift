# PsychSift design system — document set

The system of record for the v2 design system. **Rules and roles live here; values live
only in the token files.** Source-of-truth ranking: `AGENTS.md` → `ckb-v2-tokens.css` →
committed tests → `.design-sync/conventions.md` → this set. Where this set contradicts a
higher source, the higher source wins and the contradiction is a defect here.

**Picking the work up cold?** Start at
[`docs/outstanding-issues.md`](../outstanding-issues.md) — the ledger rows are the current
source of truth for what is open, in what order, and what has already been measured.

[HANDOVER-2026-08-07.md](HANDOVER-2026-08-07.md) is **superseded and must not be used to
scope work** (`#277`). Nine open rows cite it as their Source, but four of its figures have
since been disproved and the corrections live in those rows rather than in the document,
which still asserts the originals. It is kept for provenance — the citations, the PR and
commit record, and its verification and gotcha sections — and carries a banner listing what
is known wrong.

Reading order:

1. [SPEC.md](SPEC.md) — principles, foundations, patterns, degraded states, accessibility,
   content design, the migration playbook (§13) and the authoring definition of done (§14).
2. [TOKENS.md](TOKENS.md) — the reconciled inventory: every role, winner, owner, and the
   per-group allowed/forbidden usage rules (§7).
3. [COMPONENTS.md](COMPONENTS.md) — maturity matrix (§0), the eight safety-component
   specifications (§1–§8), and the binding contract per existing component (§9).
4. [DECISIONS.md](DECISIONS.md) — conflicts C1–C5 resolved, the clinical Q&A record,
   assumptions, and the resolution log.
5. [GATES.md](GATES.md) — every rule paired with its enforcement status. A prohibition
   with no row there is a suggestion.
6. [FIX-GUIDE.md](FIX-GUIDE.md) — Hazard 1–2 sweep dispositions (Fixed / Documented / Deferred / Out-of-scope).
7. [ADOPTION.md](ADOPTION.md) — surface ownership, registration dispositions, proof status, and the generated v2 adoption manifest across all 14 clinical surface families.

Canonical code: `src/app/ckb-v2-tokens.css` is the **v2 target layer** and `globals.css` remains
the compatibility layer. The source now mounts `.ckb-v2` literally on the global `<html>`, so every
production surface is observed under v2. The generated [adoption manifest](adoption-manifest.json)
records that observation. Declared v2 surfaces may keep `baseline.status: "not-committed"` with
empty `files` so `check:design-system-adoption` / `check:design-system-contract` stay green during
draft; human-approved Linux screenshots and exact hosted provenance remain the draft→ready gate,
not a red CI check. Design project `08d6f126-3fd0-4764-aedf-0062a467280a` is not verified by this
repository; local design-sync parity is not remote publication proof.
