/**
 * `<hcm-draw-toolbar>`: the drawing tools of the admin map (docs/research/M2c-interfaces.md §4.6): Draw (the place's
 * shape: a point, a line, an area), Select and move, Add at centre (where the crosshair points), Delete the chosen
 * position, Remove the last position: a named group of 48 px buttons, each its own Tab stop with its name (the kit's
 * one-stop `hcm-toolbar` hides its other tools' shadow trees from Tab, which the tour's Tab round reports as never
 * reached); the active one is pressed. Fires `hcm-tool` with `{tool}`.
 */
import type { UiLocale } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';

import { defineHcmIconButton } from '../../components/icon-button.js';
import { defineOnce, emit } from '../../components/internal.js';
import { adminBase } from '../shell/admin-styles.js';
import { contentText } from '../shell/text.js';
import type { PoiShapePort } from '../pois/pois-port.js';

export const HCM_DRAW_TOOLBAR_TAG = 'hcm-draw-toolbar';

export type DrawToolPort = 'draw' | 'select' | 'add-centre' | 'delete-vertex' | 'undo-vertex';

const SHAPE_ICONS: Readonly<Record<PoiShapePort, string>> = { point: 'place', linestring: 'polyline', polygon: 'pentagon' };

export class HcmDrawToolbar extends LitElement {
    static override readonly properties = {
        shape: { type: String },
        mode: { type: String },
        canDelete: { type: Boolean, attribute: 'can-delete' },
        canUndo: { type: Boolean, attribute: 'can-undo' },
        canAddCentre: { attribute: false },
        locale: { type: String },
        readOnly: { type: Boolean, attribute: 'read-only' },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: block;
                max-inline-size: 100%;
            }

            /* 40 px buttons in 48 px rings: 8 px apart, so no ring covers its neighbour's (M3 targets on a touch window). */
            .tools {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                align-items: center;
            }
        `,
    ];

    declare shape: PoiShapePort;
    /** The active tool: drawing the shape, or selecting and moving it. */
    declare mode: 'draw' | 'select';
    declare canDelete: boolean;
    declare canUndo: boolean;
    /** False until the place's centre is known (the map's, or the city's starting view without a map). */
    declare canAddCentre: boolean;
    declare locale: UiLocale;
    /** A revoked admin's editor (`DECISIONS-for-review.md` §42d): every tool is off. */
    declare readOnly: boolean;

    constructor() {
        super();
        this.shape = 'point';
        this.mode = 'select';
        this.canDelete = false;
        this.canUndo = false;
        this.canAddCentre = true;
        this.locale = 'en';
        this.readOnly = false;
    }

    #tool(
        tool: DrawToolPort,
        icon: string,
        label: string,
        options: { readonly pressed?: boolean; readonly disabled?: boolean } = {},
    ): TemplateResult {
        const pick = (): void => {
            emit(this, 'hcm-tool', { tool });
        };
        return html`<hcm-icon-button
            class=${tool}
            .icon=${icon}
            .label=${label}
            ?toggle=${options.pressed !== undefined}
            ?selected=${options.pressed === true}
            ?disabled=${options.disabled === true || this.readOnly}
            @click=${pick}
        ></hcm-icon-button>`;
    }

    override render(): TemplateResult {
        const text = (key: Parameters<typeof contentText>[1]): string => contentText(this.locale, key);
        return html`<div class="tools" role="group" aria-label=${text('adminContent.map.toolbar')}>
            ${this.#tool('draw', SHAPE_ICONS[this.shape], text('adminContent.map.tool.draw'), { pressed: this.mode === 'draw' })}
            ${this.#tool('select', 'crop_free', text('adminContent.map.tool.select'), { pressed: this.mode === 'select' })}
            ${this.#tool('add-centre', 'center_focus_strong', text('adminContent.map.tool.addCentre'), { disabled: !this.canAddCentre })}
            ${this.#tool('delete-vertex', 'delete', text('adminContent.map.tool.deleteVertex'), { disabled: !this.canDelete })}
            ${this.#tool('undo-vertex', 'undo', text('adminContent.map.tool.undoVertex'), { disabled: !this.canUndo })}
        </div>`;
    }
}

/** Registers `<hcm-draw-toolbar>` and the kit elements it renders. */
export function defineHcmDrawToolbar(registry: CustomElementRegistry = customElements): void {
    defineHcmIconButton(registry);
    defineOnce(registry, HCM_DRAW_TOOLBAR_TAG, HcmDrawToolbar);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-draw-toolbar': HcmDrawToolbar;
    }
}
