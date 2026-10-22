# Decision: Answers leave the diagnosis and treatment decision to the clinician

- **Status:** decided 2026-10-21
- **Source:** `src/lib/rag/rag-answer-instructions.ts`, find "leave the diagnosis and treatment choice to the treating clinician"

On 21 Oct 2026 the owner approved, in the project chat ("Go ahead with all recommendations please",
answering the coordinator's list that named "yes to the prompt line"), adding one line to both answer
prompts for the amended TGA exemption limb (d) that applies from 1 Nov 2026: answers do not make the
diagnosis or treatment decision for a specific patient, and set out the guidance and criteria
instead. The owner also approved one before-and-after eval canary pair capped at US$2, to run once the
OpenAI quota is restored. Showing exact quote cards at medium trust (limb (e)) was approved in the same
message. Up to 2 quotes show at medium trust. An authority-capped medium answer still shows none.
The only live surface is the source drawer's cited passage, which now shows the exact quote at medium
trust. A local screenshot check on 21 Oct found no visible difference with demo content, and the
owner then approved the change and the hazard-controls reseal on 21 Oct. Until the reseal runs, a
drift exception covers the two changed files.

If this summary and the source ever differ, the source wins.
