# Decision: The health professional declaration moves to first open, before any clinical tool

- **Status:** decided 2026-10-26
- **Source:** `src/components/mode-kit/use-clinical-tool-access.ts`, find "first open, before any clinical tool (D26-07, 26 Oct 2026)"

On 26 Oct 2026 the owner accepted the design recommendation (D26-07) to ask for the declaration "I'm a
health professional and I accept the Terms" when PsychSift first opens, instead of only at the first
Ask, and then chose to build it now on a decision card in the project thread. Every clinical tool waits
on the same account record. A tool opened after Not now shows a card that reopens the prompt. The
prompt's wording is unchanged, and the Terms step at the first Ask stays as a second chance.

If this summary and the source ever differ, the source wins.
