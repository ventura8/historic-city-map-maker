/**
 * The city's texts (`docs/research/M2c-interfaces.md` §8.5, section `texts`; behaviour A19): the name in both
 * languages, About and the privacy notice (Markdown subset, at most 10,000 characters, previewed as DOM beside the
 * field), and the credits (at most 50: a label in both languages and an optional https link, in the order shown). A link
 * that is not https refuses the save and the page names its line (S-A19-BAD-MARKDOWN-LINK); typed HTML stays text.
 */
import { MAX_URL_LENGTH, parseMarkdown, type CityDoc, type Credit, type ValidationIssue } from '@hcm/shared';

/** The fields of the texts section. */
export const TEXT_FIELDS = ['name', 'about', 'privacy', 'credits'] as const satisfies readonly (keyof CityDoc)[];

/** The credits a city lists at most (`cityDocSchema`). */
const MAX_CREDITS = 50;

/** The Markdown fields: About and the privacy notice, in both languages. */
type MarkdownField = 'about' | 'privacy';

/** A link's target as the source writes it: `](target)`. */
const LINK = /\]\(([^)\s]{1,2048})\)/g;

/** The 1-based lines of `source` whose links are not https (the save is refused and the page names them). */
export function rejectedLinkLines(source: string): number[] {
    const rejected = new Set(parseMarkdown(source).rejectedLinks);
    if (rejected.size === 0) {
        return [];
    }
    return source
        .replaceAll('\r\n', '\n')
        .split('\n')
        .flatMap((line, index) => ([...line.matchAll(LINK)].some((match) => rejected.has(match[1] ?? '')) ? [index + 1] : []));
}

/** The issues of a credit row the schema reports as `credits[<n>].label.en`: the row and its field. */
export function creditIssue(issue: ValidationIssue): { readonly row: number; readonly field: string } | null {
    const match = /^credits\[(\d+)\]\.(.+)$/.exec(issue.path);
    return match === null ? null : { row: Number(match[1]), field: match[2] ?? '' };
}

/** A new, empty credit at the end (the schema names its empty labels until they are typed). */
export function withCredit(credits: readonly Credit[] | undefined): Credit[] {
    const list = credits ?? [];
    return list.length >= MAX_CREDITS ? [...list] : [...list, { label: { ro: '', en: '' } }];
}

export function withoutCredit(credits: readonly Credit[] | undefined, row: number): Credit[] {
    return (credits ?? []).filter((_credit, index) => index !== row);
}

/** The credits with row `row` moved one place up (-1) or down (+1); unchanged at either end. */
export function movedCredit(credits: readonly Credit[] | undefined, row: number, by: -1 | 1): Credit[] {
    const list = [...(credits ?? [])];
    const target = row + by;
    const moving = list[row];
    if (moving === undefined || target < 0 || target >= list.length) {
        return list;
    }
    list.splice(row, 1);
    list.splice(target, 0, moving);
    return list;
}

/** One credit with a field changed: `label.ro`, `label.en` or `url` (an empty address removes the link). */
export function editedCredit(credit: Credit, field: 'ro' | 'en' | 'url', text: string): Credit {
    if (field === 'url') {
        const url = text.trim().slice(0, MAX_URL_LENGTH);
        return url === '' ? { label: credit.label } : { label: credit.label, url };
    }
    return { ...credit, label: { ...credit.label, [field]: text } };
}

/** The credits with row `row`'s field changed. */
export function editedCredits(credits: readonly Credit[] | undefined, row: number, field: 'ro' | 'en' | 'url', text: string): Credit[] {
    return (credits ?? []).map((credit, index) => (index === row ? editedCredit(credit, field, text) : credit));
}

/** The lines of each Markdown text, per language, whose links are not https (empty lists: none). */
export type MarkdownLines = Readonly<Record<MarkdownField, { readonly ro: readonly number[]; readonly en: readonly number[] }>>;

export const NO_LINK_LINES: MarkdownLines = { about: { ro: [], en: [] }, privacy: { ro: [], en: [] } };

function linesOf(text: { readonly ro: string; readonly en?: string | undefined } | undefined): {
    readonly ro: number[];
    readonly en: number[];
} {
    return { ro: rejectedLinkLines(text?.ro ?? ''), en: rejectedLinkLines(text?.en ?? '') };
}

/** The rejected link lines of a city's About and privacy notice (none before the city is read). */
export function markdownLinesOf(city: Pick<CityDoc, 'about' | 'privacy'> | null): MarkdownLines {
    return city === null ? NO_LINK_LINES : { about: linesOf(city.about), privacy: linesOf(city.privacy) };
}
