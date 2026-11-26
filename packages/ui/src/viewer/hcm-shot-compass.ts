/** A shot-direction button whose icon tracks the camera without repainting the viewer. */
import { translate } from '@hcm/shared';
import { css, html, type TemplateResult } from 'lit';

import { cssProperties } from '../components/css-properties.js';
import { defineOnce } from '../components/internal.js';
import { compassDescription, HcmCompass } from './hcm-compass.js';

export const HCM_SHOT_COMPASS_TAG = 'hcm-shot-compass';

/** The signal arcs in Material Symbols Rounded's satellite_alt point southeast in the unrotated glyph. */
const GLYPH_BEARING = 135;

export class HcmShotCompass extends HcmCompass {
    static override readonly properties = { ...HcmCompass.properties, shot: { type: Number } };

    static override readonly styles = [
        ...HcmCompass.styles,
        css`
            button {
                color: var(--md-sys-color-on-surface-variant);
            }
        `,
    ];

    declare shot: number;

    constructor() {
        super();
        this.shot = 0;
    }

    override render(): TemplateResult {
        const label = translate(this.locale, 'viewer.shotDirection', { degrees: String(Math.round(this.shot) % 360) });
        const rotation = { transform: `rotate(${String(this.shot - this.camera.bearing - GLYPH_BEARING)}deg)` };
        return html`<button class="interactive touch-target" part="button" aria-label=${label} aria-describedby="heading">
                <hcm-icon name="satellite_alt" aria-hidden="true" ${cssProperties(rotation)}></hcm-icon>
            </button>
            <span id="heading" class="visually-hidden">${compassDescription(this.locale, this.camera)}</span>`;
    }
}

export function defineHcmShotCompass(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_SHOT_COMPASS_TAG, HcmShotCompass);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-shot-compass': HcmShotCompass;
    }
}
