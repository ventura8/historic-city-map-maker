/**
 * The layer editor's pane (`docs/research/M2c-interfaces.md` §8.2, §8.3; behaviours A35, A36, A38): the save row, the
 * conflict and gone banners, the texts in both languages, the attribution, year and date, Shown at start and Published,
 * the default opacity and the four image adjustments with Reset (every slider previews live; Save writes), the image and
 * geometry tools of the raster pipeline (M3, `./geometry-group.ts`), and Delete with its confirmation. On a revoked admin's read-only page
 * (`DECISIONS-for-review.md` §42d) every field is read-only and every control that writes is off.
 */
import {
    ADJUSTMENT_SLIDERS,
    LAYER_DELETE_GRACE_DAYS,
    signedPercent,
    sliderFromAdjustment,
    withAdjustment,
    type LayerAdjustmentName,
    type LayerAdjustments,
    type LayerDoc,
    type UiLocale,
} from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import type { AssistViewPort } from '../assist/assist-port.js';
import { draftAssist } from '../assist/assist-parts.js';
import type { WhoPort } from '../editing/conflict.js';
import { errorTemplate, loadingTemplate, reconnectingStatus } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import { conflictBanner, field, issueAt, saveBar, saveStateOf, sliderRow, type FieldSpec } from './form-parts.js';
import type { CropStatePort } from './geometry/crop-port.js';
import { geometryGroup } from './geometry-group.js';
import {
    labelOf,
    type LayerDeletionPort,
    type LayerEditorPort,
    type LayersIntentsPort,
    type LayerTextFieldPort,
    type MapStatusPort,
} from './layers-port.js';

export interface EditorContext {
    readonly locale: UiLocale;
    readonly intents: LayersIntentsPort | null;
    /** Says a settled change in the page's polite region. */
    readonly announce: (text: string) => void;
    /** The address of the layer list (the not-found state links back to it). */
    readonly listHref: string;
    /** The layer was deleted: the page goes back to the list. */
    readonly deleted: () => void;
    /** The page's map: its state, and mapbox-gl.css's address ('' in tests: no network). */
    readonly map: { readonly status: MapStatusPort; readonly css: string };
    /** A revoked admin's page: nothing writes. */
    readonly readOnly: boolean;
    /** Who reads the page and the admins' names: the conflict banner names who saved. */
    readonly who: WhoPort;
    /** M3 (CR-M3-7): the open Crop, or null. */
    readonly crop: CropStatePort | null;
    /** M4 (CR-M4-4): the translation drafts of the open layer (null: no draft buttons). */
    readonly assist: AssistViewPort | null;
}

/** The page's map, with the open layer drawn as saved and the draft's look previewed over it. */
function mapBox(context: EditorContext): TemplateResult {
    const { intents } = context;
    return html`<hcm-admin-map
        class="layer-map"
        .status=${context.map.status}
        .locale=${context.locale}
        .cssUrl=${context.map.css}
        @hcm-map-host=${(event: Event) => {
            intents?.attachMap((event as CustomEvent<{ container: HTMLElement }>).detail.container);
        }}
        @hcm-zoom=${(event: Event) => {
            intents?.zoomBy((event as CustomEvent<{ delta: number }>).detail.delta);
        }}
    ></hcm-admin-map>`;
}

interface TextPair {
    /** The pair's document field, also the field its draft fills. */
    readonly field: 'label' | 'description';
    readonly ro: { readonly name: LayerTextFieldPort; readonly key: Parameters<typeof contentText>[1] };
    readonly en: { readonly name: LayerTextFieldPort; readonly key: Parameters<typeof contentText>[1] };
    readonly multiline: boolean;
}

const TEXT_PAIRS: readonly TextPair[] = [
    {
        field: 'label',
        ro: { name: 'label.ro', key: 'adminContent.layers.labelRo' },
        en: { name: 'label.en', key: 'adminContent.layers.labelEn' },
        multiline: false,
    },
    {
        field: 'description',
        ro: { name: 'description.ro', key: 'adminContent.layers.descriptionRo' },
        en: { name: 'description.en', key: 'adminContent.layers.descriptionEn' },
        multiline: true,
    },
];

/** The text a field shows: its value in the draft ('' when absent). */
function textOf(layer: LayerDoc, name: LayerTextFieldPort): string {
    const values: Readonly<Record<LayerTextFieldPort, string | number | undefined>> = {
        'label.ro': layer.label.ro,
        'label.en': layer.label.en,
        'description.ro': layer.description?.ro,
        'description.en': layer.description?.en,
        attribution: layer.attribution,
        year: Number.isNaN(layer.year) ? undefined : layer.year,
        date: layer.date,
    };
    const value = values[name];
    return value === undefined ? '' : String(value);
}

function fieldSpec(
    context: EditorContext,
    editor: LayerEditorPort,
    layer: LayerDoc,
    spec: Omit<FieldSpec, 'value' | 'issue' | 'onInput' | 'id'> & { readonly name: LayerTextFieldPort },
): FieldSpec {
    const { name, ...rest } = spec;
    return {
        ...rest,
        id: `layer-${name.replace('.', '-')}`,
        value: textOf(layer, name),
        issue: issueAt(editor.draft.issues, name),
        readOnly: context.readOnly,
        onInput: (text) => {
            context.intents?.setField(name, text);
        },
    };
}

/** M4 (CR-M4-4): the draft button of a pair, when the page has assists and intents. */
function pairDraft(context: EditorContext, layer: LayerDoc, pair: TextPair): TemplateResult {
    const { assist, intents } = context;
    if (assist === null || intents === null) {
        return EMPTY;
    }
    const text = { ro: textOf(layer, pair.ro.name), en: textOf(layer, pair.en.name) };
    return draftAssist({ locale: context.locale, view: assist, actions: intents, field: pair.field, text, readOnly: context.readOnly });
}

function textsGroup(context: EditorContext, editor: LayerEditorPort, layer: LayerDoc): TemplateResult {
    const { locale } = context;
    const text = (name: LayerTextFieldPort, key: Parameters<typeof contentText>[1], extra: Partial<FieldSpec> = {}): TemplateResult =>
        field(locale, fieldSpec(context, editor, layer, { name, label: contentText(locale, key), ...extra }));
    const pair = (spec: TextPair): TemplateResult => {
        const extra = spec.multiline ? { multiline: true } : {};
        return html`<div class="fields pairs">${text(spec.ro.name, spec.ro.key, extra)} ${text(spec.en.name, spec.en.key, extra)}</div>
            ${pairDraft(context, layer, spec)}`;
    };
    return html`<section class="group">
        <h3>${contentText(locale, 'adminContent.layers.texts')}</h3>
        <p class="note">${contentText(locale, 'adminContent.layers.englishFallback')}</p>
        ${TEXT_PAIRS.map(pair)}
        <div class="fields">
            ${text('attribution', 'adminContent.layers.attribution', { help: contentText(locale, 'adminContent.layers.attributionHelp') })}
            ${text('year', 'adminContent.layers.year', { inputMode: 'numeric', required: true })}
            ${text('date', 'adminContent.layers.date', { type: 'date' })}
        </div>
    </section>`;
}

function switchRow(
    label: string,
    state: { readonly checked: boolean; readonly off: boolean },
    change: (checked: boolean) => void,
): TemplateResult {
    return html`<div class="switch-row">
        <span aria-hidden="true">${label}</span>
        <hcm-switch
            .checked=${state.checked}
            ?disabled=${state.off}
            label=${label}
            @hcm-change=${(event: Event) => {
                change((event as CustomEvent<{ checked: boolean }>).detail.checked);
            }}
        ></hcm-switch>
    </div>`;
}

function percentOf(opacity: number): number {
    return Math.round(opacity * 100);
}

function displayGroup(context: EditorContext, editor: LayerEditorPort, layer: LayerDoc): TemplateResult {
    const { locale, intents } = context;
    const percent = (value: number): string => contentText(locale, 'adminContent.layers.percent', { percent: String(value) });
    return html`<section class="group">
        <h3>${contentText(locale, 'adminContent.layers.display')}</h3>
        ${switchRow(
            contentText(locale, 'adminContent.layers.shownAtStart'),
            { checked: layer.defaultVisible, off: context.readOnly },
            (checked) => {
                intents?.edit({ defaultVisible: checked });
            },
        )}
        ${switchRow(
            contentText(locale, 'adminContent.layers.publishedSwitch'),
            { checked: layer.published, off: context.readOnly },
            (checked) => {
                intents?.edit({ published: checked });
            },
        )}
        ${
            layer.status === 'ready' && issueAt(editor.draft.issues, 'published') === null
                ? nothing
                : html`<p class="note">${contentText(locale, 'adminContent.layers.notReady')}</p>`
        }
        ${sliderRow({
            label: contentText(locale, 'adminContent.layers.opacity'),
            min: 0,
            max: 100,
            value: percentOf(layer.opacity),
            valueText: percent(percentOf(layer.opacity)),
            disabled: context.readOnly,
            onValue: (value) => {
                intents?.setOpacity(value);
            },
            onSettled: (value) => {
                context.announce(contentText(locale, 'adminContent.layers.opacityChanged', { percent: String(value) }));
            },
        })}
    </section>`;
}

/** Where the store keeps a slider moved to `position`: a level stops at the other one (what is said is what is kept). */
function keptPosition(adjustments: LayerAdjustments, name: LayerAdjustmentName, position: number): number {
    return sliderFromAdjustment(name, withAdjustment(adjustments, name, position)[name]);
}

function adjustmentsGroup(context: EditorContext, layer: LayerDoc): TemplateResult {
    const { locale, intents } = context;
    const adjustments = layer.adjustments ?? {};
    return html`<section class="group">
        <h3>${contentText(locale, 'adminContent.layers.adjustments')}</h3>
        <p class="note">${contentText(locale, 'adminContent.layers.adjustmentsNote')}</p>
        ${ADJUSTMENT_SLIDERS.map((slider) => {
            const value = sliderFromAdjustment(slider.name, adjustments[slider.name]);
            const label = contentText(locale, `adminContent.layers.adjust.${slider.name}`);
            const valueText = contentText(locale, 'adminContent.layers.adjustValue', { value: signedPercent(slider.name, value) });
            return sliderRow({
                ...{ label, min: slider.min, max: slider.max, value, valueText, disabled: context.readOnly },
                onValue: (next) => {
                    intents?.setAdjustment(slider.name, next);
                },
                onSettled: (next) => {
                    const value = signedPercent(slider.name, keptPosition(adjustments, slider.name, next));
                    context.announce(contentText(locale, 'adminContent.layers.adjusted', { name: label, value }));
                },
            });
        })}
        <div class="actions">
            <hcm-button variant="outlined" icon="restore" ?disabled=${context.readOnly} @click=${() => intents?.resetAdjustments()}
                >${contentText(locale, 'adminContent.layers.reset')}</hcm-button
            >
        </div>
    </section>`;
}

/**
 * What deleting leaves behind: a linked layer's tileset stays at Mapbox; the pipeline's tiles go after the grace, its own archives in the
 * public bucket (M12) or its Mapbox tileset. An own-tiles layer has no `mapbox` block, and was told its tileset stayed (2026-11-07).
 */
function lastingKey(
    layer: LayerDoc,
): 'adminContent.layers.deleteBodyLinked' | 'adminContent.layers.deleteOwnTiles' | 'adminContent.layers.deleteTiles' {
    if (layer.mapbox === undefined && layer.currentVersion === undefined) {
        return 'adminContent.layers.deleteBodyLinked';
    }
    return layer.source.type === 'pmtiles' ? 'adminContent.layers.deleteOwnTiles' : 'adminContent.layers.deleteTiles';
}

function deleteBody(locale: UiLocale, layer: LayerDoc): string {
    const lasting = contentText(locale, lastingKey(layer), { days: String(LAYER_DELETE_GRACE_DAYS) });
    return `${contentText(locale, 'adminContent.layers.deleteBody')} ${lasting}`;
}

async function confirmDelete(context: EditorContext): Promise<void> {
    if ((await context.intents?.confirmDelete()) === true) {
        context.deleted();
    }
}

function deleteControls(context: EditorContext, layer: LayerDoc, deletion: LayerDeletionPort): TemplateResult {
    const { locale, intents } = context;
    const name = labelOf(layer.label, locale);
    return html`<div class="actions">
            <hcm-button variant="outlined" icon="delete" ?disabled=${context.readOnly} @click=${() => intents?.askDelete()}
                >${contentText(locale, deletion.phase === 'running' ? 'adminContent.layers.deleting' : 'adminContent.layers.delete')}</hcm-button
            >
        </div>
        <hcm-confirm-dialog
            destructive
            .open=${deletion.phase === 'confirm'}
            .headline=${contentText(locale, 'adminContent.layers.deleteConfirm', { name })}
            .body=${deleteBody(locale, layer)}
            .confirmLabel=${contentText(locale, 'adminContent.layers.delete')}
            .cancelLabel=${contentText(locale, 'adminContent.layers.keep')}
            @hcm-confirm=${() => {
                void confirmDelete(context);
            }}
            @hcm-cancel=${() => intents?.cancelDelete()}
        ></hcm-confirm-dialog>`;
}

function editorBody(context: EditorContext, editor: LayerEditorPort, layer: LayerDoc, deletion: LayerDeletionPort): TemplateResult {
    const { locale, intents } = context;
    const draft = editor.draft;
    const handlers = { save: () => void intents?.save(), discard: () => intents?.discard() };
    const texts = {
        saved: 'adminContent.layers.state.saved',
        unsaved: 'adminContent.layers.state.unsaved',
        saving: 'adminContent.layers.state.saving',
    } as const;
    return html`<div class="pane">
        <h2 tabindex="-1" data-detail-heading>${labelOf(layer.label, locale)}</h2>
        ${saveBar(locale, texts, { ...saveStateOf({ ...draft, dirty: draft.dirty.length > 0 }), readOnly: context.readOnly }, handlers)}
        ${reconnectingStatus(locale, editor.doc.reconnecting)}
        ${conflictBanner(
            locale,
            {
                conflict: 'adminContent.layers.conflict',
                keepMine: 'adminContent.layers.keepMine',
                takeTheirs: 'adminContent.layers.takeTheirs',
            },
            draft.conflict,
            { keepMine: () => intents?.keepMine(), takeTheirs: () => intents?.takeTheirs(), who: context.who, readOnly: context.readOnly },
        )}
        ${draft.gone ? html`<p class="alert" role="alert"><span>${contentText(locale, 'adminContent.layers.gone')}</span></p>` : nothing}
        ${mapBox(context)} ${textsGroup(context, editor, layer)} ${displayGroup(context, editor, layer)} ${adjustmentsGroup(context, layer)}
        ${geometryGroup(context, editor.id, layer)} ${draft.gone ? nothing : deleteControls(context, layer, deletion)}
    </div>`;
}

function notFound(context: EditorContext): TemplateResult {
    return html`<div class="pane">
        <h2 tabindex="-1" data-detail-heading>${contentText(context.locale, 'adminContent.layers.notFound')}</h2>
        <p><a href=${context.listHref}>${contentText(context.locale, 'adminContent.layers.backToList')}</a></p>
    </div>`;
}

/** The editor of the open layer: loading, its error, not found, or the editor itself. */
export function layerEditor(context: EditorContext, editor: LayerEditorPort, deletion: LayerDeletionPort): TemplateResult {
    if (editor.doc.status === 'error') {
        return errorTemplate(context.locale, editor.doc.failure, () => context.intents?.retry());
    }
    if (editor.notFound) {
        return notFound(context);
    }
    const layer = editor.draft.value;
    return layer === null ? loadingTemplate(context.locale) : editorBody(context, editor, layer, deletion);
}
