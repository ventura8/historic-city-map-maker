/**
 * `<hcm-worker-versions>` (`docs/research/M7-local-worker.md`, *The starter updates itself*; behaviour A142), in "This computer"'s
 * card: the image the worker runs and the version of the starter file ("the helper") that runs it, each beside the installed
 * release's. A helper older than the release says so in plain words, why it could not update itself (its last look's word), and
 * the one command that updates it, with Copy: the server's starter file for the chosen system, downloaded and opened once.
 */
import { DEFAULT_LOCALE, type Locale } from '@hcm/shared';
import { translateAdminWorkerLocal, type AdminWorkerLocalKey } from '@hcm/shared/admin-worker-local';
import { css, html, LitElement, type PropertyValues, type TemplateResult } from 'lit';

import { defineOnce } from '../../components/internal.js';
import { copyToClipboard } from '../setup/setup-body.js';
import { workerStyles } from './worker-element.js';
import type { LocalPort, LocalViewPort, VersionsViewPort, WorkerOsPort } from './worker-port.js';

const HCM_WORKER_VERSIONS_TAG = 'hcm-worker-versions';
/** How much of a digest the card shows. */
const SHORT = 12;

/**
 * The one line that updates the helper on `os`: the server's starter file (`url`, `worker.starter` with `action=install`) saved
 * in the home folder (Windows: the temporary one) and opened, which sets the service up again with the new file.
 */
export function starterUpdateCommand(url: string, os: WorkerOsPort): string {
    if (os === 'windows') {
        return `Invoke-WebRequest -UseBasicParsing '${url}' -OutFile "$env:TEMP\\hcm-worker.bat"; & "$env:TEMP\\hcm-worker.bat"`;
    }
    const file = os === 'mac' ? '~/hcm-worker.command' : '~/hcm-worker.sh';
    return `curl -fsSL '${url}' -o ${file} && sh ${file}`;
}

/** Which "why" line a helper's last look gives. */
function whyKey(update: VersionsViewPort['update']): AdminWorkerLocalKey {
    if (update === null || update === 'unchecked') {
        return 'adminWorkerLocal.versions.why.first';
    }
    return update === 'current' || update === 'updated' ? 'adminWorkerLocal.versions.why.later' : `adminWorkerLocal.versions.why.${update}`;
}

class HcmWorkerVersions extends LitElement {
    static override readonly properties = {
        local: { attribute: false },
        locale: { type: String },
        view: { state: true },
        copied: { state: true },
    };

    static override readonly styles = [
        ...workerStyles,
        css`
            :host {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            p {
                margin: 0;
            }
        `,
    ];

    declare local: LocalPort | null;
    declare locale: Locale;
    declare view: LocalViewPort | null;
    declare copied: boolean | null;
    #unsubscribe: (() => void) | null = null;

    constructor() {
        super();
        this.local = null;
        this.locale = DEFAULT_LOCALE;
        this.view = null;
        this.copied = null;
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#unsubscribe?.();
        this.#unsubscribe = null;
    }

    protected override willUpdate(changed: PropertyValues): void {
        if (changed.has('local')) {
            this.#listen(this.local);
        }
    }

    /** Follows `local`'s state (none without one). */
    #listen(local: LocalPort | null): void {
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.view = local === null ? null : local.state;
        if (local !== null) {
            this.#unsubscribe = local.subscribe((state) => {
                this.view = state;
            });
        }
    }

    #t(key: AdminWorkerLocalKey, params?: Readonly<Record<string, string>>): string {
        return translateAdminWorkerLocal(this.locale, key, params);
    }

    override render(): TemplateResult {
        const view = this.view;
        const versions = view === null ? null : view.versions;
        if (view === null || versions === null) {
            return html``;
        }
        return html`<h4 class="title">${this.#t('adminWorkerLocal.versions.title')}</h4>
            ${this.#body(view, versions)}`;
    }

    #body(view: LocalViewPort, versions: VersionsViewPort): TemplateResult {
        if (!versions.said) {
            return html`<p data-versions="not-said">${this.#t('adminWorkerLocal.versions.notSaid')}</p>`;
        }
        return this.#said(view, versions);
    }

    #said(view: LocalViewPort, versions: VersionsViewPort): TemplateResult {
        const image =
            versions.image === null ? this.#t('adminWorkerLocal.versions.unknown') : versions.image.slice(0, 'sha256:'.length + SHORT);
        const worker = versions.imageCurrent ? 'adminWorkerLocal.versions.current' : 'adminWorkerLocal.versions.workerOld';
        return html`<p data-versions-worker=${versions.imageCurrent ? 'current' : 'old'}>
                ${this.#t('adminWorkerLocal.versions.worker', { version: image })} ${this.#t(worker)}
            </p>
            ${this.#starter(view, versions)}`;
    }

    #starter(view: LocalViewPort, versions: VersionsViewPort): TemplateResult {
        if (versions.starter === null) {
            return html`<p data-versions-starter="none">${this.#t('adminWorkerLocal.versions.byCommand')}</p>`;
        }
        const line = this.#t('adminWorkerLocal.versions.starter', { version: versions.starter });
        if (versions.starterCurrent) {
            return html`<p data-versions-starter="current">${line} ${this.#t('adminWorkerLocal.versions.current')}</p>`;
        }
        return html`<p data-versions-starter="old">${line}</p>
            ${this.#old(view, versions)}`;
    }

    /** The helper is out of date: what happened, why, and the fix. */
    #old(view: LocalViewPort, versions: VersionsViewPort): TemplateResult {
        const command = starterUpdateCommand(view.files.install.url, view.os);
        return html`<div role="alert" data-starter-old=${versions.update ?? 'none'}>
                <p>${this.#t('adminWorkerLocal.versions.old')}</p>
                <p class="note">${this.#t(whyKey(versions.update))}</p>
            </div>
            <p>${this.#t(`adminWorkerLocal.versions.where.${view.os}`)}</p>
            <pre class="text" aria-label=${this.#t('adminWorkerLocal.versions.command')}>${command}</pre>
            <div class="actions">
                <hcm-button variant="tonal" icon="content_copy" data-copy-update @click=${() => void this.#copy(command)}
                    >${this.#t('adminWorkerLocal.versions.copy')}</hcm-button
                >
            </div>
            <p class="note" role="status" data-copied="update">${this.#copiedText()}</p>`;
    }

    #copiedText(): string {
        if (this.copied === null) {
            return '';
        }
        return this.#t(this.copied ? 'adminWorkerLocal.copied' : 'adminWorkerLocal.copyFailed');
    }

    async #copy(text: string): Promise<void> {
        this.copied = null;
        this.copied = await copyToClipboard(text, navigator.clipboard);
    }
}

/** Registers `<hcm-worker-versions>` (`defineWorkerMachine` calls it); again, a no-op. */
export function defineWorkerVersions(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_WORKER_VERSIONS_TAG, HcmWorkerVersions);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-worker-versions': HcmWorkerVersions;
    }
}
