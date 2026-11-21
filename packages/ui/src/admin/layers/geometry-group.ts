/**
 * The layer editor's Image and geometry group (`docs/research/M3-interfaces.md` §10.5; CR-M3-7): the chip of a newer
 * version under way (its page), **Replace the image** (the Imagery area's upload for this layer), **Edit points**
 * (the georeferencer on the current version; a linked layer has no scan, and says so), and **Crop**, whose tool comes in
 * the lazy `layer-geometry` chunk (`<hcm-layer-crop>`) on the first click. M8 (`docs/research/M8-join-interfaces.md` §9): a joined
 * layer has neither: it has no scan of its own, so it says to delete it and join again. Batch 4 (§5.1): a frame's layer a published join
 * of its date replaced says so, with the way to that join.
 */
import type { LayerDoc, UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { when, withValue } from '../imagery/when.js';
import { contentText, noticeText } from '../shell/text.js';
import type { CropStatePort } from './geometry/crop-port.js';
import type { LayersIntentsPort } from './layers-port.js';

export interface GeometryContext {
    readonly locale: UiLocale;
    readonly intents: LayersIntentsPort | null;
    readonly readOnly: boolean;
    /** The open Crop, or null. */
    readonly crop: CropStatePort | null;
}

function pendingChip(locale: UiLocale, layer: LayerDoc): TemplateResult {
    return withValue(
        layer.pendingVersion,
        (version) =>
            html`<p>
                <a class="tag touch-target" data-tone="wait" href=${['#/imagery/version', version].join('/')}
                    >${contentText(locale, 'adminContent.imagery.layer.pending')}</a
                >
            </p>`,
    );
}

/** A layer the join of its date replaced: off the public map, kept; the link opens that join. */
function retiredChip(locale: UiLocale, layer: LayerDoc): TemplateResult {
    return withValue(
        layer.retired,
        ({ by }) =>
            html`<p class="note" data-state="retired-layer">
                <a class="external" href=${['#/imagery/version', by].join('/')}
                    >${contentText(locale, 'adminContent.imagery.layer.retired')}</a
                >
            </p>`,
    );
}

/** A layer several frames were joined into. */
function isJoined(layer: LayerDoc): boolean {
    return layer.provenance?.usgsParts !== undefined;
}

function georefItem(locale: UiLocale, layer: LayerDoc): TemplateResult {
    if (isJoined(layer)) {
        return html`<li class="note" data-state="joined-layer">${contentText(locale, 'adminContent.imagery.layer.joined')}</li>`;
    }
    const version = layer.currentVersion;
    return version === undefined
        ? html`<li class="note" data-state="no-scan">${noticeText(locale, 'apiError.imagery.noScan')}</li>`
        : html`<li>
              <a class="external" href=${['#/georef', version].join('/')}>${contentText(locale, 'adminContent.imagery.layer.regeoref')}</a>
          </li>`;
}

function cropTool(context: GeometryContext, crop: CropStatePort): TemplateResult {
    const { intents } = context;
    const actions = {
        redraw: () => intents?.redrawCrop(),
        addCorner: () => intents?.addCropCorner(),
        save: () => void intents?.saveCrop(),
        close: () => intents?.closeCrop(),
    };
    return html`<hcm-layer-crop
        .locale=${context.locale}
        .view=${crop}
        .actions=${actions}
        ?read-only=${context.readOnly}
    ></hcm-layer-crop>`;
}

function cropButton(context: GeometryContext): TemplateResult {
    return html`<div class="actions">
        <hcm-button variant="outlined" icon="crop" ?disabled=${context.readOnly} @click=${() => void context.intents?.crop()}
            >${contentText(context.locale, 'adminContent.imagery.layer.crop')}</hcm-button
        >
    </div>`;
}

/** Crop for a layer with a scan: the tool while it is open, else its button. */
function cropControls(context: GeometryContext, layer: LayerDoc): TemplateResult {
    const crop = context.crop;
    return when(layer.currentVersion !== undefined && !isJoined(layer), () =>
        crop === null ? cropButton(context) : cropTool(context, crop),
    );
}

export function geometryGroup(context: GeometryContext, id: string, layer: LayerDoc): TemplateResult {
    const { locale } = context;
    return html`<section class="group" data-group="geometry">
        <h3>${contentText(locale, 'adminContent.layers.geometry')}</h3>
        <p class="note">${contentText(locale, 'adminContent.layers.geometryNote')}</p>
        ${retiredChip(locale, layer)} ${pendingChip(locale, layer)}
        <ul class="links">
            <li>
                <a class="external" href=${['#/imagery/replace', id].join('/')}
                    >${contentText(locale, 'adminContent.imagery.layer.replace')}</a
                >
            </li>
            ${georefItem(locale, layer)}
        </ul>
        ${cropControls(context, layer)}
    </section>`;
}
