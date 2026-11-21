/**
 * The year of a legacy photo. The 2015–2022 data stores it as a number (`1980`), a string (`'1960'`),
 * a date in words (`'Iulie 1936'`) or not at all, in which case the file name often has it
 * (`Arionoaia 1978.jpg`).
 */

export interface LegacyYear {
    readonly year?: number;
    /** The source's own wording when it says more than the year (`Iulie 1936`). */
    readonly dateText?: string;
}

export const MIN_YEAR = 1800;
export const MAX_YEAR = 2100;

/** A four-digit year between `MIN_YEAR` and `MAX_YEAR` that is not part of a longer number. */
const YEAR = /(?<!\d)(1[89]\d{2}|20\d{2}|2100)(?!\d)/;

function isYear(value: number): boolean {
    return Number.isInteger(value) && value >= MIN_YEAR && value <= MAX_YEAR;
}

/** The first plausible year in `text`, or undefined. */
export function yearIn(text: string): number | undefined {
    const match = YEAR.exec(text);
    return match === null ? undefined : Number(match[1]);
}

function fromFileName(fileName: string): LegacyYear {
    const year = yearIn(fileName);
    return year === undefined ? {} : { year };
}

function fromText(text: string, fileName: string): LegacyYear {
    const year = yearIn(text);
    if (year === undefined) {
        return fromFileName(fileName);
    }
    return /^\d{4}$/.test(text) ? { year } : { year, dateText: text };
}

/**
 * Year rules, in order: a numeric year; a string that holds a year (with `dateText` = the string
 * when it says more than the year); otherwise the first year in `fileName`; otherwise nothing.
 */
export function parseLegacyYear(value: unknown, fileName: string): LegacyYear {
    if (typeof value === 'number') {
        return isYear(value) ? { year: value } : fromFileName(fileName);
    }
    return fromText(typeof value === 'string' ? value.trim() : '', fileName);
}
