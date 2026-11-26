/**
 * Settings → Export the city (M5, `docs/research/M5-interfaces.md` §5.6; behaviour A53), the lazy chunk `export-card`:
 * the intro, the latest export live (waiting, being prepared, ready with its size, counts, SHA-256 and expiry, failed
 * with its reason, expired) and its actions: Include the USGS scans (unticked, with their size), Export, Download once
 * ready (the signed address goes straight into a download, never on screen). An editor sees the export read-only, a city
 * never published says to publish it first. Inputs: `exportCity` 2, `exportWithRasters` 3.
 */
import { EXPORT_LIMITS, pluralOf, translateApiError, type ExportState, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { errorTemplate, formatWhen, loadingTemplate } from '../editing/states.js';
import { when } from '../imagery/when.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { ExportIntentsPort, ExportRecordPort, ExportSectionPort } from './export-port.js';

/** What the card needs of the settings page. */
export interface ExportCardContext {
    readonly locale: UiLocale;
    readonly view: ExportSectionPort;
    readonly intents: ExportIntentsPort | null;
    /** A revoked admin's page: no control that writes (`DECISIONS-for-review.md` §42d). */
    readonly readOnly: boolean;
    /** Saves the ready zip from its signed address (`./lazy-card.ts`: a link the browser follows, then drops). */
    readonly save: (target: { readonly url: string; readonly fileName: string }) => void;
}

const KILO = 1000;
const UNITS = [
    [KILO ** 3, 'gigabyte'],
    [KILO ** 2, 'megabyte'],
    [KILO, 'kilobyte'],
] as const;

/** A size in the admin's language (`1,4 MB`, `12 kB`, `512 byte`). */
export function sizeText(locale: UiLocale, bytes: number): string {
    const [divisor, unit] = UNITS.find(([size]) => bytes >= size) ?? [1, 'byte'];
    return new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: 1 }).format(bytes / divisor);
}

/** A failed export's reason; the size limit's numbers are sizes. */
export function failureReason(locale: UiLocale, error: NonNullable<ExportRecordPort['error']>): string {
    const params =
        error.code === 'apiError.export.tooLarge'
            ? {
                  size: sizeText(locale, Number(error.params['size'] ?? 0)),
                  max: sizeText(locale, Number(error.params['max'] ?? EXPORT_LIMITS.maxBytes)),
              }
            : error.params;
    return translateApiError(locale, error.code, params);
}

/** One group of the SHA-256, where the line may wrap after it. */
function wrappable(group: string): TemplateResult {
    return html`${group}<wbr />`;
}

/** The SHA-256 in groups of eight that may wrap at a narrow width (a copy keeps it whole). */
function checksum(locale: UiLocale, sha256: string): TemplateResult {
    const groups = sha256.match(/.{1,8}/g) ?? [];
    const prefix = contentText(locale, 'adminContent.export.checksum', { sha256: '' });
    return html`<p class="note" data-field="sha256">${prefix}<code>${groups.map(wrappable)}</code></p>`;
}

function restrictedLine(locale: UiLocale, count: number): TemplateResult {
    const key = `adminContent.export.restricted.${pluralOf(locale, count)}` as const;
    return html`<p class="note" data-field="restricted">${contentText(locale, key, { count: String(count) })}</p>`;
}

const NO_COUNTS: NonNullable<ExportRecordPort['counts']> = { photos: 0, restrictedPhotos: 0, layers: 0, rasters: 0, pois: 0 };

function expiryLine(locale: UiLocale, expiresAt: string): TemplateResult {
    return html`<p class="note">${contentText(locale, 'adminContent.export.expires', { date: formatWhen(locale, expiresAt) })}</p>`;
}

/** A ready export's size and counts. */
function readySummary(locale: UiLocale, latest: ExportRecordPort): string {
    const counts = latest.counts ?? NO_COUNTS;
    return contentText(locale, 'adminContent.export.ready', {
        size: sizeText(locale, latest.bytes ?? 0),
        photos: String(counts.photos),
        layers: String(counts.layers),
    });
}

function readyBody(context: ExportCardContext, latest: ExportRecordPort): TemplateResult {
    const { locale } = context;
    const counts = latest.counts ?? NO_COUNTS;
    return html`<p class="note" data-state="ready">${readySummary(locale, latest)}</p>
        ${when(latest.expiresAt !== null, () => expiryLine(locale, String(latest.expiresAt)))}
        ${when(latest.sha256 !== null, () => checksum(locale, String(latest.sha256)))}
        ${when(counts.restrictedPhotos > 0, () => restrictedLine(locale, counts.restrictedPhotos))}`;
}

function progressBody(locale: UiLocale, state: 'queued' | 'building'): TemplateResult {
    const text = contentText(locale, `adminContent.export.${state}`);
    return html`<div class="export-progress" data-state=${state}>
        <hcm-loading-indicator .label=${text}></hcm-loading-indicator>
        <p class="note">${text}</p>
    </div>`;
}

function failedBody(context: ExportCardContext, latest: ExportRecordPort): TemplateResult {
    const { locale } = context;
    const reason = latest.error === null ? '' : failureReason(locale, latest.error);
    return html`<p class="alert" role="alert" data-state="failed">
        <hcm-icon name="error"></hcm-icon><span>${contentText(locale, 'adminContent.export.failed', { reason })}</span>
    </p>`;
}

const LATEST_BODIES: Readonly<Record<ExportState, (context: ExportCardContext, latest: ExportRecordPort) => TemplateResult>> = {
    queued: (context) => progressBody(context.locale, 'queued'),
    building: (context) => progressBody(context.locale, 'building'),
    ready: readyBody,
    failed: failedBody,
    expired: (context) => html`<p class="note" data-state="expired">${contentText(context.locale, 'adminContent.export.expired')}</p>`,
};

/** What the card's one live region says of the latest export (a failure is its own alert). */
function news(context: ExportCardContext): string {
    const { locale, view } = context;
    const latest = view.latest;
    if (latest === null || latest.state === 'failed') {
        return '';
    }
    if (latest.state === 'ready') {
        return readySummary(locale, latest);
    }
    return contentText(locale, `adminContent.export.${latest.state}`);
}

/**
 * The section's heading takes the focus as Export starts: the buttons go while the export is under way, and the focus
 * would otherwise fall to the page (`docs/LESSONS.md` 255).
 */
function focusHeading(event: Event): void {
    const root = (event.currentTarget as Element).getRootNode() as ParentNode;
    root.querySelector<HTMLElement>('h2[data-detail-heading]')?.focus();
}

/** What the latest export says: under way, ready, failed or expired; nothing before the first one. */
function latestBody(context: ExportCardContext, latest: ExportRecordPort | null): TemplateResult {
    return latest === null ? EMPTY : LATEST_BODIES[latest.state](context, latest);
}

/** An export still queued or building: Export and Download wait for it. */
function underWay(latest: ExportRecordPort | null): boolean {
    return latest?.state === 'queued' || latest?.state === 'building';
}

/** A failed or expired export: the button says Export again. */
function endedBadly(latest: ExportRecordPort | null): boolean {
    return latest?.state === 'failed' || latest?.state === 'expired';
}

function scansSwitch(context: ExportCardContext): TemplateResult {
    const { locale, view } = context;
    const label = contentText(locale, 'adminContent.export.rasters', { size: sizeText(locale, view.scans.bytes) });
    return html`<div class="switch-row">
            <span aria-hidden="true">${label}</span>
            <hcm-switch
                .checked=${view.includeScans}
                ?disabled=${context.readOnly}
                label=${label}
                @hcm-change=${(event: Event) => {
                    context.intents?.setExportScans((event as CustomEvent<{ checked: boolean }>).detail.checked);
                }}
            ></hcm-switch>
        </div>
        <p class="note">${contentText(locale, 'adminContent.export.rastersHelp')}</p>`;
}

/**
 * Export (or Export again after a failed or expired one), with the scans' switch when the city has any; beside a ready
 * export's Download, the page's one filled button, Export is tonal.
 */
function startControls(context: ExportCardContext): TemplateResult {
    const { locale, view } = context;
    const again = endedBadly(view.latest);
    return html`${when(view.scans.count > 0, () => scansSwitch(context))}
        <div class="actions">
            <hcm-button
                variant=${view.latest?.state === 'ready' ? 'tonal' : 'filled'}
                ?disabled=${context.readOnly || view.starting}
                @click=${(event: Event) => {
                    focusHeading(event);
                    void context.intents?.startExport();
                }}
                >${contentText(locale, again ? 'adminContent.export.again' : 'adminContent.export.start')}</hcm-button
            >
        </div>`;
}

/** Download: the signed address of the ready export, saved at once (a refusal is the snackbar's). */
async function download(context: ExportCardContext): Promise<void> {
    const target = await context.intents?.downloadExport();
    if (target !== undefined && target !== null) {
        context.save(target);
    }
}

function downloadControls(context: ExportCardContext): TemplateResult {
    const { locale, view } = context;
    return html`<div class="actions">
        <hcm-button
            variant="filled"
            icon="download"
            ?disabled=${context.readOnly || view.downloading}
            @click=${() => {
                void download(context);
            }}
            >${contentText(locale, 'adminContent.export.download')}</hcm-button
        >
    </div>`;
}

/** The owner's actions: Download for a ready export, Export once nothing is under way. */
function ownerControls(context: ExportCardContext): TemplateResult {
    const { latest } = context.view;
    if (underWay(latest)) {
        return EMPTY;
    }
    return html`${when(latest?.state === 'ready', () => downloadControls(context))} ${startControls(context)}`;
}

/** What the section shows below its intro once every listener answered. */
function body(context: ExportCardContext): TemplateResult {
    const { locale, view } = context;
    if (!view.published) {
        return html`<p class="note" role="status" data-state="unpublished">${contentText(locale, 'adminContent.export.unpublished')}</p>`;
    }
    if (!view.owner) {
        return html`<p class="note" data-state="owner-only">${contentText(locale, 'adminContent.export.ownerOnly')}</p>
            ${latestBody(context, view.latest)}`;
    }
    return html`${latestBody(context, view.latest)} ${ownerControls(context)}`;
}

/** The section: its heading and intro, then loading, an error with Try again, or the export. */
export function exportCard(context: ExportCardContext): TemplateResult {
    const { locale, view } = context;
    const head = html`<h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.export.title')}</h2>
        <p class="note">${contentText(locale, 'adminContent.export.intro')}</p>`;
    if (view.status === 'error') {
        return html`${head}${errorTemplate(locale, view.failure, () => context.intents?.retryExport())}`;
    }
    if (view.status === 'loading') {
        return html`${head}${loadingTemplate(locale)}`;
    }
    return html`${head}
        <p class="visually-hidden" role="status" data-export-live>${view.published ? news(context) : ''}</p>
        <section class="group export" data-section="export">${body(context)}</section>`;
}
