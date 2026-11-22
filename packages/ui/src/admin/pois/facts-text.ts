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
const SPAN = /^(\d{4})?[-–](\d{4})?$/;
const TODAY = new Set(['azi', 'today']);

/** The years of a span's two parts, an empty part left out. */
function yearsFrom(start: string | undefined, end: string | undefined): Omit<DatedLine, 'text'> {
    return Object.fromEntries(
        [
            ['yearStart', start],
            ['yearEnd', end],
        ].flatMap(([key, value]) => (value === undefined ? [] : [[key, Number(value)]])),
    );
}

/** The years a head (`1906-1940`, `1906-`, `-1940`, `1950`) names; null when it is not one. */
function yearsOf(head: string): Omit<DatedLine, 'text'> | null {
    const compact = head.replaceAll(' ', '');
    if (YEAR.test(compact)) {
        return yearsFrom(compact, compact);
    }
    const span = SPAN.exec(compact);
    return span === null || compact.length === 1 ? null : yearsFrom(span[1], span[2]);
}

/** A line's head (before the first colon) and its text; null without a colon or a text after it. */
function splitHead(line: string): readonly [string, string] | null {
    const colon = line.indexOf(':');
    const text = line.slice(colon + 1).trim();
    return colon < 0 || text === '' ? null : [line.slice(0, colon).trim(), text];
}

function lineOf(line: string): DatedLine | null {
    const trimmed = line.trim();
    if (trimmed === '') {
        return null;
    }
    const parts = splitHead(trimmed);
    if (parts === null) {
        return { text: trimmed };
    }
    const [head, text] = parts;
    if (TODAY.has(head.toLowerCase())) {
        return { text, current: true };
    }
    const years = yearsOf(head);
    return years === null ? { text: trimmed } : { text, ...years };
}

/** The lines of `text` as dated items, empty lines left out. */
export function parseDatedLines(text: string): DatedLine[] {
    return text.split('\n').flatMap((line) => lineOf(line) ?? []);
}

function yearText(year: number | undefined): string {
    return year === undefined ? '' : String(year);
}

/** The years of an item as its line's head (`1906-1940`, `1950`); null without years. */
function headOf(item: DatedLine): string | null {
    const { yearStart: start, yearEnd: end } = item;
    if (start === undefined && end === undefined) {
        return null;
    }
    return start === end ? yearText(start) : [yearText(start), yearText(end)].join('-');
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
