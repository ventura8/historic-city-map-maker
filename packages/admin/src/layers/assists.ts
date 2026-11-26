/**
 * The layer editor's assists (`docs/research/M4-interfaces.md` §4.1, CR-M4-4; S-A09-HAPPY-TRANSLATE-DRAFT):
 * `EditorAssists` over the open layer's draft, translation drafts only (a layer has no place to suggest a title for).
 * A draft fills the other language of the name or the description in the draft; nothing is written before Save.
 */
import type { LayerDoc } from '@hcm/shared';

import type { AssistState } from '../assist/assist.js';
import { EditorAssists } from '../assist/editor-assists.js';
import type { ContentServices } from '../content/services.js';
import type { LayerPatch } from './state.js';

export interface LayerAssistsDeps {
    readonly services: Pick<ContentServices, 'callables' | 'store' | 'cityId' | 'clock'>;
    /** The open layer's draft value (null: none open, or not read yet). */
    readonly value: () => LayerDoc | null;
    readonly edit: (patch: LayerPatch) => void;
    readonly changed: (assist: AssistState) => void;
}

/** The layer editor's assists over its draft. */
export function layerAssists(deps: LayerAssistsDeps): EditorAssists {
    return new EditorAssists({
        services: deps.services,
        fields: ['label', 'description'],
        text: (field) => {
            const value = deps.value();
            return value !== null && (field === 'label' || field === 'description') ? value[field] : undefined;
        },
        fill: (field, text) => {
            deps.edit({ [field]: text });
        },
        place: () => null,
        changed: deps.changed,
    });
}
