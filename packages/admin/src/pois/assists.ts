/**
 * The place editor's assists (`docs/research/M4-interfaces.md` §4.1, CR-M4-4; S-A45-HAPPY): `EditorAssists` over the open
 * place's draft. A point drawn with the Romanian title still empty asks for title suggestions on its own; Suggest a
 * title asks for the place's first position (a line's or an area's first vertex); a draft fills the other language of
 * the title or the description. Nothing is written before Save.
 */
import type { Geometry } from '@hcm/shared';

import type { AssistState } from '../assist/assist.js';
import { EditorAssists } from '../assist/editor-assists.js';
import type { PoiPatch, PoiValue } from './model.js';
import type { PoisServices } from './state.js';

export interface PlaceAssistsDeps {
    readonly services: Pick<PoisServices, 'callables' | 'store' | 'cityId' | 'clock'>;
    /** The open place's draft (null: none open). */
    readonly value: () => PoiValue | null;
    readonly edit: (patch: PoiPatch) => void;
    readonly changed: (assist: AssistState) => void;
}

/** A geometry's first position (`[lng, lat]` as `{lat, lng}`), or null without one. */
export function firstPlace(geometry: Geometry | null): { readonly lat: number; readonly lng: number } | null {
    const first = geometryStart(geometry);
    return first === undefined ? null : { lat: first[1], lng: first[0] };
}

function geometryStart(geometry: Geometry | null): readonly [number, number] | undefined {
    if (geometry === null) {
        return undefined;
    }
    if (geometry.type === 'Point') {
        return geometry.coordinates;
    }
    return geometry.type === 'LineString' ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
}

/** A point drawn on the map is the place set (an area or a line is not: Suggest a title asks for its first position). */
export function pointDrawn(assists: Pick<EditorAssists, 'placeSet'>, geometry: Geometry): void {
    if (geometry.type === 'Point') {
        assists.placeSet({ lat: geometry.coordinates[1], lng: geometry.coordinates[0] });
    }
}

/** The place editor's assists over its draft. */
export function placeAssists(deps: PlaceAssistsDeps): EditorAssists {
    return new EditorAssists({
        services: deps.services,
        fields: ['title', 'description'],
        text: (field) => {
            const value = deps.value();
            return value !== null && (field === 'title' || field === 'description') ? value[field] : undefined;
        },
        fill: (field, text) => {
            deps.edit({ [field]: text });
        },
        place: () => firstPlace(deps.value()?.geometry ?? null),
        changed: deps.changed,
    });
}
