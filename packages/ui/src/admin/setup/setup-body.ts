/**
 * The base of every card body of the Setup Assistant (`hcm-setup-billing`, `hcm-setup-provision`, ...): the page
 * hands each one the whole state (`view`), the controller's intents and the language; the body renders its slice as text and
 * calls an intent on each user action. Copy buttons write to the clipboard and say so.
 */
import { DEFAULT_LOCALE, type AdminSetupKey, type UiLocale } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';

import { defineHcmIconButton } from '../../components/icon-button.js';
import { EMPTY } from '../shell/empty.js';
import { defineHcmInstallOver } from './hcm-install-over.js';
import type { SetupIntentsPort, SetupStepId, SetupStepView, SetupViewState } from './setup-port.js';
import { setupLabel } from './setup-text.js';

/** Writes `text` to the clipboard; false when the browser refuses (no permission, an insecure page). */
export async function copyToClipboard(text: string, clipboard: Pick<Clipboard, 'writeText'> | undefined): Promise<boolean> {
    if (clipboard === undefined) {
        return false;
    }
    try {
        await clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

export abstract class SetupBody extends LitElement {
    static override readonly properties = {
        view: { attribute: false },
        intents: { attribute: false },
        locale: { type: String },
        copied: { state: true },
    };

    /** The Setup Assistant's whole state (the page hands it to every body). */
    declare view: SetupViewState | null;
    declare intents: SetupIntentsPort | null;
    declare locale: UiLocale;
    /** The name of the value just copied (its "Copied." note), or null. */
    declare copied: string | null;

    constructor() {
        super();
        this.view = null;
        this.intents = null;
        this.locale = DEFAULT_LOCALE;
        this.copied = null;
    }

    override render(): TemplateResult {
        return this.view === null ? EMPTY : this.renderBody(this.view);
    }

    protected abstract renderBody(state: SetupViewState): TemplateResult;

    protected t(key: AdminSetupKey, params?: Readonly<Record<string, string>>): string {
        return setupLabel(this.locale, key, params);
    }

    protected step(state: SetupViewState, id: SetupStepId): SetupStepView {
        return state.steps[id];
    }

    /** Calls an intent (nothing happens before the page has wired the controller). */
    protected act(run: (intents: SetupIntentsPort) => void): void {
        if (this.intents !== null) {
            run(this.intents);
        }
    }

    /** A copy button for `value` named `label`, and the "Copied." note once it worked (`id` tells the buttons apart). */
    protected copyButton(id: string, label: string, value: string): TemplateResult {
        return html`<hcm-icon-button
                icon="content_copy"
                label=${label}
                @click=${() => {
                    void this.copy(id, value);
                }}
            ></hcm-icon-button
            ><span class="note copied" role="status">${this.copied === id ? this.t('adminSetup.copied') : ''}</span>`;
    }

    private async copy(id: string, value: string): Promise<void> {
        this.copied = (await copyToClipboard(value, navigator.clipboard)) ? id : null;
    }
}

/** Registers what every body renders. */
export function defineSetupBodyParts(registry: CustomElementRegistry): void {
    defineHcmIconButton(registry);
    defineHcmInstallOver(registry);
}
