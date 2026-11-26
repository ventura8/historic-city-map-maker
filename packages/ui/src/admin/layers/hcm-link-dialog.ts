/**
 * Link a tileset or WMTS as a layer (`link-dialog.ts`) in its own chunk, `<hcm-link-dialog>`, which the layers page
 * defines once it is (DECISIONS-for-review.md §252, lesson 820): the layers chunk had no room left under its budget, and
 * the dialog opens only when asked. It renders in the page's own DOM, so its fields read and test as before.
 */
import type { UiLocale } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';

import { defineOnce } from '../../components/internal.js';
import type { LayersIntentsPort, LinkStatePort } from './layers-port.js';
import { linkDialog } from './link-dialog.js';

export interface LinkDialogInput {
    readonly locale: UiLocale;
    readonly link: LinkStatePort | null;
    readonly intents: LayersIntentsPort | null;
    /** The linked layer's id: the page opens its editor. */
    readonly linked: (id: string) => void;
}

class HcmLinkDialog extends LitElement {
    static override readonly properties = { input: { attribute: false } };

    declare input: LinkDialogInput | null;

    constructor() {
        super();
        this.input = null;
    }

    protected override createRenderRoot(): HTMLElement {
        return this;
    }

    override render(): TemplateResult {
        const input = this.input;
        return input === null ? html`` : linkDialog(input.locale, input.link, input.intents, input.linked);
    }
}

export function defineHcmLinkDialog(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, 'hcm-link-dialog', HcmLinkDialog);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-link-dialog': HcmLinkDialog;
    }
}
