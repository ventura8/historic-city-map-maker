/**
 * `<hcm-archive-report archive="<id>">` (`docs/research/M20-import-local.md` §8.2–§8.6; behaviour A121), the Imagery area's detail
 * pane at `#/imagery/archive/<id>`: the scan's report (files, size, series found, files skipped by reason), one card per series
 * (what will happen to it, its chance to calibrate itself, its rights, the estimated zoom, bytes and minutes; Import this series,
 * its title and year; a series whose rights wait asks who granted them), the total (series, bytes, days at the city's share) and
 * the one Import click. Once imported, each series' progress: waiting for its day, at work, waiting for points and why, waiting
 * for approval with its error against its threshold, published, each opening its version's page; below it, the plan of the series
 * still to import (left out, or started over by deleting its version: `imagery.deleteVersion`), when one of them can be.
 */
import type { ArchiveSeries } from '@hcm/shared';
import { html, type PropertyValues, type TemplateResult } from 'lit';

import { errorTemplate, loadingTemplate } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { noticeOf } from '../shell/text.js';
import type { ArchiveViewPort, OpenArchivePort, SeriesEditPort, SeriesProgressPort } from './archive-port.js';
import { ArchiveElement, count, sizeText } from './archive-element.js';
import { actionText, chosenOf, estimateText, overallPercent, stateText, totalText, yearShown } from './series-text.js';

export const HCM_ARCHIVE_REPORT_TAG = 'hcm-archive-report';

type Report = NonNullable<OpenArchivePort['report']>;

/** A series the import takes: proposed, or skipped only as too small (the owner insists). */
function importable(series: ArchiveSeries): boolean {
    return series.action === 'import' || series.reason === 'too-small';
}

const RIGHTS_TONE = { clear: 'good', 'needs-confirmation': 'wait', 'do-not-publish': 'error' } as const;

export class HcmArchiveReport extends ArchiveElement {
    static override readonly properties = {
        ...ArchiveElement.properties,
        archive: { type: String },
        readOnly: { type: Boolean, attribute: 'read-only' },
    };

    /** The routed archive's id. */
    declare archive: string;
    /** A revoked admin's page: nothing imports. */
    declare readOnly: boolean;

    constructor() {
        super();
        this.archive = '';
        this.readOnly = false;
    }

    protected override updated(changed: PropertyValues): void {
        super.updated(changed);
        if (changed.has('archive')) {
            this.feed?.intents.open(this.archive === '' ? null : this.archive);
        }
    }

    protected override attached(): void {
        this.feed?.intents.open(this.archive === '' ? null : this.archive);
    }

    override render(): TemplateResult {
        const view = this.view;
        const open = view === null ? null : view.open;
        if (view === null || open === null) {
            return loadingTemplate(this.locale);
        }
        return this.#opened(view, open);
    }

    /** The routed archive: loading, failed with Try again, not found, or its report. */
    #opened(view: ArchiveViewPort, open: OpenArchivePort): TemplateResult {
        if (open.status !== 'ready') {
            return open.status === 'loading'
                ? loadingTemplate(this.locale)
                : errorTemplate(this.locale, view.failure, () => this.feed?.intents.retry());
        }
        if (open.report === null) {
            return html`<div class="pane"><p data-state="not-found">${this.t('adminArchive.notFound')}</p></div>`;
        }
        return this.#report(view, open.report);
    }

    #report(view: ArchiveViewPort, report: Report): TemplateResult {
        const locale = this.locale;
        const skipped = report.skipped.reduce((sum, [, n]) => sum + n, 0);
        const summary = this.t('adminArchive.summary', {
            ...{ files: count(locale, report.files), size: sizeText(locale, report.bytes) },
            ...{ series: count(locale, report.series.length), skipped: count(locale, skipped) },
        });
        return html`<section class="pane" data-archive-report data-imported=${String(report.imported)}>
            <h2 data-detail-heading tabindex="-1">${report.name}</h2>
            <p>${summary}</p>
            ${this.#skipped(report)} ${report.imported ? this.#progress(view, report) : EMPTY} ${this.#rest(view, report)}
            <p class="note" role="status" data-result>${this.#result(view)}</p>
            <div role="alert">${view.refusal === null ? EMPTY : html`<p class="alert">${noticeOf(locale, view.refusal)}</p>`}</div>
        </section>`;
    }

    #result(view: ArchiveViewPort): string {
        const result = view.result;
        return result === null ? '' : this.t('adminArchive.imported', { today: count(this.locale, result.today) });
    }

    #skipped(report: Report): TemplateResult {
        if (report.skipped.length === 0) {
            return EMPTY;
        }
        const items = report.skipped.map(([reason, n]) => {
            const text = this.t(`adminArchive.reason.${reason}` as Parameters<typeof this.t>[0]);
            return html`<li data-skipped=${reason}>${this.t('adminArchive.skipped', { reason: text, count: count(this.locale, n) })}</li>`;
        });
        return html`<h3>${this.t('adminArchive.skippedTitle')}</h3>
            <ul>
                ${items}
            </ul>`;
    }

    /**
     * The plan of the series not imported yet: every series before the first import; after it, the ones left out or started over
     * (their version deleted), when one of them can still be imported.
     */
    #rest(view: ArchiveViewPort, report: Report): TemplateResult {
        const rest = report.series.filter((series) => !report.importedSeries.includes(series.seriesId));
        const open = !report.imported || rest.some(importable);
        return open ? this.#plan(view, rest) : EMPTY;
    }

    #plan(view: ArchiveViewPort, rest: readonly ArchiveSeries[]): TemplateResult {
        const chosen = chosenOf(rest, view.edits);
        const valid = chosen.length > 0 && chosen.every((series) => yearShown(view.edits[series.seriesId]?.year ?? ''));
        return html`${rest.map((series) => this.#series(view, series))}
            <p data-total>${totalText(this.locale, chosen)}</p>
            <div class="actions">
                <hcm-button
                    variant="filled"
                    icon="download"
                    data-import
                    ?disabled=${this.readOnly || !valid || view.importing}
                    @click=${() => void this.feed?.intents.import()}
                    >${this.t(view.importing ? 'adminArchive.importing' : 'adminArchive.import')}</hcm-button
                >
            </div>`;
    }

    #series(view: ArchiveViewPort, series: ArchiveSeries): TemplateResult {
        const edit = view.edits[series.seriesId];
        const takes = importable(series);
        const titled = `${series.title}, ${series.yearLabel ?? String(series.year)}`;
        return html`<div class="series" data-series=${series.seriesId} ?data-skip=${!takes}>
            <p class="row-title">${titled}</p>
            <p class="row-detail">${actionText(this.locale, series)}</p>
            ${this.#tags(series)}
            <p class="row-detail">${estimateText(this.locale, series)}</p>
            ${takes && edit !== undefined ? this.#choice(series, edit) : EMPTY}
        </div>`;
    }

    #tags(series: ArchiveSeries): TemplateResult {
        const state = series.rights.state;
        return html`<span class="chips">
            <span class="tag" data-auto=${series.estimate.auto}>${this.t(`adminArchive.auto.${series.estimate.auto}`)}</span>
            <span class="tag" data-rights=${state} data-tone=${RIGHTS_TONE[state]}>${this.t(`adminArchive.rights.${state}`)}</span>
        </span>`;
    }

    #choice(series: ArchiveSeries, edit: SeriesEditPort): TemplateResult {
        const intents = this.feed?.intents;
        const label = this.t('adminArchive.include');
        const id = series.seriesId;
        const named = `${label}: ${series.title}`;
        return html`<div class="switch-row">
                <span aria-hidden="true">${label}</span>
                <hcm-switch
                    .checked=${edit.include}
                    ?disabled=${this.readOnly}
                    label=${named}
                    @hcm-change=${(event: Event) => {
                        intents?.setInclude(id, (event as CustomEvent<{ checked: boolean }>).detail.checked);
                    }}
                ></hcm-switch>
            </div>
            ${edit.include ? this.#included(series, edit) : EMPTY}`;
    }

    /** A kept series: its title and year, and its rights when they wait for the owner. */
    #included(series: ArchiveSeries, edit: SeriesEditPort): TemplateResult {
        return html`${this.#fields(series.seriesId, edit)} ${this.#rights(series, edit)}`;
    }

    #fields(id: string, edit: SeriesEditPort): TemplateResult {
        const intents = this.feed?.intents;
        const invalid = !yearShown(edit.year);
        return html`<div class="field">
                <label for=${`${id}-title`}>${this.t('adminArchive.fieldTitle')}</label>
                <input
                    id=${`${id}-title`}
                    .value=${edit.title}
                    ?readonly=${this.readOnly}
                    @input=${(event: Event) => intents?.setTitle(id, (event.target as HTMLInputElement).value)}
                />
            </div>
            <div class="field" ?data-invalid=${invalid}>
                <label for=${`${id}-year`}>${this.t('adminArchive.fieldYear')}</label>
                <input
                    id=${`${id}-year`}
                    inputmode="numeric"
                    .value=${edit.year}
                    ?readonly=${this.readOnly}
                    aria-invalid=${String(invalid)}
                    aria-describedby=${`${id}-year-help`}
                    @input=${(event: Event) => intents?.setYear(id, (event.target as HTMLInputElement).value)}
                />
                <span class=${invalid ? 'error' : 'note'} id=${`${id}-year-help`} data-year-help
                    >${this.t(invalid ? 'adminArchive.yearInvalid' : 'adminArchive.yearHelp')}</span
                >
            </div>`;
    }

    #rights(series: ArchiveSeries, edit: SeriesEditPort): TemplateResult {
        if (edit.confirmedBy !== null) {
            return html`<p data-rights-confirmed>${this.t('adminArchive.rights.confirmed', { by: edit.confirmedBy })}</p>`;
        }
        if (series.rights.state !== 'needs-confirmation') {
            return EMPTY;
        }
        const id = `${series.seriesId}-rights`;
        const confirm = (event: Event): void => {
            const root = (event.currentTarget as HTMLElement).getRootNode() as ParentNode;
            const input = root.querySelector<HTMLInputElement>(`#${id}`);
            this.feed?.intents.confirmRights(series.seriesId, input?.value ?? '');
        };
        return html`<p class="note">${this.t('adminArchive.rights.question')}</p>
            <div class="field">
                <label for=${id}>${this.t('adminArchive.rights.by')}</label>
                <input id=${id} ?readonly=${this.readOnly} />
            </div>
            <div class="actions">
                <hcm-button variant="tonal" icon="check" data-confirm-rights ?disabled=${this.readOnly} @click=${confirm}
                    >${this.t('adminArchive.rights.confirm')}</hcm-button
                >
            </div>`;
    }

    #progress(view: ArchiveViewPort, report: Report): TemplateResult {
        const known = report.series.flatMap((series) => {
            const progress = view.progress[series.seriesId];
            return progress === undefined ? [] : [[series, progress] as const];
        });
        const rows = known.map(([series, progress]) => this.#progressRow(series, progress));
        const percent = overallPercent(known.map(([, progress]) => progress));
        const said = this.t('adminArchive.local.overall', { percent: String(percent) });
        return html`<h3>${this.t('adminArchive.progressTitle')}</h3>
            <p data-overall=${String(percent)}>${said}</p>
            <hcm-progress .value=${percent / 100} .label=${said}></hcm-progress>
            <ul class="rows">
                ${rows}
            </ul>`;
    }

    /** An imported series: where it stands, and its version's page. */
    #progressRow(series: ArchiveSeries, progress: SeriesProgressPort): TemplateResult {
        const versionId = progress.versionId;
        const href = versionId === null ? '' : `#/imagery/version/${versionId}`;
        const open =
            versionId === null
                ? EMPTY
                : html`<a class="external" href=${href}>${this.t('adminArchive.openVersion', { title: series.title })}</a>`;
        return html`<li class="series" data-progress=${series.seriesId} data-state=${progress.state ?? ''}>
            <p class="row-title">${series.title}</p>
            <p class="row-detail">${stateText(this.locale, progress)}</p>
            ${open}
        </li>`;
    }
}
