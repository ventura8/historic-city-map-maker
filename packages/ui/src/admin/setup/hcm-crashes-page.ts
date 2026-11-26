/**
 * The `#/crashes` page (`docs/research/M2b-interfaces.md` §1.1, route `crashes`): the crash reports panel on its own,
 * its title the page's heading, the groups listed as soon as it appears. The shell's page outlet creates it and sets
 * `app` and `state`; it follows the setup controller like `<hcm-setup-page>`.
 */
import { css, html, type TemplateResult } from 'lit';

import { defineOnce } from '../../components/internal.js';
import { baseStyles } from '../../components/styles.js';
import { EMPTY } from '../shell/empty.js';
import { defineHcmCrashGroups } from './hcm-crash-groups.js';
import { SetupPortHost } from './setup-host.js';

export const HCM_CRASHES_PAGE_TAG = 'hcm-crashes-page';

export class HcmCrashesPage extends SetupPortHost {
    static override readonly styles = [
        baseStyles,
        css`
            :host {
                display: block;
                box-sizing: border-box;
                max-inline-size: 840px;
                padding: 16px;
            }
        `,
    ];

    override render(): TemplateResult {
        if (this.view === null) {
            return EMPTY;
        }
        return html`<hcm-crash-groups standalone .view=${this.view} .intents=${this.intents} .locale=${this.language}></hcm-crash-groups>`;
    }
}

/** Registers `<hcm-crashes-page>` and the panel it shows. */
export function defineHcmCrashesPage(registry: CustomElementRegistry = customElements): void {
    defineHcmCrashGroups(registry);
    defineOnce(registry, HCM_CRASHES_PAGE_TAG, HcmCrashesPage);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-crashes-page': HcmCrashesPage;
    }
}
