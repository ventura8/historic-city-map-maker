/**
 * `<hcm-layer-crop>`: the layer editor's Crop (`docs/research/M3-interfaces.md` §10.5; CR-M3-7), in the lazy
 * `layer-geometry` chunk. It says what to do on the map (a click per corner, the first corner again to finish), offers
 * the keyboard's way (pan the map with the arrow keys, then add a corner at its centre), Draw again, Save the crop
 * (`imagery.crop`) once the polygon has three corners, and Cancel; a refusal says why. Text only.
 */
import type { UiLocale } from '@hcm/shared';
import { css, html, LitElement, type TemplateResult } from 'lit';

import { editingStyles } from '../../editing/editing-styles.js';
import { EMPTY } from '../../shell/empty.js';
import { contentText, noticeOf } from '../../shell/text.js';
import type { CropActionsPort, CropPhasePort, CropStatePort } from './crop-port.js';

export const HCM_LAYER_CROP_TAG = 'hcm-layer-crop';

type CropHintKey =
    | 'adminContent.imagery.layer.cropLoading'
    | 'adminContent.imagery.layer.cropDrawing'
    | 'adminContent.imagery.layer.cropDrawn'
    | 'adminContent.imagery.layer.cropSaving'
    | 'adminContent.imagery.layer.cropNoMap';

/** What each phase tells the admin. */
const HINTS: Readonly<Record<CropPhasePort, CropHintKey>> = {
    loading: 'adminContent.imagery.layer.cropLoading',
    drawing: 'adminContent.imagery.layer.cropDrawing',
    drawn: 'adminContent.imagery.layer.cropDrawn',
    saving: 'adminContent.imagery.layer.cropSaving',
    'no-map': 'adminContent.imagery.layer.cropNoMap',
};

const nothing = (): void => undefined;

/** Before the page hands its intents over. */
const NO_ACTIONS: CropActionsPort = { redraw: nothing, addCorner: nothing, save: nothing, close: nothing };

/** The phases with drawing tools on the map. */
function drawable(phase: CropPhasePort): boolean {
    return phase === 'drawing' || phase === 'drawn';
}

class HcmLayerCrop extends LitElement {
    static override readonly properties = {
        locale: { type: String },
        view: { attribute: false },
        actions: { attribute: false },
        readOnly: { type: Boolean, attribute: 'read-only' },
    };

    static override readonly styles = [
        ...editingStyles,
        css`
            :host {
                display: block;
            }

            .crop {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: 12px;
                border-radius: var(--md-sys-shape-corner-medium, 12px);
                background: var(--md-sys-color-surface-container-low, Canvas);
            }
        `,
    ];

    declare locale: UiLocale;
    declare view: CropStatePort | null;
    declare actions: CropActionsPort;
    declare readOnly: boolean;

    constructor() {
        super();
        this.locale = 'ro';
        this.view = null;
        this.actions = NO_ACTIONS;
        this.readOnly = false;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const { locale } = this;
        return html`<div class="crop" data-phase=${view.phase}>
            <h4>${contentText(locale, 'adminContent.imagery.layer.cropTitle')}</h4>
            <p class="note" role="status">${contentText(locale, HINTS[view.phase], { count: String(view.vertices) })}</p>
            ${this.#refusal(view)} ${this.#buttons(view)}
        </div>`;
    }

    #refusal(view: CropStatePort): TemplateResult {
        return view.refusal === null
            ? EMPTY
            : html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(this.locale, view.refusal)}</span></p>`;
    }

    #buttons(view: CropStatePort): TemplateResult {
        const { locale, actions } = this;
        const off = !drawable(view.phase) || this.readOnly;
        return html`<div class="actions">
            <hcm-button variant="filled" icon="crop" ?disabled=${view.phase !== 'drawn' || this.readOnly} @click=${actions.save}
                >${contentText(locale, 'adminContent.imagery.layer.cropSave')}</hcm-button
            >
            <hcm-button variant="tonal" icon="add_location_alt" ?disabled=${off} @click=${actions.addCorner}
                >${contentText(locale, 'adminContent.imagery.layer.cropCorner')}</hcm-button
            >
            <hcm-button variant="outlined" icon="undo" ?disabled=${off} @click=${actions.redraw}
                >${contentText(locale, 'adminContent.imagery.layer.cropRedraw')}</hcm-button
            >
            <hcm-button variant="text" icon="close" @click=${actions.close}
                >${contentText(locale, 'adminContent.common.cancel')}</hcm-button
            >
        </div>`;
    }
}

/** Registers `<hcm-layer-crop>` (its kit elements are the editing kit's, already registered with the layers page). */
export function defineHcmLayerCrop(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_LAYER_CROP_TAG) === undefined) {
        registry.define(HCM_LAYER_CROP_TAG, HcmLayerCrop);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-layer-crop': HcmLayerCrop;
    }
}
