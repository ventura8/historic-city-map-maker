/**
 * The georeferencer's controls (`docs/research/M3-interfaces.md` §10.4): the fit's errors (or why there is no fit), that
 * they are a refit of edited pairs (M15), and the warning over the city's threshold, the transform as native radios (one without enough pairs disabled with the
 * count missing), the tools (Add pairs, Add at the centres, Save, Discard) with the half pair's hint, and the warped
 * preview's switch and opacity.
 */
import { GEOREF_TRANSFORMS, type GeorefTransform, type UiLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { numberText, pluralOf } from '../imagery/imagery-text.js';
import { when, withValue } from '../imagery/when.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { GeorefIntentsPort, GeorefViewState } from './georef-port.js';
import type { ResidualSort } from './residual-table.js';

export interface GeorefContext {
    readonly locale: UiLocale;
    readonly view: GeorefViewState;
    readonly intents: GeorefIntentsPort | null;
    /** Nothing writes: the version takes no points, or the admin's access was removed. */
    readonly locked: boolean;
    readonly compact: boolean;
    readonly mapCss: string;
    readonly sort: ResidualSort;
    readonly setSort: (sort: ResidualSort) => void;
    /** The keyboard's way: a pair at the scan's crosshair and the map's centre. */
    readonly addAtCentres: () => void;
    /** M22 (§13.2): the scan and the map fill the window, the actions above them. */
    readonly full: boolean;
    /** The browser refused its full screen: the page fills the window instead. */
    readonly fullRefused?: boolean;
    readonly toggleFull: () => void;
}

function refusal(context: GeorefContext, reason: 'too-few' | 'degenerate'): TemplateResult {
    const { locale, view } = context;
    const missing = view.fit.missing[view.transform];
    const key =
        reason === 'degenerate' ? 'adminContent.georef.degenerate' : (`adminContent.georef.tooFew.${pluralOf(locale, missing)}` as const);
    return html`<p class="alert" role="alert" data-state=${reason}>
        <hcm-icon name="error"></hcm-icon><span>${contentText(locale, key, { missing: String(missing) })}</span>
    </p>`;
}

function checks(locale: UiLocale, fit: GeorefViewState['fit']): string {
    const rmse = fit.checkpointRmseM;
    return rmse === null
        ? contentText(locale, 'adminContent.georef.noChecks')
        : contentText(locale, 'adminContent.georef.checkpoint', { rmse: numberText(locale, rmse), count: String(fit.checkpointCount) });
}

function rmseWarning(context: GeorefContext): TemplateResult {
    const { locale, view } = context;
    const rmse = view.fit.overThreshold ? view.fit.checkpointRmseM : null;
    return withValue(
        rmse,
        (value) =>
            html`<p class="alert" role="alert" data-state="rmse-over">
                <hcm-icon name="info"></hcm-icon
                ><span
                    >${contentText(locale, 'adminContent.georef.rmseOver', { rmse: numberText(locale, value), threshold: numberText(locale, view.thresholdM) })}</span
                >
            </p>`,
    );
}

/** M15: the pairs were edited, so every figure and the preview are a refit that Save makes the version's map. */
function refitNote(locale: UiLocale, fit: GeorefViewState['fit']): TemplateResult {
    return when(
        fit.refitted,
        () =>
            html`<p class="note" role="status" data-state="refitted">
                <hcm-icon name="info"></hcm-icon><span>${contentText(locale, 'adminContent.georef.refitted')}</span>
            </p>`,
    );
}

export function summary(context: GeorefContext): TemplateResult {
    const { locale, view } = context;
    const fit = view.fit;
    if (fit.refusal !== null) {
        return refusal(context, fit.refusal);
    }
    return html`<p class="summary" role="status">
            <span>${contentText(locale, 'adminContent.georef.fit', { rmse: numberText(locale, Number(fit.fitRmseM)) })}</span>
            <span>${checks(locale, fit)}</span>
        </p>
        ${refitNote(locale, fit)} ${rmseWarning(context)}`;
}

function transformOption(context: GeorefContext, kind: GeorefTransform): TemplateResult {
    const { locale, view, intents } = context;
    const missing = view.fit.missing[kind];
    const note = when(
        missing > 0,
        () =>
            html`<span class="note"
                >${contentText(locale, `adminContent.georef.missing.${pluralOf(locale, missing)}`, { missing: String(missing) })}</span
            >`,
    );
    return html`<label ?data-missing=${missing > 0}>
        <input
            class="touch-target"
            type="radio"
            name="transform"
            .checked=${view.transform === kind}
            ?disabled=${missing > 0 || context.locked}
            @change=${() => {
                intents?.setTransform(kind);
            }}
        />
        <span>${contentText(locale, `adminContent.georef.transform.${kind}`)}</span>
        ${note}
    </label>`;
}

export function transforms(context: GeorefContext): TemplateResult {
    return html`<fieldset class="transforms">
        <legend>${contentText(context.locale, 'adminContent.georef.transform')}</legend>
        ${GEOREF_TRANSFORMS.map((kind) => transformOption(context, kind))}
    </fieldset>`;
}

const GUIDE_STEPS = [
    'adminContent.georef.guide.s1',
    'adminContent.georef.guide.s2',
    'adminContent.georef.guide.s3',
    'adminContent.georef.guide.s4',
    'adminContent.georef.guide.s5',
] as const;

/** How to place a map, step by step: open while the version has no pairs yet, a click away after. */
export function guide(context: GeorefContext): TemplateResult {
    const { locale, view } = context;
    return html`<details class="guide" ?open=${view.pairs.length === 0}>
        <summary>${contentText(locale, 'adminContent.georef.guide.title')}</summary>
        <ol>
            ${GUIDE_STEPS.map((step) => html`<li>${contentText(locale, step)}</li>`)}
        </ol>
        <p>${contentText(locale, 'adminContent.georef.guide.tip')}</p>
    </details>`;
}

/** The hint under the tools: the half pair's next click (and the ghost's dashed ring, when there is one), or how to add a pair. */
function halfText(locale: UiLocale, view: GeorefViewState): string {
    if (view.half !== null) {
        const end = 'pixel' in view.half ? 'halfOnScan' : 'halfOnMap';
        return contentText(locale, `adminContent.georef.${end}${view.ghost === null ? '' : 'Ghost'}`);
    }
    return view.adding ? contentText(locale, 'adminContent.georef.addingHint') : '';
}

/** Something to save: the pairs changed, or a scan that waits for points has its first ones (the corner guess's). */
function savable(view: GeorefViewState): boolean {
    return view.dirty || view.version?.state === 'needs_gcps';
}

/** Save is off while there is nothing to save, a save runs, the fit is refused or nothing may be written. */
function saveOff(context: GeorefContext): boolean {
    const { view } = context;
    return context.locked || !savable(view) || view.saving || view.fit.refusal !== null;
}

/** M16: a published version or one waiting for approval may have new points snapped (`docs/research/M16-recalibrate.md`). */
const SNAP_STATES: ReadonlySet<string | null> = new Set(['published', 'awaiting_approval']);

function stateOf(view: GeorefContext['view']): string | null {
    return view.version?.state ?? null;
}

function snapButton(context: GeorefContext): TemplateResult {
    const { view, intents } = context;
    const shown = SNAP_STATES.has(stateOf(view));
    const off = context.locked || !view.dirty || view.saving;
    return shown
        ? html`<hcm-button variant="tonal" icon="tune" ?disabled=${off} @click=${() => void intents?.snap()}
              >${contentText(context.locale, 'adminContent.georef.snap')}</hcm-button
          >`
        : html``;
}

function saveButtons(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    return html`<hcm-button variant="filled" icon="check" ?disabled=${saveOff(context)} @click=${() => void intents?.save()}
            >${contentText(locale, view.saving ? 'adminContent.georef.saving' : 'adminContent.georef.save')}</hcm-button
        >
        ${snapButton(context)}
        <hcm-button
            variant="text"
            icon="undo"
            ?disabled=${!view.canUndo || view.saving}
            @click=${() => {
                intents?.undo();
            }}
            >${contentText(locale, 'adminContent.georef.undo')}</hcm-button
        >
        <hcm-button
            variant="text"
            ?disabled=${!view.dirty || view.saving}
            @click=${() => {
                intents?.discard();
            }}
            >${contentText(locale, 'adminContent.common.discard')}</hcm-button
        >`;
}

/**
 * The refusal's banner sits in a slot that keeps its height whether or not a banner shows: a banner that came and went used to
 * push the panes down or up between a pointer's press and release, and the point landed where the pane had moved (~290 m off).
 */
function failure(context: GeorefContext): TemplateResult {
    return html`<div class="alert-slot" data-state="alert-slot">
        ${withValue(
            context.view.refusal,
            (notice) =>
                html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(context.locale, notice)}</span></p>`,
        )}
    </div>`;
}

export function tools(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    return html`<div class="actions">
            <hcm-button
                variant="tonal"
                icon="add_location_alt"
                .pressed=${view.adding}
                ?disabled=${context.locked}
                @click=${() => {
                    intents?.setAdding(!view.adding);
                }}
                >${contentText(locale, 'adminContent.georef.addPairs')}</hcm-button
            >
            <hcm-button variant="outlined" icon="my_location" ?disabled=${context.locked} @click=${context.addAtCentres}
                >${contentText(locale, 'adminContent.georef.addAtCentres')}</hcm-button
            >
            <hcm-button
                variant="outlined"
                icon=${context.full ? 'fullscreen_exit' : 'fullscreen'}
                .pressed=${context.full}
                data-action="full-screen"
                @click=${context.toggleFull}
                >${contentText(locale, context.full ? 'adminContent.georef.leaveFullScreen' : 'adminContent.georef.fullScreen')}</hcm-button
            >
            ${saveButtons(context)}
        </div>
        <p class="note" role="status">${halfText(locale, view)}</p>
        ${
            context.fullRefused === true
                ? html`<p class="note" data-state="full-refused">${contentText(locale, 'adminContent.georef.fullScreenRefused')}</p>`
                : nothing
        }
        ${failure(context)}`;
}

export function previewControls(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    const percent = Math.round(view.previewOpacity * 100);
    const label = contentText(locale, 'adminContent.georef.previewOpacity');
    const valueText = contentText(locale, 'adminContent.layers.percent', { percent: String(percent) });
    const set = (event: Event): void => {
        intents?.setPreviewOpacity((event as CustomEvent<{ value: number }>).detail.value);
    };
    const toggle = (event: Event): void => {
        intents?.togglePreview((event as CustomEvent<{ checked: boolean }>).detail.checked);
    };
    return html`<div class="switch-row">
            <span aria-hidden="true">${contentText(locale, 'adminContent.georef.preview')}</span>
            <hcm-switch
                .checked=${view.showPreview}
                label=${contentText(locale, 'adminContent.georef.preview')}
                @hcm-change=${toggle}
            ></hcm-switch>
        </div>
        <div class="slider-row">
            <span aria-hidden="true">${label}</span>
            <span aria-hidden="true">${valueText}</span>
            <hcm-slider
                min="0"
                max="100"
                step="1"
                .value=${percent}
                label=${label}
                value-text=${valueText}
                ?disabled=${!view.showPreview}
                @hcm-input=${set}
                @hcm-change=${set}
            ></hcm-slider>
        </div>`;
}
