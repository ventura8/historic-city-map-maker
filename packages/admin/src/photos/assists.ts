/**
 * The photo editor's assists (`docs/research/M4-interfaces.md` §4.1, CR-M4-4; S-A09-HAPPY-TITLE-SUGGESTION,
 * S-A09-HAPPY-TRANSLATE-DRAFT): `EditorAssists` over the open photo's draft. The pin set on the map while nobody chose
 * the title asks for title suggestions on its own: the title is empty, a camera's naming (`IMG 0412`) or the name of the
 * file it was uploaded as (every upload starts titled after its file until a suggestion or the admin replaces it);
 * Suggest a title asks for the photo's place; a draft fills the other language of the title, the description or the date
 * text. Nothing is written before Save.
 */
import { isCameraName } from '@hcm/shared';

import { EditorAssists, type AssistedText, type AssistIntents } from '../assist/editor-assists.js';
import type { AssistState } from '../assist/assist.js';
import type { PhotoPatch, PhotoValue } from './draft.js';
import type { PhotosServices } from './ports.js';

export type PhotoAssistIntents = AssistIntents;

export interface PhotoAssistsDeps {
    readonly services: Pick<PhotosServices, 'callables' | 'store' | 'cityId' | 'clock'>;
    /** The open photo's draft (null: none open). */
    readonly value: () => PhotoValue | null;
    /** The title the open photo's file suggested (`photos.onUpload`'s `suggested.title`), if any. */
    readonly fileTitle: () => string | undefined;
    readonly edit: (patch: PhotoPatch) => void;
    readonly changed: (assist: AssistState) => void;
}

/** Nobody chose the photo's title yet: empty, a camera's naming, or still the title its file gave it. */
function photoUntitled(title: AssistedText | undefined, fileTitle: string | undefined): boolean {
    const text = title?.ro.trim();
    return text === '' || (text !== undefined && (isCameraName(text) || text === fileTitle));
}

/** The photo editor's assists over its draft. */
export function photoAssists(deps: PhotoAssistsDeps): EditorAssists {
    return new EditorAssists({
        services: deps.services,
        fields: ['title', 'description', 'dateText'],
        text: (field) => {
            const value = deps.value();
            return value === null || field === 'label' ? undefined : value[field];
        },
        fill: (field, text) => {
            deps.edit({ [field]: text });
        },
        place: () => deps.value()?.location ?? null,
        untitled: (title) => photoUntitled(title, deps.fileTitle()),
        changed: deps.changed,
    });
}
