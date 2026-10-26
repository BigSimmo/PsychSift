# Decision: Under-18 and youth crises pin 000 after CAMHS Crisis Connect, and Kids Helpline is approved for youth searches

- **Status:** decided 2026-10-26
- **Source:** `src/lib/service-urgent-routing.ts`, find "Owner decision 2026-10-26 (D4)"

The owner approved every recommendation in the S7 crisis wording proposal ("Go ahead with all
recommendations", in the project chat on 26 Oct 2026). In a services search, an under-18 or youth
crisis now pins CAMHS Crisis Connect and then 000, and 000 comes first when there is immediate danger
or a swallowed amount of medicine. "aged 15", "year 10 student" and "high school student" count as
under 18, and "15M", "16F" and "(14)" count as youth wording. Status epilepticus, a patient fitting, a
stroke happening, chest pain and similar emergencies pin 000. Kids Helpline and then Lifeline WA are
pinned after the crisis lines for under-18 and youth crises, which ends the hold of 18 Oct 2026. The
Answer crisis card adds CAMHS Crisis Connect after 000 when the question names someone under 18. The
Answer crisis card also shows for more suicidal intent and method wording and for a swallowed amount of
medicine, and a swallowed amount adds the Poisons Information Centre (`src/lib/crisis-wording.ts`).

If this summary and the source ever differ, the source wins.
