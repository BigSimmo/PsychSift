# Figma sync: copy the work-mode screens into Figma

## What this is

A small developer tool that copies the live work-mode screens (My Day, Roster, On Call, Teaching,
CPD, Admin and so on) into a Figma design file, so the screens can be reviewed, annotated and
restyled in Figma. It also builds a "Components" page in Figma (buttons, tags, headers, tabs, cards)
that uses the same colours as the app.

It is a developer tool, not part of the app. Nothing here ships to the live site, touches the
database, or calls OpenAI, Supabase or GitHub. It reads only your own local copy of the app, and
every call into Figma is pasted in by hand.

The copy is a picture of the app at one moment. It does not update itself: after the app changes,
follow "Refresh Figma after a change" below.

## Where things are in Figma

- File key: `YOKQKUyYMvpTYLsU1pgVUv`
- Page ids (used by the Figma tool and by the `--swap` option):

| Page                  | Id     |
| --------------------- | ------ |
| Icons                 | `7:3`  |
| Header and navigation | `7:4`  |
| My Day                | `7:5`  |
| Notifications         | `7:6`  |
| Roster                | `7:7`  |
| Open shifts           | `7:8`  |
| Manage team           | `7:9`  |
| On Call               | `7:10` |
| Teaching              | `7:11` |
| Assessments           | `7:12` |
| CPD                   | `7:13` |
| Admin                 | `7:14` |
| Components            | `23:2` |

Colours in Figma are bound to two variable collections, "Live · Base" and "Live · Area". The area
collection has one mode per area (My Day, Roster, On Call, Teaching, CPD, Admin), so a header or
button changes colour when its frame is switched to another mode.

## What is in this folder

| File                   | What it does                                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobs.json`            | The list of every screen to copy: its route, width and any button to press first (menus, sheets), and how long to wait for a page that never goes quiet (`/roster/today` loads for 4 seconds). Its order is the order of sections on each Figma page. |
| `capture.mjs`          | Opens each screen in a browser against your local server and saves what is on it (boxes, text, icons, colours) as a JSON file, plus a PNG.                                                                                                            |
| `build-calls.mjs`      | Turns the saved screens into text files, each small enough for one Figma `use_figma` call. Also writes the Components and swap calls. Needs no server.                                                                                                |
| `calls-lib.mjs`        | The logic behind `build-calls.mjs` (shrinking icons, packing the data, splitting large pages). Covered by `tests/figma-sync-calls.test.ts`.                                                                                                           |
| `figma/builder.mjs`    | The code that runs inside Figma to draw one batch of screens. It is wrapped into every page call.                                                                                                                                                     |
| `figma/components.mjs` | The code that runs inside Figma to build the Components page.                                                                                                                                                                                         |
| `figma/swap.mjs`       | The code that runs inside Figma to replace drawn headers and tab bars with Components-page instances, so a header can be changed once for every screen.                                                                                               |

The three files in `figma/` run inside Figma's plugin sandbox, not in Node. They must not import
anything or use Node features. `build-calls.mjs` shrinks them and adds the data in front.

## Refresh Figma after a change

1. Start this project's local server and note the web address it prints. In a terminal:

   ```bash
   npm run ensure
   ```

2. Capture the screens in chunks of about 12. The local server compiles each route the first
   time it is opened and can run out of memory if it does too many at once. Run this again and
   again until it says "Nothing to capture". Replace the address with the one from step 1:

   ```bash
   node scripts/figma-sync/capture.mjs --base-url http://localhost:PORT --skip-existing --limit 12
   ```

   If the server stops answering part-way, run `npm run ensure` again and repeat the same command.
   It carries on where it stopped. Captures are saved in `.tmp-visual/figma-sync/captures`, which
   git ignores. Delete that folder first for a fresh start. The command refuses to run against any
   server that is not this project's. You need a Chromium browser for Playwright
   (`npx playwright install chromium`), or set `CHROMIUM_PATH` to one you already have.

3. Build the Figma call files (no server needed):

   ```bash
   node scripts/figma-sync/build-calls.mjs
   ```

   They are written to `.tmp-visual/figma-sync/calls`. The run lists each file and its size, and
   fails if any file is too big for one Figma call (50,000 characters).

4. Paste each call file into the Figma `use_figma` tool for file `YOKQKUyYMvpTYLsU1pgVUv`, one
   file per call, in this order:
   1. `icons-01.js`, `icons-02.js` and so on first. They add the icon components to page `7:3`
      and skip any icon already there.
   2. Then each `page-<id>-<n>.js`. The id in the name is the Figma page (for example
      `page-7_14-1.js` draws onto Admin, `7:14`). Each call adds new sections of screens to that
      page, so delete a page's old sections in Figma before redrawing it, or the page ends up
      with two copies.

5. Replace the drawn headers and tab bars with Components-page instances. This needs the
   Components page to exist (step 6 builds it the first time). Make the swap files, then paste
   one per page:

   ```bash
   node scripts/figma-sync/build-calls.mjs --swap all
   ```

   This writes `swap-7_4.js` through `swap-7_14.js`. To do one page, use
   `--swap 7:14` instead. It is safe to run again on a page.

6. Only when the components themselves change (a new button style, say), rebuild the Components
   page. This clears and redraws the whole page, so redraw the screen pages and run the swap
   again afterwards:

   ```bash
   node scripts/figma-sync/build-calls.mjs --components
   ```

   Paste `components.js` into the Figma tool.

### Adding or changing only some screens

Capturing and drawing everything takes a while. To add new screens without touching the rest:

1. Add the screens to `jobs.json`, capture only them (`--only id,id`) into a new folder (the
   second positional argument, for example `.tmp-visual/figma-sync/new`).
2. Build with `--captures` pointing at that folder, `--previous` pointing at the folder of the
   full earlier capture (so icons keep their names and only new icons are drawn), and `--y-start`
   with a small JSON file such as `{ "7:14": 5816 }` that gives, for each page, the lowest edge of
   what is already drawn there. New sections start below it. Each build also writes a `y-end.json`
   in the same format, which you can use as the next `--y-start`.

A screen that has no capture is skipped with a warning, so a partial run never fails.

## From Figma back to the app

Figma is for looking and deciding. The app's real colours and sizes live in code, so a change in
Figma only reaches the app through a normal pull request:

1. Read the variables in Figma (the "Live · Base" and "Live · Area" collections).
2. Compare them with the design tokens in `src/app/globals.css` and `src/app/work-mode-tokens.css`.
3. Change the tokens or components in the app, and open an ordinary pull request. Nothing
   in this folder writes to the app.

## Notes for maintainers

- When a route is renamed or added, update `jobs.json`. A new work-mode area also needs its Figma
  page added to `AREAS` in `calls-lib.mjs`; the build stops with a clear message if one is missing.
