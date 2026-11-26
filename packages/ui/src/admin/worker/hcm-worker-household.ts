/**
 * `<hcm-worker-household>` (W5, household computers: `docs/research/M7-local-worker.md` *Household computers*; behaviour A143), in
 * the lazy `worker-household` chunk, below "This computer" in the worker's panel: the city's computers (name, on or off, what it
 * does, its share of the computer and why, its helper's and pipeline's versions, the scanned maps it shares with the others
 * (M20 §22), its disk with Free space now and, when nearly full, a warning: cleanup item 6) with Rename, Pause or Resume and Remove this computer; how far a removal got (asked, waiting for the computer to come on, cleaning up, removed, or why not, with Disconnect
 * now anyway and only then the line or file that cleans it up by hand); and **Add another computer**: for a computer with a
 * screen, this admin's address to open there; for one without, the one line to paste over SSH.
 */
import { DEFAULT_LOCALE, type UiLocale } from '@hcm/shared';
import { translateAdminWorkerHousehold } from '@hcm/shared/admin-worker-household';
import { css, html, LitElement, type PropertyValues, type TemplateResult } from 'lit';

import { defineOnce } from '../../components/internal.js';
import { defineHcmSwitch } from '../../components/switch.js';
import { errorTemplate } from '../editing/states.js';
import { copyToClipboard } from '../setup/setup-body.js';
import { noticeOf } from '../shell/text.js';
import {
    addPanel,
    manualCleanup,
    nameOf,
    presence,
    removalWords,
    share,
    versions,
    type PartContext,
    type Translate,
} from './household-parts.js';
import { diskPart } from './household-disk.js';
import { sharingPart } from './household-sharing.js';
import { workerStyles } from './worker-element.js';
import type { ComputerViewPort, HouseholdPort, HouseholdViewPort } from './worker-port.js';

export const HCM_WORKER_HOUSEHOLD_TAG = 'hcm-worker-household';

/** What one computer's line has open: nothing, the rename field, or the removal's choices. */
type Open = { readonly id: string; readonly what: 'rename' | 'remove' } | null;

export class HcmWorkerHousehold extends LitElement {
    static override readonly properties = {
        household: { attribute: false },
        locale: { type: String },
        city: { type: String },
        level: { type: Number },
        view: { state: true },
        open: { state: true },
        copied: { state: true },
        choices: { state: true },
    };

    static override readonly styles = [
        ...workerStyles,
        css`
            :host {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .computers {
                display: flex;
                flex-direction: column;
                gap: 16px;
                margin: 0;
                padding: 0;
                list-style: none;
            }

            .computer,
            .add {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .check {
                display: flex;
                justify-content: space-between;
                gap: 12px;
                align-items: center;
                min-block-size: 48px;
            }
        `,
    ];

    declare household: HouseholdPort | null;
    declare locale: UiLocale;
    declare city: string;
    declare level: number;
    declare view: HouseholdViewPort | null;
    declare open: Open;
    /** Which line was copied, and whether it worked (null: none yet). */
    declare copied: { readonly what: string; readonly ok: boolean } | null;
    /** Remove this computer's choices: keep the scanned maps, also remove Docker. */
    declare choices: { readonly keep: boolean; readonly docker: boolean };
    #unsubscribe: (() => void) | null = null;

    constructor() {
        super();
        this.household = null;
        this.locale = DEFAULT_LOCALE;
        this.city = '';
        this.level = 3;
        this.view = null;
        this.open = null;
        this.copied = null;
        this.choices = { keep: false, docker: false };
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#unsubscribe?.();
        this.#unsubscribe = null;
    }

    protected override willUpdate(changed: PropertyValues): void {
        if (changed.has('household')) {
            this.#listen(this.household);
        }
    }

    /** Follows `household`'s state (nothing without one). */
    #listen(household: HouseholdPort | null): void {
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.view = household === null ? null : household.state;
        if (household !== null) {
            this.#unsubscribe = household.subscribe((state) => {
                this.view = state;
            });
        }
    }

    readonly #t: Translate = (key, params) => translateAdminWorkerHousehold(this.locale, key, params);

    #context(household: HouseholdPort): PartContext {
        return {
            t: this.#t,
            locale: this.locale,
            household,
            city: this.city,
            copy: (what, text) => {
                void this.#copy(what, text);
            },
            copiedText: (what) => this.#copiedText(what),
        };
    }

    override render(): TemplateResult {
        const { view, household } = this;
        if (view === null || household === null) {
            return html``;
        }
        const context = this.#context(household);
        return html`<div class="title" role="heading" aria-level=${this.level}>${this.#t('adminWorkerHousehold.title')}</div>
            <p class="note">${this.#t('adminWorkerHousehold.intro')} ${this.#t('adminWorkerHousehold.intro2')}</p>
            ${this.#list(context, view)} ${addPanel(context, view)}
            <div role="alert">${this.#refusal(view)}</div>`;
    }

    #refusal(view: HouseholdViewPort): TemplateResult {
        return view.refusal === null ? html`` : html`<p class="alert">${noticeOf(this.locale, view.refusal)}</p>`;
    }

    #list(context: PartContext, view: HouseholdViewPort): TemplateResult {
        if (view.status === 'error') {
            return errorTemplate(this.locale, view.failure, () => {
                context.household.intents.retry();
            });
        }
        if (view.computers.length === 0) {
            return html`<p data-computers="0">${this.#t('adminWorkerHousehold.none')}</p>`;
        }
        return html`<ul class="computers" aria-label=${this.#t('adminWorkerHousehold.list')} data-computers=${view.computers.length}>
            ${view.computers.map((computer) => this.#computer(context, view, computer))}
        </ul>`;
    }

    #computer(context: PartContext, view: HouseholdViewPort, computer: ComputerViewPort): TemplateResult {
        const said = removalWords(context, computer);
        return html`<li class="computer" data-computer=${computer.id} data-online=${String(computer.online)}>
            <span class="row-title">${nameOf(this.#t, computer)}</span>
            <span class="row-detail">${presence(context, computer)}</span>
            ${share(context, computer)}
            <span class="row-detail">${versions(context, computer)}</span>
            ${sharingPart(context, computer)} ${diskPart(context, view, computer)}
            <p class="note" role="status" data-removal=${computer.removal?.step ?? 'none'}>${said}</p>
            ${this.#actions(context, view, computer)} ${manualCleanup(context, computer)}
        </li>`;
    }

    /** Rename, Pause or Resume and Remove; while a removal runs or failed, Disconnect now anyway; nothing once disconnected. */
    #actions(context: PartContext, view: HouseholdViewPort, computer: ComputerViewPort): TemplateResult {
        if (computer.revoked) {
            return html``;
        }
        if (computer.removal !== null) {
            return this.#disconnect(context, view, computer);
        }
        return this.open?.id === computer.id ? this.#opened(context, view, computer) : this.#buttons(context, view, computer);
    }

    #opened(context: PartContext, view: HouseholdViewPort, computer: ComputerViewPort): TemplateResult {
        return this.open?.what === 'rename' ? this.#rename(context, view, computer) : this.#remove(context, view, computer);
    }

    #buttons(context: PartContext, view: HouseholdViewPort, computer: ComputerViewPort): TemplateResult {
        const { intents } = context.household;
        const busy = view.acting !== null;
        const pause = computer.paused
            ? { icon: 'play_arrow', key: 'adminWorkerHousehold.resume' as const, act: () => intents.resume(computer.id) }
            : { icon: 'pause', key: 'adminWorkerHousehold.pause' as const, act: () => intents.pause(computer.id) };
        return html`<div class="actions">
            <hcm-button
                variant="text"
                icon="edit"
                ?disabled=${busy}
                @click=${() => {
                    this.#openFor(computer.id, 'rename');
                }}
                >${this.#t('adminWorkerHousehold.rename')}</hcm-button
            >
            <hcm-button variant="text" icon=${pause.icon} ?disabled=${busy} @click=${() => void pause.act()}
                >${this.#t(pause.key)}</hcm-button
            >
            <hcm-button
                variant="text"
                icon="delete"
                ?disabled=${busy}
                @click=${() => {
                    this.#openFor(computer.id, 'remove');
                }}
                >${this.#t('adminWorkerHousehold.remove')}</hcm-button
            >
        </div>`;
    }

    /** Disconnect now anyway: only for a removal that waits on a computer that is off, or that failed. */
    #disconnect(context: PartContext, view: HouseholdViewPort, computer: ComputerViewPort): TemplateResult {
        const step = computer.removal?.step;
        const stuck = step === 'failed' || (step === 'asked' && !computer.online);
        if (!stuck) {
            return html``;
        }
        return html`<div class="actions">
            <hcm-button
                variant="text"
                icon="cancel"
                data-disconnect
                ?disabled=${view.acting !== null}
                @click=${() => void context.household.intents.disconnect(computer.id)}
                >${this.#t('adminWorkerHousehold.disconnect')}</hcm-button
            >
        </div>`;
    }

    #rename(context: PartContext, view: HouseholdViewPort, computer: ComputerViewPort): TemplateResult {
        const id = ['name', computer.id].join('-');
        const save = async (): Promise<void> => {
            const field = this.renderRoot.querySelector<HTMLInputElement>(`#${id}`);
            if (field !== null && (await context.household.intents.rename(computer.id, field.value))) {
                this.open = null;
            }
        };
        return html`<div class="field">
                <label for=${id}>${this.#t('adminWorkerHousehold.name')}</label>
                <input id=${id} maxlength="40" .value=${computer.name ?? ''} />
            </div>
            <div class="actions">
                <hcm-button variant="tonal" icon="check" ?disabled=${view.acting !== null} @click=${() => void save()}
                    >${this.#t('adminWorkerHousehold.save')}</hcm-button
                >
                ${this.#cancel()}
            </div>`;
    }

    #cancel(): TemplateResult {
        return html`<hcm-button
            variant="text"
            @click=${() => {
                this.open = null;
            }}
            >${this.#t('adminWorkerHousehold.cancel')}</hcm-button
        >`;
    }

    #remove(context: PartContext, view: HouseholdViewPort, computer: ComputerViewPort): TemplateResult {
        const go = async (): Promise<void> => {
            if (await context.household.intents.remove(computer.id, this.choices)) {
                this.open = null;
            }
        };
        return html`<p>${this.#t('adminWorkerHousehold.removeIntro')} ${this.#t('adminWorkerHousehold.removeIntro2')}</p>
            ${this.#choice('keep', this.#t('adminWorkerHousehold.keep'))} ${this.#choice('docker', this.#t('adminWorkerHousehold.docker'))}
            <div class="actions">
                <hcm-button variant="filled" icon="delete" data-remove-now ?disabled=${view.acting !== null} @click=${() => void go()}
                    >${this.#t('adminWorkerHousehold.removeNow')}</hcm-button
                >
                ${this.#cancel()}
            </div>`;
    }

    /** One of the removal's choices: its words and a switch (M3's 48 px target, its state not by colour alone). */
    #choice(name: 'keep' | 'docker', label: string): TemplateResult {
        return html`<div class="check" data-choice=${name}>
            <span>${label}</span>
            <hcm-switch
                .label=${label}
                .checked=${this.choices[name]}
                @hcm-change=${(event: CustomEvent<{ readonly checked: boolean }>) => {
                    this.choices = { ...this.choices, [name]: event.detail.checked };
                }}
            ></hcm-switch>
        </div>`;
    }

    #openFor(id: string, what: 'rename' | 'remove'): void {
        this.choices = { keep: false, docker: false };
        this.open = { id, what };
    }

    #copiedText(what: string): string {
        if (this.copied?.what !== what) {
            return '';
        }
        return this.#t(this.copied.ok ? 'adminWorkerHousehold.copied' : 'adminWorkerHousehold.copyFailed');
    }

    async #copy(what: string, text: string): Promise<void> {
        this.copied = null;
        this.copied = { what, ok: await copyToClipboard(text, navigator.clipboard) };
    }
}

/** Registers `<hcm-worker-household>` (its kit elements are the panel's, registered with it); again, a no-op. */
export function defineWorkerHousehold(registry: CustomElementRegistry = customElements): void {
    defineHcmSwitch(registry);
    defineOnce(registry, HCM_WORKER_HOUSEHOLD_TAG, HcmWorkerHousehold);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-worker-household': HcmWorkerHousehold;
    }
}
