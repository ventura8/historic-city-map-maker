/**
 * The place editor's one-line-per-item texts for a place's facts (`docs/research/M17-stories.md` §13): uses and addresses
 * are typed as `1906-1940: Pavilion`, `1906-: …`, `-1940: …`, `1950: …` or without years, and an address of today as
 * `azi: …` (or `today: …`). Parsing never throws: a line it cannot read keeps its whole text and no years.
 */

export interface DatedLine {
    readonly text: string;
    readonly yearStart?: number | undefined;
    readonly yearEnd?: number | undefined;
    readonly current?: boolean | undefined;
}

const YEAR = /^\d{4}$/;
const TODAY = new Set(['azi', 'today']);

/** A year, or undefined for an empty part; null for anything else. */
function yearPart(part: string): number | undefined | null {
    if (part === '') {
        return undefined;
    }
    return YEAR.test(part) ? Number(part) : null;
}

/** The years a head (`1906-1940`, `1906-`, `-1940`, `1950`) names; null when it is not one. */
function yearsOf(head: string): Omit<DatedLine, 'text'> | null {
    if (YEAR.test(head)) {
        return { yearStart: Number(head), yearEnd: Number(head) };
    }
    const parts = head.split(/[-–]/);
    const [start, end] = [yearPart(parts[0]?.trim() ?? ''), yearPart(parts[1]?.trim() ?? '')];
    const valid = parts.length === 2 && start !== null && end !== null && (start !== undefined || end !== undefined);
    return valid ? { ...(start === undefined ? {} : { yearStart: start }), ...(end === undefined ? {} : { yearEnd: end }) } : null;
}

function lineOf(line: string): DatedLine | null {
    const trimmed = line.trim();
    const colon = trimmed.indexOf(':');
    if (colon < 0) {
        return trimmed === '' ? null : { text: trimmed };
    }
    const head = trimmed.slice(0, colon).trim();
    const text = trimmed.slice(colon + 1).trim();
    if (TODAY.has(head.toLowerCase())) {
        return { text, current: true };
    }
    const years = yearsOf(head);
    return years === null || text === '' ? { text: trimmed } : { text, ...years };
}

/** The lines of `text` as dated items, empty lines left out. */
export function parseDatedLines(text: string): DatedLine[] {
    return text.split('\n').flatMap((line) => lineOf(line) ?? []);
}

/** The years of an item as its line's head (`1906-1940`, `1950`); null without years. */
function headOf(item: DatedLine): string | null {
    const { yearStart: start, yearEnd: end } = item;
    if (start === undefined && end === undefined) {
        return null;
    }
    return start !== undefined && start === end ? String(start) : [start ?? '', end ?? ''].join('-');
}

/** One item as a line the parser reads back. */
export function datedLine(item: DatedLine, today = 'azi'): string {
    const head = item.current === true ? today : headOf(item);
    return head === null ? item.text : [head, item.text].join(': ');
}

/** A comma-separated list, trimmed, empty parts left out. */
export function parseCommaList(text: string): string[] {
    return text
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '');
}
