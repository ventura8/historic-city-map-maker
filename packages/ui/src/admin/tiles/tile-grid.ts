/**
 * `<hcm-tile-grid>`: step 1 of the tile-import wizard (`docs/research/M20-import-local.md` §19.11; S-A-HAPPY-TILE-WIZARD-ORDER,
 * -KEYBOARD, -MOVE). The sheets' thumbnails in the inferred grid, each with the source of its place as a badge. A sheet is dragged to
 * a cell with a mouse or a pen; chosen, then Move and a tap on the cell (one pointer, no drag: a phone); or chosen with the arrows (a
 * roving tabindex): Shift and the arrows move it, R turns it, F mirrors it, X takes it out of the map. Each change is said in a live
 * region. The sheets left out are listed under the grid with Put back. On a phone the grid pans in its own frame: a touch never
 * starts a drag, so a swipe on the cells scrolls.
 */
import type { UiLocale } from '@hcm/shared';
import { css, html, LitElement, type PropertyValues, type TemplateResult } from 'lit';

import { cssProperties } from '../../components/css-properties.js';
import { adminBase } from '../shell/admin-styles.js';
import { emptyCellsSection } from './empty-cells.js';
import { gridSizeSection } from './grid-size.js';
import { sheetLabel, tilesText as t } from './tiles-text.js';
import { tileStyles } from './tiles-styles.js';
import type { TileSheetPort, TilesIntentsPort, TilesViewState } from './tiles-port.js';

const HCM_TILE_GRID_TAG = 'hcm-tile-grid';

const MOVES: Readonly<Record<string, readonly [number, number]>> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
};

type Action = 'rotate' | 'flip' | 'takeOut';

type SaidKey = 'adminTiles.said.turned' | 'adminTiles.said.mirrored' | 'adminTiles.said.out' | 'adminTiles.said.moved';

const ACTIONS: Readonly<Record<string, Action>> = { r: 'rotate', f: 'flip', x: 'takeOut' };

/** What the live region says after each change. */
const SAID: Readonly<Record<Action, SaidKey>> = {
    rotate: 'adminTiles.said.turned',
    flip: 'adminTiles.said.mirrored',
    takeOut: 'adminTiles.said.out',
};

/** The sheet placed in a cell, if any. */
function sheetIn(view: TilesViewState, row: number, col: number): TileSheetPort | undefined {
    return view.sheets.find((one) => one.out === null && one.row === row && one.col === col);
}

/** A thumbnail's CSS properties: its size and its place in the sprite (in sprite pixels), the sprite, its turn and mirror. */
export function thumbProperties(sheet: TileSheetPort, sprite: TilesViewState['thumbs']): Readonly<Record<string, string>> {
    const [x, y, width, height] = sheet.thumb;
    return {
        ...{ '--tw': String(width), '--th': String(height), '--tx': String(x), '--ty': String(y) },
        ...spriteProperties(sprite),
        '--tf': transformOf(sheet),
    };
}

/** A sprite's address and size as CSS properties (`--img`, `--sw`, `--sh`). */
export function spriteProperties(sprite: { readonly url: string; readonly width: number; readonly height: number } | null): {
    readonly '--img': string;
    readonly '--sw': string;
    readonly '--sh': string;
} {
    return sprite === null
        ? { '--img': 'none', '--sw': '0', '--sh': '0' }
        : { '--img': `url("${sprite.url}")`, '--sw': String(sprite.width), '--sh': String(sprite.height) };
}

/** The sheet's turn, then its mirror (CSS applies the right-most function first). */
function transformOf(sheet: TileSheetPort): string {
    const turn = `rotate(${String(sheet.turn)}deg)`;
    return sheet.flip ? `scaleX(-1) ${turn}` : turn;
}

/** Why a sheet is left out, as its text's key. */
function outKey(sheet: TileSheetPort): `adminTiles.out.${NonNullable<TileSheetPort['out']>}` {
    return `adminTiles.out.${sheet.out ?? 'not-part'}`;
}

/** A cell's name: the sheet in it, or empty with its row and column (counted from 1). */
function cellLabel(locale: UiLocale, sheet: TileSheetPort | undefined, row: number, col: number): string {
    return sheet === undefined
        ? t(locale, 'adminTiles.cellEmpty', { row: String(row + 1), col: String(col + 1) })
        : sheetLabel(locale, sheet);
}

class HcmTileGrid extends LitElement {
    static override readonly properties = {
        view: { attribute: false },
        intents: { attribute: false },
        locale: { type: String },
        moving: { state: true },
        said: { state: true },
    };

    static override readonly styles = [
        adminBase,
        tileStyles,
        css`
            :host {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .frame {
                max-inline-size: 100%;
                max-block-size: 70dvh;
                overflow: auto;
                padding: 6px;
            }

            .grid {
                display: grid;
                grid-template-columns: repeat(var(--cols), var(--hcm-tile-cell));
                gap: 4px;
                inline-size: max-content;
            }

            [role='row'] {
                display: contents;
            }

            [role='gridcell'] {
                position: relative;
                display: grid;
                place-items: center;
                inline-size: var(--hcm-tile-cell);
                block-size: var(--hcm-tile-cell);
                box-sizing: border-box;
                border: 1px dashed var(--md-sys-color-outline-variant, GrayText);
                border-radius: var(--md-sys-shape-corner-small, 8px);
                cursor: grab;
                touch-action: pan-x pan-y;
            }

            [role='gridcell'][aria-selected='true'] {
                border: 2px solid var(--md-sys-color-primary, Highlight);
            }

            [role='gridcell']:focus-visible {
                outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
                outline-offset: 2px;
            }

            .tools,
            ul {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin: 0;
                padding: 0;
                list-style: none;
            }

            li {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px;
            }
        `,
    ];

    declare view: TilesViewState | null;
    declare intents: TilesIntentsPort | null;
    declare locale: UiLocale;
    /** Move was pressed: the next cell tapped takes the chosen sheet. */
    declare moving: boolean;
    /** The live region's text: what the last change did. */
    declare said: string;
    /** The sheet a mouse or pen pressed, and its cell. */
    /** An arrow key was pressed: focus the chosen cell after the next view. */
    #refocus = false;
    #dragging: { readonly index: number; readonly row: number; readonly col: number } | null = null;

    constructor() {
        super();
        this.view = null;
        this.intents = null;
        this.locale = 'ro';
        this.moving = false;
        this.said = '';
    }

    /** Moves the focus to the chosen cell after a keyboard move (the roving tabindex follows the selection). */
    focusSelected(): void {
        this.renderRoot.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus();
    }

    /** After an arrow key, the focus follows the chosen cell once the store's new view is drawn (not the live region's redraw). */
    protected override updated(changed: PropertyValues): void {
        if (this.#refocus && changed.has('view')) {
            this.#refocus = false;
            this.focusSelected();
        }
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return html``;
        }
        const rows = Array.from({ length: view.rows }, (_, row) => row);
        return html`<p class="note" id="grid-help">${t(this.locale, 'adminTiles.gridHelp')} ${t(this.locale, 'adminTiles.gridKeys')}</p>
            <div class="frame">
                <div
                    class="grid"
                    role="grid"
                    aria-label=${t(this.locale, 'adminTiles.gridLabel')}
                    aria-describedby="grid-help"
                    ${cssProperties({ '--cols': String(view.cols) })}
                    @keydown=${this.#key}
                    @pointerup=${this.#drop}
                >
                    ${rows.map((row) => this.#row(view, row))}
                </div>
            </div>
            <p class="note" role="status">${this.said}</p>
            ${this.#tools(view)} ${gridSizeSection(this.locale, view, this.intents)} ${this.#left(view)}
            ${emptyCellsSection(this.locale, view)}`;
    }

    /** The sheet in the chosen cell, if any. */
    #chosen(view: TilesViewState): TileSheetPort | undefined {
        return sheetIn(view, view.selected.row, view.selected.col);
    }

    /** The sheet in the chosen cell of the view as it stands, if any. */
    #current(): TileSheetPort | undefined {
        return this.view === null ? undefined : this.#chosen(this.view);
    }

    /** Says what a change did to the chosen sheet, by its name. */
    #say(key: SaidKey, params: Readonly<Record<string, string>> = {}): void {
        const sheet = this.#current();
        this.said = sheet === undefined ? t(this.locale, 'adminTiles.said.empty') : t(this.locale, key, { name: sheet.name, ...params });
    }

    #row(view: TilesViewState, row: number): TemplateResult {
        const cols = Array.from({ length: view.cols }, (_, col) => col);
        return html`<div role="row">${cols.map((col) => this.#cell(view, row, col))}</div>`;
    }

    #cell(view: TilesViewState, row: number, col: number): TemplateResult {
        const sheet = sheetIn(view, row, col);
        const selected = view.selected.row === row && view.selected.col === col;
        const label = cellLabel(this.locale, sheet, row, col);
        return html`<div
            role="gridcell"
            tabindex=${selected ? 0 : -1}
            aria-selected=${selected ? 'true' : 'false'}
            aria-label=${label}
            data-row=${row}
            data-col=${col}
            @click=${() => {
                this.#tap(row, col);
            }}
            @pointerdown=${(event: PointerEvent) => {
                this.#dragging = sheet === undefined || event.pointerType === 'touch' ? null : { index: sheet.index, row, col };
            }}
        >
            ${sheet === undefined ? '' : this.#thumb(view, sheet)}
        </div>`;
    }

    #thumb(view: TilesViewState, sheet: TileSheetPort): TemplateResult {
        const source = t(this.locale, `adminTiles.source.${sheet.source}`);
        return html`<span class="thumb" aria-hidden="true" ${cssProperties(thumbProperties(sheet, view.thumbs))}></span
            ><span class="badge" aria-hidden="true">${source}</span>`;
    }

    #tools(view: TilesViewState): TemplateResult {
        const chosen = this.#chosen(view);
        return html`<div class="tools">
            <hcm-button
                variant="tonal"
                icon="drag_indicator"
                .pressed=${this.moving}
                ?disabled=${chosen === undefined}
                @click=${() => {
                    this.#toggleMove(chosen);
                }}
                >${t(this.locale, 'adminTiles.move')}</hcm-button
            >
            <hcm-button
                variant="tonal"
                icon="refresh"
                @click=${() => {
                    this.#do('rotate');
                }}
                >${t(this.locale, 'adminTiles.rotate')}</hcm-button
            >
            <hcm-button
                variant="tonal"
                icon="compare"
                @click=${() => {
                    this.#do('flip');
                }}
                >${t(this.locale, 'adminTiles.flip')}</hcm-button
            >
            <hcm-button
                variant="outlined"
                icon="layers_clear"
                @click=${() => {
                    this.#do('takeOut');
                }}
                >${t(this.locale, 'adminTiles.notPart')}</hcm-button
            >
        </div>`;
    }

    /** R, F or X (or its button): the chosen sheet turned, mirrored or taken out, and said. */
    #do(action: Action): void {
        this.#say(SAID[action]);
        this.intents?.[action]();
    }

    /** Move: on, it waits for the cell to tap (and says so); pressed again, or with no sheet chosen, it is off. */
    #toggleMove(chosen: TileSheetPort | undefined): void {
        if (chosen === undefined || this.moving) {
            this.moving = false;
            this.said = '';
            return;
        }
        this.moving = true;
        this.said = t(this.locale, 'adminTiles.movePick', { name: chosen.name });
    }

    /** A tap on a cell: with Move pressed, the chosen sheet goes there; else the cell is chosen. */
    #tap(row: number, col: number): void {
        if (this.moving) {
            this.moving = false;
            this.#moveTo(row, col);
            return;
        }
        this.intents?.select(row, col);
    }

    /** The chosen sheet dropped on a cell (Move, then a tap), said. */
    #moveTo(row: number, col: number): void {
        const sheet = this.#current();
        if (sheet !== undefined) {
            this.#say('adminTiles.said.moved', { row: String(row + 1), col: String(col + 1) });
            this.intents?.place(sheet.index, row, col);
        }
    }

    #left(view: TilesViewState): TemplateResult {
        const out = view.sheets.filter((sheet) => sheet.out !== null);
        if (out.length === 0) {
            return html``;
        }
        return html`<section aria-labelledby="left-out">
            <h3 id="left-out">${t(this.locale, 'adminTiles.outLabel')}</h3>
            <ul>
                ${out.map(
                    (sheet) =>
                        html`<li>
                            <span>${sheet.name}: ${t(this.locale, outKey(sheet))}</span>
                            <hcm-button variant="text" icon="undo" @click=${() => this.intents?.putBack(sheet.index)}
                                >${t(this.locale, 'adminTiles.putBack', { name: sheet.name })}</hcm-button
                            >
                        </li>`,
                )}
            </ul>
        </section>`;
    }

    #key = (event: KeyboardEvent): void => {
        const move = MOVES[event.key];
        if (move !== undefined) {
            event.preventDefault();
            this.#moveBy(move, event.shiftKey);
            return;
        }
        this.#act(event);
    };

    /** R, F or X without a modifier: the chosen sheet turned, mirrored or taken out. */
    #act(event: KeyboardEvent): void {
        const action = event.ctrlKey || event.metaKey ? undefined : ACTIONS[event.key.toLowerCase()];
        if (action !== undefined) {
            event.preventDefault();
            this.#do(action);
        }
    }

    #moveBy([rows, cols]: readonly [number, number], shifted: boolean): void {
        const intents = this.intents;
        const view = this.view;
        if (intents === null || view === null) {
            return;
        }
        if (shifted) {
            this.#shifted(view, rows, cols);
            intents.shift(rows, cols);
        } else {
            intents.select(view.selected.row + rows, view.selected.col + cols);
        }
        this.#refocus = true;
    }

    /** Says where Shift and an arrow move the chosen sheet (inside the grid). */
    #shifted(view: TilesViewState, rows: number, cols: number): void {
        const row = Math.min(Math.max(view.selected.row + rows, 0), view.rows - 1);
        const col = Math.min(Math.max(view.selected.col + cols, 0), view.cols - 1);
        this.#say('adminTiles.said.moved', { row: String(row + 1), col: String(col + 1) });
    }

    #drop = (event: PointerEvent): void => {
        const drag = this.#dragging;
        this.#dragging = null;
        const target = drag === null ? null : this.#cellAt(event);
        if (drag !== null && target !== null) {
            this.#dropOn(drag, Number(target.dataset['row']), Number(target.dataset['col']));
        }
    };

    /** A pressed sheet let go on a cell: placed there, unless it is its own cell (a plain click, which chooses it). */
    #dropOn(drag: { readonly index: number; readonly row: number; readonly col: number }, row: number, col: number): void {
        if (row !== drag.row || col !== drag.col) {
            this.intents?.place(drag.index, row, col);
        }
    }

    /** The grid's cell under the pointer, if any. */
    #cellAt(event: PointerEvent): HTMLElement | null {
        const under = (this.renderRoot as ShadowRoot).elementFromPoint(event.clientX, event.clientY);
        return under === null ? null : under.closest<HTMLElement>('[role="gridcell"]');
    }
}

export function defineHcmTileGrid(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_TILE_GRID_TAG) === undefined) {
        registry.define(HCM_TILE_GRID_TAG, HcmTileGrid);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-tile-grid': HcmTileGrid;
    }
}
