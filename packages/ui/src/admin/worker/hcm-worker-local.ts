/**
 * `<hcm-worker-local>` (finding 72 of 2026-11-02, `docs/research/M7-local-worker.md` §1.5, §2.7; behaviour A62), the worker
 * panel's part about the computer the admin is open on, in the lazy `worker-local` chunk: the system (picked from the
 * browser's), **Use this computer**, the auto-pair's "Connecting this computer…" and "This computer is connected" in a
 * polite region, "Docker is not installed? Get Docker", **Stop using this computer** (the removal file; the computer's
 * worker disconnected), and behind **Advanced** the copyable command of finding 66 with its one-time code (Copy, the
 * worker's page, the gcloud note).
 *
 * Finding 73 of 2026-11-03: Use this computer and Stop using this computer are links to the server's `worker.starter`,
 * which answers the file as a download the owner started (Chrome kept nothing of the Blob this element used to save).
 * After the click the region says the browser may ask to keep the file and where it is saved, and how to open it; on
 * Linux, where a double-click opens a `.sh` as text, the exact line `sh ~/Downloads/hcm-worker.sh` with its Copy button.
 * A server that does not make the file yet says to update the map instead of a link.
 */
import { PIPELINE_REPOSITORY, WORKER_CONTAINER, WORKER_PORT, DEFAULT_LOCALE, type UiLocale } from '@hcm/shared';
import { translateAdminWorkerLocal, type AdminWorkerLocalKey } from '@hcm/shared/admin-worker-local';
import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { defineOnce } from '../../components/internal.js';
import { copyToClipboard } from '../setup/setup-body.js';
import { workerStyles } from './worker-element.js';
import { linkButtonStyles } from '../setup/setup-styles.js';
import { defineWorkerMachine } from './hcm-worker-machine.js';
import type { LocalPort, LocalViewPort, StarterLinkPort, WorkerOsPort } from './worker-port.js';

export const HCM_WORKER_LOCAL_TAG = 'hcm-worker-local';

/** The worker's local page, on the computer's loopback (`localhost`): its state, and the fallback sign-in. */
export const WORKER_PAGE = `http://localhost:${String(WORKER_PORT)}/`;
/** Docker's own page of installers for every system. */
export const GET_DOCKER_URL = 'https://docs.docker.com/get-started/get-docker/';

const OSES: readonly WorkerOsPort[] = ['linux', 'mac', 'windows'];

/** The words under the link, by phase (nothing before the first click). */
const PHASE_TEXT: Readonly<Partial<Record<LocalViewPort['phase'], AdminWorkerLocalKey>>> = {
    downloaded: 'adminWorkerLocal.saved',
    looking: 'adminWorkerLocal.looking',
    connecting: 'adminWorkerLocal.connecting',
    connected: 'adminWorkerLocal.connected',
    stopped: 'adminWorkerLocal.stopped',
};

/** Where the browser saves a download on Linux, and the line that runs the starter file from there. */
export const LINUX_RUN_LINE = 'sh ~/Downloads/hcm-worker.sh';

/** Which Copy was asked, and whether it worked. */
type Copied = { readonly what: 'run' | 'command'; readonly ok: boolean } | null;

/** What the command names. */
export interface WorkerCommandInput {
    readonly project: string;
    readonly city: string;
    readonly digest: string;
    /** The one-time pairing code; null: the command carries none (the page's sign-in then). */
    readonly code: string | null;
    readonly os: WorkerOsPort;
}

/**
 * The one line that starts (or replaces) the city's worker with the pipeline's image by digest (finding 66): the old
 * container removed (quietly: `2>&1 | true`, or `| Out-Null` in Windows PowerShell), the new one detached, named, restarted
 * with the computer, its page on the loopback only, its work folder and paired session in the named volume, the code.
 */
export function workerCommand(input: WorkerCommandInput): string {
    const { project, city, digest, code, os } = input;
    const image = `us-central1-docker.pkg.dev/${project}/${PIPELINE_REPOSITORY}/pipeline@${digest}`;
    const port = String(WORKER_PORT);
    const run = `docker run -d --name ${WORKER_CONTAINER} --restart unless-stopped -p 127.0.0.1:${port}:${port} -v ${WORKER_CONTAINER}:/work`;
    const quiet = os === 'windows' ? '2>&1 | Out-Null' : '2>&1 | true';
    const pair = code === null ? '' : ` --pair ${code}`;
    return `docker rm -f ${WORKER_CONTAINER} ${quiet}; ${run} ${image} worker --city ${city} --project ${project}${pair}`;
}

export class HcmWorkerLocal extends LitElement {
    static override readonly properties = {
        local: { attribute: false },
        locale: { type: String },
        project: { type: String },
        city: { type: String },
        image: { type: String },
        view: { state: true },
        copied: { state: true },
    };

    static override readonly styles = [
        ...workerStyles,
        linkButtonStyles,
        css`
            /* The panel's own rhythm (its section's gap), so no touch target reaches the next line. */
            :host {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .advanced {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .link-text {
                display: inline-flex;
                gap: 8px;
                align-items: center;
                box-sizing: border-box;
                min-block-size: 48px;
                padding-inline: 12px;
                border-radius: var(--md-sys-shape-corner-full);
                color: var(--md-sys-color-primary);
                font-family: var(--md-sys-typescale-label-large-font);
                font-size: var(--md-sys-typescale-label-large-size);
                font-weight: var(--md-sys-typescale-label-large-weight);
                text-decoration: none;

                --hcm-icon-size: 18px;
            }

            .link-text:focus-visible {
                outline: 3px solid var(--md-sys-color-secondary);
                outline-offset: 2px;
            }

            .open {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            details > summary {
                box-sizing: border-box;
                min-block-size: 48px;
                padding-block: 14px;
                cursor: pointer;
            }
        `,
    ];

    declare local: LocalPort | null;
    declare locale: UiLocale;
    declare project: string;
    declare city: string;
    /** The pipeline image's digest the command names. */
    declare image: string;
    declare view: LocalViewPort | null;
    /** Which Copy was asked and whether it worked (null: none yet). */
    declare copied: Copied;
    #unsubscribe: (() => void) | null = null;

    constructor() {
        super();
        this.local = null;
        this.locale = DEFAULT_LOCALE;
        this.project = '';
        this.city = '';
        this.image = '';
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

    /** Follows `local`'s state (nothing without one). */
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

    #t(key: AdminWorkerLocalKey): string {
        return translateAdminWorkerLocal(this.locale, key);
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return html``;
        }
        return html`<p>${this.#t('adminWorkerLocal.intro')}</p>
            <hcm-segmented-button
                .label=${this.#t('adminWorkerLocal.os')}
                .options=${OSES.map((value) => ({ value, label: this.#t(`adminWorkerLocal.os.${value}`) }))}
                .value=${view.os}
                @hcm-change=${(event: CustomEvent<{ value: WorkerOsPort }>) => {
                    this.local?.intents.setOs(event.detail.value);
                }}
            ></hcm-segmented-button>
            ${this.#use(view)} ${view.phase === 'none' ? this.#find() : nothing}
            <p class="note" role="status" data-local=${view.phase}>${this.#phase(view)}</p>
            ${this.#machine(view)} ${view.phase === 'downloaded' ? this.#open(view) : nothing}
            ${view.phase.startsWith('connect') ? nothing : this.#noDocker()} ${this.#stopUsing(view)}
            <details
                @toggle=${(event: Event) => {
                    this.#advanced(event);
                }}
            >
                <summary>${this.#t('adminWorkerLocal.advanced')}</summary>
                <div class="advanced">${this.#command(view)}</div>
            </details>`;
    }

    /** Finding 75: already set up on this computer, another way: look for its worker, with no file. */
    #find(): TemplateResult {
        return html`<div class="actions">
            <hcm-button
                variant="text"
                icon="search"
                data-find
                @click=${() => {
                    this.local?.intents.find();
                }}
                >${this.#t('adminWorkerLocal.find')}</hcm-button
            >
        </div>`;
    }

    /** Where to get Docker, unless this computer's worker answers (`connecting`, `connected`: finding 79 of 2026-11-03). */
    #noDocker(): TemplateResult {
        return html`<p class="note">
            ${this.#t('adminWorkerLocal.noDocker')}
            <a class="external" href=${GET_DOCKER_URL} target="_blank" rel="noopener noreferrer"
                >${this.#t('adminWorkerLocal.getDocker')}</a
            >
        </p>`;
    }

    /** The starter file's link (a download the server answers), or why there is none: the server does not make it yet. */
    #use(view: LocalViewPort): TemplateResult {
        if (view.starter === false) {
            return html`<p class="note" role="alert" data-starter-missing>${this.#t('adminWorkerLocal.failed')}</p>`;
        }
        return this.#file(view.files.install, ['link-button', 'download', 'adminWorkerLocal.use'], () => {
            this.local?.intents.use();
        });
    }

    /** Stop using this computer: the removal file's link (none while the server makes no file). */
    #stopUsing(view: LocalViewPort): TemplateResult {
        if (view.starter === false) {
            return html``;
        }
        return this.#file(view.files.uninstall, ['link-text', 'delete', 'adminWorkerLocal.stop'], () => void this.local?.intents.stop());
    }

    /** A starter file's link. */
    #file(file: StarterLinkPort, [kind, icon, label]: readonly [string, string, AdminWorkerLocalKey], clicked: () => void): TemplateResult {
        return html`<div class="actions">
            <a class=${kind} href=${file.url} download=${file.name} data-starter=${file.name} @click=${clicked}
                ><hcm-icon name=${icon} aria-hidden="true"></hcm-icon>${this.#t(label)}</a
            >
        </div>`;
    }

    /** M26: the connected computer's card. */
    #machine(view: LocalViewPort): TemplateResult | typeof nothing {
        return view.phase === 'connected'
            ? html`<hcm-worker-machine .local=${this.local} .locale=${this.locale}></hcm-worker-machine>`
            : nothing;
    }

    /** The phase's words: after the click, that the browser may ask to keep the file and where it is saved. */
    #phase(view: LocalViewPort): string {
        const key = PHASE_TEXT[view.phase];
        return key === undefined ? '' : this.#t(key);
    }

    /** How to open the saved file on the chosen system; on Linux the exact line, with Copy. */
    #open(view: LocalViewPort): TemplateResult {
        const key = `adminWorkerLocal.open.${view.os}` as const;
        const how = html`<p data-open=${view.os}>${this.#t(key)}</p>`;
        if (view.os !== 'linux') {
            return html`<div class="open">${how}</div>`;
        }
        return html`<div class="open">
            ${how}
            <pre class="text" aria-label=${this.#t('adminWorkerLocal.runCommand')}>${LINUX_RUN_LINE}</pre>
            <div class="actions">
                <hcm-button variant="tonal" icon="content_copy" @click=${() => void this.#copy('run', LINUX_RUN_LINE)}
                    >${this.#t('adminWorkerLocal.copyRun')}</hcm-button
                >
            </div>
            <p class="note" role="status" data-copied="run">${this.#copiedText('run')}</p>
        </div>`;
    }

    /** Opening Advanced asks for the command's one-time code. */
    #advanced(event: Event): void {
        const open = (event.target as HTMLDetailsElement).open;
        if (open && this.view?.code === null) {
            void this.local?.intents.command();
        }
    }

    #command(view: LocalViewPort): TemplateResult {
        const command = workerCommand({ project: this.project, city: this.city, digest: this.image, code: view.code, os: view.os });
        return html`<p>${this.#t('adminWorkerLocal.commandIntro')}</p>
            <pre class="text" aria-label=${this.#t('adminWorkerLocal.command')}>${command}</pre>
            <div class="actions">
                <hcm-button variant="tonal" icon="content_copy" @click=${() => void this.#copy('command', command)}
                    >${this.#t('adminWorkerLocal.copy')}</hcm-button
                >
                <a class="external" href=${WORKER_PAGE} target="_blank" rel="noopener noreferrer">${this.#t('adminWorkerLocal.page')}</a>
            </div>
            <p class="note" role="status" data-copied="command">${this.#copiedText('command')}</p>
            <ul class="note">
                <li>${this.#t('adminWorkerLocal.notePair')}</li>
                <li>${this.#t('adminWorkerLocal.noteGcloud')}</li>
            </ul>`;
    }

    #copiedText(what: 'run' | 'command'): string {
        const copied = this.copied;
        if (copied?.what !== what) {
            return '';
        }
        return this.#t(copied.ok ? 'adminWorkerLocal.copied' : 'adminWorkerLocal.copyFailed');
    }

    async #copy(what: 'run' | 'command', text: string): Promise<void> {
        this.copied = null;
        this.copied = { what, ok: await copyToClipboard(text, navigator.clipboard) };
    }
}

/** Registers `<hcm-worker-local>` (its kit elements are the panel's, registered with it); again, a no-op. */
export function defineWorkerLocal(registry: CustomElementRegistry = customElements): void {
    defineWorkerMachine(registry);
    defineOnce(registry, HCM_WORKER_LOCAL_TAG, HcmWorkerLocal);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-worker-local': HcmWorkerLocal;
    }
}
