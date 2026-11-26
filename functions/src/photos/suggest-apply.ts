/**
 * What a suggestion does to a photo (M13, `docs/research/M13-roles.md` §4), pure: only the fields a proposal changes, a date as a
 * whole (a year past the stored range replaces the range, a year changed drops the old date text the public would still read and
 * the month and day of the old year), a
 * date text in the language it was written in, and the way back of one decision: exactly the fields it wrote.
 */
import { photoDocSchema, validate, type Locale, type PhotoDoc, type SuggestionProposal, type SuggestionUndo } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { omit } from '../api/objects.js';

type Fields = Readonly<Record<string, unknown>>;

/** The fields a decision can write, and so all its way back has to know. */
const UNDOABLE = ['location', 'bearing', 'year', 'yearEnd', 'month', 'day', 'dateText', 'credit'] as const;

/** `fields` without their `undefined` values: Firestore refuses them, and an absent field is what the photo means. */
function present(fields: object): Fields {
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function localeOf(proposal: SuggestionProposal): Locale {
    return proposal.dateLocale ?? 'ro';
}

/** Both parsed by their schemas, so the keys of a place or a text come in one order. */
function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function differs(current: unknown, proposed: unknown): boolean {
    return proposed !== undefined && !same(current, proposed);
}

/** The proposal without what the photo already says; `apiError.suggestion.noChange` when that is all of it. */
export function changedProposal(photo: PhotoDoc, proposal: SuggestionProposal): SuggestionProposal {
    const { dateLocale, ...fields } = proposal;
    const current: Fields = { ...photo, dateText: photo.dateText?.[localeOf(proposal)] };
    const kept = Object.entries(fields).filter(([key, value]) => differs(current[key], value));
    if (kept.length === 0) {
        throw new ApiError('apiError.suggestion.noChange');
    }
    const changed: SuggestionProposal = Object.fromEntries(kept);
    return present({
        ...changed,
        // An end year means nothing to the schema without its start, the one the proposal named.
        year: changed.yearEnd === undefined ? changed.year : proposal.year,
        dateLocale: changed.dateText === undefined ? undefined : dateLocale,
    });
}

/** A year past the stored end replaces the range: the proposal can name no absence. */
function nextEnd(photo: PhotoDoc, proposal: SuggestionProposal): number | undefined {
    if (proposal.yearEnd !== undefined) {
        return proposal.yearEnd;
    }
    const past = proposal.year !== undefined && photo.yearEnd !== undefined && photo.yearEnd < proposal.year;
    return past ? undefined : photo.yearEnd;
}

/** The typed language's text, the other language's kept; Romanian is the one a localized text cannot go without. */
function writtenText(photo: PhotoDoc, text: string, locale: Locale): NonNullable<PhotoDoc['dateText']> {
    return { ro: photo.dateText?.ro ?? text, ...photo.dateText, [locale]: text };
}

type Years = Pick<PhotoDoc, 'year' | 'yearEnd'>;

function sameYears(photo: PhotoDoc, years: Years): boolean {
    return years.year === photo.year && years.yearEnd === photo.yearEnd;
}

/** The viewer prefers a date text, so a text the new years contradict has to go, or the public keeps reading the old date. */
function nextText(photo: PhotoDoc, proposal: SuggestionProposal, years: Years): PhotoDoc['dateText'] {
    if (proposal.dateText !== undefined) {
        return writtenText(photo, proposal.dateText, localeOf(proposal));
    }
    return sameYears(photo, years) ? photo.dateText : undefined;
}

/** A month and a day belong to the year they were set in (`docs/research/photo-date-source.md`): new years drop them. */
function nextDay(photo: PhotoDoc, years: Years): Pick<PhotoDoc, 'month' | 'day'> {
    return sameYears(photo, years) ? { month: photo.month, day: photo.day } : { month: undefined, day: undefined };
}

/** The photo with the proposal in it; `apiError.suggestion.invalid` when the two disagree (the reviewer is told why). */
export function photoWith(photo: PhotoDoc, proposal: SuggestionProposal): PhotoDoc {
    const { location, bearing } = proposal;
    const years = { year: proposal.year ?? photo.year, yearEnd: nextEnd(photo, proposal) };
    const merged = present({
        ...photo,
        location: location ?? photo.location,
        bearing: bearing ?? photo.bearing,
        ...years,
        ...nextDay(photo, years),
        dateText: nextText(photo, proposal, years),
    }) as PhotoDoc;
    if (!validate(photoDocSchema, merged).ok) {
        throw new ApiError('apiError.suggestion.invalid');
    }
    return merged;
}

/** What one decision wrote and what stood there before. */
export function undoOf(before: PhotoDoc, after: PhotoDoc): SuggestionUndo {
    const written = UNDOABLE.filter((key) => !same(before[key], after[key]));
    const pick = (photo: PhotoDoc): Fields => present(Object.fromEntries(written.map((key) => [key, photo[key]])));
    return { before: pick(before), after: pick(after) };
}

/**
 * The photo with one decision taken off: only the fields it wrote, and only while they still say what it wrote; a field someone
 * changed since is theirs, and `apiError.suggestion.notRevertable` leaves it to History.
 */
export function photoWithout(photo: PhotoDoc, undo: SuggestionUndo): PhotoDoc {
    const written = new Set([...Object.keys(undo.before), ...Object.keys(undo.after)]) as ReadonlySet<keyof typeof undo.after>;
    const untouched = [...written].every((key) => same(photo[key], undo.after[key]));
    const restored = { ...omit(photo, [...written]), ...undo.before };
    if (!untouched || !validate(photoDocSchema, restored).ok) {
        throw new ApiError('apiError.suggestion.notRevertable');
    }
    return restored;
}
