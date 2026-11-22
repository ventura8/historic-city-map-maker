/**
 * The place editor's one-line-per-item texts for a place's facts (`docs/research/M17-stories.md` §13): uses and addresses
 * are typed as `1906-1940: Pavilion`, `1906-: …`, `-1940: …` or without years, and an address of today as `azi: …` (or
 * `today: …`). Parsing never throws: a line it cannot read keeps its whole text and no years.
 */

export interface DatedLine {
    readonly text: string;
    readonly yearStart?: number;
    readonly yearEnd?: number;
    readonly current?: true;
}

const YEARS = /^\s*(\d{4})?\s*[-–]\s*(\d{4})?\s*:\s*(.+)$/;
const SINGLE = /^\s*(\d{4})\s*:\s*(.+)$/;
const TODAY = /^\s*(azi|today)\s*:\s*(.+)$/i;

function lineOf(line: string): DatedLine | null {
    const trimmed = line.trim();
    if (trimmed === '') {
        return null;
    }
    const today = TODAY.exec(trimmed);
    if (today !== null) {
        return { text: (today[2] ?? '').trim(), current: true };
    }
    const single = SINGLE.exec(trimmed);
    if (single !== null) {
        const year = Number(single[1]);
        return { text: (single[2] ?? '').trim(), yearStart: year, yearEnd: year };
    }
    const span = YEARS.exec(trimmed);
    if (span === null || (span[1] === undefined && span[2] === undefined)) {
        return { text: trimmed };
    }
    return {
        text: (span[3] ?? '').trim(),
        ...(span[1] === undefined ? {} : { yearStart: Number(span[1]) }),
        ...(span[2] === undefined ? {} : { yearEnd: Number(span[2]) }),
    };
}

/** The lines of `text` as dated items, empty lines left out. */
export function parseDatedLines(text: string): DatedLine[] {
    return text.split('\n').flatMap((line) => lineOf(line) ?? []);
}

/** One item as a line the parser reads back. */
export function datedLine(item: DatedLine, today = 'azi'): string {
    if (item.current === true) {
        return `${today}: ${item.text}`;
    }
    if (item.yearStart === undefined && item.yearEnd === undefined) {
        return item.text;
    }
    if (item.yearStart !== undefined && item.yearStart === item.yearEnd) {
        return `${String(item.yearStart)}: ${item.text}`;
    }
    return `${item.yearStart === undefined ? '' : String(item.yearStart)}-${item.yearEnd === undefined ? '' : String(item.yearEnd)}: ${item.text}`;
}

/** A comma-separated list, trimmed, empty parts left out. */
export function parseCommaList(text: string): string[] {
    return text
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '');
}
