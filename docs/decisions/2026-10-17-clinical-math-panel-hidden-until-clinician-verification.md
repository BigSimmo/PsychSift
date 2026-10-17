# Decision: The bedside calculator panel is hidden from /calculators until clinician verification

- **Status:** decided 2026-10-17
- **Source:** `tests/clinical-math-panel-breakpoint.dom.test.tsx`, find "Owner decision 17 Oct 2026 22:12 AWST"

The owner decided on 17 Oct 2026 at 22:12 AWST that the whole bedside calculator panel (renal clearance with
ideal body weight, QTc and lithium) stays off the calculators page until a clinician verifies it.
`src/components/calculators/search-page.tsx` no longer renders `ClinicalMathPanel` in the sidebar or the
mobile column, and no longer calls `useClinicalMathPanelState`. The component, the hook and their unit
tests are kept, so the panel can be wired again once verified. The follow-up from #08216B (#8Y9169, which
lists the 16 Oct calculator changes that need clinician verification) tracks that review. Wiring the panel
again needs a new decision that records the clinician's verification.

If this summary and the source ever differ, the source wins.
