/**
 * Reads the date and times out of a pasted shift offer ("need a reg for Ward
 * A Sat 17 Oct 0800–1630, Example Hospital"). It runs on the phone only; the
 * message is never sent or saved. Anything it can't read is left blank for
 * the doctor to fill in, never guessed.
 */

export type ParsedOffer = {
  readonly date: string | null;
  readonly start: string | null;
  readonly end: string | null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function clock(raw: string): string | null {
  const digits = raw.replace(/[:.]/g, "");
  if (!/^\d{3,4}$/.test(digits)) return null;
  const hours = Number(digits.slice(0, -2));
  const minutes = Number(digits.slice(-2));
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** The next occurrence of day/month on or after `today` (YYYY-MM-DD, Perth). */
function nextDate(day: number, monthIndex: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  for (const candidateYear of [year, year + 1]) {
    const date = new Date(Date.UTC(candidateYear, monthIndex, day));
    if (date.getUTCMonth() !== monthIndex) continue;
    const iso = `${candidateYear}-${pad(monthIndex + 1)}-${pad(day)}`;
    if (iso >= today) return iso;
  }
  return null;
}

export function parseOffer(message: string, today: string): ParsedOffer {
  const text = message.toLowerCase();

  let date: string | null = null;
  const named = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(text);
  if (named) {
    date = nextDate(Number(named[1]), MONTHS.indexOf(named[2]!), today);
  } else {
    const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/.exec(text);
    if (numeric) date = nextDate(Number(numeric[1]), Number(numeric[2]) - 1, today);
  }

  let start: string | null = null;
  let end: string | null = null;
  const range = /\b(\d{1,2}[:.]?\d{2})\s*(?:-|–|—|to)\s*(\d{1,2}[:.]?\d{2})\b/.exec(text);
  if (range) {
    start = clock(range[1]!);
    end = clock(range[2]!);
    if (!start || !end) {
      start = null;
      end = null;
    }
  }

  return { date, start, end };
}
