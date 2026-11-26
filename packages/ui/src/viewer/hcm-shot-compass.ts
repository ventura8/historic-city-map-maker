/** A shot-direction button whose icon tracks the camera without repainting the viewer. */
import { translate } from '@hcm/shared';
import { css, html, type TemplateResult } from 'lit';

import { cssProperties } from '../components/css-properties.js';
import { defineOnce } from '../components/internal.js';
import { compassDescription, HcmCompass } from './hcm-compass.js';

export const HCM_SHOT_COMPASS_TAG = 'hcm-shot-compass';

export class HcmShotCompass extends HcmCompass {
    static override readonly properties = { ...HcmCompass.properties, shot: { type: Number } };

    static override readonly styles = [
        ...HcmCompass.styles,
        css`
            svg {
                width: 24px;
                height: 24px;
            }

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
        const rotation = { transform: `rotate(${String(this.shot - this.camera.bearing)}deg)` };
        return html`<button class="interactive touch-target" part="button" aria-label=${label} aria-describedby="heading">
                <svg viewBox="0 0 24 24" aria-hidden="true" ${cssProperties(rotation)}>
                    <path d="M12 10 7 2 Q12 0 17 2 Z" fill="currentColor" opacity=".55"></path>
                    <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
                        <rect x="9" y="11" width="6" height="9" rx="1.5"></rect>
                        <path d="M1 12h6v6H1z M17 12h6v6h-6z M7 15h2m6 0h2"></path>
                    </g>
                </svg>
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
