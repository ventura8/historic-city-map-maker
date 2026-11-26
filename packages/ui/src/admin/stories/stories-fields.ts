/** The stories editor's pure parts (M17, `docs/research/M17-stories.md` §6): its texts, its fields, a row's state. */
import type { AdminContentKey, CityRole, UiLocale, StoryDoc } from '@hcm/shared';

import { contentText as t } from '../shell/text.js';
import type { StoryItemPort } from './stories-port.js';

interface Text {
    readonly ro: string;
    readonly en?: string | undefined;
}

/** A year typed in a field: empty is none; anything else is the number, which the schema checks. */
export function yearOf(text: string): number | undefined {
    return text.trim() === '' ? undefined : Number(text);
}

/** `text` in `locale`, English falling back to Romanian. */
export function inLocale(text: Text, locale: UiLocale): string {
    return locale === 'en' ? (text.en ?? text.ro) : text.ro;
}

/** A localized text with `locale`'s part set to `value`: an empty English part goes, an empty text goes altogether. */
export function withPart(text: Text | undefined, locale: UiLocale, value: string): Text | undefined {
    const next = { ...partsOf(text), [locale]: value };
    if (next.en === '') {
        return next.ro === '' ? undefined : { ro: next.ro };
    }
    return { ro: next.ro, en: next.en };
}

/** Both parts of a text, an absent one empty. */
function partsOf(text: Text | undefined): { readonly ro: string; readonly en: string } {
    return text === undefined ? { ro: '', en: '' } : { ro: text.ro, en: text.en ?? '' };
}

const STATE_KEYS = {
    pending: 'adminContent.stories.pending',
    refused: 'adminContent.stories.refused',
} as const;

/** What a row says of a story's state: waiting or refused, unpublished, or nothing once it is public. */
export function stateText(locale: UiLocale, item: StoryItemPort): string {
    if (item.review !== null) {
        return t(locale, STATE_KEYS[item.review]);
    }
    return item.published ? '' : t(locale, 'adminContent.stories.unpublished');
}

/** One text field of the editor: its id (`title-ro`, `yearStart`), its label and its value. */
interface TextSpec {
    readonly id: string;
    readonly key: AdminContentKey;
    readonly value: string;
    readonly onInput: (text: string) => void;
    readonly multiline?: boolean;
    readonly help?: string;
}

function yearSpecs(value: StoryDoc, edit: (patch: Partial<StoryDoc>) => void): readonly TextSpec[] {
    return (['yearStart', 'yearEnd'] as const).map((key) => ({
        id: key,
        key: `adminContent.stories.${key}`,
        value: String(value[key] ?? ''),
        onInput: (next: string) => {
            edit({ [key]: yearOf(next) });
        },
    }));
}

/** The editor's text fields, in order. */
export function textSpecs(locale: UiLocale, value: StoryDoc, edit: (patch: Partial<StoryDoc>) => void): readonly TextSpec[] {
    const help = `${t(locale, 'adminContent.stories.format')} ${t(locale, 'adminContent.stories.formatPhoto')}`;
    const title = (part: UiLocale) => (next: string) => {
        edit({ title: withPart(value.title, part, next) ?? { ro: '' } });
    };
    const body = (part: UiLocale) => (next: string) => {
        edit({ body: withPart(value.body, part, next) });
    };
    const titles = partsOf(value.title);
    const texts = partsOf(value.body);
    return [
        { id: 'title-ro', key: 'adminContent.stories.titleRo', value: titles.ro, onInput: title('ro') },
        { id: 'title-en', key: 'adminContent.stories.titleEn', value: titles.en, onInput: title('en') },
        { id: 'body-ro', key: 'adminContent.stories.bodyRo', value: texts.ro, onInput: body('ro'), multiline: true, help },
        { id: 'body-en', key: 'adminContent.stories.bodyEn', value: texts.en, onInput: body('en'), multiline: true },
        ...yearSpecs(value, edit),
    ];
}

/** M13's matrix for stories (`firestore.rules`): a moderator creates none; staff, an editor and an uploader do. */
export function canCreateStory(role: CityRole | null): boolean {
    return role !== 'moderator';
}

/** A moderator deletes no story; an uploader only their own while it waits or was refused (they see no other). */
export function canDeleteStory(role: CityRole | null, story: StoryDoc): boolean {
    if (role === 'uploader') {
        return story.reviewStatus === 'pending' || story.reviewStatus === 'refused';
    }
    return role !== 'moderator';
}

/** Versions opens `#/history`, a route of staff only (`LIMITED_ROUTES`). */
export function seesVersions(role: CityRole | null): boolean {
    return role !== 'moderator' && role !== 'uploader';
}
