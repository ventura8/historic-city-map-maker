/**
 * The viewed area of an aerial photo (the owner, 2026-11-22): the ground the photo shows, four corners the admin drags
 * on the map. The section starts the area as a trapezoid in front of the camera, from the direction and the field of
 * view (`areaAhead`), resets it to that, or removes it; a shape that is not a convex quadrilateral says so
 * under the section (`validation.viewedArea`). The cone stays: it is the direction, the area is what the photo shows.
 */
import { DEFAULT_FOV, areaAhead } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import type { PlaceInput } from './editor-place.js';
import { fieldIssue, photoText } from './photo-text.js';

interface Corner {
    readonly lat: number;
    readonly lng: number;
}

/** The default area of a photo at `location`, from its draft's direction and field of view. */
export function startingArea(location: Corner, bearing: number | undefined, fov: number | undefined): Corner[] {
    return areaAhead([location.lng, location.lat], bearing ?? 0, fov ?? DEFAULT_FOV).map(([lng, lat]) => ({ lat, lng }));
}

function areaActions(input: PlaceInput, location: Corner): TemplateResult {
    const { locale, value, intents } = input;
    const start = (): void => {
        intents?.edit({ viewedArea: startingArea(location, value.bearing, value.fov) });
    };
    if (value.viewedArea === undefined) {
        return html`<p class="note">${photoText(locale, 'adminContent.photos.area.none')}</p>
            <div class="actions">
                <hcm-button variant="tonal" icon="crop_free" ?disabled=${input.readOnly} @click=${start}
                    >${photoText(locale, 'adminContent.photos.area.draw')}</hcm-button
                >
            </div>`;
    }
    return html`<div class="actions">
        <hcm-button variant="tonal" icon="refresh" ?disabled=${input.readOnly} @click=${start}
            >${photoText(locale, 'adminContent.photos.area.reset')}</hcm-button
        >
        <hcm-button variant="text" icon="delete" ?disabled=${input.readOnly} @click=${() => intents?.edit({ viewedArea: undefined })}
            >${photoText(locale, 'adminContent.photos.area.remove')}</hcm-button
        >
    </div>`;
}

/** The viewed area's part of the place section: only for a placed aerial photo. */
export function areaFields(input: PlaceInput): TemplateResult {
    const { locale, value, issues } = input;
    const location = value.location;
    if (value.kind !== 'aerial' || location === undefined) {
        return EMPTY;
    }
    const error = fieldIssue(locale, issues, 'viewedArea');
    return html`<div class="field" data-area>
        <h3>${photoText(locale, 'adminContent.photos.area.title')}</h3>
        <p class="note">${photoText(locale, 'adminContent.photos.area.note')}</p>
        ${areaActions(input, location)} ${error === null ? nothing : html`<p class="alert" role="alert">${error}</p>`}
    </div>`;
}
