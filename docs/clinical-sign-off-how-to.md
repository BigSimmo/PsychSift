# How to sign off clinical content

This guide is for the clinical owner. It explains, step by step, how to read and sign off
the guidance for the WA Mental Health Act 2014 forms, the plain-English Act-section
summaries, the Act deadlines on each form's Timeline, the ten locally authored differential
overlays, the Formulation guide modules, mechanisms and concepts, and the Therapy records.
You do it on your own computer. Nothing is sent anywhere until the last step.

Only you can sign off. Claude and other tools are blocked from doing it: the sign-off tool
refuses to write anything unless a person is typing at a real terminal.

## What a sign-off does

Every form in the app currently says "awaiting clinical review". When you sign a form off,
that label comes off for that form only. The rest keep it until you get to them, so you can
do a few at a time.

Your sign-off is tied to the exact text you read. If anyone edits that text afterwards, the
app's checks notice and the form goes back to needing your sign-off. You will never be
vouching for words you did not see.

## Before you start

You need a terminal window open in your copy of the project folder on your computer.

- **Mac:** open the Terminal app, type `cd ` (with a space after it), drag the project folder
  into the window, and press Enter.
- **Windows:** use Command Prompt, not PowerShell. Open the project folder in File Explorer,
  click the address bar at the top, type `cmd` and press Enter. A Command Prompt window opens
  already in the project folder. (If you do use PowerShell, type `npm.cmd` wherever this
  guide says `npm`. PowerShell can refuse the plain `npm` command, and it can drop the `--`
  that passes your answers' settings through to the tool.)

Type each command below exactly as shown, then press Enter.

1. Check your computer has the right version of Node, the program the project runs on:

   ```bash
   node --version
   ```

   The answer must be `v24.15` or higher, but still start with `v24` (for example `v24.15.0`
   or `v24.16.1`). If it does not, stop and tell Claude what it printed.

2. Get the latest version of the project:

   ```bash
   git fetch origin
   ```

3. Switch to the main version of the project, which has the sign-off tool, and bring it up
   to date. Type these one at a time:

   ```bash
   git switch main
   ```

   ```bash
   git pull
   ```

   Then make your own sign-off branch, so your sign-offs travel on their own and never
   straight onto main (main only accepts changes through a reviewed pull request). Use
   today's date in place of the example date:

   ```bash
   git switch -c clinical-signoff-2026-10-01
   ```

   If any of these says your local changes would be overwritten, stop and ask Claude before
   going on.

   If you already signed forms on the claude/sweet-carson-e7ur0s-wa-signoff branch and pushed
   them, tell Claude so they are merged into main first — your form sign-offs carry over
   unchanged.

4. Install the project's tools for this version. It takes a few minutes, and you only need
   to do it again after you next switch to a newer version of the project. Close VS Code
   and any running copy of the app first — Windows can lock the installed-packages folder.

   ```bash
   npm ci --include=dev
   ```

5. Check the tool works. This only shows what is waiting and changes nothing:

   ```bash
   npm run clinical:review
   ```

## Signing off forms

6. Start the walk-through. Replace `<your surname>`, angle brackets included, with your
   surname, so the name reads exactly as you want it shown in the app. Keep the quote marks.
   The tool refuses the name if the angle brackets are still there.

   ```bash
   npm run clinical:review -- --write --walk --kind form --reviewed-by "Dr <your surname>"
   ```

   Your name is shown publicly in the app. Do not use your email address, AHPRA number,
   provider number or staff number; the tool will refuse them.

7. The tool shows one form at a time, highest consequence first: **3C, 10B, 10E, 11B, 11E,
   6C**, then the rest in catalogue order. For each form it shows everything you are
   vouching for, exactly as the app shows it: the three summary cards at the top of the
   form's page (clock, who makes it, criteria), the purpose, who may make it, when it applies, the clock, what it does and
   does not authorise, the traps, the pre-use checks, the safety pearl, the documentation
   stem, and the Act sections it was drafted from. Have the approved form open beside you and
   read the screen in full.

8. Answer the three questions. Type `yes` or `no` and press Enter.
   - **"The wording matches its source."** Every statement on the screen matches the Act
     sections named and the current approved form. Nothing is added that the source does
     not say.
   - **"The clinical meaning is correct."** Read as a clinician would at the bedside, it
     means the right thing: the clock starts at the right moment, the maker is right, and
     the limits of what the form authorises are right.
   - **"It is safe to show this as reviewed."** You are content for the app to drop the
     "awaiting clinical review" label for this form.

   Any `no` means that form is not signed off. Nothing is written for it, and the tool moves
   on to the next form. It stays "awaiting clinical review" until you come back to it.

9. After three `yes` answers, type the form's code to confirm (for example `3C`) and press
   Enter. That form is saved straight away.

10. Stop whenever you like: type `quit` at any question or at the code prompt, or press Ctrl
    and C together. Nothing is saved for the form on screen; every form you already confirmed
    stays saved. Next time, the walk-through starts at the first
    form you have not signed.

## Signing off Act-section summaries

The same walk-through works for the plain-English summaries of each Act section. It shows
the verbatim Act text above the drafted summary, in section-number order. The three
questions mean the same thing, applied to the summary against the Act text. Confirm each one
by typing its section number (for example `26`).

```bash
npm run clinical:review -- --write --walk --kind section --reviewed-by "Dr <your surname>"
```

## Signing off Act deadlines

The same walk-through works for the Mental Health Act deadlines shown on each form's
Timeline. It shows the quoted Act words for each deadline. Confirm each one by typing the
code the tool shows for it.

```bash
npm run clinical:review -- --write --walk --kind timeframe --reviewed-by "Dr <your surname>"
```

After you sign off a deadline, tell Claude: the offline page (the one the app shows with no
internet) keeps its own copy of signed-off deadlines, and Claude must rebuild it.

## Signing off the Today rule engines

Three Today-page features stay switched off until you sign them: roster fatigue warnings, CPD
category coaching and the Mental Health Act countdowns. One guided command does all three.

1. See where things stand (this changes nothing):

   ```bash
   npm run rules:sign
   ```

2. Start the guided sign-off:

   ```bash
   npm run rules:sign -- --write
   ```

3. The first time, it adds you as the approved signer. It prints where to find your account ID
   in the Supabase dashboard (Authentication, then Users, then the UID column on your row); paste
   it, then type your given name and surname, then type `ADD`.
4. For each feature it shows every quoted rule and its source. Answer the three questions, type
   the sign-off code it shows, then choose whether to switch it on now.
5. The countdowns also ask for the date you re-checked the medical-device ruling and where that
   decision is written down. A countdown runs only for a deadline that a named clinician signed.
6. Re-reviewing a feature that is already signed: answering No to any question revokes its
   sign-off and switches it off. Skipping the review or mistyping the code changes nothing.
7. It saves `src/lib/admin/today-rule-sign-offs.json`. Tell Claude it is signed so the file can
   be committed.

## Signing off the differential overlays

Ten differentials carry assessment steps, safety facts and "how to tell it apart" rows that
were written locally rather than exported from a source. Each page marks that content
"Locally authored — verify before use". Once you sign one off, that line names you instead.

The walk-through shows the highest-risk ones first: neuroleptic malignant syndrome,
serotonin toxicity, delirium, hypoactive delirium and clozapine toxicity, then the rest. It
shows every authored line exactly as the page does. Confirm each one by typing its short
name, which the tool shows (for example `serotonin-toxicity`).

```bash
npm run clinical:review -- --write --walk --kind differential --reviewed-by "Dr <your surname>"
```

The three questions mean the same thing here. "The wording matches its source" means each
statement matches what you would accept from a current guideline or standard text. A step
that tells a clinician what to do, rather than what to check, deserves the closest read.

## Signing off Formulation

Formulation has three walk-throughs. Do the guide modules first, because they instruct
rather than define. Guide 8, for example, makes a specific claim about NICE NG225 and
suicide risk prediction. Then do the 12 mechanisms, then the 46 concepts.

```bash
npm run clinical:review -- --write --walk --kind formulation-guide --reviewed-by "Dr <your surname>"
```

```bash
npm run clinical:review -- --write --walk --kind formulation-mechanism --reviewed-by "Dr <your surname>"
```

```bash
npm run clinical:review -- --write --walk --kind formulation-concept --reviewed-by "Dr <your surname>"
```

Each screen shows every field of the record, including its evidence list. Confirm each one by
typing its id, which the tool shows (for example `guide-08` or `avoidance`). Once signed, the
record's badge changes from "Awaiting clinical review" to "Clinically reviewed" with your name.

## Signing off Therapy

Therapy records can be reviewed either in batch via an HTML review pack (recommended) or one-by-one in the terminal. Both paths ask the same seven checks per record: clinical accuracy, source correspondence, evidence appraisal, safety and cautions, the patient-facing explanation, proofreading, and Australian English.

### Visual HTML review pack and batch sign-off (recommended)

Instead of answering questions 205 times in the terminal, generate a visual HTML review pack to read in your browser:

1. Generate the review pack:
   ```bash
   npm run therapy:review -- --pack --reviewed-by "Dr <your surname>"
   ```
2. Open `sign-off-packs/therapy.html` in your browser and review the records. Note the sign-off code shown at the top.
3. Sign the batch in one step:
   ```bash
   npm run therapy:review -- --write --batch --reviewed-by "Dr <your surname>"
   ```
   If any specific record needs revision before sign-off, exclude it by short name: `--exclude <slug1>,<slug2>`.

### Terminal walk-through (one by one)

The walk-through goes through all 205 in catalogue order. Confirm each one by typing `REVIEW` and its short name, which the tool shows.

```bash
npm run therapy:review -- --write --walk --reviewed-by "Dr <your surname>"
```

47 Therapy records list no references yet. The tool leaves them out, because the source correspondence question cannot be answered yes without a source; they stay awaiting review until one is adopted. Type `skip` at any question to move on to the next record without saving the one on screen.

## Indigenous content is never signed off here

Owner rule, 2026-09-26. Any record that mentions Aboriginal or Torres Strait Islander people,
First Nations, Indigenous, social and emotional wellbeing (SEWB), or an Indigenous-specific
service is held back: it is left out of every walk-through, pack and batch, the tool refuses to
sign it even by its code, and a record found signed anyway turns the project's checks red. It
needs review under Aboriginal governance instead. The queue report shows how many are held in
each set. The match is deliberately broad, so a record can be held for a passing mention; that
only leaves it awaiting review, which is the safe state.

## Specifiers and dictionary rewrites

Two more sets work with the same walk-through, pack and batch commands:

- `--kind specifier`: the 71 specifiers with a written definition plus the 18 general
  specifiers. These definitions are hidden on the site today because an automated check found
  scattered clinical errors among them; signing one says it is correct against DSM-5-TR, and the
  page then shows it. The other 494 specifiers have no definition yet, so there is nothing to sign.
- `--kind dictionary-rewrite`: the 28 proposed rewrites of existing dictionary definitions.
  Approving one records your approval; the site keeps the current wording until the approved
  rewrites are applied in a separate step.

## Signing off a whole set at once (batch)

Owner decision, 2026-09-26. Instead of answering the questions record by record, you can
read a whole set in your browser and sign it in one go.

1. Write the review pack for one set. It is saved in the `sign-off-packs` folder inside the
   project folder:

   ```bash
   npm run clinical:review -- --pack --kind formulation-concept --reviewed-by "PsychSift"
   ```

2. Open the pack in your browser and read every record. At the top it shows a **sign-off
   code** (eight letters and numbers) and the exact command to run. Note the code of any
   record you are not happy with; it is shown under each record's title.

3. Run the command from the top of the pack. Put the codes of the records you are not happy
   with after `--exclude`, separated by commas with no spaces, or leave `--exclude` out:

   ```bash
   npm run clinical:review -- --write --batch --kind formulation-concept --reviewed-by "PsychSift" --exclude hopelessness,guilt
   ```

4. Answer the three questions once. Answer yes only if the statement is true of every
   record you are signing. Then type the sign-off code from the top of the pack.

If any record changed after the pack was written, the code will not match and nothing is
signed. Write a fresh pack and read that one. Excluded records stay awaiting review.

The same works for `--kind differential`, `formulation-guide`, `formulation-mechanism`,
`form`, `section`, `timeframe`, `specifier` and `dictionary-rewrite`. For Therapy:

```bash
npm run therapy:review -- --pack --reviewed-by "PsychSift"
```

```bash
npm run therapy:review -- --write --batch --reviewed-by "PsychSift" --exclude <slugs>
```

## Saving and sending your sign-offs

Your sign-offs are saved only on your computer until you send them. When you have finished
a session:

11. Mark the changed files to be saved. For forms:

    ```bash
    git add data/forms-content-review.json docs/evidence/forms-operational-guidance-review.md
    ```

    For Act sections, instead:

    ```bash
    git add data/mha-2014-sections.json
    ```

    For Act deadlines, instead:

    ```bash
    git add data/mha-timeframes.json
    ```

    For the differential overlays:

    ```bash
    git add data/differential-curated-review.json
    ```

    For Formulation (all three walk-throughs):

    ```bash
    git add src/data/formulation-concepts.json src/data/formulation-content.json
    ```

    For Therapy:

    ```bash
    git add src/data/therapies-source.json src/data/therapies-index.json src/data/therapy-catalogue-assets.ts public/therapy-compass-data
    ```

12. Save them with a short note:

    ```bash
    git commit -m "Clinical sign-off: forms"
    ```

    (For sections, use `"Clinical sign-off: Act sections"`; for deadlines,
    `"Clinical sign-off: Act deadlines"`; otherwise name what you signed, for example
    `"Clinical sign-off: differentials"`.)

13. Send them, using the same date as your branch name:

    ```bash
    git push -u origin clinical-signoff-2026-10-01
    ```

    This can take a minute or two while the project runs its own checks.

Then tell Claude in the chat: "open a PR for my sign-offs on clinical-signoff-2026-10-01"
(with your date), and Claude will take it from there. A sign-off also changes a few derived
files and counts that the project's checks compare against (for example the site-content
manifest fixture and the sign-off queue counts). Claude refreshes those in the pull request;
you do not need to.

If `git push` (or any step) fails, copy the last line of the message it printed and paste it
to Claude in the chat. Your sign-offs are still saved on your computer, so nothing is lost.

## If something looks wrong

- **The tool says "content changed since sign-off".** Someone edited a form or summary
  after you signed it. It is back in your queue; run the walk-through again to re-read it.
- **The text on screen is wrong.** Answer `no`. Nothing is saved for that form. Tell Claude
  which form and what is wrong, and it will be corrected and come back to you.
- **The tool says the project's tools are not installed.** Run `npm ci --include=dev` (step
  4), then start the walk-through again.
- **The tool says another sign-off is saving the file.** Close any other terminal window
  that is running the sign-off tool and try again. It clears a lock left behind by a
  session that crashed, or one older than 30 minutes, by itself. If it still refuses, copy
  the last line of the message and paste it to Claude.
- **Anything else.** Copy the last line of the message and paste it to Claude.
