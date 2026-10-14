import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readSource = (relPath: string) => readFileSync(path.join(root, relPath), "utf8");

describe("Task 7 & 8: focus restoration, shortcut guards, landmarks, headings, and explanatory aria-disabled wiring", () => {
  it("restores focus to the opener when SettingsDialog and SidebarSettingsDialog close", () => {
    const lazyDialogs = readSource("src/components/clinical-dashboard/lazy-sidebar-dialogs.tsx");
    const settingsDialog = readSource("src/components/clinical-dashboard/settings-dialog.tsx");

    expect(lazyDialogs).toContain("triggerRef.current = document.activeElement");
    expect(lazyDialogs).toContain("restoreFocusUnlessMoved(target)");

    expect(settingsDialog).toContain("triggerRef.current = document.activeElement");
    expect(settingsDialog).toContain("restoreFocusUnlessMoved(target)");
    expect(settingsDialog).toContain("returnFocusRef={triggerRef}");
  });

  it("wires each ReminderSettingsBlock phone calendar alert select to its type heading and label via aria-labelledby", () => {
    const reminders = readSource("src/components/clinical-dashboard/settings-reminders.tsx");

    expect(reminders).toContain("const headingId = `settings-reminder-${type}-heading`;");
    expect(reminders).toContain("const alertLabelId = `settings-reminder-${type}-alert-label`;");
    expect(reminders).toContain("aria-labelledby={`${headingId} ${alertLabelId}`}");
  });

  it("guards UniversalSearchCommandSurface / and Cmd+K shortcuts when an aria-modal dialog is open", () => {
    const commandSurface = readSource("src/components/clinical-dashboard/universal-search-command-surface.tsx");

    expect(commandSurface).toContain("function handleSearchFocusShortcut(event: KeyboardEvent)");
    expect(commandSurface).toContain('if (document.querySelector(\'[role="dialog"][aria-modal="true"]\')) return;');
  });

  it("yields the WorkSearchButton / shortcut when #agreement-question-input is present on /admin/agreement", () => {
    const workSearchButton = readSource("src/components/work-search/work-search-button.tsx");

    expect(workSearchButton).toContain('if (slash && document.getElementById("agreement-question-input")) return;');
  });

  it("guards CalculatorSheet backdrop click dismissal once answers have been started", () => {
    const calculatorSheet = readSource("src/components/calculators/calculator-sheet.tsx");

    expect(calculatorSheet).toContain("const dismissFromBackdrop = () => {");
    expect(calculatorSheet).toContain("if (derived.started) {");
    expect(calculatorSheet).toContain("closeRef.current?.focus();");
  });

  it("renders <main> and <h1> landmarks on /factsheets/search, /factsheets/topics, /cme boundaries, and /first-nations", () => {
    const factsheetsSearch = readSource("src/components/factsheets/factsheets-search-page.tsx");
    const factsheetsTopics = readSource("src/components/factsheets/factsheets-topics-page.tsx");
    const cmeOwnerBoundary = readSource("src/components/cme/cme-owner-boundary.tsx");
    const cmeStateNotice = readSource("src/components/cme/cme-state-notice.tsx");
    const bedsideHome = readSource("src/components/first-nations/bedside-home.tsx");

    expect(factsheetsSearch).toMatch(/<main[\s\S]*?data-testid="factsheets-search-page"/);
    expect(factsheetsSearch).toContain(">Search patient information</h1>");

    expect(factsheetsTopics).toMatch(/<main[\s\S]*?data-testid="factsheets-topics-page"/);
    expect(factsheetsTopics).toContain('title="Topics"');

    expect(cmeOwnerBoundary).toContain('<main data-testid="cme-sample-loading"');
    expect(cmeOwnerBoundary).toContain('data-testid="cme-owner-boundary"');
    expect(cmeOwnerBoundary).toContain('data-testid="cme-signed-out"');
    expect(cmeOwnerBoundary.match(/<h1 className="sr-only">CPD<\/h1>/g)?.length).toBeGreaterThanOrEqual(3);
    expect(cmeStateNotice).toContain('<h1 className={bandNamesPage ? "sr-only"');

    expect(bedsideHome).toContain('<h1 className="sr-only">First Nations</h1>');
  });

  it("separates the Open Shifts SectionHeading label from its count with a space", () => {
    const openShiftsUi = readSource("src/components/open-shifts/open-shifts-ui.tsx");

    expect(openShiftsUi).toContain("{` ${count}`}");
  });

  it("wires explanatory unavailable controls with aria-disabled, aria-describedby, title, and ignoreUnavailableActivation", () => {
    const assessKit = readSource("src/components/teaching/assessments/assess-kit.tsx");
    const termOverview = readSource("src/components/teaching/assessments/assessments-term-overview.tsx");
    const numberSheets = readSource("src/components/favourites/number-sheets.tsx");
    const filmstrip = readSource("src/components/document-viewer/document-image-filmstrip.tsx");
    const overviewLanding = readSource("src/components/document-viewer/document-overview-landing.tsx");
    const documentViewer = readSource("src/components/DocumentViewer.tsx");

    expect(assessKit).toContain('aria-disabled={disabled ? "true" : undefined}');
    expect(assessKit).toContain("onClick={disabled ? ignoreUnavailableActivation : onClick}");

    expect(termOverview).toContain("onClick={live ? onClick : ignoreUnavailableActivation}");
    expect(termOverview).toContain('onClick={remindWhyNot ? ignoreUnavailableActivation : () => setSheet("bulk")}');
    expect(termOverview).toContain("onClick={ignoreUnavailableActivation}");

    expect(numberSheets).toContain('aria-disabled={!dialable ? "true" : undefined}');
    expect(numberSheets).toContain("aria-describedby={!dialable ? `${item.id}-copy-unavailable` : undefined}");
    expect(numberSheets).toContain("onClick={!dialable ? ignoreUnavailableActivation : handleCopy}");

    expect(filmstrip).toContain('aria-disabled={page === null ? "true" : undefined}');
    expect(filmstrip).toContain("onClick={page === null ? ignoreUnavailableActivation : () => onSelectPage(page)}");
    expect(filmstrip).toContain("aria-describedby={pageUnavailableId}");

    expect(overviewLanding).toContain('aria-disabled={answerUnavailable ? "true" : undefined}');
    expect(overviewLanding).toContain("aria-describedby={answerUnavailable ? answerReasonId : undefined}");
    expect(overviewLanding).toContain("onClick={answerUnavailable ? ignoreUnavailableActivation : onAskFromDocument}");

    expect(documentViewer).toContain('aria-disabled={!canSummarizeDocument ? "true" : undefined}');
    expect(documentViewer).toContain(
      'aria-describedby={!canSummarizeDocument ? "document-actions-summarize-reason" : undefined}',
    );
  });
});
