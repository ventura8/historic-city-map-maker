/**
 * A field's problem in words that say what to do (the live manual test of 2026-11-01, findings 35 and 37): a required
 * field left empty, a category not chosen or a shape not drawn reads as the action it asks for ("Add a title in
 * Romanian", "Choose a category"), never as the schema's generic words ("The value is too small or too short.", "The
 * value does not have the required format."). Every other problem keeps the viewer's validation words. Save's note names
 * every field it waits for: "Cannot save: add a title in Romanian; choose a category." The editors of places, photos,
 * layers and the city settings (categories, texts) all say their problems through here.
 */
import { translate, type AdminContentKey, type UiLocale, type ValidationCode, type ValidationIssue } from '@hcm/shared';

import { contentText } from '../shell/text.js';
import { fieldName } from './field-names.js';

/** The codes a missing text gives: absent, or shorter than its one character. */
const MISSING_TEXT: readonly ValidationCode[] = ['validation.required', 'validation.tooSmall'];

interface OwnWords {
    readonly key: AdminContentKey;
    /** The codes these words answer; `null`: every problem of the field (a category is chosen or it is not). */
    readonly codes: readonly ValidationCode[] | null;
}

/** A place's year after next year (`placeYearIssues`): the schema's `validation.tooBig`, in the editor's own words. */
const YEAR_LATE: OwnWords = { key: 'adminContent.common.issue.yearLate', codes: ['validation.tooBig'] };

/**
 * The fields whose problems have words of their own, by the issue's path: the first whose codes match says it. A map, so
 * a path such as `toString` finds nothing (a plain object's prototype would answer it).
 */
const OWN_WORDS: ReadonlyMap<string, readonly OwnWords[]> = new Map<string, readonly OwnWords[]>([
    ['title', [{ key: 'adminContent.common.issue.titleRo', codes: MISSING_TEXT }]],
    ['title.ro', [{ key: 'adminContent.common.issue.titleRo', codes: MISSING_TEXT }]],
    ['label.ro', [{ key: 'adminContent.common.issue.labelRo', codes: MISSING_TEXT }]],
    ['name.ro', [{ key: 'adminContent.common.issue.nameRo', codes: MISSING_TEXT }]],
    ['category', [{ key: 'adminContent.common.issue.category', codes: null }]],
    ['geometry', [{ key: 'adminContent.common.issue.geometry', codes: ['validation.required'] }]],
    ['year', [{ key: 'adminContent.common.issue.year', codes: ['validation.required', 'validation.type'] }]],
    // A place's years (owner request of 2026-11-12): Save wants one at least, reported at the start year, and none after next year.
    ['yearStart', [{ key: 'adminContent.common.issue.placeYear', codes: ['validation.required'] }, YEAR_LATE]],
    ['yearEnd', [YEAR_LATE]],
    ['yearSeen', [YEAR_LATE]],
]);

/** The key of the field's own words for this problem, or null when the validation words say it. */
function ownKey(issue: ValidationIssue): AdminContentKey | null {
    const options = OWN_WORDS.get(issue.path) ?? [];
    const words = options.find((option) => option.codes === null || option.codes.includes(issue.code));
    return words === undefined ? null : words.key;
}

/** A field's problem as its form says it under the field. */
export function issueText(locale: UiLocale, issue: ValidationIssue): string {
    const key = ownKey(issue);
    return key === null ? translate(locale, issue.code) : contentText(locale, key);
}

/** `text` with its first letter in lower case and no closing full stop: a part of a longer sentence. */
function inSentence(locale: UiLocale, text: string): string {
    const bare = text.endsWith('.') ? text.slice(0, -1) : text;
    return bare.charAt(0).toLocaleLowerCase(locale) + bare.slice(1);
}

/** The document field an issue's path starts with (`links[0].url` is `links`). */
function topField(path: string): string {
    const end = path.search(/[.[]/);
    return end === -1 ? path : path.slice(0, end);
}

/** One problem as Save's note lists it: the field's own words, or its name and the validation words. */
function noteItem(locale: UiLocale, issue: ValidationIssue): string {
    const key = ownKey(issue);
    if (key !== null) {
        return inSentence(locale, contentText(locale, key));
    }
    const field = fieldName(locale, topField(issue.path));
    return contentText(locale, 'adminContent.common.issueAt', { field, issue: inSentence(locale, translate(locale, issue.code)) });
}

/** "Cannot save: add a title in Romanian; choose a category.": every problem once, in the order found. */
export function cannotSaveText(locale: UiLocale, issues: readonly ValidationIssue[]): string {
    const items = [...new Set(issues.map((issue) => noteItem(locale, issue)))];
    return contentText(locale, 'adminContent.common.cannotSave', { issues: items.join('; ') });
}
