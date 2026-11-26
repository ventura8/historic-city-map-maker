/**
 * Dates the admin types, in the admin's language whatever the browser's (the orchestrator's review of the M2c
 * screenshots, 2026-10-18): a native `<input type="date">` shows the browser's own pattern (`mm/dd/yyyy` in an American
 * browser) in a Romanian page, so the date fields are M3 date input fields instead (a text field with the pattern as its
 * hint): Romanian `zz.ll.aaaa`, English `dd/mm/yyyy` (the admin's English dates are British, `setup-text.ts`). The value
 * stays an ISO date (`YYYY-MM-DD`) everywhere else.
 */
import type { UiLocale } from '@hcm/shared';

/** Romanian's dot; English's slash, which every other language's date field takes too. */
const SEPARATORS: Partial<Readonly<Record<UiLocale, string>>> = { ro: '.', en: '/' };

/** Day, month and year (day first, as both languages write it; `.`, `/`, `-` or a space between). */
const DAY_FIRST = /^\s*(\d{1,2})[./\-\s](\d{1,2})[./\-\s](\d{4})\s*$/;

/** An ISO date, typed or pasted as it is. */
const ISO = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/;

function pad(value: number, length: number): string {
    return String(value).padStart(length, '0');
}

/** The ISO date of a day that exists (no 31 April), else null. */
function isoOf(year: number, month: number, day: number): string | null {
    const date = new Date(Date.UTC(year, month - 1, day));
    const exists = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    return exists ? `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` : null;
}

/** `2026-10-18` as the admin writes it: `18.10.2026` in Romanian, `18/10/2026` in English; any other text as it is. */
export function formatDateInput(locale: UiLocale, value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match === null ? value : [match[3], match[2], match[1]].join(SEPARATORS[locale] ?? '/');
}

/** The ISO date a typed text names (`18.10.2026`, `18/10/2026`, `2026-10-18`); '' for an empty field; null for anything else. */
export function parseDateInput(text: string): string | null {
    if (text.trim() === '') {
        return '';
    }
    const dayFirst = DAY_FIRST.exec(text);
    if (dayFirst !== null) {
        return isoOf(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
    }
    const iso = ISO.exec(text);
    return iso === null ? null : isoOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
}
