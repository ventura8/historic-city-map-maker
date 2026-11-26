/**
 * `<hcm-vertex-list>`: a shape's positions without a pointer (docs/research/M2c-interfaces.md §4.6; WCAG 2.1.1 and
 * 2.5.7): each position as its latitude and longitude (7 decimals), with Move up, Move down and Remove, and the choice of
 * the position Add at centre adds after. It edits the same draft as the map, so the map follows. Fires `hcm-vertex`
 * with the edit (`set`, `move`, `remove`) and `hcm-vertex-select` with `{index}` (null: none chosen).
 */
import type { LngLat, UiLocale } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmIconButton } from '../../components/icon-button.js';
import { defineOnce, emit } from '../../components/internal.js';
import { editingStyles } from '../editing/editing-styles.js';
import { contentText } from '../shell/text.js';
import type { VertexEditPort } from '../pois/pois-port.js';

export const HCM_VERTEX_LIST_TAG = 'hcm-vertex-list';

/** A coordinate as the field shows it: at most 7 decimals, no trailing zeros. */
export function coordinateText(value: number): string {
    return String(Number(value.toFixed(7)));
}

/** A typed coordinate within `limit` (90 for latitudes, 180 for longitudes), or null. */
export function coordinateOf(text: string, limit: number): number | null {
    const value = Number(text.trim().replace(',', '.'));
    return text.trim() !== '' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

export class HcmVertexList extends LitElement {
    static override readonly properties = {
        positions: { attribute: false },
        selected: { attribute: false },
        locale: { type: String },
        readOnly: { type: Boolean, attribute: 'read-only' },
    };

    static override readonly styles = [
        ...editingStyles,
        css`
            ol {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin: 0;
                padding: 0;
                list-style: none;
            }

            li {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                gap: 8px;
                padding: 8px;
                border-radius: var(--md-sys-shape-corner-medium, 12px);
            }

            /*
             * The chosen position is ringed, not filled: its fields and buttons keep the surface behind them (filled with the
             * secondary container, their borders and icons fell to 1.27:1 in the light high-contrast scheme).
             */
            li[data-chosen] {
                box-shadow: inset 0 0 0 2px var(--md-sys-color-secondary, Highlight);
            }

            .row-actions {
                grid-column: 1 / -1;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px;
            }

            .choose {
                flex: 1 1 auto;
                min-block-size: 48px;
                padding-inline: 12px;
                border: 1px solid var(--md-sys-color-outline, CanvasText);
                border-radius: var(--md-sys-shape-corner-full, 999px);
                background: transparent;
                color: inherit;
                font: inherit;
                text-align: start;
            }
        `,
    ];

    declare positions: readonly LngLat[];
    declare selected: number | null;
    declare locale: UiLocale;
    /** A revoked admin's editor (`DECISIONS-for-review.md` §42d): the positions are read-only, Move and Remove off. */
    declare readOnly: boolean;

    constructor() {
        super();
        this.positions = [];
        this.selected = null;
        this.locale = 'en';
        this.readOnly = false;
    }

    #edit(edit: VertexEditPort): void {
        emit(this, 'hcm-vertex', edit);
    }

    #set(index: number, axis: 0 | 1, input: HTMLInputElement): void {
        const position = this.positions[index];
        const value = coordinateOf(input.value, axis === 0 ? 180 : 90);
        if (position === undefined) {
            return;
        }
        // The field shows the shape's position until the area answers: an accepted edit renders the new one, a refused
        // one (outside the city, crossing edges) leaves the position as it was, and the field must not say otherwise.
        input.value = coordinateText(position[axis]);
        if (value !== null) {
            this.#edit({ kind: 'set', index, position: axis === 0 ? [value, position[1]] : [position[0], value] });
        }
    }

    #field(index: number, axis: 0 | 1, value: number): TemplateResult {
        const id = `v${String(index)}-${axis === 0 ? 'lng' : 'lat'}`;
        const label = contentText(this.locale, axis === 0 ? 'adminContent.map.longitude' : 'adminContent.map.latitude');
        return html`<div class="field">
            <label for=${id}>${label}</label>
            <input
                id=${id}
                inputmode="decimal"
                autocomplete="off"
                ?readonly=${this.readOnly}
                .value=${coordinateText(value)}
                @change=${(event: Event) => {
                    this.#set(index, axis, event.target as HTMLInputElement);
                }}
            />
        </div>`;
    }

    #row(position: LngLat, index: number): TemplateResult {
        const number = { number: String(index + 1) };
        const chosen = this.selected === index;
        const text = (key: Parameters<typeof contentText>[1]): string => contentText(this.locale, key, number);
        return html`<li ?data-chosen=${chosen}>
            ${this.#field(index, 1, position[1])} ${this.#field(index, 0, position[0])}
            <div class="row-actions">
                <button
                    type="button"
                    class="choose"
                    aria-pressed=${chosen ? 'true' : 'false'}
                    @click=${() => {
                        emit(this, 'hcm-vertex-select', { index: chosen ? null : index });
                    }}
                >
                    ${text('adminContent.map.vertex')}
                </button>
                ${this.#action('arrow_upward', text('adminContent.map.moveUp'), index === 0, { kind: 'move', index, by: -1 })}
                ${this.#action('arrow_downward', text('adminContent.map.moveDown'), index === this.positions.length - 1, { kind: 'move', index, by: 1 })}
                ${this.#action('delete', text('adminContent.map.removeVertex'), false, { kind: 'remove', index })}
            </div>
        </li>`;
    }

    #action(icon: string, label: string, disabled: boolean, edit: VertexEditPort): TemplateResult {
        return html`<hcm-icon-button
            .icon=${icon}
            .label=${label}
            ?disabled=${disabled || this.readOnly}
            @click=${() => {
                this.#edit(edit);
            }}
        ></hcm-icon-button>`;
    }

    override render(): TemplateResult {
        const empty = this.positions.length === 0;
        return html`<h3 id="vertices">${contentText(this.locale, 'adminContent.map.vertices')}</h3>
            ${empty ? html`<p class="note">${contentText(this.locale, 'adminContent.map.verticesEmpty')}</p>` : nothing}
            <ol aria-labelledby="vertices" ?hidden=${empty}>
                ${this.positions.map((position, index) => this.#row(position, index))}
            </ol>`;
    }
}

/** Registers `<hcm-vertex-list>` and the kit element it renders. */
export function defineHcmVertexList(registry: CustomElementRegistry = customElements): void {
    defineHcmIconButton(registry);
    defineOnce(registry, HCM_VERTEX_LIST_TAG, HcmVertexList);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-vertex-list': HcmVertexList;
    }
}
