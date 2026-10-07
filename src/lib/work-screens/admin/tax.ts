import { withoutExampleRecords } from "@/lib/example-data/guards";
import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import {
  EXPENSE_KINDS,
  type AdminExpense,
  type AdminTaxYear,
  type ExpenseKind,
} from "@/lib/work-screens/admin/paperwork-model";

/**
 * Admin · Tax: a checklist of the documents and records the doctor gathers
 * for their tax return, and the work expenses they type from their receipts.
 * A record for them, never tax advice: PsychSift holds no thresholds, rates or
 * rules, so it never says what can be claimed. The ATO's own pages are linked
 * as plain links instead. Every total is the sum of what the doctor typed.
 */

/** The ATO's own pages, plain links. No figure from them is copied here. */
/**
 * Plain links only, to the top-level ATO page. No deep links, because none can
 * be checked from the repo, and no figures: tax tables, the calculators and
 * what you can claim are all found from there.
 */
export const ATO_LINKS = [
  {
    id: "home",
    title: "Tax tables, calculators and deductions",
    sub: "Australian Taxation Office, ato.gov.au",
    href: "https://www.ato.gov.au/",
  },
] as const;

export interface TaxChecklistItem {
  readonly id: string;
  readonly title: string;
  readonly sub: string;
}

export interface TaxChecklistGroup {
  readonly label: string;
  readonly items: readonly TaxChecklistItem[];
}

/** What a doctor gathers. Plain names, no rules about what is deductible. */
export const TAX_CHECKLIST: readonly TaxChecklistGroup[] = [
  {
    label: "Documents to gather",
    items: [
      { id: "income-statement", title: "Income statement", sub: "From myGov, once your employer marks it ready" },
      { id: "second-job", title: "Other income statements", sub: "Locum, sessional or second jobs" },
      { id: "private-health", title: "Private health insurance statement", sub: "From your insurer" },
      { id: "bank-interest", title: "Bank interest and dividends", sub: "From your bank and share registry" },
    ],
  },
  {
    label: "Work records",
    items: [
      { id: "receipts", title: "Receipts for work expenses", sub: "Listed below as you add them" },
      {
        id: "registration-invoice",
        title: "Registration and indemnity invoices",
        sub: "Ahpra and your indemnity insurer",
      },
      { id: "college-fees", title: "College, course and conference fees", sub: "Course hours are tracked in CPD" },
      { id: "travel-diary", title: "Travel or car records", sub: "If you travel between work sites" },
      { id: "home-office", title: "Working from home record", sub: "Hours you worked from home" },
      { id: "phone-use", title: "Phone and internet work use", sub: "How you worked out the work share" },
    ],
  },
  {
    label: "Lodging",
    items: [
      { id: "check-ato", title: "Read the ATO guidance", sub: "Linked below" },
      { id: "accountant", title: "Book your accountant or open myTax", sub: "Before the due date for your return" },
      { id: "lodged", title: "Return lodged", sub: "Keep a copy with your records" },
    ],
  },
];

export const ALL_TAX_ITEM_IDS: readonly string[] = TAX_CHECKLIST.flatMap((group) => group.items.map((item) => item.id));

export const EXPENSE_KIND_WORDS: Record<ExpenseKind, string> = {
  registration: "Registration",
  indemnity: "Indemnity",
  college: "College and memberships",
  courses: "Courses and conferences",
  books: "Books and subscriptions",
  equipment: "Equipment",
  phone: "Phone and internet",
  travel: "Travel",
  other: "Other",
};

/** The financial year holding a Perth date, by its first calendar year: 1 July 2026 to 30 June 2027 is "2026". */
export function financialYearKey(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return String(month >= 7 ? year : year - 1);
}

export function financialYearLabel(key: string): string {
  const start = Number(key);
  return `${start} to ${String(start + 1).slice(2)} financial year`;
}

export function financialYearRange(key: string): { start: string; end: string } {
  const start = Number(key);
  return { start: `${start}-07-01`, end: `${start + 1}-06-30` };
}

export function emptyTaxYear(): AdminTaxYear {
  return { ticks: {}, expenses: [] };
}

export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `$${dollars.toLocaleString("en-AU")}.${rest}`;
}

/**
 * Dollars as typed ("146", "146.50", "$1,034") to whole cents, or null when it
 * is not an amount. A comma counts only as a thousands mark ("1,034"), so
 * "12,50" is refused rather than read as $1,250.
 */
export function parseDollars(text: string): number | null {
  const typed = text.trim().replace(/^\$\s*/, "");
  if (typed.includes(",") && !/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(typed)) return null;
  const value = typed.replace(/,/g, "");
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, part = ""] = value.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

export function expenseTotals(expenses: readonly AdminExpense[]) {
  const byKind = EXPENSE_KINDS.map((kind) => ({
    kind,
    label: EXPENSE_KIND_WORDS[kind],
    cents: expenses.filter((expense) => expense.kind === kind).reduce((total, expense) => total + expense.cents, 0),
    count: expenses.filter((expense) => expense.kind === kind).length,
  })).filter((row) => row.count > 0);
  const total = expenses.reduce((sum, expense) => sum + expense.cents, 0);
  const missingReceipts = expenses.filter((expense) => !expense.receiptKept).length;
  return { total, byKind, count: expenses.length, missingReceipts };
}

/** Month totals across the financial year so far (July first), for the small bar chart. */
export function monthTotals(expenses: readonly AdminExpense[], yearKey: string, today: string) {
  const start = Number(yearKey);
  const months: { key: string; label: string; cents: number }[] = [];
  for (let index = 0; index < 12; index += 1) {
    const year = index < 6 ? start : start + 1;
    const month = ((6 + index) % 12) + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (`${key}-01` > today) break;
    months.push({
      key,
      label: new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-AU", { month: "short", timeZone: "UTC" }),
      cents: expenses
        .filter((expense) => expense.on.startsWith(key))
        .reduce((total, expense) => total + expense.cents, 0),
    });
  }
  return months;
}

export function sortExpenses(expenses: readonly AdminExpense[]): AdminExpense[] {
  return [...expenses].sort((a, b) => (a.on === b.on ? a.title.localeCompare(b.title) : a.on < b.on ? 1 : -1));
}

export function csvCell(value: string): string {
  // A leading = + - @, tab or carriage return would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function itemCount(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

/** Excel reads a CSV as UTF-8 only when it starts with a byte order mark. */
export const CSV_BOM = "\uFEFF";

export function taxPackFileName(yearKey: string): string {
  return `psychsift-tax-pack-${yearKey}-${String(Number(yearKey) + 1).slice(2)}.csv`;
}

/** The pack for an accountant: expenses as rows, then totals by kind. Only what the doctor typed. */
export function taxPackCsv(year: AdminTaxYear, yearKey: string): string {
  const expenses = withoutExampleRecords(year.expenses);
  const rows: string[][] = [["Date", "Kind", "What", "Amount", "Receipt kept"]];
  for (const expense of sortExpenses(expenses).reverse()) {
    rows.push([
      expense.on,
      EXPENSE_KIND_WORDS[expense.kind],
      expense.title,
      (expense.cents / 100).toFixed(2),
      expense.receiptKept ? "Yes" : "No",
    ]);
  }
  const totals = expenseTotals(expenses);
  rows.push([], ["Totals by kind"]);
  for (const row of totals.byKind) rows.push(["", row.label, itemCount(row.count), (row.cents / 100).toFixed(2), ""]);
  rows.push(["", "All", itemCount(totals.count), (totals.total / 100).toFixed(2), ""]);
  rows.push([], [`${financialYearLabel(yearKey)}. Typed by me from my receipts. Not tax advice.`]);
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function checklistProgress(year: AdminTaxYear): { done: number; total: number } {
  return { done: ALL_TAX_ITEM_IDS.filter((id) => year.ticks[id] === true).length, total: ALL_TAX_ITEM_IDS.length };
}

export function expenseLine(expense: AdminExpense): string {
  return `${EXPENSE_KIND_WORDS[expense.kind]} · ${expense.receiptKept ? "Receipt kept" : "No receipt yet"}`;
}

export function expenseDateLabel(expense: AdminExpense): string {
  return formatRecordedDate(expense.on);
}
