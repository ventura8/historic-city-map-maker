import { LitElement, css, html, type TemplateResult } from 'lit';

import { isBundledIcon } from '../icons.js';
import { defineOnce } from './internal.js';

export const HCM_ICON_TAG = 'hcm-icon';

/**
 * A Material Symbols Rounded icon, drawn from the bundled subset by its ligature name (`ICONS`). Decorative: the
 * control around it carries the accessible name. A name outside the subset draws nothing, never the bare word.
 * `filled` switches the font's FILL axis (selected states). Size: `--hcm-icon-size` (default 24 px). Right to left the
 * directional ones (`chevron_*`, `arrow_*`) mirror.
 */
export class HcmIcon extends LitElement {
    static override readonly properties = {
        name: { type: String, reflect: true },
        filled: { type: Boolean, reflect: true },
    };

    static override readonly styles = css`
        :host {
            /* ICON_FONT_FAMILY of fonts/font-files.ts, registered by installFonts(). */
            --hcm-icon-font: 'HCM Material Symbols Rounded';

            display: inline-flex;
            flex: none;
            width: var(--hcm-icon-size, 24px);
            height: var(--hcm-icon-size, 24px);
            color: inherit;
        }

        span {
            display: inline-block;
            width: 100%;
            height: 100%;
            overflow: hidden;
            font-family: var(--hcm-icon-font);
            font-size: var(--hcm-icon-size, 24px);
            font-style: normal;
            font-weight: 400;
            font-feature-settings: 'liga';
            font-variation-settings: 'FILL' 0;
            line-height: 1;
            letter-spacing: normal;
            text-transform: none;
            white-space: nowrap;
            direction: ltr;
            user-select: none;
            -webkit-font-smoothing: antialiased;
        }

        :host([filled]) span {
            font-variation-settings: 'FILL' 1;
        }

        /* Right to left a chevron or an arrow points the other way (previous is on the right); other icons never mirror. */
        :host([name^='chevron_']:dir(rtl)),
        :host([name^='arrow_']:dir(rtl)) {
            transform: scaleX(-1);
        }
    `;

    declare name: string;
    declare filled: boolean;

    constructor() {
        super();
        this.name = '';
        this.filled = false;
    }

    override render(): TemplateResult {
        return html`<span aria-hidden="true">${isBundledIcon(this.name) ? this.name : ''}</span>`;
    }
}

export function defineHcmIcon(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_ICON_TAG, HcmIcon);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-icon': HcmIcon;
    }
}
