/**
 * `<hcm-archive-panel>` (`docs/research/M20-import-local.md` §2.1, §8.1; behaviour A121), in the Imagery area's Upload view under the
 * GeoTIFF upload: Import local files. With no worker of the city seen in the last three minutes it says to start the worker first
 * (Open Jobs); with one, batch 4 (the owner, 2026-11-09: no new tab): Choose a folder and Choose a zip pick the files in this tab, which
 * streams them to the worker on this computer's loopback with the share sent, then the files the scan read, and Cancel; the worker's own
 * page stays a link below, the fallback. Below, the archives already scanned, each opening its
 * report (`#/imagery/archive/<id>`). An archive that arrives while the card is open (the worker's scan just reported it) opens its report
 * by itself (`hcm-archive-arrived`): choosing the files and Import are the owner's only inputs (§8.3, the admin-input budget).
 */
import type { AdminArchiveKey } from '@hcm/shared/admin-archive';
import { trackFunnel } from '@hcm/shared/funnels';
import { html, type PropertyValues, type TemplateResult } from 'lit';

import { errorTemplate } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import type { ArchiveRowPort, ArchiveViewPort, LocalFilePort, LocalImportPort } from './archive-port.js';
import { ArchiveElement, count, sizeText } from './archive-element.js';
import { localImportFunnel } from './local-import-funnel.js';

export const HCM_ARCHIVE_PANEL_TAG = 'hcm-archive-panel';

/** Why the admin's import stopped, in words; a scan's own error code is shown as it came. */
const WHY: Readonly<Record<string, AdminArchiveKey | undefined>> = {
    notPaired: 'adminArchive.local.notPaired',
    unreachable: 'adminArchive.local.unreachable',
    refused: 'adminArchive.local.refused',
};

/** The picked files, each with its path inside the chosen folder (`webkitRelativePath`), else its name (a zip). */
export function pickedFiles(list: Iterable<File> | null): LocalFilePort[] {
    return [...(list ?? [])].map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}

/** The archive's name: the zip's, or the chosen folder's (the first part of a file's path in it). */
export function archiveName(path: string, source: 'folder' | 'zip'): string {
    const slash = path.indexOf('/');
    return source === 'zip' || slash < 0 ? path : path.slice(0, slash);
}

export class HcmArchivePanel extends ArchiveElement {
    /** The archives listed when the card first read them (null before): any other one arrived since. */
    #known: ReadonlySet<string> | null = null;

    protected override updated(changed: PropertyValues): void {
        super.updated(changed);
        const view = this.view;
        if (view?.status === 'ready') {
            this.#arrived(view.archives);
        }
        if (view !== null) {
            trackFunnel(this, localImportFunnel(view.local));
        }
    }

    protected override detach(): void {
        super.detach();
        this.#known = null;
    }

    /** A new archive not yet imported: the page opens its report. */
    #arrived(archives: readonly ArchiveRowPort[]): void {
        const known = this.#known;
        this.#known = new Set(archives.map((row) => row.id));
        const fresh = known === null ? undefined : archives.find((row) => !known.has(row.id) && !row.imported);
        if (fresh !== undefined) {
            this.dispatchEvent(new CustomEvent('hcm-archive-arrived', { detail: { id: fresh.id }, bubbles: true, composed: true }));
        }
    }
    override render(): TemplateResult {
        const view = this.view;
        return html`<section data-archive-panel>
            <h3 class="title">${this.t('adminArchive.title')}</h3>
            <p class="note">${this.t('adminArchive.intro')}</p>
            ${view === null ? EMPTY : this.#body(view)}
        </section>`;
    }

    #body(view: ArchiveViewPort): TemplateResult {
        if (view.status === 'error') {
            return errorTemplate(this.locale, view.failure, () => this.feed?.intents.retry());
        }
        return html`${this.#choose(view)} ${this.#archives(view)}`;
    }

    #choose(view: ArchiveViewPort): TemplateResult {
        if (!view.connected) {
            return html`<p data-state="no-worker">${this.t('adminArchive.noWorker')}</p>
                <div class="actions"><a class="external" href="#/jobs">${this.t('adminArchive.openJobs')}</a></div>`;
        }
        const busy = view.local.phase === 'upload' || view.local.phase === 'scan';
        return html`<div class="actions" role="group" aria-label=${this.t('adminArchive.choose')}>
                <hcm-button
                    variant="filled"
                    icon="upload"
                    data-choose="folder"
                    ?disabled=${busy}
                    @click=${() => {
                        this.#pick('folder');
                    }}
                    >${this.t('adminArchive.local.folder')}</hcm-button
                >
                <hcm-button
                    variant="tonal"
                    icon="upload_file"
                    data-choose="zip"
                    ?disabled=${busy}
                    @click=${() => {
                        this.#pick('zip');
                    }}
                    >${this.t('adminArchive.local.zip')}</hcm-button
                >
            </div>
            <input
                type="file"
                data-pick="folder"
                webkitdirectory
                multiple
                hidden
                @change=${(event: Event) => {
                    this.#picked(event, 'folder');
                }}
            />
            <input
                type="file"
                data-pick="zip"
                accept=".zip,application/zip"
                hidden
                @change=${(event: Event) => {
                    this.#picked(event, 'zip');
                }}
            />
            ${this.#local(view.local)}
            <p class="note">
                ${this.t('adminArchive.chooseNote')}
                <a class="external" data-fallback href=${view.importUrl} target="_blank" rel="noopener noreferrer"
                    >${this.t('adminArchive.local.fallback')}</a
                >
            </p>`;
    }

    #pick(source: 'folder' | 'zip'): void {
        this.renderRoot.querySelector<HTMLInputElement>(`input[data-pick="${source}"]`)?.click();
    }

    /** The picked files with their paths in the folder (`webkitRelativePath`), or the zip by its name; the input is emptied for the next. */
    #picked(event: Event, source: 'folder' | 'zip'): void {
        const input = event.currentTarget as HTMLInputElement;
        const files = pickedFiles(input.files);
        input.value = '';
        const first = files[0];
        if (first !== undefined) {
            void this.feed?.intents.importLocal(files, source, archiveName(first.path, source));
        }
    }

    /** The import's progress while it runs, with Cancel; how it ended once it did. */
    #local(local: LocalImportPort): TemplateResult {
        if (local.phase === 'idle') {
            return EMPTY;
        }
        if (local.phase === 'upload' || local.phase === 'scan') {
            const said =
                local.phase === 'upload'
                    ? this.t('adminArchive.local.upload', { percent: String(local.percent) })
                    : this.t('adminArchive.local.scan', {
                          done: count(this.locale, local.done),
                          total: count(this.locale, local.total),
                          percent: String(local.percent),
                      });
            return html`<div class="local" data-local=${local.phase}>
                <hcm-progress .value=${local.percent / 100} .label=${said}></hcm-progress>
                <p role="status">${said}</p>
                <div class="actions">
                    <hcm-button
                        variant="outlined"
                        icon="close"
                        @click=${() => {
                            void this.feed?.intents.cancelLocal();
                        }}
                        >${this.t('adminArchive.local.cancel')}</hcm-button
                    >
                </div>
            </div>`;
        }
        return html`<p role="status" data-local=${local.phase}>${this.#ended(local)}</p>`;
    }

    #ended(local: LocalImportPort): string {
        if (local.phase === 'failed') {
            return this.t('adminArchive.local.failed', { why: this.#why(local.error) });
        }
        return this.t(local.phase === 'done' ? 'adminArchive.local.done' : 'adminArchive.local.cancelled');
    }

    /** Why it stopped in words; a scan's own error code as it came. */
    #why(error: string | null): string {
        const key = WHY[error ?? ''];
        return key === undefined ? (error ?? '') : this.t(key);
    }

    #archives(view: ArchiveViewPort): TemplateResult {
        const rows =
            view.archives.length === 0
                ? html`<p class="note" data-state="no-archives">${this.t('adminArchive.none')}</p>`
                : html`<ul class="rows">
                      ${view.archives.map((row) => html`<li>${this.#row(row)}</li>`)}
                  </ul>`;
        return html`<h4>${this.t('adminArchive.archives')}</h4>
            ${rows}`;
    }

    #row(row: ArchiveRowPort): TemplateResult {
        const locale = this.locale;
        const detail = this.t('adminArchive.row', {
            ...{ series: count(locale, row.series), files: count(locale, row.files) },
            size: sizeText(locale, row.bytes),
        });
        const imported = row.imported ? html` <span class="tag" data-tone="good">${this.t('adminArchive.rowImported')}</span>` : EMPTY;
        const href = `#/imagery/archive/${row.id}`;
        return html`<a class="row" data-archive=${row.id} href=${href}
            ><span class="row-title">${row.name}${imported}</span><span class="row-detail">${detail}</span></a
        >`;
    }
}
